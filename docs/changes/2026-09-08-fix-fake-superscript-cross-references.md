# MinerU 交叉引用误判伪上标与标点空格粘连修复

## 背景

在阅读 MinerU 解析的学术论文时，用户反馈两类显著的排版缺陷：
1. **交叉引用编号被误当成上标**：正文中的 `Table 8` 被错误识别并渲染为 `Table <sup>8</sup>`（右上角缩小上标），而相邻的 `Table 10` 却能正常保留为普通字号；
2. **标点空格粘连缺失**：在伪上标产生后，紧随其后的标点符号（如逗号 `,`）与后续正文英文单词之间丢失了空格，例如拼接成了 `Table <sup>8</sup>,while`（期望为 `Table 8, while`）。

## 根因分析

1. **学术文献“数字+标点”引用先验误触发**：
   - 科技论文中广泛使用无括号的上标数字表示参考文献引用或脚注（如 `method⁸,`）。
   - MinerU / 版面分析模型在遇到单数字紧接标点符号（如 `8,`）时，极易强行命中引用先验，误将其归类为上标并包裹 `<sup>`；
   - 相比之下，`Table 10 maintain` 为双位数且后跟空格加普通单词，不会触发该引用规则。
2. **超链接切分与基线微弱浮动**：
   - 原文中的 `Table 8` 属于 PDF 内部超链接 Span，而 `, while` 属于正文 Span。跨 Span 连接处在字距（Kerning）或边界框（BBox）计算中可能产生小于 1pt 的基线浮动，易被脆弱的启发式规则误判为偏高上标。
3. **缺乏交叉引用实体白名单保护**：
   - 系统缺乏对 `Table`、`Figure`、`Equation`、`Section` 等显式交叉引用的语境感知，未能阻止后续正文编号被上标化。

## 解决方案

1. **`src/utils/markdown.ts`**：
   - 扩展 `sanitizeFakeSuperscripts`，内置科技文献交叉引用实体关键词（`Table`, `Figure`, `Fig.`, `Equation`, `Eq.`, `Section`, `Sec.`, `Algorithm`, `Algo.` 等）；
   - 支持 HTML `<sup>...</sup>` 与 Unicode 上标数字（如 `⁰¹²³⁴⁵⁶⁷⁸⁹`）的双重规约，还原为标准正文编号；
   - 支持多项连续交叉引用（如 `Table 8 and 9`、`Figure 2, 3, and 4`）中的后续上标递归清洗；
   - 修复紧接标点逗号且缺失空格的缺陷，自动将 `Table 8,while` 规约为 `Table 8, while`。
2. **全链路生效**：
   - 该清洗逻辑在 BlockViewer 渲染、全文检索、RAG 向量切片、AI 摘要与翻译主链路统一生效。
3. **单测覆盖**：
   - 在 `tests/superscript.test.ts` 中补充针对 `Table 8,while`、Unicode 上标 `Table ⁸,while`、多项引用及逗号空格修复的完整用例。
