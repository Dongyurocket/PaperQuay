# 2026-11-23 - 审计 4B-3 小批：MCP 数据一致性（D3-4、D3-11、D3-14）

关联计划：[2026-11-23 审计剩余工作清单](../plans/2026-11-23-audit-remaining.md)。本批为第 4 批收口，只处理以下三项，不改 schema、不重构其他模块：

- D3-4：MCP 读工具在库缺失时建库，`preview_delete_papers` 以可写连接打开文库。
- D3-11：外部写入标记先读后写，并发进程互相覆盖 revision。
- D3-14：`create_note` / `update_note` 接受不存在的 paperId/folderId。

## 现象

- **D3-4**：`list_note_tags` / `list_note_folders` 通过 `createNoteStore` 打开 notes 库，`openDatabase` 会 `mkdir`、建表并跑迁移；只读探测因此创建了数据库。`preview_delete_papers` 用 `createLibraryStore` 打开文库，同样会建库/补 schema，并持有写连接。
- **D3-11**：`recordExternalWrite` 先 `readExternalWriteMarker` 取旧 revision，再写临时文件并 rename。两个 MCP/桌面进程同时写入时会基于同一个旧值各 +1，后写覆盖前写，桌面端少收到一次刷新；崩溃在 rename 前也没有留下可审计记录。
- **D3-14**：`noteStore.createNote` / `updateNote` 只归一化 `folderId`，从不检查目标是否存在；MCP `createNote` 也只把 `paperId` 写成字符串。笔记因此可能绑定到文献列表与文件夹树里都找不到的目标。

## 修改

### D3-4 读工具只读打开，库缺失返回空结果

- `electron/mcp/knowledgeMcpService.cjs`
  - `listNoteTags` / `listNoteFolders` 改用 `getNotesDb()`（`openReadOnlyDb`），库缺失直接返回 `{ tags: [], total: 0 }` / `{ folders: [], total: 0 }`，不再调用 `createNoteStore`。
  - `previewDeletePapers` 改用 `openReadOnlyDb(libraryDatabasePath)`；库缺失返回空预览（`papers/files/sharedFiles/unmanagedFiles` 为空、计数为 0、附带 `message`），存在时用只读连接读取 paper、settings 与同路径附件引用，再交给 `describeDeletePreview`。
- `electron/backend/noteStore.cjs`：抽出 `queryNoteTags(db, request)` / `queryNoteFolders(db)`，内部 `listTags` / `listFolders` 与 MCP 只读路径共用；表缺失时返回空数组，不建表。
- `electron/backend/libraryDatabaseStore.cjs`：抽出并导出 `getPaperFromDb`、`findAttachmentsByStoredPathInDb`、`loadLibrarySettingsFromDb`；写路径（`deletePapersWithPreviewFromDb`、`findAttachmentsByStoredPath`）改为复用同一查询，避免读写两套口径。

### D3-11 外部写入标记改为 SQLite 原子 UPSERT

- `electron/backend/externalWriteMarker.cjs`
  - 标记文件从 `.paperquay-external-writes.json` 换成 `.paperquay-external-writes.sqlite`，表 `external_writes(scope, revision, updated_at, source)`。
  - `recordExternalWrite` 在 `BEGIN IMMEDIATE` 事务内执行 `INSERT ... ON CONFLICT (scope) DO UPDATE SET revision = external_writes.revision + 1`，每次写入原子递增，读者看到的是已提交的完整 revision。
  - 旧 JSON 仅在标记库没有任何行时作为迁移基线读取一次（`INSERT OR IGNORE` 播种两个 scope），之后不再写入；`.json` 文件保留不删。事务提交前崩溃留下的空库会继续回退到旧基线，不会把 revision 归零。
  - 读路径 `readExternalWriteMarker` 用只读连接；库损坏/不可读仍返回 `unknown`，桌面的保守写护栏语义不变。
- `electron/backend/externalWriteWatch.cjs`：目录 watch 的文件名过滤接受标记主库与 `-journal` / `-wal` / `-shm` 边车，避免提交只触发边车事件时漏刷新。

### D3-14 笔记目标校验

- `electron/backend/noteStore.cjs`
  - 新增 `assertNoteTargets`：folder 必须在 `note_folders` 存在；paper 是否存在由调用方注入 `assertPaperExists` 回调（`global-notes` 跳过）。
  - `createNote` 在同一写事务内、`upsertNote` 之前校验；失败抛 `FOLDER_NOT_FOUND` / `PAPER_NOT_FOUND`，事务回滚，不留下笔记行。
  - `updateNote` 仅在 `patch` 显式包含 `folderId` 时校验 folder；历史笔记已绑定被删除 folder 时，其他字段仍可更新。`updateNote` 本身不接受 `paperId`，因此无需 paper 校验。
- `electron/mcp/knowledgeMcpService.cjs`
  - 新增 `paperExists(paperId)`：只读打开文库查询 `papers.id`，库缺失即视为不存在。
  - `createNote` 把 `assertPaperExists` 传入 noteStore，使校验发生在笔记写事务内。
- `tests/knowledgeMcpNotesWrite.test.ts` 的 `setup()` 用真实 `createLibraryStore` 建立最小文库（`paper-1`、`paper-2`），既有 `paperId` 用例继续成立。

## 验证

- 新增/更新用例：
  - `tests/knowledgeMcpNotesWrite.test.ts`：notes 库缺失时两个读工具返回空且不创建 `-wal/-shm`；不存在的 paper/folder 分别返回 `PAPER_NOT_FOUND` / `FOLDER_NOT_FOUND` 且失败不落库；`global-notes`、合法 paper、合法 folder 均通过；文库缺失时带 `paperId` 的创建被拒。
  - `tests/knowledgeMcpRuntimeWrite.test.ts`：文库缺失时预览返回空且不创建库；删除 `library_meta` 后预览仍保持该表缺失、主库字节不变、无 `-journal`，证明走只读连接且不迁移。
  - `tests/noteStore.test.ts`：写事务内 folder/paper 校验、失败回滚、历史 dangling folder 不阻塞标题更新。
  - `tests/externalWriteMarker.test.ts`：缺失标记不建文件；旧 JSON revision 迁移后继续递增；空标记库（模拟提交前崩溃）仍回退旧基线；两个子进程各 40 次并发写后 revision 精确等于 80，读者随后连续读到严格 +1。
- 定向用例（2026-11-23，本机）：
  - `node --test tests/noteStore.test.ts tests/noteStoreSelection.test.mjs tests/noteVault.test.ts tests/knowledgeMcp*.test.* tests/externalWriteMarker.test.ts tests/desktopRunMarker.test.ts`：94 项全过。
  - `node --test tests/externalWriteMarker.test.ts`：4 项全过。
- `npm run typecheck`：四个项目 0 诊断。
- `npm test`：1021 项，1020 通过、1 跳过、0 失败。首轮曾在并行负载下出现一次 `tests/knowledgeGraphCommands.test.mjs` 的临时 JSON `EPERM`（与本批无关），该文件单独运行 9 项全过，整仓重跑全绿。

## 剩余风险

- 只读打开 WAL 模式的库仍可能创建空的 `-wal` / `-shm` 边车文件（SQLite 行为，不写数据、不建表）；目录级 watcher 可能看到这些事件，但 MCP 读不会改变库内容。
- 外部写入标记换成 SQLite 后，revision 的审计粒度仍是「每个 scope 一行最新值」；并发写入的递增不会丢失，但不会保留逐事件历史（计划允许的 UPSERT 方案）。
- 标记库未被现有备份/导入流程显式处理；丢失后会从旧 JSON 或 0 重新开始，桌面端只比较差值，可能少一次刷新，与旧实现删除标记文件的行为一致。
- 标记写入是单写者事务；极端多进程争用时超过 5 s busy timeout 会抛 `SQLITE_BUSY`，`markExternalWrite` 会记录错误并返回 false（数据写入本身已完成，界面刷新可能延后到下一次写入或聚焦比对）。
- D3-14 的 paper 校验由 MCP 注入回调实现；桌面端 `notes_create` 仍只校验 folder，不校验 paperId（本批范围限定 MCP 数据一致性）。
- `update_note` 不支持修改 `paperId`，因此“更新到不存在的 paper”当前不可达；若后续开放该字段，需要同时接入 paper 校验。
