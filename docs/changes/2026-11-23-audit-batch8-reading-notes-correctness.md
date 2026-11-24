# 2026-11-23 - 第 8 批：阅读/笔记正确性

## 现象

第 7 批收口后仍有一组阅读与笔记正确性问题，集中在数据可逆性、冲突校验与后台刷新语义：

- **笔记检索**：`search_notes` / 桌面 `notes_search` 只在 FTS 抛错时回退 LIKE，FTS 返回 0 行时静默为空；旧库或迁移后 `notes_fts` 缺行时笔记不可搜索。
- **MCP 笔记读写**：`get_note` 只返回扁平 `contentText`，`update_note` 只接受 Markdown；富文本（加粗、列表、锚点块）经过一次往返即丢失结构。
- **文件夹删除**：`expectedFolderVersions` 只校验调用方给出的条目，遗漏子文件夹时仍会删除整棵子树。
- **MCP 检索契约**：`search_notes` schema 不允许 `pageKind: ''`，也未声明 handler 已支持的 `tag`/`type`/`noteIds`/`linkedPaperId`。
- **文献库刷新**：挂载时首屏查询与 180ms 防抖可能重复；后台 MinerU 状态发现会改变查询回调身份、推进代次、清空多选并反复重查。
- **翻译缓存**：清空只清内存，磁盘缓存会被恢复 effect 重新读回；缓存键只有目标语言；整表覆盖写入会丢并发块。
- **Reader 标签**：只有翻译中的标签计入 busy，运行中问答所在的标签可能被卸载。
- **详情表单快捷键**：书房工作区隐藏后 window Ctrl+S/Escape 仍能保存/丢弃草稿。
- **Notes 列表**：folder 计数逐 folder 过滤（O(folders×notes)），渲染层静默截断 1000 条笔记。
- **Vault 自动同步**：禁用后 in-flight sync 不取消；小 vault 的同步前缀仍阻塞主线程。
- **S5 笔记残留**：标题/标签/颜色按键重算正文哈希；首键 120ms 内关闭/切笔记可能无草稿；4MiB 上限丢弃 8×256KB 夹具；`data:` 中段替换不可检测。
- **第 7 批残留**：批量删除先删文件后删记录；`onAllPapersChange` 死回调；`hasPdf` 筛选为 stat 水合整库；`source:null + pdfData` 签名依赖显示名。

## 根因

- FTS 查询把「0 命中」与「索引缺失」混为一谈；建表逻辑只创建空表，没有启动时的完整性回填。
- MCP 笔记工具以 Markdown/纯文本为交换格式，没有暴露结构化的唯一事实源。
- 版本快照只做「给了就校验」，没有把覆盖完整性作为冲突条件。
- Schema 与 handler 各自演进，能力声明滞后。
- 文献库把「用户条件」与「后台状态发现」共用同一个查询键和代次。
- 翻译缓存路径只按语言命名，写入没有 read-merge-write 临界区；清空没有失效磁盘与在途读取。
- Reader busy 只看翻译状态；详情快捷键没有可见性/焦点边界。
- Notes 列表按 folder 重复扫描；服务调用有 1000 条硬上限。
- Vault 同步器只有「同步前缀 + 异步续跑」，没有取消令牌，也没有后台起步模式。
- 笔记签名把正文哈希与元数据按键绑在同一个 memo；草稿只节流后生成 payload；草稿持久化重复保存 HTML。
- 批量删除把文件清理放在数据库事务之前；`onAllPapersChange` 的消费者已移除但传参链未删；附件筛选沿用 `store.load()`。

## 修改

### D2-5 FTS 0 行回退与启动回填

- `noteSearch.keywordNotes`：FTS 查询 0 行时丢弃该结果并回退 LIKE，`channel` 如实返回 `like`。
- `noteStore.createSchema` 结束时 `rebuildNotesFtsIfStale`：比较有效笔记数与 `notes_fts` 行数，并检查是否有有效笔记缺索引；不一致时在事务内 `DELETE + INSERT ... SELECT` 全量回填，软删除笔记不回填并清理残留行。
- 回填不修改 schema 或 `user_version`；FTS 表缺失/不可用时保持 LIKE 回退。
- 用例：`tests/noteStoreSearchFts.test.ts`（3）。
- **复核修正**：本批只改了 `noteSearch.keywordNotes`（桌面与 MCP hybrid 共用）。MCP `search_notes` 的 keyword 模式仍走 `knowledgeMcpService.searchNotesKeyword`，FTS 分支只在抛错时回退；实测删除一条 `notes_fts` 行后 `search_notes({mode:'keyword'})` 返回 0。回填检查也只判断行是否存在，外部直接改标题/正文留下的陈旧索引行不会重建；MCP 只读打开不触发回填。D2-5 转 partial，第 9 批补 MCP 0 行回退与说明。

### D3-6 笔记结构化 round trip

- `get_note` 返回 `contentJson` 与 `contentFormat: 'tiptap-json'`；文档序列化超过 2,000,000 字符时省略 JSON 并标记 `contentJsonTruncated`，文本仍分页返回。
- `update_note` 新增 `contentJson` 入参：必须为 `{type:'doc', content:[...]}`；与 `content` 互斥。写入时 `contentText` 由 JSON 派生，`contentHtml` 清空，`content` 置空避免两份正文漂移。
- 已有锚点必须在新 `contentJson` 中全部保留（`noteAnchorBlock`/`noteAnchorLink`），缺失返回 `NOTE_ANCHOR_MISSING`；Markdown 路径的 `paperquay://anchor/<id>` 校验保留。
- 用例：`tests/knowledgeMcpNoteStructured.test.ts`（5）。

### D3-7 文件夹版本快照全覆盖

- `deleteFolder` 在提供 `expectedFolderVersions` 时，目标与全部后代都必须有条目；缺失或版本不一致均返回 `NOTE_CONFLICT`，事务整体回滚。
- 未提供版本映射的桌面删除保持原语义。
- 用例：`tests/noteStoreFolderVersions.test.ts`（2）。

### D3-12 search_notes schema 与过滤对齐

- `pageKind` enum 增加 `''`（清除筛选）；新增 `tag`、`type`、`noteIds`、`linkedPaperId` 声明。
- `searchNotesKeyword` 同步支持四类过滤，keyword 降级路径不再忽略；`noteIds` 使用 `json_each`，`tag` 大小写不敏感，`type` 白名单校验。
- 用例：`tests/knowledgeMcpNoteStructured.test.ts`、`tests/mcpContract.test.ts`、`tests/knowledgeMcp.test.ts`（更新 pageKind enum 断言）。

### D4-6 + D6-13 文献库首屏与状态发现分流

- 首屏 `loadLibraryFirstScreen` 之后无条件 `skipNextDebouncedQueryRef = true`，挂载不再重复查询。
- `refreshPapers` 读取 `queryStateRef` 的最新条件，回调身份不再随 `filters`/`mineruPaperIds` 变化；只有用户查询推进 `papersQueryGenerationRef`。
- 新增 `papersRefreshing` 区分首次加载与后台刷新；分类点击跳过随后防抖查询。
- **复核修正**：`papersRefreshing` 目前只被赋值，`src` 内无消费者；并发刷新时 `finally` 可能提前清除。首屏 `loading` 期间修改筛选/搜索会被防抖 effect 的 `loading` 早退吞掉（`useLibraryCatalog.ts:222-224` 注释已过期）。D4-6 转 partial，第 9 批接 UI 并修首屏窗口。
- 新增 `libraryQueryPolicy.ts`：查询触发键只含用户筛选/排序/搜索/分类；MinerU 发现结束时只递增版本，筛选开启时做一次尾部刷新（`source:'status'`、保留选择），筛选关闭时只合并 `paperStatuses`。
- `usePaperSelection` 的筛选清空与 `SelectionFilterSnapshot` 移除 `mineruIdKey`，状态发现不再清空多选或使在途全选失效。
- 用例：`tests/libraryQueryPolicy.test.ts`（5）、`tests/selectionFilterGuard.test.ts`（更新 1 条）。

### D5-5 + D5-6 翻译缓存清除、键与合并写入

- 缓存文件名改为 `<目标语言>-<模型/源语言哈希8位>.json`；读取候选同时包含旧 `<目标语言>.json`，旧缓存只补缺块。
- `writeTranslationCache` 在同一按路径锁内完成 read-merge-write：同块新译文优先，磁盘上其它块保留；两个渲染层写入方不再互相覆盖。跨进程同时写仍为先写者可能被覆盖，已在注释登记。
- `handleClearTranslations` 删除主/备用缓存根下当前文稿、当前语言的身份缓存与旧命名缓存（目录可列出时清理同语言其它模型缓存），并推进 item+语言 epoch；在途恢复读取完成后 token 失效、不回填。
- 删除失败时保留会话清除标记，状态栏报告失败的文件；其它文稿/目标语言不受影响。
- 新增 `delete_text_file` IPC：仅允许 `.json`、仅普通文件、走 `assertWriteAllowed`；拒绝越权目录、`..`、设备路径、ADS 与伪装成 `.json` 的目录。
- 用例：`tests/readerTranslationCache.test.ts`（13）、`tests/readerTranslationCacheDelete.test.ts`（6）。

### D5-9 Reader busy 标签

- `ReaderTabBridgeState` 增加 `qaRunning`，由 `useReaderQa` 的 `qaRunningSessionIds.length > 0` 填充；`collectBusyReaderTabIds` 把翻译中或问答运行中的标签都计入 `busyTabIds`，`chooseMountedReaderTabIds` 保持其挂载。
- 复核并补回归：同 workspace 切 tab 不中止问答；abort 空占位删除、部分答案保留；持久化前 `stripEmptyAssistantMessages`。
- 用例：`tests/readerBusyTabs.test.ts`（7）。

### D6-7 Notes 计数与分页

- `NotesWorkspace` 用 `countNotesInFolderTree` 一次遍历计算未分类与每个 folder 的后代计数（未知 folder 归未分类，环保护），结果与逐 folder 过滤一致。
- `useNotesStore.loadNotes` 与 `useReaderNotes.reloadNotes` 移除 `limit:1000`：`listAllNotes` 按 5000/页拉取到短页，`notes_list` 增加命令层 offset；代次守卫丢弃旧请求，分页快照渐进写回；活动笔记与 loading/error 语义保持。
- 用例：`tests/notesFolderCounts.test.ts`（5000 条计数、分页、重复页防死循环、IPC offset）、`tests/noteStoreSelection.test.mjs`。

### D6-9 详情表单快捷键边界

- 新增纯函数 `isDetailsPanelVisible` / `isEventInsideDetails`；window keydown 仅在面板布局可见（无 `[hidden]`/`display:none` 祖先）且事件目标/焦点在面板内时处理 Ctrl/Cmd+S 与 Escape。
- 工作区隐藏或焦点在其它控件时不再保存或丢弃草稿。
- 用例：`tests/literatureDetailsShortcuts.test.ts`（4）。

### D6-14 元数据字段 changed 判断

- 核验 `buildManualMetadataUpdateRequest` 已包含 `publisher`/`volume`/`issue`/`pages`/`issn`（第 7 批顺带完成）。
- 抽出 `src/features/literature/manualMetadataPatch.ts`（只依赖类型，可直接单测），`useMetadataJobs` 复用。
- 用例：`tests/metadataManualPatch.test.ts`（3：五项写入、trim 相同不写、单字段变化）。

### vault-autosync-main-thread 取消与后台起步

- `noteVault.syncNow` 接受 `shouldCancel`/`AbortSignal`，每个 IO 前检查；取消后不写 manifest、不删文件，返回 `cancelled: true`；阶段边界补充 yield 操作。
- `background: true` 从异步驱动起步（调用栈内零 IO），chunk 8 并在每段后 `setImmediate`；手动小 vault 仍同步返回。
- 禁用自动同步：`useVaultAutoSyncSchedule` cleanup 置 cancelled 并 `void cancelNotesVaultAutoSync()`（不 await）；`notes_vault_update_settings` 支持 `{cancelAutoSync:true}` 并在自动同步关闭时中止调度器同步。
- 1000 文件基准：确定性假 IO 驱动最大停顿 3.98ms（断言 <16ms，均值 3.25ms，总 ~813ms）；真实 fs 隔离 9.3–15.9ms、全套并行负载下 16.6–17.97ms（真实路径用 24ms 回归阈值，严格预算由假 IO 用例承担）。
- 用例：`tests/noteVaultCancel.test.ts`（取消不写 manifest/不删文件、恢复同步、设置中止）、`tests/noteVaultPerf.test.ts`（2）。

### S5 笔记编辑器残留

- 签名拆为「正文内容哈希（仅 `revision` 变化时计算）+ 标题/标签/颜色」；元数据按键 0.0005–0.0018ms/键且 0 次 `getJSON`（旧路径约 11ms/键）。签名 v3 兼容 v1/v2 旧草稿。
- `flushLiveEditor` 在切换/卸载时若 tracker 有挂起或 dirty，用实时完整快照补建并落盘草稿，关闭首键 120ms 窗口。
- 草稿持久化省略 `contentHtml`（恢复只用 `contentJson`），8×256KB 夹具（约 2.1M 字符）可写入并回读；恢复后 HTML 为空，下次保存重新生成。
- `data:` URL 哈希增加 5 个等距中段窗口（32 字符，含正中间），等长中段替换可检测。
- `tracker.flush()` 消费 pending 时补发 `onCommit`；`!dirty` 时清空 `pendingDraftRef`。
- 用例：`tests/noteEditorPerf.test.ts`、`tests/noteEditorDraftWindow.test.ts`、`tests/noteEditorUtils.test.ts`、`tests/noteEditorConflict.test.mjs`。

### 第 7 批残留清理

- **D6-5**：批量删除先计算可安全清理的托管文件（共享附件判断在删除前完成），再单事务删除记录，最后删文件并 best-effort 清 RAG；新增 `fileFailures` 上报。事务失败时文件不动，不再出现「记录还在、PDF 已删」。用例：`tests/libraryBatchCommands.test.mjs`（新增 1）。
- **D2-2**：删除 `onAllPapersChange` 死传参链（`LiteratureLibraryView`/`useLibraryCatalog`/`useMetadataJobs`），保留内部全量快照供 MinerU 状态发现；`library_query_papers` 的附件筛选改用 `listAttachmentFilterSnapshot`（paper id + 附件行），不再 `store.load()` 整库水合。用例：`tests/libraryBatchCommands.test.mjs`（新增 1）。
- **D5-13**：`getPdfSourceSignature` 增加可选 `pdfData` 身份（长度 + 64 个等距 8 字节窗口 FNV-1a），`PdfViewer` 对 `source:null + pdfData` 使用 `data:<len>:<hash>`；local/remote 语义不变，改显示名不再重载，字节变化（含同长度中段）会重载。用例：`tests/pdfViewerPageCountLifecycle.test.ts`、`tests/pdfDocumentSource.test.ts`。
- **桌面 notes_create / update_note**：`noteCommands` 注入 `assertPaperExists`（`native-library:` 前缀还原为文库主键，`standalone:` 与 `global-notes` 放行），未知 paper 返回 `PAPER_NOT_FOUND`；`update_note` 支持 `paperId` 并在 noteStore 写事务内校验。用例：`tests/noteCommandsPaperValidation.test.ts`、`tests/knowledgeMcpNoteStructured.test.ts`。

## 验证

- `npm run typecheck`：四个项目 0 诊断。
- `npm test`：1,279 项，1,273 通过、6 跳过、0 失败。
- `npm run build`：通过（仅既有动态 import 警告）。
- 新增/更新用例：`noteStoreSearchFts`（3）、`noteStoreFolderVersions`（2）、`knowledgeMcpNoteStructured`（5）、`libraryQueryPolicy`（5）、`metadataManualPatch`（3）、`readerTranslationCache`（13）、`readerTranslationCacheDelete`（6）、`readerBusyTabs`（7）、`notesFolderCounts`、`noteCommandsPaperValidation`、`noteVaultCancel`、`noteVaultPerf`（2）、`noteEditorDraftWindow`、`literatureDetailsShortcuts`（4）、`libraryBatchCommands`（新增 2）、`selectionFilterGuard`（更新）、`knowledgeMcp` / `mcpContract` / `pdfViewerPageCountLifecycle`（更新）。

## 行为变化

- 清空译文会删除磁盘缓存；旧缓存仍可读，但清除后不会重新出现。
- 翻译缓存文件名加入模型/源语言哈希；旧 `<lang>.json` 仍被读取。
- 笔记草稿签名升级到 v3；持久化草稿不再保存 `contentHtml`。
- Notes 列表不再静默停在 1000 条；`notes_list` 支持 offset。
- 后台 vault 同步返回 Promise 且 stats 带 `cancelled`；同步 chunk 从 16 降到 8，总时长略增。
- 详情表单 Ctrl+S/Escape 仅在面板可见且焦点在面板内生效。
- MinerU 状态发现不再清空多选；只有「MinerU 已解析」筛选会在发现结束后补一次尾部查询。
- 桌面 `notes_create` 对未知 paper 由放行转为 `PAPER_NOT_FOUND`（`native-library:`/`standalone:`/`global-notes` 不受影响）。
- `source:null + pdfData` 的滚动/热图状态键从显示名改为 `data:...`，旧键不再命中。

## 残留与风险

- **S5 图谱侧仍 partial**：998ms 是 20k 边基准、2000 候选/768 维约 1.03s、Worker 失败回退主线程且无看门狗、`vendor-graph` 仍静态含 fcose；第 9 批处理。
- 译文清空不取消正在进行的全文翻译；其后续进度写入可能重新落盘并解除清除标记（原有行为）。
- 翻译缓存锁仅进程内；多进程同时写同一缓存仍为先写者可能被覆盖。
- `data:` 签名只采样 5 个中段窗口，窗口之外的等长替换仍可能漏检。
- Notes 树未虚拟化（第 9 批 D7 项）；>5000 条笔记的第二页起经 `listAllNotes` 全量水合。
- 真实 fs 的 vault 停顿受 Windows GC/并行测试负载影响，严格 <16ms 由确定性假 IO 用例保证。
- 安装版冒烟、真机 UI 与 axe 扫描仍未执行。

## 独立复核（2026-11-23）

8 个只读 verifier 逐项复核本批声明，均给出 file:line 证据并运行目标用例：

- **CONFIRMED**：D3-6/D3-12、D3-7、D5-5/D5-6、D5-9/D6-9、D6-7/S5 笔记、vault/D6-14/第 7 批残留清理。
- **PARTIAL**：D2-5（MCP keyword 模式 0 行不回退；陈旧索引行只查存在性、不查内容）、D4-6（`papersRefreshing` 无消费者；首屏 `loading` 窗口吞筛选/搜索变化）。两项从 fixed 降为 partial，并入第 9 批。
- **MINOR（并入第 9 批）**：笔记分页 `ORDER BY` 无唯一 tiebreaker；正文节流 120ms 内 `dirty=false` 使保存按钮/Ctrl+S 不可用；`delete_text_file` 未登记 typed args；`native-library:` 空 id 通过 `assertPaperExists`；`updateNote` 在 `linkedPaperId` patch 时校验的是 `note.paperId`；D3-6 未覆盖 >2M 截断分支；vault 真实 fs 用例标题仍写 <16ms 而断言 <24ms；`paperMetadataRecognition.ts` 保留同名 metadata patch 实现。
