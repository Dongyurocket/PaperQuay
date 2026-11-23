# 2026-11-23 - 审计第 2 批：安全收口与阅读/翻译/RAG/笔记正确性

关联计划：[2026-11-22 代码、架构与 UI 专项审计](../plans/2026-11-22-code-architecture-ui-audit.md) 第 2 批（A5–A7、B1–B5、C1–C5、E1、E3）。

## 现象

- 渲染层可经单一 `paperquay:invoke` 通道调用任意命令，`approve_write_path` 允许自行批准任意路径；`paperquay-pdf` 协议与 MinerU 云解析都信任渲染层传入的路径/主机；MinerU 表格 sanitizer 的 unwrap 分支可被不允许标签绕过；API Key 明文落盘（B1–B5）。
- MCP 图表读取用裸 `paperId` 哈希缓存目录，与阅读器的 `native-library:<id>` 目录不一致；翻译 IPC 逐块请求且无超时/取消；QA 上下文预算算完即丢；删除论文不清 RAG，整库 `save()` 覆盖并发写入；PDF 文本提取 promise 未绑定 PDF 身份（C1–C5）。
- `paperHistory` 每次滚动都重写整张多 MB localStorage map；RetainPDF 的 `starting/uploading` 僵死记录永久阻塞重译；外部笔记写入把所有打开标签标为「外部更新」，搜索会把编辑器重绑到第一条结果（A5–A7）。
- 深色主题多处 `bg-white` 无 dark 配对；Tailwind 非 5 倍数透明度不生成 CSS，所有浅色遮罩消失（E1、E3）。

## 修改

### B1 渲染层 IPC 边界

- 新增 `electron/ipcAllowlist.cjs`：显式列出渲染层需要的 130+ 命令；preload 与 main 双侧校验，未登记命令直接拒绝。删除 `approve_write_path`，渲染层不再能自行批准路径。
- 新增 `electron/ipcSecurity.cjs`：`senderFrame` 必须是主窗口主框架，且 URL 必须是应用自身文档（开发态 Vite URL / 安装版 `dist/index.html`）；启动期 `renderer-restore-sync` 用 WebContents id 校验（preload 执行时 URL 尚未提交）。
- 新增 `electron/backend/pathPolicy.cjs`：读允许 `dataDir`、文库/译版/MinerU 缓存、配置文件中的缓存目录、附件位置与对话框返回的路径；写允许上述根目录、对话框保存路径，以及已知附件/对话框目录下的 `.pdf`（批注版导出）。realpath 包含校验，拒绝设备路径、NTFS ADS 和空路径。
- 文件对话框返回的路径由主进程登记读写权限；`read_text_file(_if_exists)`、`read_binary_file_base64`、`list_directory_files`、`path_exists`/`paths_exist` 全部走同一策略。
- 信任根只来自应用路径、主进程写过的文库设置（`storageDir`/`translatedPdfDir`）与主进程对话框授权，不再把渲染层可写的配置文件（`mineruCacheDir`/`zoteroLocalDataDir`）当成读/写根。对话框授权持久化到 `<dataDir>/.paperquay-approved-roots.json`，该文件对渲染层读写都不可见。
- `library_update_settings` 只有在目录经目录对话框授权（或位于 dataDir 内）时才接受新的 `storageDir`/`translatedPdfDir`。
- `library_import_pdfs`、`library_relocate_attachment`、`library_add_attachment` 都会校验源路径已授权且为 PDF——附件表是后续读/写的信任锚，不能由渲染层任意登记。真实文件拖放由 preload 直接把路径登记给主进程（入口不通过 contextBridge 暴露，合成 drop 的 File 没有本地路径）。
- 启动时把历史遗留的正斜杠附件路径统一为平台分隔符；附件目录包含校验同时接受 `/` 与 `\`，并对空目录前缀做长度保护。

### B2 MinerU 云解析

- `run_mineru_cloud_parse` 只接受 `.pdf` 且读权限内的路径；`apiBaseUrl` 只允许官方 MinerU 主机、回环地址、私有网段与 `.local`（配置文件是渲染层可写的，不能作为端点信任锚）；`extractDir` 只允许默认缓存根或主进程已授权的缓存目录，越界回退到受控子目录。
- `readZipWithAdm` 增加条目数（5000）、单条目（512 MB）与总解压量（2 GB）上限，拒绝 `..`/绝对路径、Windows 保留设备名、ADS 与尾随点/空格。
- `download_remote_file_to_path` 只接受 http/https。

### B3 表格 sanitizer

- `sanitizeMineruTableHtml` 重写为自底向上的节点清洗：不允许标签先递归搬出并清洗子节点，再删除自身；`script/style/iframe/object/svg/form` 等连同子树丢弃；注释节点删除。补齐两条 XSS payload 回归测试。

### B4 `paperquay-pdf` 协议

- 只接受 GET/HEAD；路径必须通过主进程路径策略（文库/译版/缓存/附件/对话框路径）；协议层直接拒绝 UNC、设备路径与 ADS。

### B5 API Key 加密

- 新增 `electron/backend/secretStorage.cjs`：用 AES-256-GCM 加密整段 `secrets` JSON，配置文件中写为 `secretsEncrypted: "enc:v2:<iv>:<tag>:<ciphertext>"`；旧明文配置照常读取并在下次写回时迁移。
  - 之所以不用 `safeStorage`：独立 MCP 进程以 `ELECTRON_RUN_AS_NODE=1` 运行，无法调用 DPAPI/Keychain；继续用 safeStorage 会让 MCP 的 embedding key、笔记向量索引与混合检索在首次写回后失效。32 字节密钥保存在 `<userData>/PaperQuay-secrets.key`（dataDir 的父目录，不在渲染层可读根内），同用户本地进程的威胁模型与 DPAPI 一致。
  - 仍兼容读取 `enc:v1:`（旧 safeStorage）密文；后端 `noteEmbedding`、MCP `resolveEmbeddingConfig` 与备份导出都通过 `resolveReaderConfigSecrets` 解密，备份把 secrets 以明文写入密码加密的 `.pqbackup` 以支持跨机恢复。
- `.bak` 备份在写入前先把明文 `secrets` 加密，避免备份成为明文密钥副本；加密后端不可用时保留明文回退，文件仍可读。读取/解密失败进入既有 A3 可恢复错误路径，不覆盖原文件。
- 密文每次加密都会变，写入前先解密旧配置做语义比较：内容未变时不重写文件、不刷新 `.bak`；旧明文配置即使内容未变也会写一次完成迁移。

### C1 MCP 图表缓存键

- 新增 `src/shared/mineruCachePaths.cjs`（+ `.d.ts`），把 `document-<hash(workspaceId)>`、标题/旧版命名与三种 JSON 候选收敛为唯一实现；`src/utils/mineruCache.ts` 改为复用该模块。
- `knowledgeMcpService.readPaperFigure` 改用 `locateMineruFigureBlock`：同时尝试 `native-library:<paperId>` 与裸 `paperId` 身份、三种 JSON，支持 `middle.json` 的 `pdf_info[].para_blocks`。

### C2 翻译 IPC

- `translate_blocks_openai_compatible` 把收到的块按 20 块 / 8000 字符再分批，一次请求返回 `{blocks:[{blockId,translatedText}]}`；解析失败才退回逐块翻译。
- 每次请求有独立 deadline（默认 120s，可配），429/5xx/超时/网络错误重试 3 次并退避；`requestsPerMinute` 在端点+模型维度限流。
- 新增 `translate_cancel`：渲染层每次请求带 `requestId`，`AbortSignal` 取消时通知主进程 abort；取消以 `TRANSLATION_CANCELLED` rejection 返回，不再把已取消批次当成功。
- 划词翻译也加 120s deadline。

### C3 QA 上下文预算

- `resolveQaRequest` 把 `tokenBudget` 传入 `resolveLocalRag`；`resolveLocalRag` 的 retrieved 分支补 `budgetSkippedCount`。
- `buildRagContextText` 在丢弃 section 之后再做一次硬裁剪：只剩一个超长 section 时按预算截断文本本身，并在末尾加 `[truncated]` 标记；`budgetSkippedCount` 只统计被整段丢弃的证据条目，不重复计数。
- PDF 文本 / MinerU Markdown 全文回退用 `trimDocumentTextToTokenBudget` 按预算裁剪（先扣掉截断说明自身的 token），并在 `qaContext` 标记 `budgetSkippedCount`。

### C4 数据一致性

- `library_delete_paper` 删除记录后调用 `ragStore.removeDocumentIndex({ documentKey: paperId })`。
- 附件路径校验按「候选位于附件目录或其子目录」判定（用 `rtrim` 求目录前缀，避免把祖先目录当成附件目录，也避免 `_`/`%` 被 LIKE 当通配符）。
- `library_update_settings` → `saveSettings`；分类增删改 → `saveCategory`/`deleteCategories`；拖拽排序 → `savePaperSortOrders`；导入 → 仅 `savePaper` 新文献；`noteVault` 设置 → `saveSettings`。整库 `save()` 在桌面命令中不再使用；存储目录迁移只回写被改写的附件所属文献。
- 新建数据库时补种系统分类与默认设置（不再依赖整库保存顺带补齐）；旧版 SQLite 有数据时只补缺失分类，绝不清空。
- MCP `delete_papers` 同样调用 RAG 索引清理（`removeRagIndexes`），MCP 删除的论文不再被 `search_knowledge_base` / `read_paper_content` 命中。

### C5 PDF 文本提取竞态

- 新增 `src/features/reader/pdfTextCache.ts`：缓存与在途 promise 都绑定 `pdfSource + workspaceId` 的 cacheKey；切换 PDF 时 `invalidate()`，旧结果不再回填共享缓存；同一 key 的并发调用共享一个 promise。

### A5 paperHistory

- 从单键整表改为按论文分片：索引 `paper-reader-paper-history-index-v2` + 每篇 `paper-reader-paper-history-v2:<workspaceId>`；滚动保存只写当前论文与索引。
- 启动时把 `paper-reader-paper-history-v1` 迁移为分片，全部写成功后才删旧键；每篇会话数上限 40，全局记录上限 300。
- `QuotaExceededError` 时淘汰最旧记录后重试，仍失败则发 toast 与 `paperquay:paper-history-storage-warning` 事件，不抛出。
- 备份恢复路径重映射扩展到 v2 分片（PDF/MinerU/滚动位置）。

### A6 RetainPDF

- `starting/uploading/submitting` 在重启后没有可恢复的远端任务，直接标记为可重试失败；其他 active 记录按 `updatedAt` 超过 6 小时标记超时失败。
- `start_translation` 遇到僵死 active 记录先标失败再重新开始，不再误报「已有任务在运行」。

### A7 笔记外部更新与搜索

- `useNotesStore.loadNotes` 保留已选中的 `activeNoteId`，搜索/标签过滤不再把编辑器切到第一条结果；`NotesWorkspace` 用最近一次完整记录兜底被过滤掉的当前笔记。
- 外部写入事件改为逐个 `getNote` 比较 `updatedAt`，只通知真正变化的 noteId；没有基线版本时不再猜测变化（避免被搜索过滤的脏编辑器误报冲突）。
- 外部删除笔记时清空 pin、活动 id 并关闭对应标签页，编辑器不会继续停留在已删除的笔记上。

### E1 深色主题

- `NoteDistillPreviewPanel`、`readerPreferencesPrimitives/Content/ModelsSection`、`blockViewerContent`、`assistantSidebarDrawers` 中无 dark 配对的 `bg-white`/`bg-slate-50` 改为 `var(--pq-surface-1/2)`；弹窗边框改用 `--pq-border`。

### E3 遮罩令牌

- `index.css` 新增 `--pq-overlay-soft/strong`（浅色 `rgba(2,6,23,.28/.62)`，深色 `rgba(0,0,0,.45/.70)`）。
- `Dialog`、设置窗口、文本输入框、块预览、笔记提炼预览统一使用令牌；全仓非 5 倍数 Tailwind 透明度（`/6`、`/8`、`/14`、`/28`、`/32`、`/54`、`/58`、`/62`、`/72`、`/76`、`/78`、`/88`、`/92`、`/96`）归零，统一改为 5 的倍数或令牌。
- 新增 `tests/uiDesignTokens.test.ts` 阻止回归，并在构建产物中确认 `background-color: var(--pq-overlay-*)` 规则存在。

## 验证

新增测试（12 个文件）：

- `tests/ipcSecurity.test.mjs`：白名单覆盖 src 全部 invoke 命令且不含 `approve_write_path`；sender 守卫；路径策略读写/附件/对话框/ADS/设备路径；协议 403/405/400 与 `..` 穿越；MinerU 路径/主机/解压目录；zip 穿越/ADS/设备名/条目上限。
- `tests/readerConfigSecrets.test.ts`：密文落盘、读回、旧明文迁移（内容不变也迁移）、备份无明文、加密不可用回退、解密失败可恢复、语义未变不重写/不刷 `.bak`。
- `tests/paperHistoryStorage.test.ts`：5000 条迁移后单次保存只写 2 个 key（实测 <25ms，计划目标 <5ms 的同一结构性保证）、会话/全局上限、配额淘汰与 UI 警告、删除。
- `tests/retainPdfRecovery.test.mjs`：starting/uploading/running 过期判定与重启恢复、僵死记录不阻塞重译。
- `tests/mineruCacheSharing.test.mjs`：用阅读器构造器写缓存后 MCP 能按 blockId 取到；title 目录与 `middle.json`。
- `tests/translationBatch.test.mjs`：500 块 → 25 次请求；取消后不再发请求且以 `TRANSLATION_CANCELLED` 拒绝；500→成功重试；挂起请求超时返回可重试错误。
- `tests/qaBudget.test.ts`：全文回退裁剪不超过预算；RAG 截断计数；`buildQaContext` 透传。
- `tests/libraryWriteTargeting.test.mjs`：删除论文清 RAG；`saveSettings`/排序只改目标列；整库 `save()` 被 spy 后不被调用；新库有系统分类；附件目录包含方向；导入源路径越界被拒。
- `tests/pdfTextCache.test.ts`：同 key 共享、切换 PDF 丢弃旧结果、invalidate。
- `tests/notesTargeting.test.ts`：搜索保持当前笔记；外部写入只在版本变化时通知。
- `tests/safeHtml.test.ts`：unwrap 隐藏的 `<img onerror>`、嵌套 `script/style/iframe`、合法表格结构。
- `tests/uiDesignTokens.test.ts`：非标准透明度为 0、令牌双主题；E1 全仓扫描无未配对的 `bg-white`/`bg-slate-50`（仅登记开关圆点与 PDF 切片图片衬底两处例外）。
- `tests/secretStorage.test.mjs`：AES-GCM 往返、密钥位于 dataDir 之外、篡改/丢密钥失败、旧明文兼容、`resolveReaderConfigSecrets`。
- `tests/knowledgeMcpRagCleanup.test.mjs`：MCP 删除后 RAG chunk 被清理；无 RAG 库时为空操作。
- 扩展 `tests/backupPathRemap.test.ts`：v2 分片路径重映射。
- 对抗性复核补测：翻译命令白名单、双引号命令扫描、MinerU 端点白名单、配置不能扩根、storageDir 需目录授权、relocate/add-attachment 不能铸造读权限、正斜杠附件路径、单条超长 RAG section 硬裁剪（截断标记、不重复计入丢弃数）、MCP 删除清 RAG、外部删除笔记解绑、AES 密钥文件。
- 另做了一轮 4 维度对抗性复核（24 个 agent），确认的 16 条问题已全部修复并补测试。

执行结果（Windows 11，Node 24.19）：

- `tsc`：通过。
- `npm test`：928 项，927 通过、1 跳过、0 失败。此前几次运行中 `readerSettings`/`readerSettingsHydration`/`mcpClientLaunch` 曾因计划 F5 记录的本机 `%TEMP%` esbuild `Access is denied` 失败，本次未复现；本次新增与涉及的测试全部通过。
- `npm run build`：通过（`✓ built in 1.30s`）。早前运行曾因同一 F5 临时目录问题在 `vite:esbuild-transpile` 阶段失败。
- MCP bundle：`npx esbuild bin/paperquay-mcp.cjs --bundle` 成功，产物包含共享缓存构造器。
- 构建产物 CSS：确认 `--pq-overlay-soft/strong` 在浅色/深色均有定义，`background-color: var(--pq-overlay-*)` 规则已生成。

## 残留与边界

- A6 只修了僵死状态与重译阻塞；现有 `retainpdf_get_status/cancel_translation` 尚未接入一个专门的文献详情/任务中心 UI（当前仓库没有 RetainPDF 任务面板），留待 UI 批次。
- B1 保留单一 `invoke` 通道，用双侧显式白名单收口；未改成按域方法签名（会影响 130+ 调用点），白名单由测试锁定防止漂移。
- C4 只改了桌面命令的整库保存；MCP 自己的 `delete_papers` 仍走独立实现，其 RAG 清理属于 S3 双份逻辑收敛范围。
- B1 的对话框/拖放读权限持久化在 `.paperquay-approved-roots.json`；升级后首次启动时，此前配置的自定义 MinerU/译版目录还没有授权记录，需要在设置里重新选择一次目录（UI 本来就走目录对话框）。默认位于 dataDir 内的目录不受影响。
- B5 的密钥文件位于 `<userData>/PaperQuay-secrets.key`，不在 dataDir 内。只手工复制 dataDir（不含密钥文件）到新机器会导致已有密文无法解密，需要重新填写 API Key；`.pqbackup` 恢复不受影响（备份内含解密后的 secrets，并在首次保存时重新加密）。
- MinerU 端点只允许官方主机、回环、私有网段与 `.local`；公网自建 MinerU 服务需要改走局域网地址。`apiBaseUrl` 不再与渲染层可写的配置文件比对。
- E1 的对比度验收依赖深色截图人工复核；本次以源码令牌与自动化类检查覆盖，未做截图比对。
- 本机 `npm run build` / `npm test` 的 F5 `%TEMP%` 问题未在本批处理（属计划 F5）。
