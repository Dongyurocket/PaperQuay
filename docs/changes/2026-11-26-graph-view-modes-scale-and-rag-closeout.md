# 2026-11-26 - 知识图谱视图模式、规模性能与 RAG 状态收口

- 计划：[2026-11-25 library RAG status and graph visualization](../plans/2026-11-25-library-rag-status-and-graph-visualization.md)
- 范围：B5–B8（图谱视图模式、稳定布局、视觉/交互拆分、规模与性能）+ A3.2/A3.3/A5/A6 的收口项
- 前置记录：[2026-11-26 RAG 状态管理与图谱语义边](./2026-11-26-library-rag-status-and-graph-semantic-edges.md)

## 现象与根因

第一批交付了语义边、默认论文视角和稳定布局，但图谱仍缺少：

- 视图模式只有“视角 + 全局/局部”，没有把「主题总览 / 聚焦 / 混合」作为一等入口；文献库、阅读器、笔记无法“在图中查看”。
- 着色固定为主分类；引用视角、混合视角没有各自的默认颜色语义。
- 没有 hover tooltip、inspector 标签页、边证据（相似度/引用原文/共同标签）、匹配导航和显式刷新。
- 大图缺少边预算、LOD、快照缓存、WebGL 开关与按分类聚合；`KnowledgeGraphWorkspace` 仍有 2,000+ 行。
- RAG 详情面板缺抽取器版本、`lastError`/`rebuildError` 分开显示与未解析时的 MinerU 入口；批量运行中单篇动作未禁用；RAG 库不可用时筛选没有提示。

## 修改

### 图谱视图与交互（B5/B7）

- 新增「视图模式」：主题总览（论文 + 引用 + 语义，标签/分类只着色）、聚焦（局部 1–5 跳）、混合、自定义。文献库右键、阅读器「⋯」、笔记右键通过 `emitOpenGraphFocus` 打开图谱并聚焦。
- 着色支持主分类 / 节点类型 / 年份 / 聚类；视角切换时按视角设置默认着色，用户手动改过后不再覆盖。
- 交互：hover 高亮 1 跳邻居并显示 tooltip（标题、作者/年份、分类、标签、度数、阅读进度、RAG 状态、相似度/引用证据）；点击锁定，`Esc` 清除；双击进入局部图。
- 右侧 inspector 拆成概览 / 连接 / 统计三个标签页；连接按边类型分组，显示方向、权重、相似度、引用原文与共同标签。
- 图例同时显示节点与边类型计数并可开关；搜索默认「聚光」（保留全图、匹配加环、其余变暗），可切「仅显示匹配」并用上/下一个跳转；新增显式刷新按钮。
- 监听笔记、文献、阅读进度、RAG 状态与 MinerU/概览事件，防抖 800ms 刷新快照并保留已有节点位置。

### 布局、视觉与组件拆分（B6/B7.3）

- 新增 `graphPresentation.ts`、`graphStyles.ts`、`graphLayout.ts`、`graphEvents.ts`、`GraphSidebar.tsx`、`GraphInspector.tsx`、`GraphToolbar.tsx`、`GraphTooltip.tsx`、`graphPreferences.ts`；工作区只保留编排与状态。
- 节点形状：文献圆形、笔记圆角矩形、标签菱形、分类六边形；论文阅读进度用 SVG 外环（5% 分桶缓存）。渲染层始终显式传 `include*` 标志；后端默认仍全开以兼容 MCP/旧快照，默认“总览”由前端过滤保证。
- 边：引用/自定义关系保留箭头与 bezier；语义边细虚线 straight；同对多边 bezier；大图无向边用 haystack；基础边不透明，注释层低透明度。
- 布局 worker 读取节点 `type/size/degree` 与边 `type/weight`；fcose 按类型设置斥力（论文 40k、标签/分类 3×、笔记 0.75×）与边长（语义 110 / 引用 140 / 注释 220 基准）；新增聚集力/斥力/连线长度滑杆（防抖 250ms，重排不自动 fit）。
- 新增节点先放在邻居质心，再做一次 `randomize:false`、≤600 次迭代的增量布局；位置按 `graphSignature` 存入 `paperquay-graph-positions-v2`，>2000 节点不持久化。
- 标签在 hover 时常显；放大/缩小使用 1.15/0.95 迟滞，避免阈值抖动。

### 规模与性能（B8）

- 后端默认节点/每节点边预算从 10,000/250 调整为 3,000/60；UI 仍可显式请求更高上限。
- 新增主进程快照缓存 `graphSnapshotCache.cjs`：按「文献/笔记/RAG 库 + WAL + 关系文件 + 配置文件的 mtime/size」与请求键缓存，15s TTL、8 条 LRU；关系写入与 `knowledge_graph_invalidate_cache` 显式失效。
- 渲染层新增 50,000 条总边预算、三档 zoom LOD（<0.5 保留 10–20%，0.5–0.9 约 50%，≥0.9 全部）、边预算/采样摘要。
- 超过阈值（默认 1,500 篇）按主分类折叠为成员数超节点；复用原分类节点而不是重复创建；双击超节点展开该分类。
- 新增 WebGL 实验开关：启动检测 `WEBGL_debug_renderer_info`，SwiftShader/llvmpipe 自动保持 Canvas；WebGL 模式降级虚线/点线。
- 复用 `perfTrace`：快照、元素构建、布局、首帧、交互 rAF p50/p95 显示在图谱统计；新增 5,000 节点/25,000 边 headless 布局 fixture（`PAPERQUAY_PERF=1`）作为迁移决策门的一半输入。实测该 fixture 的 fcose 布局约 **389s**（本机 Node 24），远高于 3s PASS 门槛，记录为 **MIGRATE** 证据；因此 UI 在超过 1,200 节点且未聚合时改用确定性网格布局，避免力导向阻塞工作区，并在统计面板提示开启大规模聚合。
- 统计面板显示语义覆盖、度数中位/最大、分量、孤立节点、Hubness、采样/边预算保留数，并对 `degreeMax > 2K`、`componentCount > 1` 给出警告。

### RAG 收口（A3.2/A3.3/A5/A6）

- `PaperRagPanel` 增加抽取器版本列；`lastError` 与 `rebuildError` 分开展示；未解析文献显示可执行的「先运行 MinerU 解析」。
- 批量索引运行中，行菜单、详情面板、状态条禁用单篇建立/重试/更新/重建/移除；`handleIndexPaperRag` 增加单篇锁，批量启动时检查该锁，避免单篇与批量同时写同一索引。
- RAG 库不可用时，`library_query_papers` 返回 `ragStatusAvailable: false`；筛选弹层保留控件并提示「索引库不可用，筛选结果降级」。
- 自动重试 effect 把 `embeddingApiKey` 纳入配置指纹，换 Key 后清空尝试计数；批量 `force` 规则抽成纯函数 `resolveRagBatchForce`，自动重试默认尊重冷却。
- 新增 `tests/ragIndexBatchSelection.test.ts`、`tests/graphGeometry.test.mjs`、`tests/graphPresentation.test.ts`、`tests/graphSnapshotCache.test.mjs`、`tests/graphLayoutPacking.test.ts`、`tests/graphScaleFixture.test.ts`；扩展 RAG 聚合优先级、筛选序列化与后端分页组合测试。

## 验证

- `npm run typecheck`：六个项目 0 诊断。
- `npm run lint`：0 error / 205 warning（基线 206）。
- `npm test`：1,570 项，1,560 通过、10 跳过、0 失败。
- `npm run build`：通过。
- 图谱语义边本机库副本数据来自前置记录：170 篇有效向量，K=10 得到 620 条边、最大度数 10、1 个连通分量。
- Electron 实机验收（hover/inspector/位置恢复/WebGL/LOD/5k 帧率）仍需在应用内逐项执行；本记录只覆盖构建、自动化测试与数据层测量。

## 回退

- 图谱视图模式、着色、tooltip、inspector、LOD、聚合、WebGL 均为前端增量，可通过偏好或设置关闭；`embeddingStrategy: 'global-top'` 恢复旧语义边。
- 快照缓存只影响性能，不改变返回内容；`knowledge_graph_invalidate_cache` 可随时清空。
- RAG 面板/批量锁/可用性提示均为增量字段与 UI，无数据库迁移。
