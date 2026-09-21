# PaperQuay v{{VERSION}}

## New Features

- **Note references**: insert paper citations from the toolbar, slash menu, or `@`. Clicking a citation opens the paper; citations that carry a page or block location jump to that position. The sidebar and end-of-note numbered list are derived live from the note JSON and are not stored separately.
- **Long-document reader windowing**: dual-pane reading of dissertations, textbooks, and long reports no longer mounts every MinerU block, thumbnail button, and PDF overlay host in the DOM. Visible structure blocks are windowed (off-screen Markdown/KaTeX is unloaded), the thumbnail list is virtualized, PDF.js eager `getPage` is disabled, and overlay hosts are observed only near the current page.

## Fixes

- **Note AI polish retrieval key mismatch**: RAG indexes used the bare `paper.id`, while polish queries used the `native-library:` prefix, so already-indexed papers returned no evidence. Queries now match both keys; evidence is ranked globally and truncated to the top 8. Embedding-dimension mismatches and missing model citations get explicit notices. Polish defaults to the note's linked papers.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

## Notes

- Existing notes keep working: `PaperReference` still parses `{paperId, label}`; page/block location fields are optional.
- Reader windowing is a rendering-path change only. Jump-to-block, PDF↔block linking, translation overlays, and RAG are unchanged.

---

# PaperQuay v{{VERSION}} 中文说明

## 新增

- **笔记参考文献**：工具栏、斜杠命令和 `@` 均可插入文献引用。点击打开对应论文；带页/块位置时可跳到原文。右侧栏与文末编号列表从笔记内容实时派生，不落库。
- **长文档阅读窗口化**：学位论文、教材和长篇报告的双栏阅读不再把全部结构块、缩略图按钮和 PDF overlay 主机挂进 DOM。可见结构块按视口窗口化（卸载离屏 Markdown/KaTeX），缩略图列表虚拟化，PDF.js 关闭 eager `getPage`，仅观察当前页附近的 overlay 主机。

## 修复

- **笔记 AI 润色检索键不一致**：索引使用裸 `paper.id`，查询却带 `native-library:` 前缀，导致已索引文献也检索为空。现同时查询两种键，证据按全局相关度取 top 8；embedding 维度不匹配或模型未返回引用时给出明确提示。润色范围默认改为「笔记关联文献」。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。

## 使用提示

- 旧笔记无需迁移：`PaperReference` 仍解析 `{paperId, label}`，页/块位置字段为可选。
- 阅读器窗口化只改渲染路径；跳转到块、PDF↔块几何关联、翻译 overlay 与 RAG 行为不变。
