# 2026-11-23 - 第 7 批：性能（S5 + 附录性能项）

## 现象

审计计划第 7 批的 13 个性能条目仍为 open，覆盖三条主链路：

- **文献库首屏与刷新**：`library_init` 每次返回整库 `LiteraturePaper`（作者/标签/附件/摘要全部水合），首屏无分页；Reader 启动时另行分页拉取全库构造 5000 条 `workspaceItemMap`；阅读进度事件触发列表与分类全量重查；批量收藏/移动/删除逐篇 IPC；`library_list_papers` 在 1000 条截断；分类计数在 JS 侧按分类重建后代集；附件筛选对全库附件逐个 `stat`；文献列表 `papers.map` 全量渲染 5000 行。
- **知识图谱**：fcose 布局在主线程 `proof/2500` 运行；后端为全部文献建节点、向量两两 cosine 后才截断。
- **笔记编辑器**：每次按键执行 `getJSON + getHTML + collectText + 全量 JSON.stringify` 签名，8 张截图时单键超过 50ms。
- **MCP 与 Worker**：混合检索存在逐命中 chunk 复核与逐结果 ready 检查；RAG worker 无 per-call 超时、崩溃后本会话永久失败；MCP 每次调用新建 library store 且部分路径不关闭。
- **PDF 元数据预览**：整份 PDF 以 base64 进入渲染进程后才解析第 1 页。
- **流式问答**：每个 delta 重建整个 `qaSessions`，历史消息重复解析 Markdown。
- **Vault 自动同步**：设置关闭/改间隔不清理现有 `setInterval`；主进程同步扫描整个 vault。

## 根因

- 首屏把「设置/分类」与「文献列表」绑在同一个初始化快照里；分页查询能力已存在但只有后续刷新使用。
- 阅读进度事件没有 detail，刷新 hook 只能全量重查；列表行没有 memo/虚拟化，行内闭包随父组件重建。
- 图谱布局与相似度计算没有规模上限；fcose 静态 import 到渲染入口。
- 笔记签名把 HTML 生成与深拷贝放在每次按键路径；渲染层没有节流/增量签名概念。
- Worker 宿主只有「失败闩锁」，没有超时/重启预算；MCP store 的创建与关闭分散在各 handler。
- 附件可用性与 vault 自动同步缺少缓存/订阅，按查询/按设置原样重复工作。

## 修改

### D2-2 + D5-10 首屏瘦身与 Reader 按需解析

- `library_init` 只返回 `{ settings, categories }`；分类计数改走 SQLite `listCategoriesWithCounts()`，不再水合整库。
- 新增 `src/features/literature/libraryFirstScreen.ts`：初始化后只发一次 `library_query_papers({ limit: 500, offset: 0 })`；`useLibraryCatalog` 首屏使用该页，并跳过随后 180ms 的重复防抖查询（MinerU 筛选除外，延迟到第一页之后按需补齐全库状态）。
- Reader 删除全库 `listAllLibraryPapers` 挂载 effect 与 `libraryWorkspaceItems`；`workspaceItemMap` 只合并 standalone/native 已打开条目，持久化 `native-library:*` 标签按 id 单条 `getLibraryPaper` 解析；概览使用 `resolvedLibraryPapers` 缓存。
- 问答范围/笔记引用候选改为助手侧栏打开后按需加载；不再在首屏拉全库。
- 详情表单 citationKey 查重改用 `library_list_citation_keys`（只返回 id + key），不再依赖整库快照。
- 首屏用例：`tests/libraryFirstScreen.test.ts`、`tests/libraryBatchCommands.test.mjs`、`tests/readerWorkspaceItems.test.ts`。

### D2-8 + D2-9 + D3-5 MCP 检索与 RAG worker

- `searchKnowledgeBase` 的 embedding model key 只算一次；逐命中 chunk 复核与逐结果 ready 检查合并为两条批量查询；KNN/邻居/chunk 均 O(1) 次。
- `ragWorkerHost.cjs` 增加 per-call 超时（读 30s、索引/快照/迁移 10min，可注入覆盖）、崩溃时拒绝在途调用并按预算懒重建（3 次/60s），`close()` 幂等且阻止重启；新增 `RAG_WORKER_TIMEOUT` / `RAG_WORKER_CLOSED` / `RAG_WORKER_RESTART_BUDGET` 错误码。
- `PaperQuayKnowledgeService` 增加懒加载单例 library store 与 `close()/dispose()`；MCP 读路径按 id 使用单行查询，不再 `load()` 整库。`bin/paperquay-mcp.cjs` 在退出/SIGINT/SIGTERM/stdio 关闭时释放 store。
- 用例：`tests/mcpHybridRetrieval.test.ts`、`tests/ragWorkerHost.test.ts`、`tests/mcpBatchStoreLifecycle.test.ts`；28 工具契约不变。

### D4-13 PDF 元数据主进程解析

- 新增 `electron/backend/pdfMetadataCommands.cjs`：`pdf_read_metadata_preview({ path })` 经 pathPolicy 校验后在主进程读取 PDF，用 pdfjs legacy 构建解析元数据与第 1 页文本行，只回传小 JSON（5 MB 夹具 716 B）。
- `src/services/pdfMetadata.ts` 改为 invoke 该命令，保留原有标题/作者/DOI/年份启发式与 `LocalPdfMetadataPreview` 契约；不再 `readLocalBinaryFile`。
- `package.json` 的 extraResources 新增 `pdfjs/legacy/build`；`pdfJsAssets.cjs`/`afterPack.cjs` 校验 `pdf.mjs` 与 `pdf.worker.mjs` 存在。
- 复核 `usePdfDocumentLifecycle` 的 `sourceSignature`：local-path/remote-url 只含路径/URL，改标题不重载、换路径重载；`source:null + pdfData` 回退分支仍会受 `currentPdfName` 影响（生产路径始终有 source），回归用例见 `tests/pdfViewerPageCountLifecycle.test.ts`。依赖数组仍与 HEAD 不同，保留到第 8 批复核。

### D4-14 + D6-6 阅读进度增量刷新

- `useLibraryReadingTracking` 的阅读事件携带 `{ paperId, lastReadAt, readingProgress }`。
- `useLibraryQueryRefresh` 增加 `handleReadingUpdated`：返回 true 时跳过全量重查；`useLibraryCatalog` 按 id 取 `library_get_paper_summary`（不含 abstract/doi/keywords 等大字段）合并进当前行，并用 `papersQueryGenerationRef` 丢弃过期响应。
- 仅当筛选/排序依赖阅读状态（`readStatus`、`recentlyRead`、按 `lastReadAt` 排序）时才退回全量重查。
- 用例：`tests/libraryQueryRefresh.test.ts`、`tests/libraryReadingTracking.test.ts`、`tests/libraryIncrementalRefresh.test.ts`、`tests/literatureLibraryUtils.test.ts`。

### D5-8 流式问答增量渲染

- 新增 `ReaderQaStreamStore`（`src/features/reader/readerAssistantSidebarProps.ts`）：流式 delta 只写瞬态快照，按动画帧合并通知（每帧至多 2 次），不重建已提交的 `qaSessions`；流结束/中止时 `buildStreamedQaSession` 一次性提交，并保留历史消息对象身份，使 memo 行不重渲染。
- 历史消息行 `memo`，Markdown 解析结果走有界 LRU（`createBoundedStringCache`），超过上限淘汰最旧项。
- 中止清理规则 `resolveReaderQaStreamAbortCleanup`：有部分文本时提交部分答案，空占位直接删除。
- 基准：100 条历史 + 200 delta 的 store 路径 0.55ms（热态，不含 IPC/React 渲染），通知 ≤2、提交 1 次；用例见 `tests/readerStreaming.test.ts`、`tests/readerQaPerTab.test.ts`。真实 hook 的“单次提交”由源码路径核对，结构用例只覆盖 store 与清理规则。

### D6-5 批量命令

- 新增 `library_batch_update_papers`（收藏/加分类，`store.applyPaperChanges` 单事务）与 `library_batch_delete_papers`（文件清理后单事务删除，再逐篇清理 RAG 索引并上报失败）。
- `useBatchOperations` 的批量收藏/移动/删除改为一次 IPC；全选仍用 `listAllLibraryPaperIds` 一次性枚举 id。
- 行为变化：批量写入改为原子操作——任一条目不存在时整批回滚并报错，不再逐篇部分成功。
- 用例：`tests/libraryBatchCommands.test.mjs`、`tests/libraryIncrementalRefresh.test.ts`。

### D6-7（library 部分）分类计数与 1000 条上限

- `categoryCounts` 改为一次遍历沿父链累计（seen 去重），5000 篇/50 层分类 8.93ms；`library_init` 与分类命令使用 SQLite 聚合计数。
- `library_list_papers` 上限 1000 → 5000；列表主路径全部走 `library_query_papers` 分页（500/页），全选 id 分页（5000/页）。
- 用例：`tests/libraryBatchCommands.test.mjs`（计数与基准）、`tests/libraryCommands.test.mjs`（1,200 条不再截断）。
- **范围说明**：原 D6-7 指向 Notes folder 计数/树与 1000 条笔记上限；本批只完成 library 侧，`NotesWorkspace.tsx` 仍逐 folder `filterNotesByFolder`，`useNotesStore.ts` 仍静默 1000 条，D6-7 转 open 并入第 8 批。

### attachment-filter-stat-storm 附件 stat 缓存

- `libraryAttachmentAvailability.cjs` 新增 `createAttachmentAvailabilityCache`：按路径缓存存在性（正结果 5s、负结果 1.5s），同路径并发请求共享一次 stat；文库写入（导入/删除/附件增删/迁移）显式失效。
- 行为变化：外部移动文件后 `missing` 状态最多滞后 TTL；应用内写入立即失效。
- 用例：`tests/attachmentAvailabilityCache.test.mjs`、`tests/libraryAttachmentAvailability.test.mjs`。

### vault-autosync-main-thread

- 自动同步改为 `useVaultAutoSyncSchedule`：订阅单一设置文档，关闭/改间隔立即 `clearInterval` 并重挂；无关设置变化不重置倒计时。
- `noteVault.syncNow` 的扫描/读写改为异步分片（每 16 次 IO 让出事件循环，小 vault 保持同步返回）：1000 文件总耗时约 2.1–2.5s；首轮记录的最大事件循环停顿 10.24ms 未复现（复核 21.4–21.8ms），测试只断言 finite，未断言 <16ms。
- 范围说明：首个 20 次 IO 仍同步执行，禁用后已启动的 sync 不会被取消；该项转 partial，第 8 批补 in-flight 取消、首段让出与 stall 断言。
- 用例：`tests/vaultAutosyncReactivity.test.mjs`、`tests/noteVault.test.ts`。

### S5 文献列表虚拟化

- 抽出 `LiteraturePaperRow`（`memo`）保留选择、拖拽、右键、Enter/Space、双击打开与测量回调。
- `LiteraturePaperList` 在 >60 行时使用 `resolveVirtualWindow` 窗口渲染（固定行高估计 + `ResizeObserver` 实测 + 8px 间距），滚动用 rAF 合并；小库保持全量渲染。
- 5000 行窗口基准：800px 视口、140px 行高下最多渲染 19 行（测试断言 ≤20；1200px 视口约 22 行）；875 个滚动位置累计窗口计算 16.92ms（约 0.02ms/次；测试仅断言总量 <500ms，实测 12–21ms 随负载波动）。
- 用例：`tests/literaturePaperListVirtualization.test.ts`。

### S5 知识图谱

- 新增 `src/features/graph/graphLayout.worker.ts`：在 module worker 内用 headless cytoscape + fcose 计算全局布局，主线程以 preset 位置应用；局部 concentric 仍留在主线程。`graphLayoutRunner.ts` 负责请求关联、失败回退与 `dispose()`；`graphLayoutMessages.ts` 负责严格的响应解析与位置校验。
- 大图自适应布局预算：≤500 节点保持 `proof/2500`，501–1500 用 default/1200，1501–3000 draft/600，3001–7000 draft/300，>7000 draft/120。10k 节点/20k 边 headless fcose 实测 998ms（10k/15k 边 836ms，5k 528ms，3k 321ms），满足 <2s 目标；首帧异步布局期间画布短暂显示未定位节点，不再冻结渲染线程。
- 基准边界：998ms 是 20k 边基准；后端默认每节点 250 边，10k 节点最坏约 1.25M 边，而布局预算只按节点数，因此 998ms 不是配置最坏情况。Worker 失败/不可用时 `graphLayoutFallback.ts` 仍回退主线程 fcose，`graphLayoutRunner` 没有 worker 超时看门狗；`vendor-graph` 仍静态包含 fcose 代码，仅执行在 Worker。
- 后端 `applyGraphBounds`：节点超过 `graphNodeLimit`（默认 10000，硬上限 50000）时按度数降序（同度按 id）确定性抽样，只保留两端存活的边；每节点边数上限（默认 250，硬上限 1000）按权重保留。普通规模快照原样返回；发生裁剪时 `metadata` 标记 `sampled/truncated/totalNodes/returnedNodes/...`，前端显示采样提示。10k 文献快照构建 80–110ms（测试实测 99ms；该基准关闭 RAG，不含 embedding 边）。
- `listDocumentSimilarities` 的候选文档数受 `maxCandidates`（默认 2000，上限 5000）约束，边数上限 1000，使用 top-K 堆收集（内存 O(limit)）；候选按 document_key 确定性截断，SQL 先过滤允许的 document key 并预计算范数。2500 文档/8 维 41–54ms；2000 候选/768 维最坏情况 1,031ms（decode/norm 仍是 O(全部允许文档)）。
- 用例：`tests/graphLayout.test.ts`（8）、`tests/graphSnapshotScale.test.mjs`（7）、`tests/graphSimilarityScale.test.mjs`（7）、`tests/knowledgeGraphCommands.test.mjs`（9）。

### S5 笔记编辑器签名

- `onUpdate` 只调用 `tracker.markDirty()`；120ms 尾随节流窗口内合并为一次廉价快照（`getJSON + collectText`，不含 `getHTML`）。
- 保存、草稿写入、锚点插入、切换笔记/卸载时才 `flush()` 完整快照（含 HTML 与字数）；草稿写入按编辑器实际持有的 noteId 限定，避免串写。
- `fastSignature` 改为标题/标签/颜色 + 结构化 `contentHash` + 纯文本，不再对 `contentJson` 做全量 `JSON.stringify`；普通长文本全量哈希，内嵌 `data:` 图片只采样长度与首尾，段落中间的字符改动仍可检测。
- 旧版全 JSON 草稿签名仍可匹配，避免升级后误判冲突。
- 8 张 256KB base64 截图的合成文档：单键路径（markDirty + 一次节流提交 + fastSignature）0.84–1.35ms，节流签名路径 0.062–0.103ms/次，旧路径同夹具 1.86–2.71ms/次（假 source，真机 Tiptap 序列化更高；纯 fastSignature 约 0.015ms）。
- 残留：标题/标签/颜色按键仍走旧重路径（`noteContentToTiptap` + legacy 全量签名 + 草稿深拷贝，约 11ms/键），未纳入 120ms 节流；首次正文按键后 120ms 内关闭/切笔记时没有草稿载荷，保存按钮也被 dirty 门控，存在最多 120ms 丢失窗口；草稿 4MiB 上限会丢弃 8×256KB 夹具（序列化 4,195,701 > 4,194,304），图片密集笔记的崩溃保护缺失；`data:` 字符串只哈希长度+首尾 64 字符，等长中段替换不可检测。上述转入第 8 批。
- 行为变化：正文 dirty/外部更新签名最多滞后 120ms；字数随节流提交刷新。
- 用例：`tests/noteEditorPerf.test.ts`、`tests/noteEditorModules.test.ts`、`tests/noteEditorConflict.test.mjs`。

### 性能记录方式（第 6 条）

- 渲染层埋点：`localStorage['pq.perf']='1'`（`src/utils/perfTrace.ts`）；主进程：`PAPERQUAY_PERF=1`（`electron/perfTrace.cjs`）。
- 本批可重复基准均以 `PAPERQUAY_PERF=1 node --test <file>` 运行；数据规模、方法与本机数值见上。
- 未做真机 UI fps/首屏视频测量：列表基准证明渲染窗口有界（5000 → 约 19–22 行，随视口），但 Electron 实际 fps 需在安装版用 DevTools Performance 记录；该项登记为验收缺口。

## 验证

- `npm run typecheck`：四个项目 0 诊断。
- `npm test`：1,204 项，1,198 通过、6 跳过（环境变量控制的性能/本地模型基准）、0 失败。
- `npm run build`：通过；`dist/assets/graphLayout.worker-*.js` 约 560 kB，fcose 不再进入主入口。
- `npm run mcp:bundle`：通过，`packaging/mcp/server.cjs` 与 sqlite-vec 资源重新生成（`packaging/mcp/` 被 gitignore）。
- 性能基准：`PAPERQUAY_PERF=1` 运行 `tests/literaturePaperListVirtualization.test.ts`、`tests/libraryBatchCommands.test.mjs`、`tests/noteEditorPerf.test.ts`、`tests/graphSnapshotScale.test.mjs`、`tests/graphSimilarityScale.test.mjs`、`tests/mcpHybridRetrieval.test.ts`、`tests/ragWorkerHost.test.ts`、`tests/vaultAutosyncReactivity.test.mjs` 等；数值见上文。
- Windows 并发关系写入测试的 `writeJsonSync` 重试窗口从 20×15ms 提升到 60×25ms（约 1.5s），消除本机关闭/杀毒占用导致的 EPERM 偶发失败；仍保留失败时抛出、不降级为非原子覆盖的语义。

## 剩余验收缺口

- 渲染层 5000 行 ≥50fps、安装版首屏与 10k 节点真机渲染未测；当前证据是窗口行数有界与 Node 基准。
- PDF 元数据主进程解析只在开发/Node 环境验证；安装版依赖 extraResources 的 `pdfjs/legacy/build`，未做安装包冒烟。
- 图谱大图采样与相似度候选上限是有意的近似；普通规模结果不变，已补等价性用例。
- 列表虚拟化后窗口外行不在 DOM：Tab 焦点、find-in-page、读屏仅覆盖已挂载行，且未设 `aria-setsize`/`aria-posinset`；`index.css` 的“DOM 结构完整”注释对 >60 行已过期。行 memo 仍受父层内联回调影响。纳入第 9 批可访问性收尾。

## 行为变化与限制

- 批量收藏/移动/删除改为单事务原子操作（失败整批回滚）。
- 附件 missing 的正/负 stat 结果分别缓存 5s / 1.5s；应用内写入会显式失效，外部移动文件最多滞后该 TTL。
- 流式问答在流结束/中止时一次性提交到会话历史；流中复制/存笔记仍使用实时文本。
- 笔记正文的 dirty 指示与外部更新签名最多滞后 120ms（标题/标签/颜色仍即时）；字数同样随节流刷新。
- `library_init` 不再返回 `papers`，任何外部调用方需改走 `library_query_papers`。
- 安装版 PDF 元数据解析依赖 extraResources 的 `pdfjs/legacy/build`；已补配置与 afterPack 校验，但未做安装版冒烟。
- 图谱大图会按节点/边上限采样（默认 10000 节点、每节点 250 边）并在 `metadata`/UI 标记；嵌入相似度只考虑前 2000 个候选文档（按 document_key 确定性截断），大库结果是受控近似，普通规模不变。
- 图谱全局布局改为异步：首帧可能短暂显示未定位节点；fcose 随机化导致坐标与旧版不完全一致，小图布局参数保持 proof/2500。
