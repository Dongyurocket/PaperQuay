# MinerU 伪上标连字清洗、学术上标渲染与公式排版修复

## 背景

在阅读由 MinerU 解析的学术论文时，用户反馈两类显著问题：
1. 正文与摘要中大量出现西文连字乱码，例如 `signi<sup>fi</sup>cant`、`speci<sup>fi</sup>cally`、`The <sup>fi</sup>ndings`、`high-<sup>fi</sup>delity`、`horizontal <sup>fl</sup>ight`、`0.2<sup>–</sup>0.7` 等；
2. 正规学术上标（如单位 $kg/m^2$、引用标号 $^{[1-3]}$）显示异常：部分被行内公式扫描器误判为公式包裹了 `$` 并渲染为畸形的 `< sup > 2 < / sup >`，部分因 `react-markdown` 默认不渲染 HTML 而直接暴露 `<sup>2</sup>` 源码；
3. 多行复杂公式或算法推导块排版坍缩为单行，且从某项开始由于公式定界符相贴碰撞合成非法 `$$`，触发 KaTeX 语法解析错误（`Can't use '$$' in math mode`），导致整段公式以鲜红色报错文本展示。

## 根因分析

1. **连字伪上标**：MinerU 的 OCR / 版面模型在检测带有西文排版连字（`fi`, `fl`, `ff`, `ffi`, `ffl`）或偏高符号（`–`, `’`）的文本时，误判为其在基线上偏高，自动包裹了 `<sup>` 标签；
2. **上标露出与公式误伤**：
   - `wrapInlineLatexSegments` 将包含 `<` 和 `>` 的文本误判定为包含数学比较操作符，进而强制添加数学定界符 `$`；
   - `react-markdown` 默认对非 Markdown 规范的 HTML 标签不予解析，直接以原生文本转义输出；
3. **公式碰撞与多行坍缩**：
   - `algorithm` 块中的 `algorithm_content` 数组在逐项转 Markdown 时直接拼接，当两个连续项均为 `equation_inline` 时，前一项结尾的 `$` 与后一项开头的 `$` 直接拼成了 `$$`，破坏了 remark-math 的语法树解析；
   - 单换行在 CommonMark 规范下被折叠为空格，丢失了原论文逐行排列的层次。

## 解决方案

1. **`src/utils/markdown.ts`**：
   - 增加 `sanitizeFakeSuperscripts`，自动规约西文连字伪上标与误标点，还原完整词汇与标点；
   - 增加 `separateCollidingDollarMath`，安全解耦紧挨着的 `$A$$B$`；
   - 在 `wrapInlineLatexSegments` 中增加 HTML 标签过滤，防止包含 `<...>` 标签的普通文字被误包装为 LaTeX；
   - 导出 `remarkSuperscriptPlugin`，在 AST 层面将 `<sup>` 与 `<sub>` 转化为标准语义节点。
2. **`src/services/mineru.ts`**：
   - `renderInlineMarkdownContent` 拼接数组项时增加定界符安全换行防护；
   - `toMarkdownFragment` 增加 `algorithm` 块分行排版支持；
   - 文本提取（`extractTextFromMineruBlock`）全链路接入清洗，保障全文检索、RAG 分块与 AI 翻译词汇正确。
3. **前端渲染组件**：
   - 在 `BlockViewer`、Agent 消息与侧边栏中引入 `remarkSuperscriptPlugin` 并配置自适应上标/下标组件。
4. **单测覆盖**：
   - 新增 `tests/superscript.test.ts`，覆盖伪上标清洗、标点还原、正规上标保留、公式解耦及 AST 插件转换。
