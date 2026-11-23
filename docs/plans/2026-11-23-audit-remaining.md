# PaperQuay 审计计划剩余工作清单（2026-11-23 核验）

- 日期：2026-11-23
- 状态：**核验完成，待排期**
- 关联计划：[2026-11-22 代码、架构与 UI 专项审计](2026-11-22-code-architecture-ui-audit.md)
- 关联变更记录：[第 1 批](../changes/2026-11-23-audit-batch1-data-dev-blockers.md)、[第 2 批](../changes/2026-11-23-audit-batch2-security-reader-notes-ui.md)、[第 3 批](../changes/2026-11-23-audit-batch3-startup-design-a11y-build.md)
- 代码基线：`main` 工作区，`package.json` 0.4.37。第 1–3 批改动**截至核验时尚未提交**（105 modified + 136 untracked），HEAD 仍是审计前基线；本清单所有 `文件:行号` 均指 2026-11-23 工作区状态。
- 核验方式：12 个并行审计 agent 逐条读取当前源码并交叉核对，附录 A 93 条全覆盖；同时执行 `npm test`（928 项：927 通过、1 跳过、0 失败）与 `npm run typecheck`（四个项目 0 诊断）。未执行安装包冒烟、真机 UI 与 axe 扫描，相关项在 §3 标注为验收缺口。

> 状态口径：**fixed**＝当前代码已修复且有测试或源码证据；**partial**＝主路径已修但仍有明确缺口；**open**＝当前代码仍存在。fixed 条目的历史证据见三份批次变更记录，本清单不重复展开。

---

## 1. 结论

| 范围 | 结果 |
| --- | --- |
| 计划正文 32 个主题 | 第 1–3 批完成 28 个；剩 **S2（open）、S3（partial）、S4（open）、S5（partial）** |
| 附录 A 93 条 P2/P3 | **fixed 21、partial 16、open 56** |
| 三批「残留与边界」 | 8 项验收缺口：计划头部状态已在本清单生成时同步，其余 7 项待办（§3） |
| 仓库状态 | 三批改动未提交，HEAD 不含修复；`npm test` 928 项全绿 |

正文未完成的 4 个主题与附录 A 的开放条目有部分重叠（同一工作项），§5 的建议批次已按工作项去重。附录 A 中不在正文主题内的开放条目约 40 余条，属于原计划「待排期」范围。

---

## 2. 正文主题剩余

### S2 巨组件与巨模块拆分

- **状态：open（未开始）**
- **目标目录全部不存在**：`src/features/literature/hooks`、`src/features/reader/hooks`、`src/features/pdf/hooks`、`electron/backend/rag`、`electron/shared` 均不存在；唯一存在的 `src/hooks` 只含 `useWheelScrollDelegate.ts`、`useImeSafeTextareaValue.ts`，与本计划无关。
- **LiteratureLibraryView（3,837 行）**：7 个目标 hook（`useLibraryCatalog`、`usePaperSelection`、`useImportFlow`、`useMetadataJobs`、`usePdfAssetAudit`、`useBatchOperations`、`useCategoryActions`）全仓 0 命中；46 个 `useState` 集中在 `:356-447`，选择、目录刷新、导入、元数据任务、PDF 资产审计、批量操作、分类动作全部内联。元数据解析对话框（`:3471-3565`）与 PDF 存储体检对话框（`:3596-3686`）仍内联在 JSX。
- **DocumentReaderTab（4,731 行）**：只有一个组件定义（`:315`），`:4547` 才开始 return；document/open、QA、summary、notes 四组职责仍混在约 4,200 行 state/ref/effect/useCallback 中。
- **PdfViewer（3,385 行）**：展示层已有 `PdfThumbnailSidebar.tsx`、`PdfOutlinePanel.tsx`、`PdfPageOverlay.tsx` 等独立文件（HEAD 既有），但 PDF.js 生命周期、滚动恢复、选择与批注、缩略图、目录、块覆盖层的控制逻辑仍在 `PdfViewer.tsx`（43 个 `useEffect`）。
- **ragStore（2,461 行）**：schema/迁移、索引、检索、运行记录四层仍在一个模块；本批对该文件无改动。
- **knowledgeMcpService（3,346 行）**：仍是单个 `PaperQuayKnowledgeService` 类（`:714` 起），约 50 个方法横跨文库、笔记、Zotero、RAG 与翻译版 PDF，未抽领域服务层。
- **验收缺口**：没有针对 hooks 目录或 rag 分层的结构/契约测试；「只移动代码、不改行为」尚无拆分前后对照证据。

### S3 桌面与 MCP 双份业务逻辑

- **状态：partial**
- **已共享**：`src/shared/ragQueryUtils.cjs`、`src/shared/mineruCachePaths.cjs`（C1 产物）、store 层单行 UPSERT/版本检查、`rrfFuse` 等局部函数。
- **embedding 配置仍有 3 份**：`src/services/rag.ts:49-69`、`electron/mcp/knowledgeMcpService.cjs:622-641,996-1021`、`electron/backend/noteEmbedding.cjs:6-27`；另有 `utils.cjs` 第四套 `normalizeBaseUrl` 与零引用的 `src/services/embeddingConfig.ts`。MCP 固定 60s 超时且 apiKey 可为空，notes 侧默认值与必填性不同。
- **MCP 仍重复实现四套流程**：
  - 导入：桌面仅按 contentHash 查重，MCP 另按 DOI/标题；文件命名、读授权、Crossref 抓取均不同。
  - 更新：`applyPaperMetadataPatch` 与 `updatePaperFields` 同构但未抽；`language: ''` 桌面报错、MCP 清空为 null。
  - Zotero：桌面按 collection 建嵌套分类并处理未归档，MCP 建平级分类；元数据字段写入范围不同。
  - 检索：MCP 直接查 rag.sqlite（FTS/KNN/RRF/LIKE），桌面走 `ragStore.retrieveDocumentChunks`；结果形状不同（`paperId/paperTitle/snippet` vs `documentKey/chunkId/text`）。
- **版本检查双层**：论文/分类/删除走共享 `libraryDatabaseStore.assertRecordVersion`；note/folder 仍由 MCP 自写 `assertRecordVersion` 与 `noteStore` 双层校验。
- **契约测试缺失**：现有测试只断言 18/28 工具名、3 个 schema 字段与 1 次 `tools/call`；未枚举 TOOLS ↔ handler 一一对应、默认值、required、错误码。已存在漂移：`search_papers` schema 声称可搜 tags，handler 的自由文本条件不含 tags。
- **验收缺口**：计划要求「同一输入桌面与 MCP 返回一致结构」「删除重复实现后覆盖率不下降」，均未达成。

### S4 设置单一存储

- **状态：open（未开始）**
- **四个所有者原样存在**：
  - Notes `src/features/notes/bibliography.ts:22-52` 整对象写 `paper-reader-settings-v3`；
  - Reader `src/features/reader/useReaderSettings.ts` 整对象写 localStorage（`:402-405`）与配置文件（`:422-455`）；
  - SQLite `library_settings` 独立存储（`libraryCommands.cjs:604-615`，`saveSettings` 仍先 DELETE 全表再重插）；
  - `zoteroLocalDataDir` 同时存在于 `LibrarySettings` 与 `ReaderConfigFile`，并有独立 state、500ms 双写、hydration 回填、事件回填。
- **无版本与迁移**：`READER_CONFIG_VERSION = 1` 只写不读；`LibrarySettings` 无 version；`library_meta.version` 只是数据库初始化标记。
- **验收两条都不成立**：
  - 同会话：Notes 改 `noteCitationStyle` 后，Reader 再改任意设置会用挂载时的旧值整对象覆盖。
  - 重启：hydration 让配置文件覆盖 localStorage，Notes 值丢失。
  - 反向：Reader 偏好设置改引用格式，NoteEditor 只在挂载时初始化，显示旧值并在下次保存覆盖 Reader 值。
- **无回归测试**：现有测试只覆盖 Notes 自身写读与 `normalizeReaderSettings`，没有「Notes 设 apa7 → Reader 任意设置写/重启 hydrate → 仍为 apa7」用例。

### S5 三处性能热点

- **状态：partial**
- **已做**：知识图谱相似度滑杆 260ms 防抖；笔记草稿写入 300ms 防抖（仅延迟内存 Map 写入）。
- **文献列表**：`LiteraturePaperList.tsx:505-529` 仍 `papers.map` 全量渲染，行组件未 memo，无 tanstack-virtual/react-window 等依赖；仅保留 CSS `content-visibility`（`index.css:522-525`），已加载行全部留在 DOM。
- **知识图谱**：`KnowledgeGraphWorkspace.tsx:441-459` 仍静态 import fcose 并主线程 `layout.run()`（`quality:'proof'`、`numIter:2500`）；后端 `knowledgeGraphCommands.cjs:516-557` 仍为全部 papers 建节点，`ragStore.cjs:2219-2286` 先加载全部文档向量两两 cosine 再截断，无 top-degree 采样；`src/features/graph` 只有一个文件，全仓 `new Worker(` 仅见 MinerU 解析。
- **笔记编辑器**：每次按键仍 `getJSON + getHTML + collectText + 全量 JSON.stringify` 签名（`NoteEditor.tsx:979-982,1273-1279`；`noteEditorUtils.ts:400-425`）；图片仍 base64 入正文（`noteEditorUtils.ts:493-528`，`allowBase64: true`）；草稿仍是进程内无上限 Map，无 beforeunload/磁盘持久化。
- **隐藏工作区刷新**：`useLibraryQueryRefresh.ts` 监听事件后统一 `refreshPapers()` 全量刷新，未按 `paperId` 增量、无 `workspaceActive` 门控；Library 在 `App.tsx` 与 `Reader.tsx` 以 hidden 常驻挂载，隐藏时照常刷新。
- **验收缺口**：5000 行列表 ≥50fps、10k 节点首屏 <2s、8 截图笔记单键 <50ms 均无埋点或基准；`tests/initialChunks.test.mjs` 只证明分包，不是 S5 验收。

---

## 3. 三批残留与验收缺口

| # | 项 | 状态 | 证据与剩余工作 |
| --- | --- | --- | --- |
| 1 | A6 RetainPDF 任务中心 | partial | 后端 `retainPdfIntegration.cjs:989-1029` 已有 status/cancel，命令已入白名单；但 `src/services/retainPdf.ts:74-104` 的 `getRetainPdfStatus`/`cancelRetainPdfTranslation` 全仓无 import，UI 未接。需在文献详情或任务中心接入失败重试与取消，并补 UI 用例。 |
| 2 | F4 checkJs / lint / CI | partial | `tsconfig.electron.json:7-8` 仍 `checkJs:false`；实测 `--checkJs` 报 154 个 TS 错误（knowledgeMcpService 47、backupSources 15、backupImport 13 等）；未引入 ESLint/Biome；`tsconfig.tests.json` 只含 `tests/**/*.ts`，24 个 `.test.mjs` 未纳入。需按文件分批开 checkJs，或明确登记范围外。 |
| 3 | E4/E1 axe 与截图 | open | 全仓无 axe-core/testing-library；`tests/uiA11yI18n.test.ts` 与 `uiDesignTokens.test.ts` 均为源码正则/类名扫描；`docs/assets` 无深色/浅色审计截图。需补 axe 扫描与双主题截图复核记录，不能把 E4 视为已验收。 |
| 4 | E5 服务层与模板文案 | partial | `src/services/notes.ts` 仍有 14 处中文错误兜底；`noteEditorUtils.ts:168-329` 的斜杠模板 label/description 全中文；`NotesList/NotesWorkspace/NotesGraphView/noteHealth` 仍有单语中文。需改错误码 + 渲染层本地化，或登记为产品范围外。 |
| 5 | B1 首次启动重新授权 | partial | pathPolicy 约束成立（`pathPolicy.cjs:144-164` 不含 renderer 配置中的 MinerU/Zotero 目录）；但升级后自定义 MinerU/译版目录没有授权记录时，缺少设置页引导重新选择；`mineruCacheCommands` 目录校验尚未统一到 pathPolicy。 |
| 6 | F2/§8 安装版冒烟 | partial | `tests/mcpPackaging.test.ts` 只做 extraResources/资源根/缺文件静态断言；CI 仅 `electron-builder --dir` 冒烟；中文 CID PDF、Vault 同步、RetainPDF、MCP `read_paper_figure`、备份恢复均未在安装版实机验收。 |
| 7 | S1 性能埋点对比 | partial | `tests/initialChunks.test.mjs` 已断言首屏闭包不含 editor/graph chunk；`App.tsx` 有 `workspace:notes/graph` 埋点，但没有改造前后冷启动与首次打开的耗时对比记录。 |
| 8 | 文档状态同步 | partial | 计划头部已补充本清单链接与残留标注（2026-11-23 整理时完成），与 batch3「残留与边界」口径一致。`docs/changes/README.md` 仍只是格式说明，是否作为批次索引待定。 |

---

## 4. 附录 A 逐条状态（93 条）

**汇总**：fixed 21、partial 16、open 56。

- **fixed（21）**：D1-3、D1-4、D2-1、D2-6、D3-3、D5-11、D8-3、D5-3、D6-8、D6-10、D6-11、D4-12、D7-2、D7-3、D7-5、D7-8、D7-10、D7-12、D1-7、D8-5、D8-9。
- **partial（16）**：D1-2、D1-5、D2-12、D3-4、D8-7、D8-14、D1-14、D5-14、D4-9、D7-4、D7-6、D7-7、D7-9、D8-4、D8-6、D8-10。
- **open（56）**：见下表。

> 下表保留审计原 ID 与级别；「剩余工作」列是 2026-11-23 当前代码的核验结论。

| ID | 级别 | 状态 | 剩余工作 / 当前证据 |
| --- | --- | --- | --- |
| D2-14 | P2 | open | ragStore 未拆 schema/迁移、索引、检索、运行记录；libraryCommands 未把元数据网络抓取与文库 CRUD/附件/分类命令分离。 |
| D2-9 | P2 | open | 仍无 worker 重启/重建、无 per-call 超时；一次异步崩溃后本会话全部 RAG 调用持续失败，只能重启应用。 |
| D3-10 | P2 | open | MCP 私有混合检索管线与 embedding 配置未合并到 ragStore/shared 域模块，按源 KNN 与按结果邻接查询的 N+1 仍在。 |
| D3-3 | P2 | fixed | 已修复（本轮核验通过） |
| D3-9 | P2 | open | 导入、更新、Zotero 同步、检索四套 MCP 实现均未收敛为共享域模块；已确认的具体漂移包括文件命名规则、查重口径、检索筛选面与 total/分页语义。 |
| D4-10 | P2 | open | 四个巨组件均未拆分，effect/state 图仍集中在单个组件内。 |
| D4-11 | P2 | open | QA 会话/输入/附件未按 tabId 分片；切换标签仍会清空草稿并中止流式回答。 |
| D4-5 | P2 | open | 未引入单一 settings store、patch 写与版本校验；Notes-only 写入仍会被 Reader 的整对象 localStorage/配置文件写回静默回滚。 |
| D5-12 | P2 | open | 未按计划拆分为 document/QA/summary/notes 四个 hook，也未保留薄壳负责布局与 tab 生命周期。 |
| D5-13 | P2 | open | PDF.js 生命周期、滚动恢复、选择与批注、缩略图、目录、块覆盖层仍未拆成独立模块。 |
| D1-2 | P2 | partial | will-navigate 仍未把 file:// 限制到 `dist/index.html`（或复用 isTrustedRendererUrl 精确判定）；攻击者 HTML 仍可在主窗口加载、劫持 UI，并使用 preload 直接暴露的 clipboard/listen 等非 IPC 能力。应按 `electron/ipcSecurity.cjs:17-29` 的白名单拒绝其它 file:// 导航。 |
| D1-3 | P2 | fixed | 已修复（本轮核验通过） |
| D1-4 | P2 | fixed | 已修复（本轮核验通过） |
| D1-5 | P2 | partial | 渲染层仍未校验 assetPath 必须位于当前 MinerU 缓存目录内：允许根（尤其 dataDir）内的任意文件仍可被读取为 base64 返回；UNC 路径在 `pathPolicy.resolveForCheck`→`safeRealpathSync`（`electron/backend/pathPolicy.cjs:57-63,186-191`）阶段仍会先发起 SMB 探测，然后才因不在读根内被拒。需在 `resolveMineruAssetPath`/加载边界做字符串层面 UNC 拒绝，并用缓存目录包含校验限制 asset 读取。 |
| D1-6 | P2 | open | 任意绝对路径（含 UNC、用户文档/桌面等）仍可作为恢复目标，应用重启后会重命名既有目录并写入备份内容。需把 targets 绑定到主进程 dialog 返回的授权记录（同 pathPolicy 的持久化授权），拒绝 UNC 与非空未授权目录。 |
| D1-9 | P2 | open | 生产版渲染器崩溃/白屏仍不可见；无效 pending restore 仍静默退出，用户只能从 pending.error.json 与控制台日志发现。需在生产版注册 render-process-gone/did-fail-load 提示与恢复，并对无效 pending 显示可读错误。 |
| D2-1 | P2 | fixed | 已修复（本轮核验通过） |
| D2-10 | P2 | open | 自定义关系仍是非原子写；进程崩溃/并发写导致文件损坏时，下一次读取会把损坏当空库，随后任一写入将永久覆盖丢失全部关系。需原子写（临时文件+fsync+rename）并在损坏时备份报错而不是当空。 |
| D2-11 | P2 | open | Zotero 正在运行且 WAL 未 checkpoint 时，导入会读到过期快照；大库会整库载入 WASM 内存，存在 OOM 风险。需优先复制含 WAL 的一致性快照（或使用只读 SQLite 连接/ATTACH），并限制并发与内存。 |
| D2-12 | P2 | partial | 元数据 HTTP 请求、远程 PDF 下载与本地 PDF 导入仍无超时和大小上限；下载/导入仍整文件缓冲。需 AbortSignal.timeout、Content-Length/流式累计上限、下载按块流式写盘并对导入大小做上限或流式哈希。 |
| D2-13 | P2 | open | 无硬链接文件系统上仍无法导入/恢复；VACUUM 与 integrity_check 仍在主线程同步执行，大库会卡住 UI。需硬链接失败回退到 rename/复制，并把快照与校验移到 worker/子进程。 |
| D2-5 | P2 | open | FTS 查询空结果不回退 LIKE；缺少启动/迁移时的 notes_fts 全量回填或重建，旧笔记仍可能静默不可搜索。 |
| D2-6 | P2 | fixed | 已修复（本轮核验通过） |
| D3-4 | P2 | partial | 笔记只读工具（list_note_tags/list_note_folders）仍会在库不存在时创建 notes 数据库；preview_delete_papers 仍以可写连接打开文库库。需把这三处改为只读打开并在库缺失时返回空结果，确保 MCP 读不触发建库。 |
| D3-6 | P2 | open | get_note 仍需返回 contentJson 或可逆 Markdown，update_note 需支持结构化内容往返；当前富文本 round trip 仍被扁平化。 |
| D3-7 | P2 | open | 需在 MCP 或 noteStore 校验 expectedFolderVersions 覆盖全部 removedIds（缺失即 NOTE_CONFLICT），并补 partial map 用例。 |
| D3-8 | P2 | open | 需对解析后的 absolutePath 做 realpath 包含校验（必须位于 cacheDir 内），拒绝绝对路径、UNC 与 .. 穿越，并补越界用例。 |
| D4-6 | P2 | open | 未改：需要区分首次加载/后台刷新（请求代次或 refreshing 标志），去掉挂载时的重复请求，并在响应乱序时丢弃旧结果。 |
| D4-7 | P2 | open | 未改：需要离场保护（beforeunload/自动保存）以及草稿落盘和 Map 上限/淘汰。 |
| D5-3 | P2 | fixed | 已修复（本轮核验通过） |
| D5-5 | P2 | open | 未改：清空需同时删除磁盘缓存文件并抑制恢复 effect（或记录显式清空标记）。 |
| D5-6 | P2 | open | 未改：缓存键需加入模型/源语言；写入前与磁盘内容合并或按块增量写，并跨写入者加锁。 |
| D5-7 | P2 | open | 未改：主提交路径需按文档身份+请求代次守卫（旧请求不得写 pdfSource/currentDocument/loading），switchCurrentPdfFile 也要纳入同一代次。 |
| D5-9 | P2 | open | 未改：切换标签不应无条件 abort（或需可恢复状态），abort 时无条件清理空占位，QA 中标签计入 busy，并在持久化前过滤空 assistant 消息。 |
| D6-10 | P2 | fixed | 已修复（本轮核验通过） |
| D6-11 | P2 | fixed | 已修复（本轮核验通过） |
| D6-8 | P2 | fixed | 已修复（本轮核验通过） |
| D6-9 | P2 | open | 未改：window 监听需绑定面板可见/工作区激活，或把快捷键限制在表单焦点范围内。 |
| D8-7 | P2 | partial | preload 与 main 的集成行为（白名单拒绝、restore 同步 ack、will-navigate 放行规则）仍只有间接模块测试，需补 vm/桩加载用例。 |
| D2-2 | P2 | open | library_init 需瘦身为仅返回 settings/categories，首屏文献改走 library_query_papers 首页，LiteratureLibraryView 初始列表使用分页结果。 |
| D2-8 | P2 | open | 改为一次批量 KNN（或 document_key IN 列表）、签名/chunk 结果只算一次并复用。 |
| D3-5 | P2 | open | 复用并关闭 library store（或注入单例），按 paperId 查少量记录替代全库 load。 |
| D4-13 | P2 | open | 改为主进程侧只读首页/范围解析，避免整个 PDF base64 进渲染进程。 |
| D5-10 | P2 | open | 按需/懒加载单篇 workspace item，或把全库快照下沉到主进程查询。 |
| D5-11 | P2 | fixed | 已修复（本轮核验通过） |
| D5-8 | P2 | open | 流式答案单独订阅/增量渲染，历史消息 memo 并缓存 markdown AST。 |
| D6-5 | P2 | open | 新增批量命令（单事务）处理删除/收藏/移动，全选按游标或后台任务处理，避免逐篇 IPC。 |
| D6-6 | P2 | open | 改为增量/按 id 刷新 + 请求代次守卫，列表只取摘要字段。 |
| D6-7 | P2 | open | 一次遍历预计算祖先集与 folder 计数（或后端聚合），并取消 1000 条上限（分页/虚拟化）。 |
| D8-3 | P2 | fixed | 已修复（本轮核验通过） |
| attachment-filter-stat-storm | P2 | open | 缓存 stat 结果（TTL/失效）或主进程增量维护 missing 状态，避免每次查询全库 stat。 |
| vault-autosync-main-thread | P2 | open | 订阅设置变化并立即 clearInterval；vault 扫描改异步/分片或移出主线程。 |
| D1-7 | P2 | fixed | 已修复（本轮核验通过） |
| D3-2 | P2 | open | 需让 MCP bundle 携带 ragWorker.cjs（或 MCP 进程内直接调用 indexNote 不走 Worker），并补安装版布局的笔记向量索引回归测试。 |
| D8-4 | P2 | partial | 改为排除式/glob 配置或对实际 asar/安装目录断言运行时依赖闭包（含传递依赖），否则白名单与真实打包内容仍会漂移。 |
| D8-5 | P2 | fixed | 已修复（本轮核验通过） |
| D8-6 | P2 | partial | 按文件逐步开启 electron/、bin/ 的 checkJs；将 tests/**/*.mjs 纳入类型检查项目（allowJs/checkJs 或独立 tsconfig）。 |
| D4-12 | P2 | fixed | 已修复（本轮核验通过） |
| D4-9 | P2 | partial | Notes UI 仍有大量单语中文：src/features/notes/NotesList.tsx:66,68-70,84（排序 aria-label 与 option）；src/features/notes/NotesWorkspace.tsx:305-316（确认/取消）、:369、:986-1004（vault 清理确认与同步完成文案）；src/features/notes/NotesGraphView.tsx:43,111,120；src/features/notes/noteHealth.ts:71-75；服务层错误 src/services/notes.ts:35,81,103,196。标签页的「未命名笔记」兜底仍是中文（src/stores/useTabsStore.ts:156,185），英文界面可见。 |
| D7-10 | P2 | fixed | 已修复（本轮核验通过） |
| D7-2 | P2 | fixed | 已修复（本轮核验通过） |
| D7-3 | P2 | fixed | 已修复（本轮核验通过） |
| D7-4 | P2 | partial | .pq-input 外环本身仍只有 1.73:1（浅）/2.88:1（深），未达 3:1；当前焦点可见性主要靠同时变色的 1px 实心 accent 边框（3.43:1/9.35:1）。需提高 color-mix 比例或改用实心 accent 环，并修正注释与验收数值。 |
| D7-6 | P2 | partial | 焦点陷阱仍可逃逸：选项是 <button tabIndex={-1}>（src/ui/commandPalette.tsx:165-169），而 Dialog 的 FOCUSABLE 用 button:not([disabled]) 把它计入边界（src/ui/dialog.tsx:44-51），导致 last 是永远 Tab 不到的选项；唯一真实 Tab 停靠点是搜索框，从搜索框按 Tab 时 active!==last，Dialog 不拦截（src/ui/dialog.tsx:122-139），焦点会落到未设 inert 的背景页面。需把 tabindex=-1 元素排除出陷阱边界，或在 Tab 时把焦点循环回输入框。 |
| D7-7 | P2 | partial | 指针打开的右键菜单仍收不到键盘事件：只有传 keyboardAnchor 时打开才聚焦菜单项（src/ui/menu.tsx:74-82），onKeyDown 绑在菜单面板上（:129），没有 document 级监听。无 keyboardAnchor 的右键菜单（src/features/notes/NotesSidebar.tsx:576-587、src/components/tabs/TabBar.tsx:275-281、src/features/pdf/PdfViewer.tsx:3370-3381 等）打开后焦点留在背景，Esc/方向键不会触发处理函数，实际仍不可键盘操作；docs/ui-design-system.md:104 的「键盘始终可用」目前不成立。 |
| D7-8 | P2 | fixed | 已修复（本轮核验通过） |
| D7-9 | P2 | partial | workspace 与服务层仍是中文：src/features/notes/NotesWorkspace.tsx:803、:810、:1009（索引/同步失败兜底）、:986-1004（vault 清理确认与完成状态）、:305-316（确认/取消 title 与 aria-label）；src/services/notes.ts:35,81,103,196 等 throw 中文错误；NotesSidebar 仍把 error 原文直接渲染（src/features/notes/NotesSidebar.tsx:342,403-404），英文界面会显示中文错误。 |
| D1-14 | P3 | partial | 仍为单一 stringly-typed 通道：无逐命令 args/return schema、无编译期命令联合类型或类型化注册表；白名单只做运行时字符串拒绝，类型安全仍依赖调用方 invoke<T> 断言，electron/ 目录仍未开启 checkJs。 |
| D5-14 | P3 | partial | 模块位置未迁移到 app 级，backup/MCP/updates 仍归属 features/reader；设置状态与窗口生命周期仍由 Reader 持有，只是当前 Reader 始终挂载才可用。 |
| D7-14 | P3 | open | 未提供 UI 原语 size/variant API，28px/32px 混用仍在；<1040px 的响应式回退仍不可达。 |
| D1-10 | P3 | open | 退出时排队的笔记索引仍会丢失，且 3 秒硬退可能绕过 RAG worker/store 的异步关闭。需在 before-quit 中等待 noteIndexer.whenIdle（带超时）并延后 app.exit。 |
| D1-11 | P3 | open | 未实现“ack 成功前不清空/保留旧快照”或按 key 增量合并；反复加载/ack 持续失败会反复清空 localStorage。需持久化 restore 完成状态或改为合并写入。 |
| D1-13 | P3 | open | 无应用级 CSP、未接管权限请求策略、渲染器 sandbox 关闭、ASAR 完整性校验关闭。需补 CSP（至少 default-src/script-src 白名单）、权限处理器、评估 sandbox:true 与 ASAR integrity，或把这些登记为明确风险。 |
| D1-8 | P3 | open | whenReady 与 loadFile/loadURL 的失败仍无错误处理：渲染层入口加载失败时没有对话框、没有后端清理，窗口保持隐藏或进程悬挂。需给 loadFile/loadURL 与 whenReady 链补 catch，失败时弹窗并复用现有清理路径。 |
| D3-11 | P3 | open | 两个 MCP/桌面进程并发写入时仍会互相覆盖 revision（后写者基于旧值 +1），桌面端可能漏一次刷新事件；崩溃前也没有可审计日志。需 O_APPEND 写入/文件锁或改用 SQLite 原子 UPSERT 记录。 |
| D3-14 | P3 | open | 不存在的 paperId/folderId 仍可写入，笔记会绑定到不可见目标（列表/文件夹树均找不到）。需在写入事务内校验 paper 与 folder 存在，或补外键/级联策略。 |
| D6-12 | P3 | open | 未改：草稿需持久化到 localStorage/IndexedDB，并在退出/崩溃路径提示或自动保存。 |
| D6-13 | P3 | open | 未改：用户筛选与后台状态发现需分流——选择清空/查询代次只看用户条件，MinerU 状态只合并数据。 |
| D6-14 | P3 | open | 未改：把 publisher/volume/issue/pages/issn 纳入 changed 判断，或直接比较合并前后的草稿。 |
| D3-12 | P3 | open | 需更新 schema 允许 pageKind: ''，并把 tag/type/noteIds/linkedPaperId 等已支持过滤条件补进 search_notes schema（或删除 handler 侧未声明能力）。 |
| D4-8 | P3 | open | 死 store 与对应测试仍在，Reader 内重复的桥接状态逻辑未合并或删除。 |
| D7-13 | P3 | open | 两条都未处理：MinerU 表格与滚动条需改用 --pq-* 语义令牌；未被引用的令牌与类需删除或接入使用，并同步 docs/ui-design-system.md。 |
| D8-10 | P3 | partial | 把固定延时改为确定性等待（轮询断言、暴露的 promise 或假定时器），保留现有临时目录重试守卫。 |
| D8-12 | P3 | open | 需建立 schema 与 handler 的契约测试（参数、默认值、必填、错误码），替代纯手工维护。 |
| D8-14 | P3 | partial | 测试仍复制打包配置；应改为调用 scripts/bundle-mcp.cjs 的 bundleMcp() 或抽共享配置，避免两处漂移。 |
| D4-14 | P3 | open | 阅读进度更新不应触发文献列表/category 重查（原位更新，或仅文库可见时刷新）。 |
| D3-13 | P3 | open | AppImage 应通过 APPIMAGE/APPDIR 解析稳定可执行路径（或安装到固定目录）生成 snippets；afterPack 增加 bundle 内容/版本或 hash 校验，避免 stale bundle 被打包。 |
| D8-11 | P3 | open | 要么显式拒绝 arm64 并说明原因，要么提供/内嵌 windows-arm64 sqlite-vec 扩展并让 afterPack 选中正确包；删除 Build-Local 中重复的前端构建（或让 electron:build 不再构建）。 |
| D8-13 | P3 | open | 在 devDependencies 显式声明 builder-util、app-builder-lib、electron-winstaller（或改用公开稳定 API/自带工具），避免 npm 提升布局变化后构建或测试失败。 |
| D8-9 | P3 | fixed | 已修复（本轮核验通过） |
| D7-11 | P3 | open | 整条未修：kicker 文字应改用 --pq-accent 或更深文字令牌（如 --pq-text/--pq-accent-hover），不要复用为实心 accent 底设计的 --pq-accent-text。 |
| D7-12 | P3 | fixed | 已修复（本轮核验通过） |
| D7-5 | P3 | fixed | 已修复（本轮核验通过） |

---

## 5. 建议批次

前置动作：先把第 1–3 批按批次拆 commit（batch1 数据/开发阻断、batch2 安全/正确性、batch3 工程化），暂存时排除 `scripts/`、`.verification-*`、`.codex-temp` 等非审计文件。否则 HEAD 仍不含任何修复。

| 批次 | 主题 | 条目 | 目标 |
| --- | --- | --- | --- |
| 第 4 批 | 安全与数据收尾 | D1-2、D1-5、D1-6、D1-8、D1-9、D1-10、D1-11、D1-13、D2-10、D2-11、D2-12、D2-13、D3-4、D3-8、D3-11、D3-14、D5-7、D6-12 | 止住剩余越权读取、恢复目标越界、退出丢索引、图谱关系损坏与草稿丢失 |
| 第 5 批 | 设置与共享域（S4 → S3） | D4-5、D5-14、D3-9、D3-10、D8-12、D8-14、D1-14、D8-7 | 单一 settings store + 迁移；embedding/检索/导入共享；28 工具契约测试 |
| 第 6 批 | 巨组件拆分（S2） | D2-14、D4-8、D4-10、D4-11、D5-12、D5-13、D7-14 | 只移动代码，按目标 hook/模块分步提交，保持 build + test |
| 第 7 批 | 性能（S5 + 附录性能项） | D2-2、D2-8、D2-9、D3-5、D4-13、D4-14、D5-8、D5-10、D6-5、D6-6、D6-7、attachment-filter-stat-storm、vault-autosync-main-thread | 列表虚拟化与 memo、fcose Worker + top-degree、批量命令、增量刷新 |
| 第 8 批 | 阅读/笔记正确性 | D2-5、D3-6、D3-7、D3-12、D4-6、D4-7、D5-5、D5-6、D5-9、D6-9、D6-13、D6-14 | 笔记 round trip、FTS 回退、翻译缓存、PDF 打开代次、笔记列表与筛选 |
| 第 9 批 | UI 与工程化收尾 | D4-9、D7-4、D7-6、D7-7、D7-9、D7-11、D7-13、D3-2、D3-13、D8-4、D8-6、D8-10、D8-11、D8-13 | i18n 收口、焦点/对比度、MCP 打包、checkJs 增量、构建脚本 |

批次 4–9 完成后，再补 §3 的验收缺口（A6 UI、axe/截图、F4 checkJs、安装版 §8.6 冒烟、S1 性能对比）与计划头部/索引文档。

---

## 6. 验收要求

1. **每批改动**：`npm run build` + `npm test` 通过；新增用例覆盖「触发条件 + 负向路径」；UI 改动补浅色/深色截图。
2. **安全类**（第 4 批）：每个边界补越权/越界用例，不接受仅文档说明；恢复目标必须绑定主进程授权。
3. **S4**：验收「Notes 设 apa7 → Reader 任意设置写/重启 hydrate → 仍为 apa7」，并覆盖版本迁移与冲突。
4. **S3**：枚举 28 个 MCP 工具的 schema/handler 契约；同一输入桌面与 MCP 返回一致结构；删除重复实现后覆盖率不下降。
5. **S2**：只移动代码与改内部接口，不同时改行为；每步独立提交，保持测试全绿；补结构/契约测试证明拆分边界。
6. **S5**：用 `PAPERQUAY_PERF=1` / `localStorage['pq.perf']='1'` 记录改造前后数据；验收 5000 行列表 ≥50fps、10k 节点首屏 <2s、8 截图笔记单键 <50ms。
7. **发布前**：安装版冒烟覆盖中文 CID 字体 PDF、Vault 同步、RetainPDF、MCP `read_paper_figure` 与备份恢复。

---

## 7. 明确不做

- 不改文库、RAG、笔记 schema 与 `user_version`；不回写用户数据。
- 不重做 Agent/检索/笔记架构；S2/S3 只做结构拆分与共享模块抽取。
- 不把已登记的设计例外（图谱节点菜单、语义令牌未覆盖的 `dark:*`、accent/success 对比度约束）当作缺陷。
- 不删除或提交 `scripts/` 下的未跟踪个人脚本与数据。
- 不把 fixed 的 21 条重新排期；如需回归，只补测试，不重复改动。

---

## 8. 核验限制

- 本清单基于 2026-11-23 工作区源码逐条阅读，未执行安装包、真机 UI 与 axe；相关结论在对应条目中标注。
- `npm test` 全绿只证明现有测试集合通过，不证明每个 open 条目都没有运行时复现；第 4–9 批仍应按计划先写失败用例。
- 三批改动未提交；提交后行号可能位移，实施前以当时源码复核为准。
- 附录 A 93 条已全部覆盖，无遗漏项。
