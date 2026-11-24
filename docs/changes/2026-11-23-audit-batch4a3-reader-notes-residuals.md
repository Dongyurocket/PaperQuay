# 2026-11-23 - 审计 4A-3 小批：PDF 打开代次、笔记草稿落盘与两项 4A 残留（D5-7、D6-12/D4-7、D1-6、D1-10）

关联计划：[2026-11-23 审计剩余工作清单](../plans/2026-11-23-audit-remaining.md)。本批只处理以下四项，不改 schema、不重构其他模块：

- D5-7：PDF 打开/切换的请求代次。
- D6-12 + D4-7：未保存笔记草稿的持久化、容量上限与退出冲刷。
- D1-6 残留：`backup_import_inspect` 的包路径授权。
- D1-10 残留：退出时等待 RAG store/worker，并取消在途 embedding。

## 现象

- **D5-7**：`DocumentReaderTab` 的 `requestId` 只保护延迟 MinerU 恢复；`switchCurrentPdfFile` 不参与代次。远程下载或磁盘检查尚未返回时切换 PDF，旧请求仍会写 `pdfSource` / `currentDocument` / `loading`；同一 `workspaceId` 切换原始版/批注版时，旧 open 的提交可能覆盖新来源。
- **D6-12 / D4-7**：草稿保存在模块级无上限 `Map`，进程退出即丢失；只有手动保存才写入笔记库，`beforeunload` 不冲刷 300ms 防抖窗口内的编辑。
- **D1-6 残留**：恢复目标已绑定对话框授权，但 `backup_import_inspect` 直接使用渲染层传入的 `packagePath`；UNC 路径可能在容器校验前先触发 SMB 探测。
- **D1-10 残留**：`backend.shutdown` 只等待笔记索引队列，`ragStore.close()` 仍是 fire-and-forget；worker 卡在同步 SQLite 调用时只能依赖 3 秒强制退出，超时也不会取消在途 embedding。

## 修改

### D5-7 PDF 打开/切换共享代次

- 新增 `src/features/reader/documentOpenGeneration.ts`：`begin()` / `current()` / `isCurrent(token)` / `ifCurrent(token, commit)`。每次打开或切换都会让之前所有请求失效。
- `src/features/reader/DocumentReaderTab.tsx`
  - `openDocumentRequestIdRef` 替换为 `documentOpenGenerationRef`（`:395`）。
  - `openWorkspaceDocument` 在磁盘检查、远程下载后与提交前检查代次；旧请求直接返回，不写 `pdfSource` / `currentDocument` / `loading` / `error`；延迟 MinerU 恢复与 `finally` 清理都走 `ifCurrent`（`:1340` 起）。
  - `openDocumentItem` 在 `tryResolveSavedPdfPath` 后检查代次，并把同一 token 传给所有候选路径与 Zotero 打开分支（`:1572`）。
  - `switchCurrentPdfFile` 调用 `begin()`，使正在恢复的旧文档/MinerU 缓存失效；只在仍为最新请求时提交状态与清理 loading（`:2587`）。

### D6-12 / D4-7 草稿持久化与退出冲刷

- `src/features/notes/noteEditorUtils.ts`
  - 新增 `createNoteEditorDraftStore({ storage, maxEntries, maxBytes })`（`:140`），默认写 `localStorage` 前缀 `paperquay.note-editor-draft.v1:`；无可用存储时退化为进程内存储。
  - 默认上限 20 条 / 4 MiB（`:66-67`），按 `updatedAt` 淘汰最旧草稿；单条超限只保留内存副本。
  - `QuotaExceededError` 时逐条淘汰旧草稿后重试；非配额错误不牺牲其他草稿；损坏 JSON/结构不符合的条目在读取时删除。
  - 原有 `read/write/clearNoteEditorDraft` 改为委托延迟创建的单例 store（`:320`）。
- `src/features/notes/NoteEditor.tsx`
  - 新增 `beforeunload` / `pagehide` / `visibilitychange(hidden)` 冲刷，effect 清理时再冲刷一次（`:1549` 起）。`localStorage` 写入是同步的，可在 unload 阶段完成；切换笔记仍沿用既有卸载冲刷与草稿恢复逻辑。

### D1-6 残留 backup_import_inspect 包路径授权

- `electron/backend/backupCommands.cjs`
  - `backup_select_package` 返回的路径登记到会话级 `authorizedPackages`（Windows 下大小写归一），UNC/设备/ADS 不登记（`:69-91`）。
  - `backup_import_inspect` 在调用 importer 之前校验：必须是绝对路径、非 UNC/设备/ADS、且与对话框登记值一致；否则抛 `UNAUTHORIZED_PACKAGE`（`:308-315`）。容器读取不会发生在校验之前。

### D1-10 残留退出等待 RAG worker 与取消 embedding

- `electron/backend/ragWorkerHost.cjs`
  - 支持注入 `createWorker` 便于挂起用例（`:35`）。
  - `close({ timeoutMs })` 在预算内等待 worker 的 `close` 应答；超时（或预算为 0）调用 `failAll()` 后 `worker.terminate()`，返回 `{ timedOut }`（`:96`）。不传预算时保持原有无限等待语义。
- `electron/backend/noteEmbedding.cjs`
  - 索引器持有 `shutdownAbort`；在进程内执行单元中把 `signal` 合并进 embedding 配置，`closeWhenIdle` 超时与 `close()` 都会 abort 在途 fetch（`:71-78,139-169`）。
  - Worker 执行单元无法结构化克隆 `AbortSignal`，该路径由 shutdown 预算到点后 `worker.terminate()` 取消。
- `electron/backend.cjs`
  - `closeBackend()` 幂等并返回 RAG close promise；`shutdown` 用同一 `timeoutMs` 计算剩余预算，等待 `ragStore.close({ timeoutMs: remaining })`，返回 `ragStoreClosed` / `ragStoreCloseTimedOut`（`:171,237-253`）。
- `electron/main.cjs`
  - 退出日志增加 RAG worker 未按时关闭的告警；3 秒强制退出兜底保留。

## 验证

- 新增 / 更新用例：
  - `tests/documentOpenGeneration.test.ts`：同一 `workspaceId` 切换 `pdfSource` 时旧 open 的提交被丢弃；乱序异步 open 只保留最新来源；后续 open 取消延迟 MinerU 恢复；旧请求的错误与 loading 清理不生效。
  - `tests/noteEditorUtils.test.ts`：注入存储后跨实例恢复草稿（崩溃/重载）；按条目数淘汰最旧；配额超限时淘汰旧草稿并保留最新；超大草稿只留内存；存储不可用与损坏值不破坏编辑；clear 同时清内存与持久化。
  - `tests/noteEditorConflict.test.mjs`：`beforeunload` 把待落盘草稿同步写入 `localStorage`。
  - `tests/backupCommands.test.ts`：未登记包路径被拒且 importer 不被调用；对话框登记后 inspect 成功；UNC/设备/ADS 在容器读取前被拒；对话框返回 UNC 也不会登记。
  - `tests/ragWorkerHost.test.ts`：worker 挂起时按预算返回 `{ timedOut: true }` 并 terminate；正常应答返回 `{ timedOut: false }`；无预算时保持无限等待。
  - `tests/noteSemanticSearch.test.ts`：`closeWhenIdle` 超时会 abort 在途信号；`indexNote` 把 abort 传到 embedding 并记录失败状态。
- 命令与结果（2026-11-23，本机）：
  - `npm run typecheck`：四个项目 0 诊断。
  - `npm test`：961 项，960 通过、1 跳过、0 失败。首次全量运行时 `tests/knowledgeGraphCommands.test.mjs` 的并发写用例出现一次 Windows `EPERM` 临时文件读取（4A-2 既有用例），单独复跑与第二次全量运行均通过。

## 剩余风险

- 恢复目标与包路径授权都是会话级：目录/包选择与对应命令必须在同一主进程会话内完成。当前 UI 流程满足；跨重启断点续导需要把授权纳入持久 `pathPolicy` 并同时校验 restoreId。
- 草稿存储是「尽力而为」：`localStorage` 被禁用、配额耗尽或单条草稿超限时只保留内存副本，进程崩溃仍会丢失；容量上限按最旧 `updatedAt` 淘汰，不能保证保留用户最关心的草稿。
- `beforeunload` 冲刷依赖防抖 effect 已更新的 `pendingDraftRef`；在最后一次输入与窗口关闭发生在同一渲染帧内时，最多丢失一个防抖窗口（300ms）内的按键。
- Worker 执行单元的 embedding 取消只能通过 `terminate()` 完成，未实现跨线程取消协议；worker 在同步 SQLite 调用中不响应 close 时，shutdown 会消耗完剩余预算后强制终止，外层 3 秒兜底仍保留。
- `backup_import_stage` 的 `packagePath` 仍未绑定对话框授权（本批只按 D1-6 残留范围处理 inspect）；stage 的容器校验会拒绝非法包，但 UNC 包路径仍可能在 stage 阶段先触发 SMB 探测。
