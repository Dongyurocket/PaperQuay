# 2026-11-23 - 审计 4B-2 小批：Zotero WAL 快照、外部 I/O 限额与备份硬链接/worker 校验（D2-11、D2-12、D2-13）

关联计划：[2026-11-23 审计剩余工作清单](../plans/2026-11-23-audit-remaining.md)。本批只处理以下三项，不改 schema、不重构其他模块：

- D2-11：Zotero 本地库的 WAL 一致性与 WASM 内存占用。
- D2-12：元数据 HTTP、远程 PDF 下载与本地 PDF 导入的超时和大小上限。
- D2-13：备份恢复的硬链接回退，以及 VACUUM/integrity_check 的主线程阻塞。

## 现象

- **D2-11**：`withLocalZoteroDatabase` 只复制 `zotero.sqlite`，Zotero 运行中尚未 checkpoint 的 `-wal` 行完全不可见；在 WAL 模式下主库甚至可能还没有 schema。随后又把整个复制文件读入 `sql.js` WASM，大库会占用数倍内存。临时文件名用 `Date.now() + pid`，并发查询会在同一毫秒互相覆盖，出现 `no such table`。
- **D2-12**：OpenAlex/Crossref 的 `fetch` 没有超时，`readRequestJson` 会把响应整体读入内存；`download_remote_file_to_path` 直接写目标文件并整文件 `arrayBuffer()`，超时/超限会留下损坏目标；`downloadZoteroAttachmentPdf` 同样无上限；本地导入先 `readFile` 整篇 PDF 再 `hashBytes`，大文件会一次性进堆。
- **D2-13**：`processEntries` 只用 `fsp.link` 发布文件；FAT/exFAT、SMB 与部分加密卷不支持硬链接（Windows 常返回 `EPERM`），恢复在最后一步失败。`libraryDatabaseStore` / `noteStore` / `ragStore` 的 `snapshotTo` 与 `backupSources.checkDatabase` 在主线程同步执行 `VACUUM main INTO` 与 `PRAGMA integrity_check`，大库会卡住 UI。

## 修改

### D2-11 Zotero 读一致快照，不再整库进 WASM

- `electron/backend/zoteroLocal.cjs`
  - 改用 `node:sqlite` 只读连接执行 `VACUUM main INTO '<temp>'`：读到包含 WAL 未 checkpoint 行的一致单文件快照，Zotero 运行中也可安全读取。
  - 若当前 SQLite/文件系统无法 VACUUM 或拿不到读锁，回退复制 `sqlite + -wal + -shm`，再对新副本做 `PRAGMA quick_check`；最多 3 次，避免把半写入文件当数据库。
  - 每次查询使用带随机后缀的独立临时目录文件；全局 FIFO 槽位把并发快照限制为 2，避免多个大库同时 VACUUM/复制拖垮主进程或占满临时盘。
  - 查询层改为 `node:sqlite` 的 `prepare(sql).all(...params)` 窄适配，不再 `require('sql.js')`、不再把整库读入 WASM；内存由 SQLite 页缓存控制。对外导出的查询函数与返回字段不变。
- `tests/zoteroLocal.test.ts` 新增：
  - WAL 中未 checkpoint 的行可见（保持写入连接打开、`wal_autocheckpoint=0`）。
  - 拦截 `Module._load('sql.js')` 后本地查询仍成功，证明不再走 WASM。
  - 6 个并发查询全部返回正确结果（槽位队列不死锁）。

### D2-12 外部 I/O 超时、大小上限与流式落盘

- 新增 `electron/backend/httpIO.cjs`
  - `fetchJsonLimited`：`AbortSignal.timeout`（默认 15 s）+ `Content-Length` 预检 + 流式累计上限（默认 8 MiB）；超时、取消、超限、HTTP 状态与 JSON 错误都带可读代码（`HTTP_TIMEOUT` / `CANCELLED` / `HTTP_RESPONSE_TOO_LARGE` / `HTTP_STATUS` / `HTTP_INVALID_JSON`）。
  - `downloadUrlToFile`：默认 60 s / 512 MiB；按块读取并写入同目录 `.partial` 文件，成功后 rename；超时、超限、流错误都会关闭句柄并删除半成品，不会留下可误用的目标文件。
  - `resolveLimit`：允许后端 context 注入小上限用于测试，渲染层不能抬高上限。
- `electron/backend/libraryCommands.cjs`
  - OpenAlex、Crossref、Crossref references 全部改走 `fetchJsonLimited`，限额从 `context.httpLimits`（`metadataTimeoutMs` / `metadataMaxBytes`）读取。
  - `library_import_pdfs` 先 `stat` 拒绝超过 512 MiB 的文件（`context.importLimits.maxPdfBytes` 可注入），再用 `hashFile` 流式哈希替代 `readFile + hashBytes`。
- `electron/backend/fileCommands.cjs`：`download_remote_file_to_path` 改用 `downloadUrlToFile`，超时/上限由 `context.httpLimits` 控制。
- `electron/backend/zoteroApi.cjs`：`downloadZoteroAttachmentPdf` 复用同一流式下载与清理逻辑。
- 用例：
  - 新增 `tests/httpIO.test.ts` 9 项：JSON 解析、超时、声明长度超限、分块累计超限、流式成功、超限清理、流错误清理、下载超时清理。
  - `tests/fileCommands.test.ts` 新增 3 项：流式落盘、分块超限清理、下载超时。
  - `tests/libraryCommands.test.mjs` 新增 3 项：导入大小上限、流式哈希、元数据请求携带 `AbortSignal`。

### D2-13 硬链接回退与备份校验移出主线程

- `electron/backend/backupContainer.cjs`
  - 新增 `publishExtractedFile`：优先 `fsp.link`；遇到 `EPERM`/`EACCES`/`ENOSYS`/`ENOTSUP`/`EXDEV`/`EINVAL`/`EMLINK` 时回退同目录 `rename`；`EEXIST` 等真实冲突照常抛出。`processEntries` 改用它发布解密文件。
- 新增 `electron/backend/backupDatabaseWorker.cjs` 与 `backupDatabaseSnapshot.cjs`
  - worker 内用只读 `VACUUM main INTO` 生成快照、设置 `user_version`、执行 `integrity_check`/`quick_check` 并统计行数；RAG 库按需加载 `sqlite-vec`。
  - 宿主默认 120 s 超时，支持 `AbortSignal` 取消；超时/取消会终止 worker，分别返回 `DB_SNAPSHOT_TIMEOUT` / `CANCELLED`；worker 异常返回 `DB_SNAPSHOT_FAILED`，完整性失败保留 `DB_INTEGRITY_FAILED`。
- `electron/backend/backupSources.cjs`
  - library、notes、rag 三个快照全部改走 worker；删除主线程的 `checkDatabase` / `readCounts` / `updateUserVersion` 同步路径。超时可由 `context.backupSnapshotTimeoutMs` 注入，测试可注入 `createBackupSnapshotWorker`。
- 用例：
  - `tests/backupContainer.test.ts` 新增硬链接失败回退 rename、`EEXIST` 不掩盖两项。
  - 新增 `tests/backupDatabaseSnapshot.test.ts` 4 项：超时终止、取消终止、worker 结果透传、真实 WAL 库在 worker 中快照并统计。

## 验证

- 定向用例（2026-11-23，本机）：
  - `node --test tests/zoteroLocal.test.ts`：6 项全过。
  - `node --test tests/httpIO.test.ts tests/fileCommands.test.ts tests/libraryCommands.test.mjs`：32 项全过。
  - `node --test tests/backupContainer.test.ts tests/backupDatabaseSnapshot.test.ts tests/backupPackage.test.ts`：17 项全过。
- `npm run typecheck`：四个项目 0 诊断。
- `npm test`：1011 项，1010 通过、1 跳过、0 失败。

## 剩余风险

- Zotero 每次查询仍要生成一份完整快照（`VACUUM INTO` 写盘），大库会增加延迟与临时盘占用；并发上限为 2，但单次快照的内存/磁盘成本与库大小线性相关。
- 若 `VACUUM INTO` 不可用，复制 `sqlite + -wal + -shm` 无法严格证明跨文件一致性；目前依赖 `quick_check` 与最多 3 次重试，极端写入场景仍可能读到逻辑上不完整的快照。
- 元数据限额只能在 backend context 注入，UI 不可调；`lookup_literature_metadata` 仍把单个来源的失败吞成 `null`，超时不会直接提示用户。
- PDF 导入上限固定 512 MiB；哈希与复制分两次读取，存在哈希后文件被替换的 TOCTOU 窗口；`move` 模式仍在提交后才删除源文件。
- 备份快照超过 120 s 会直接失败，没有回退到主线程同步路径；导出时源数据库缺失也会整体失败（不再由 `store.snapshotTo` 创建空快照）。
- 硬链接成功后若杀软占用临时文件，`unlink` 失败被忽略，可能残留 `.partial`；回退 `rename` 依赖同目录，目标卷与临时文件同目录成立，但未在 FAT/SMB 实机上做安装版恢复演练。
