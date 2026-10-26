# PaperQuay v{{VERSION}}

Per-paper opt-out for the local RAG index.

- A paper can be excluded from the local knowledge base from the details panel, context menu, or batch bar. Exclusion deletes that paper’s index and keeps the PDF, parsed content, and notes.
- Rejoining does not rebuild the index. Build it again manually or in batch.
- Reader QA and single-paper Agent context still fall back to the full text. Excluded papers no longer appear in knowledge-base search or document similarity.
- The library list can filter all, included, or excluded papers. The index overview counts excluded papers.
- MCP `search_papers` and `get_paper_details` return `ragEnabled`. Excluded papers do not appear in `search_knowledge_base` or `read_paper_content`.

Validation: frontend build passed; all 861 tests passed. Desktop installers were not hand-regressed before tagging. Installers are built by the `app-v{{VERSION}}` release workflow.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

文献级 RAG 索引开关。

- 详情、右键和批量栏可以把单篇或一批文献移出本地知识库。移出删除该文献已有索引，PDF、解析结果和笔记保留。
- 重新加入后不会自动重建索引，需要再手动或批量建立。
- 阅读器问答和 Agent 单篇上下文仍回退全文。已排除文献不再进入知识库检索和文献相似度。
- 列表可按全部 / 已加入 / 已排除筛选。索引概览统计已排除篇数。
- MCP `search_papers` 与 `get_paper_details` 返回 `ragEnabled`。已排除文献不会出现在 `search_knowledge_base` 和 `read_paper_content`。

验证：前端构建通过；全部 861 项测试通过。打标签前没有在干净安装版上完成桌面手工回归。安装包由 `app-v{{VERSION}}` Release 工作流构建。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
