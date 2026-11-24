# 2026-11-23 - 审计第 5 批：单一设置存储与桌面/MCP 共享域（D4-5、D5-14、D3-9、D3-10、D8-12、D8-14、D1-14、D8-7）

关联计划：[2026-11-23 审计剩余工作清单](../plans/2026-11-23-audit-remaining.md)。本批按「S4 单一设置存储 → S3 桌面/MCP 共享域」顺序完成 8 项，不改文库/RAG/笔记 SQLite schema，不提交、不 push。

## 现象

- **D4-5（S4）**：设置同时由 Notes（`bibliography.ts` 整对象写 `paper-reader-settings-v3`）、Reader（`useReaderSettings` 整对象写 localStorage + 350 ms 配置文件）、SQLite `library_settings` 与 `zoteroLocalDataDir` 双写持有。Notes 改 `noteCitationStyle` 后，Reader 任意设置写回会用挂载时的旧对象覆盖；重启 hydration 又让配置文件覆盖 localStorage。
- **D5-14**：备份、MCP、更新等应用级设置组件与设置窗口生命周期都在 `src/features/reader`，Notes/Graph 无法独立打开。
- **D3-9（S3）**：MCP 导入/更新/Zotero 同步/检索各自复制桌面逻辑：查重口径（桌面仅 contentHash，MCP 另按 DOI/标题）、PDF 命名（`paperId-file` vs 规则命名）、`language: ''` 语义（桌面报错、MCP 清空）、Zotero 分类（MCP 平级、桌面嵌套）均漂移。
- **D3-10**：embedding 配置有 3 份实现，MCP 混合检索私有 fork 按源逐文档 KNN、按结果逐条取邻居（N+1）。
- **D8-12**：现有测试只断言工具名数量与个别字段，未枚举 28 个工具的 schema/handler 一一对应、默认值、required 与错误码。
- **D8-14**：打包测试复制 esbuild 配置，与 `scripts/bundle-mcp.cjs` 可能漂移。
- **D1-14**：`paperquay:invoke` 仍是纯字符串通道，无逐命令 args/result schema。
- **D8-7**：preload/main 的集成行为（白名单拒绝、restore sync ack、will-navigate）只有间接模块测试。

## 修改

### D4-5 单一设置存储（主进程持久化 + 渲染层只读缓存）

- 新增 `src/shared/appSettingsContract.cjs`（+ `.d.ts`）：设置文档 v2、`SETTING_KEYS`/`SECRET_KEYS`（与 `DEFAULT_SETTINGS`/`DEFAULT_SECRETS` 由测试锁定）、`migrateAppSettingsDocument`（v0/v1→v2，未来版本拒绝）、`normalizeSettingsPatch`/`normalizeSecretsPatch`（未知键拒绝）、`assertSettingsRevision`、`mergeLegacyAppSettings`。
- 新增 `electron/backend/appSettings.cjs`：`appPaths.configPath` 仍是唯一文件（MCP/笔记索引继续直接读取），但写入方改为主进程。文档带单调递增 `revision`；写入只接受按键 patch，并与调用方 `expectedRevision` 校验；secrets 经 `secretStorage` 加密为 `secretsEncrypted`；写入复用 `writeJsonSync`（临时文件 + fsync + rename）。
- 新增 `electron/backend/appSettingsCommands.cjs` 与 5 个 IPC 命令：`app_settings_get` / `app_settings_get_secrets` / `app_settings_patch` / `app_settings_patch_secrets` / `app_settings_migrate_legacy`。版本冲突返回 `{ ok:false, code:'SETTINGS_CONFLICT', current }`，由渲染层基于最新 revision 重放。
- 新增 `src/services/appSettings.ts` 与 `src/app/settings/appSettingsCache.ts`：渲染层只读缓存 + 串行写队列；乐观叠加未确认 patch；冲突时取回规范文档后重放；`noteCitationStyle`/`uiLanguage` 跨入口订阅。
- Notes：`bibliography.ts` 的 `saveNoteCitationStyle` 改为 patch `noteCitationStyle`，`loadNoteCitationStyle` 只在缓存未 hydrate 时回退旧 localStorage；`NoteEditor` 订阅缓存，Reader 改样式后同步并重建编号。
- Reader：`useReaderSettings` 移除 localStorage 整对象写与 350 ms 配置文件写回；hydration 先调用 `app_settings_migrate_legacy` 合并旧 localStorage/旧配置，再 `mergeReaderConfigWithDefaults`；设置/密钥变化按 diff 发 patch。`zoteroLocalDataDir` 只写应用设置文档，主进程镜像到 `library_settings`，删除 Reader 里 500 ms 的二次写回 effect。
- SQLite：`saveKeyValueTable` 从「DELETE 全表再重插」改为按键 UPSERT + 删除缺失键，`library_get_settings`/`library_init` 用应用设置文档的规范 Zotero 目录覆盖镜像值。

### D5-14 应用级设置模块上移

- 将 `BackupTransferSection`、`BackupPasswordDialog`、`BackupProgressPanel`、MCP 设置、更新设置、设置原语与类型移到 `src/app/settings/`；Reader 设置窗口改为复用这些组件。
- 新增 `AppSettingsWindow`（通用/备份/MCP/更新）与 `useAppSettingsStore`；`App.tsx` 常驻挂载，文库工作区仍打开完整 Reader 设置，Notes/Graph 打开应用级设置；窗口内提供「阅读、翻译与模型设置…」跳转。

### D3-9 桌面/MCP 共享库域

- 新增 `electron/shared/libraryDomain.cjs`：`normalizeDoi`/`normalizeTitleForDuplicate`/`findDuplicatePaper`（contentHash → DOI → 标题）、`buildImportedAttachmentFileName`（`autoRenameFiles=false` 时 `${paperId}-${file}`，否则复用 `buildPdfAssetFileName`）、`buildImportedPaperRecord`、`applyPaperMetadataPatch`（`language: ''`/`null` 都清空为 null）。
- 新增 `electron/shared/zoteroDomain.cjs` 与 `src/shared/zoteroItemMetadata.cjs`：集合嵌套路径、大小写不敏感匹配、`Zotero Unfiled` 规划、Zotero 元数据映射；MCP `paperquay_sync_from_zotero` 改用同一规划与共享导入记录/命名/查重，并把重复文献挂到集合分类。
- `electron/backend/libraryCommands.cjs` 的桌面导入/更新与 `electron/mcp/knowledgeMcpService.cjs` 的导入/更新/同步共用上述模块；MCP `search_papers` 自由文本补上 tag 名称匹配。

### D3-10 混合检索与 embedding 配置收敛

- 新增 `src/shared/embeddingConfig.cjs`：base URL/模型键/维度/超时/批量统一；笔记索引、MCP、`src/services/rag.ts` 共用；删除零引用的 `src/services/embeddingConfig.ts`。
- 新增 `electron/shared/ragSearch.cjs`：FTS5、精确信号补召回、单次 KNN（按合格 source 数计算 k，避免单文档吃满配额）、RRF、LIKE 回退、批量邻居片段。MCP `searchKnowledgeBase` 与 `ragStore.retrieveDocumentChunks` 共用；MCP 结果同时保留 `paperId/paperTitle/snippet` 与规范字段 `documentKey/chunkId/text/score/pageIndex/pageNumber/sourceType/blockId`。

### D8-12 MCP 契约测试

- 把 28 个工具 schema 与 handler 分发从 `bin/paperquay-mcp.cjs` 抽到 `electron/mcp/mcpTools.cjs`（`TOOLS`、`createToolHandlers`、`applySchemaDefaults`、`handleMessage`），bin 只保留 stdio 传输与 `require.main` 守卫。
- 新增 `tests/mcpContract.test.ts`：28 个工具唯一、TOOLS↔handler 一一对应、required ⊆ properties、默认值、tools/list、tools/call 分发、图片内容块、未知工具、`PAPER_CONFLICT/NOTE_CONFLICT/CATEGORY_CONFLICT` 错误码、JSON-RPC -32602/-32601，以及真实 fixture 的 tag 过滤与自由文本匹配。

### D8-14 打包器测试

- 新增 `scripts/bundleMcpConfig.cjs`（入口/输出目录/esbuild 选项/路径解析），`scripts/bundle-mcp.cjs` 改用共享配置并支持 `bundleMcp({ outDir })`。
- 新增 `tests/mcpBundleConfig.test.ts`：不再复制 esbuild 配置；用 `write:false` 验证入口可打包且 `sqlite-vec` 保持 external，并在临时目录验证 `server.cjs`、`sql-wasm.wasm`、`node_modules/sqlite-vec` 产物。

### D1-14 IPC 类型化 registry

- 新增 `electron/ipcCommandRegistry.cjs`：零依赖 JSON Schema 子集校验器（未知关键字报错），为 15 个命令登记 args/result schema；`createCommandInvoker` 在 handler 前校验 args，`IPC_INVALID_ARGS: <command>: <path>`；result 校验仅在 `PAPERQUAY_VALIDATE_IPC_RESULTS=1` 时启用。
- 新增 `src/services/ipcCommands.ts`：同一组命令的渲染层 args/result 类型与 `TypedIpcCommand` 联合；测试对照 allowlist 与 schema，未登记命令仍受白名单约束。

### D8-7 Electron 集成测试

- 新增 `tests/electronPreloadIntegration.test.mjs`：vm + 假 electron 加载 preload，覆盖白名单拒绝、restore sync 应用/标记/ack、无 payload 不 ack、拖放路径授权。
- 新增 `tests/electronMainIntegration.test.mjs`：vm + 桩加载 main，覆盖 `paperquay:invoke` 的窗口/文档/白名单校验、restore sync/ack、`will-navigate` 放行可信 dev URL 并拦截 https/file 逃逸、拖放路径只接受主窗口字符串路径。

## 验证

- 新增/更新用例：`tests/appSettingsStore.test.ts`、`tests/appSettingsSingleStore.test.ts`（Notes 设 apa7 → Reader 任意设置写 → 重启 hydrate 仍为 apa7；stale revision 拒绝并重放）、`tests/appSettingsModuleStructure.test.mjs`、`tests/readerSettingsHydration.test.mjs`、`tests/librarySettingsUpsert.test.mjs`、`tests/bibliography.test.ts`、`tests/mcpSharedDomain.test.ts`、`tests/mcpZoteroShared.test.ts`、`tests/mcpHybridRetrieval.test.ts`、`tests/embeddingConfigShared.test.ts`、`tests/mcpContract.test.ts`、`tests/mcpBundleConfig.test.ts`、`tests/ipcCommandRegistry.test.ts`、`tests/electronPreloadIntegration.test.mjs`、`tests/electronMainIntegration.test.mjs`。
- 定向：`tests/ragStore.test.ts` 23 项、`tests/knowledgeMcp.test.ts` 18 项、`tests/knowledgeMcpNotesWrite/RuntimeWrite/Write/Figure/RagCleanup` 45 项、`tests/readerScopedRag.test.ts`、`tests/noteSemanticSearch.test.ts`、`tests/noteEditorConflict.test.mjs`、`tests/noteEditorUtils.test.ts`、`tests/mcpPackaging.test.ts`、`tests/packagingDependencies.test.mjs` 全部通过。
- `npm run typecheck`：四个项目 0 诊断。
- `npm run build`：Vite 生产构建通过。
- `npm test`：1095 项，1094 通过、1 跳过、0 失败（在隔离 `TEMP/TMP` 下最终复跑）。

## 剩余风险

- 设置文档损坏时 Reader 暂停写回并保留旧 localStorage 供本次会话使用；修复/删除文件后重启才恢复持久化（与旧配置文件策略一致）。
- `app_settings_get_secrets` 仍把解密后的 API Key 交给渲染层（渲染层需要调用模型接口）；安全边界与旧 `read_text_file` 读取配置文件相同。
- 设置文档迁移后旧 localStorage 键会被清除；降级到旧版本会丢失这些键（旧版本仍可从配置文件读到设置，但不会读回 localStorage）。
- IPC result 校验默认关闭，历史命令的宽松返回形状仍可能漂移；新增命令应同时登记 allowlist、registry 与 `src/services/ipcCommands.ts`。
- MCP 单次 KNN 的 k 上限为 4096；超过该规模的库若 4096 个最近邻全部来自不合格分区，仍可能少召回（已显著优于逐文档 N+1，且桌面本地库规模下不构成实际限制）。
- 共享 Zotero 规划只覆盖分类/元数据/命名/查重；Zotero 附件下载与本地数据库读取仍走原有 `zoteroLocal.cjs`。
