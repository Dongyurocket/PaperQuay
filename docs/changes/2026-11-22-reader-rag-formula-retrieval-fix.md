# 阅读器问答与知识库检索无法识别公式块修复

- 日期：2026-11-22
- 范围：阅读器本地 RAG 检索与上下文拼装、MinerU 公式/短块切分与 LaTeX 清洗、SQLite FTS5/精确通道检索、QA Prompt 与 MCP `search_knowledge_base`
- 计划文档：[2026-11-22-reader-rag-formula-retrieval-fix.md](../plans/2026-11-22-reader-rag-formula-retrieval-fix.md)

## 现象

在论文《Conceptual Design of an AAM Tiltrotor via Aircraft-Level Weight-Performance Feedback》中提问「公式(6)，cm的计算公式是哪里来的」时，阅读器左侧已渲染出第 7 页公式 (5)–(7)，右侧问答却只回答出「来自参考文献第 18 条」，并提示现有摘录没有给出式 (6) 表达式与第 18 条文献详情；诊断条显示 `关键词通道已检索，命中 0 个候选`。

## 根因

1. **关键词通道（FTS5 `trigram`）在中英混合问句与短公式/符号词上 0 命中**：`buildFtsMatchQuery` 未按中英边界切分且未扩展 `\tag{6}`/`(6)`/`C _{m}`，长度小于 3 的短编号（`6`、`18`、`cm`）在 `trigram` 索引中恒返回 0 行；`Question:/Selected excerpt:` 模板前缀也干扰分词。
2. **邻域扩展固定 ±1 chunk 被浮动图注阻断**：第 6 页公式引导段与第 7 页式 (5)–(7) 之间隔着 Fig. 3 的 3 条独立子图题注碎片，导致后向扩展止步于 `(a) twin-tiltrotor`。
3. **缺少交叉引用确定性补全与跨来源尺度隔离**：问句与命中段中的 `Eqs. 5–7`、`公式(6)`、`[18]` 未触发原公式块和文末文献条目补全；`hybrid` 模式下 `1 - RRF` 分数与纯向量 L2 距离直接混排比较。
4. **MinerU 公式块孤立切分与 OCR 空格噪声**：`equation` 块单独成 88 字符裸 LaTeX 且残留 `C _{m}`、`0. 5`、`0. 1 1` 空格碎片，削弱向量与字面匹配。
5. **MCP 侧同源缺口**：`escapeFtsQuery` 与 `snippetWithNeighbors` 存在相同的中文粘连、短编号失效与碎片挡断问题。

## 修改

1. **共享查询分析与精确通道**（[src/shared/ragQueryUtils.cjs](../../src/shared/ragQueryUtils.cjs)、[src/shared/ragQueryUtils.cjs.d.ts](../../src/shared/ragQueryUtils.cjs.d.ts)）：
   - 实现 `stripRagQueryTemplateNoise`、混合语言边界分词、公式编号（`公式(6)`/`Eqs. 5-7` → `\tag{6}`/`(6)`/`Eq. 6`）、文献编号（`[18]`/`参考文献第18条`）与短物理量（`cm` → `C _{m}`/`C_{m}`/`C_m`）扩展；
   - 提供 `chunkMatchesFormulaNumber`（排除正文 `Eq. (6)` 引用误判）、`chunkMatchesReferenceEntry` 与 `scoreChunkByExactQuerySignals`。
2. **后端与 MCP 检索对齐**（[electron/backend/ragStore.cjs](../../electron/backend/ragStore.cjs)、[electron/mcp/knowledgeMcpService.cjs](../../electron/mcp/knowledgeMcpService.cjs)）：
   - `ragStore.cjs` 在限定文献作用域（≤20 篇）内补充精确公式/文献/短符号召回通道并与 FTS 结果合并进入 `rrfFuse`，返回命中通道 `channels`；
   - `knowledgeMcpService.cjs` 复用 `buildFtsMatchQuery` 与单篇精确信号补召回，并升级 `snippetWithNeighbors` 跨过短图注与连续公式组。
3. **上下文自适应扩展、交叉引用补全与混合排序修复**（[src/features/reader/readerRag.ts](../../src/features/reader/readerRag.ts)、[src/services/localRag.ts](../../src/services/localRag.ts)）：
   - 新增 `mergeHybridSourceRetrievals` 与更新后的 `filterRelevantRetrievals`，先按来源内通道尺度过滤再统一融合，保留 `fts`/`exact` 精确命中；
   - `buildNeighborContext` 在遇到图注碎片与公式组时扩大扫描步数（最多 6 步，受单目标与整次问答 token 预算约束）；
   - `buildRagContextText` 针对问句与命中段引用的公式编号及参考文献编号执行确定性补全，超出总预算时优先保留补全段；
   - `buildContextSection` 为公式块补充 `$$...$$` 与页码/小节提示，引用 `evidenceKind` 支持 `'equation'`（[src/types/reader.ts](../../src/types/reader.ts)）并在截断预览时避免从 `$$` 中间切断。
4. **MinerU LaTeX OCR 清洗与 `mineru-chunks-v3` 分块**（[src/utils/markdown.ts](../../src/utils/markdown.ts)、[src/services/mineru.ts](../../src/services/mineru.ts)、[src/features/reader/readerRag.ts](../../src/features/reader/readerRag.ts)）：
   - `normalizeRawLatexExpression` 新增 `compactOcrMathSpaces`，清洗 `C _ {m}`、`0. 1 1`、`1. 1 7 5` 等 OCR 空格噪声，并在 `collectTextParts` 中处理行内公式 span；
   - `buildMineruRagChunks` 合并同小节内的连续子图图注碎片及公式组与前导/变量说明段，为纯公式块附带 `[Section: ...]` 语义锚点并包裹 `$$...$$`，并将 `MINERU_RAG_EXTRACTOR_VERSION` 递增为 `'mineru-chunks-v3'`（保留 `skipIfSignatureMismatch: true`，仅单篇打开懒建或手动重建生效）。
5. **QA Prompt 加强**（[electron/backend/aiCommands.cjs](../../electron/backend/aiCommands.cjs)）：
   - 在常规与视觉 HTML 问答提示词中明确要求核对上下文中的 `$$...$$` / `\tag{n}` 公式块与参考文献条目并如实区分缺失项。

## 验证

- `npx tsc --noEmit`：通过。
- `npm run build`（使用工作区内 `.tmp-build` 作为 `TEMP`/`TMP`）：`tsc && vite build` 通过。
- `npm test`（同上临时目录配置）：816 项中 815 项通过、0 失败、1 项跳过（已有环境依赖用例 `labelled note retrieval benchmark with a local multilingual embedding model`）。
- MCP 打包干跑：使用 `esbuild` 打包 `bin/paperquay-mcp.cjs` 验证共享模块 `src/shared/ragQueryUtils.cjs` 可正常解析与打包。
- 本机真实样本只读副本验证（基于 `paper_mufwwou2_5a014354` 缓存与临时库，未修改用户正式数据）：
  - 沿用旧 `v2` 索引时，中文提问 `「公式(6)，cm的计算公式是哪里来的」` 在 Phase 1 下命中 `ftsTotal = 5`，拼装上下文同时包含式 `(6)`（`$$...$$` 包裹）与文献 `[18]`（`Leishman JG (2000) Principles of Helicopter Aerodynamics`）；
  - 按 `v3` 重分块后该篇 `mineru-markdown` 块数从 175 收敛至 133，式 `(5)–(7)` 合并为 `page-7-block-5` 且 OCR 空格清洗完整；MCP `searchKnowledgeBase` 可命中 `page-7-block-6` 并桥接 `Eqs. 5–7` 上下文。
