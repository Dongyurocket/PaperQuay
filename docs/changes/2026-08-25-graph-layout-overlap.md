# 2026-08-25 - 知识图谱节点聚集重叠修复

## 现象

打开知识图谱页时，所有节点聚集在中心位置、互相重叠，无法正常浏览。

## 根因

1. **主因：布局在 0×0 容器中执行。** `App.tsx` 中图谱工作区以 `hidden` 属性常驻挂载（应用启动停在 Library 页时即已挂载，容器 `display:none`、尺寸 0×0）。`KnowledgeGraphWorkspace` 的 `loadGraph` 在挂载后立即执行，数据返回后立即调用 `runGraphLayout`——cytoscape cose 布局以容器尺寸为边界框（`cy.width()/cy.height()`，此时为 0），多连通分量的打包逻辑把全部节点压到原点附近。之后切换到图谱页时，cytoscape 的 ResizeObserver 只触发 `cy.resize()` 更新画布，**不会重新布局**，节点永久停留在压缩位置。
2. **加重项：自定义 cose 参数劣化。** `gravity: 0.22`（低于默认 1）与 `idealEdgeLength: 96` 的组合实测比 cose 默认参数重叠更多；且温度冷却（0.99ⁿ）约 687 次迭代即提前收敛，`numIter: 900` 未真正生效。
3. **附带 bug：图谱被误销毁重建。** 创建 cytoscape 实例的 effect 依赖 `createRelation`，后者依赖 `relationLabel`/`relationDescription` 输入态——在“自定义关系”面板每输入一个字符都会销毁并重建整个图谱实例为空图，且 `renderedNodeIdsRef` 未重置，后续增量更新全部落空，图谱无法自行恢复。

根因经 headless 复现验证：同一 45 节点多分量图、同一布局参数，0×0 容器下布局跨度仅 237×379px、重叠对 76；正常容器下跨度 1400×900、重叠对 20。

## 修改

- `package.json`：新增依赖 `cytoscape-fcose@^2.2.0`。
- `src/types/cytoscape-fcose.d.ts`：新增模块类型声明（该包无自带 TS 类型）。
- `src/features/graph/KnowledgeGraphWorkspace.tsx`：
  - 全局布局由内置 `cose` 换成 `fcose`，参数经 headless 实验标定（`quality: 'proof'`、`nodeRepulsion: 40000`、`idealEdgeLength: 180`、`edgeElasticity: 0.2`、`gravity: 0.3`、`packComponents`、`nodeDimensionsIncludeLabels`）；局部模式仍用 `concentric`。
  - 渲染 effect 在全量重建后先检查容器尺寸（`graphContainerHasSize`），容器不可见时把布局挂起到 `pendingLayoutRef`，不再在 0×0 容器中布局。
  - 新增 `workspaceActive` prop；工作区从 hidden 切换为可见时 `cy.resize()`，并补跑被挂起的布局（或 `fit` 适配视图）。
  - 创建 cytoscape 实例的 effect 依赖收窄为 `[selectGraphEdge, selectGraphNode]`（两者引用稳定），`createRelation` 改经 `createRelationRef` 转发，修复输入关系文字时图谱被销毁重建的问题。
- `src/app/App.tsx`：给 `KnowledgeGraphWorkspace` 传入 `workspaceActive={activeWorkspace === 'graph'}`（沿用 Reader 的现有模式）。

## 验证

- 参数标定实验（headless cytoscape，脚本在会话工作台 `verify-*.cjs`）：
  - 45 节点多分量图：重叠对从默认参数 67~72 降至 10，平均最近邻 45.5px（节点直径 24~38px）。
  - 662 节点极端图：重叠对 0，平均最近邻 58.6px，耗时约 250ms（原 cose 约 4700ms）。
  - 0×0 容器下 fcose 同样会压缩布局（重叠对 39~72），证实“可见后才布局”是必要条件，与算法选型正交。
- `npm run build` 通过（含 TypeScript 检查）。
- `npm test` 通过：178 pass / 0 fail。
- 待手工回归：启动应用后在 Library 停留片刻再切到图谱页，节点应正常分散；在“自定义关系”面板输入文字，图谱不消失。
