# 文献级 RAG 状态管理与图谱语义边实施记录

- 日期：2026-11-26
- 计划：[2026-11-25 library RAG status and graph visualization](../plans/2026-11-25-library-rag-status-and-graph-visualization.md)
- 范围：A0–A3（RAG 状态共享、筛选、单篇/批量管理、自动重试）+ B1–B4（图谱语义边、默认视角、布局稳定性、inspector）

## 现象与根因

### RAG 管理

底层已有成员开关、索引状态、单篇/全库索引与失败冷却，但入口分散在设置页和右键菜单：

- 行内角标只是文本，不能直接建立、重试或查看失败原因；
- 批量只能处理全库候选，不能处理文献库当前选中的 N 篇；
- 筛选只有“知识库成员”，没有“已索引/待更新/待索引/失败/未建立”；
- 失败错误不分类，无法判断该重试、检查 Key 还是检查余额。

### 图谱

语义视图的主要问题在数据层，不是 Cytoscape：

- 文档向量是 chunk 平均，保留很强的公共方向；原始余弦整体抬高；
- `listDocumentSimilarities` 用绝对阈值 0.82 + 全局 top-N，结果被近重复对占满；
- 渲染层再硬编码 120 条上限，176 篇中只有 72 篇能获得语义边；
- 默认把 20 个标签、10 个分类作为普通节点，分类最大度数 52，形成蜘蛛网；
- 每次刷新 `randomize: true`，节点位置全部重排，用户没有空间记忆。

## 修改

### A0：共享状态与后端筛选

- 新增 `src/shared/ragIndexStatus.cjs` / `.cjs.d.ts`：聚合、过期判定、分组由渲染进程与主进程共用。
- 新增 `src/shared/ragIndexVersions.cjs`：抽取器版本常量共用。
- 新增 `electron/backend/libraryRagStatusFilter.cjs`：按 RAG 状态计算匹配 paper id，再与请求已有 `paperIds` 取交集。
- `libraryCommands` 的 `library_query_papers`、`library_list_paper_ids`、`library_list_papers`、`library_count_papers` 统一应用筛选；RAG 状态 2 秒 TTL 缓存。
- `libraryDatabaseStore.listRagStatusSnapshot()` 只读 `id + rag_enabled`，不水合整库。
- 文献库筛选新增 `ragStatus`，旧 localStorage 缺字段回落 `all`；筛选变化时监听 `RAG_INDEX_STATUS_UPDATED_EVENT` 刷新。

### A1：单篇管理

- 行内 RAG 角标改为按钮 + 菜单；菜单按 `ready/stale/pending/failed/none/excluded` 生成动作。
- 新增 `src/features/literature/ragActions.ts`：状态文案、动作规则、禁用条件的纯函数。
- 新增 `PaperRagPanel`：成员开关、来源明细（MinerU / PDF 文本）、模型、分块数、索引时间、错误分类与冷却时间。
- 详情状态条的“知识库”chip 显示真实状态，点击打开动作菜单。

### A2：选中批量

- `handleBatchRagIndex` 支持 `mode: missing | failed | stale | rebuild | all-legacy`、`paperIds`、`reason`、`force`。
- 新增 `selectRagBatchTargets`，统一候选与跳过原因（未解析、已排除、已就绪、待索引、其他）。
- 文献库批量栏新增“RAG 索引”下拉；确认框显示候选数、跳过原因、会调用 Embedding 服务。
- 批量执行显示紧凑进度、暂停/继续/取消；设置页按钮改用同一套 mode。

### A3：失败分类与自动重试

- 新增 `src/services/ragIndexError.ts`：`auth / billing / rate-limit / network / incomplete-vectors / excluded / unknown`，认证/余额不自动重试。
- 新增设置：`ragAutoIndexAfterParse`（默认开）、`ragAutoRetryFailed`（默认关）、`ragAutoRetryMaxAttempts`（默认 2）、`ragAutoRetryIntervalMinutes`（默认 30）。
- 自动重试只在 60 秒 tick、冷却结束、非认证/余额错误时运行；手动动作清零计数；配置变化清零。
- `scheduleLibraryItemRagIndexing` 受 `ragAutoIndexAfterParse` 控制；启动不扫描全库。

### B1：文档几何与互近邻语义边

- `rag_document_vectors` 主键加入 `embedding_model_key`；旧表启动时整表重建，并从 chunk 回填，避免同维度不同模型混算。
- 新增 `buildDocumentGeometry`：单位化 → 去均值 → Gram 矩阵幂迭代求前 D=2 主成分 → 投影掉 → 再单位化（all-but-the-top）。
- `listDocumentSimilarities` 默认 `mutual-knn`：每篇 top-k 双向邻居、排名权重、按分量桥接；保留 `global-top` 回退。
- 图节点大小改为图内度数 `clamp(18, 56, 18 + 6*sqrt(degree))`；标签抽稀随度数而不是阅读进度。
- `graphQuality` 元数据：节点/边数、度数、分量、孤立节点、hubness、语义覆盖、几何版本。

### B2–B4：默认视角、布局与交互

- 默认视角改为论文总览：论文 + 引用 + 语义，标签/分类默认关闭；论文按主分类确定性着色。
- 语义边虚线、细线、低透明度；引用边保留实线箭头。
- 布局 worker 接收节点类型/大小/度数/历史坐标；`randomize: false`，无历史坐标时用黄金角螺旋初始位置。
- 刷新时保留旧节点坐标，新节点放到已定位邻居质心；孤立新节点放外围；可手动重新布局。
- 节点位置持久化到 `localStorage['paperquay-graph-positions-v1']`，节点数 > 2000 不持久化。
- worker 内按连通分量做 shelf packing，`packComponents` 不再依赖未注册的 layout-utilities。
- 右侧 inspector 显示“为什么相连”，可点邻居/边；图例显示各类型计数并可切换；hover 高亮 1 跳邻居，移出恢复。
- 语义邻居数滑杆（3–20，默认 10）替代原相似度阈值；去掉渲染层 120 条硬编码。

## 验证

- `npm run build`：通过。
- `npm test`：1533 项，1524 通过、0 失败、9 跳过。
- `tests/graphSimilarityScale.test.mjs`：`global-top` 旧算法对照保留；`mutual-knn` 度数、连通分量、近重复保留、公共方向移除均通过。
- `tests/graphLayout.test.ts`：`randomize:false`、节点尺寸参与布局、组件 shelf packing 间距、位置校验。
- `tests/ragStore.test.ts`：旧 `rag_document_vectors` 迁移后包含 `embedding_model_key`，旧行丢弃并从 chunk 回填。
- 真实库副本（2026-11-26，4096 维，Qwen3-VL-Embedding-8B，完整回填后）：
  - 170 篇有效文档向量；
  - `k=10` 得到 **620 条语义边**、最大度数 **10**、最小度数 1、**1 个连通分量**、1 条桥边；
  - 几何 **94ms**、选边 **91ms**；
  - 修复前同库为 9,209 对 ≥0.82、渲染层只取 120 条且覆盖 72/176。

## 未完成 / 待实机验收

1. 应用首次启动会触发一次 `rag_document_vectors` 迁移与有界回填；回填完成前图谱的语义覆盖会暂时偏低，需在真实应用内确认空闲回填速度。
2. 图谱 UI（inspector、图例、hover、位置恢复）尚未在 Electron 实机逐项验收；本轮只完成构建、自动化测试与数据层副本测量。
3. B5 的边预算/LOD/快照缓存/WebGL 开关、B6 的 Prior/Derivative/Timeline/Connect 高级模式未实施。
4. 文献库筛选与设置页统计口径不同（前者全部已加入文献，后者 MinerU 已解析集合），需要在用户手册写清。

## 回退

- RAG 状态筛选与共享模块是增量字段；移除 `ragStatus` 即回到原查询。
- 图谱可传 `embeddingStrategy: 'global-top'` 恢复旧选边；位置持久化、组件打包、inspector 均为前端增量，可单独关闭。
