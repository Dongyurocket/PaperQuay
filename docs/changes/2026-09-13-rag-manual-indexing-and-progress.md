# 2026-09-13 - RAG 手动索引触发与索引进度显示

## 现象

本地 RAG 索引只有自动触发（MinerU 解析后追加、阅读器/Agent 懒索引），失败记录受冷却期限制只能等自动重试；界面上除问答时一行"当前索引 X/Y 段"外没有任何进度可见性，用户无法知道哪些文献已索引、哪些失败、如何手动补救。

## 修改

- **后端**：`ragStore.cjs` 新增 `listIndexStatuses()` 并注册为 `rag_list_index_statuses` 命令（`aiCommands.cjs`），`backend.cjs` 降级桩补齐。
- **渲染层服务**：`services/rag.ts` 新增 `ragListIndexStatuses()`；`localRag.ts` 的 `ensurePreparedSourceIndexed` 新增 `force` 选项（手动触发时绕过失败冷却与内存失败缓存，断点续传逻辑不变）并返回 `{ outcome: 'ready'|'skipped'|'failed', errorMessage? }`；索引状态写入（成功/失败）时派发 `paperquay:rag-index-status-updated` 事件供各工作区刷新角标；`libraryRagIndexing.ts` 透传 `force` 并返回结构化结果。
- **纯函数**（`services/ragIndexStatus.ts`）：多来源聚合状态（任一 failed→failed，全 ready→ready，否则 pending）、候选筛选（MinerU 已解析且未索引/待建/失败）、管理面板统计，便于单测与多 UI 复用。
- **Reader hooks**：新增 `useReaderRagIndexActions`——维护索引状态 map（挂载 + 事件防抖刷新）、`handleBatchRagIndex({ onlyFailed })`（串行批量强制索引，复刻 BatchProgressState 的暂停/继续/取消范式）、`handleIndexPaperRag(documentKey)`（单篇强制索引）。
- **UI**：
  - 设置面板「本地 RAG 检索」新增"知识库索引管理"卡片：已索引/待索引/失败统计、`[为未索引文献建立索引]`、`[仅重建失败索引]`（失败数>0 时出现）、暂停/取消与进度条；
  - 文献列表在 MinerU 角标旁新增 RAG 状态角标（已索引/索引中/未索引/失败，失败带重试提示），仅本地 RAG 可用且该文献 MinerU 已解析时显示；
  - 文献右键菜单新增"建立/重建 RAG 索引"（索引中显示禁用态）。
- **范围边界**：批量/手动索引只覆盖 mineru-markdown 源；pdf-text 源继续随阅读器打开懒索引自愈；不提供"重建全部"按钮（避免全量重 embedding 的 API 成本）。

## 验证

- `npm run build` 通过；`npm test` 全部 293 个用例通过（新增 `tests/ragIndexStatus.test.ts` 5 个用例：listIndexStatuses、聚合优先级、分组、候选筛选、面板统计）。
- 桌面端手工回归（设置面板统计与实际库一致、批量索引 6 篇 pending 文献、右键单篇重建、角标实时刷新）建议在下次桌面运行时抽查。
