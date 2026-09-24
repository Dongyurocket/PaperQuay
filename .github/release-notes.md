# PaperQuay v{{VERSION}}

## Fixes

- **Inline math inside Markdown tables no longer degrades to literal `$`**: when a table cell contained bare LaTeX (for example `仅 T_i`), the inline-math wrapper's candidate run crossed the `|` cell delimiter and swallowed the neighbouring cell, so the inserted `$` delimiters landed in two different cells. remark-math never pairs across cells, so the entire row rendered as literal `$` and KaTeX produced no nodes at all. Table rows are now wrapped cell by cell; expressions containing `|` outside tables (`A = |x| < 1`, `P(A | B) = 0.5`) behave exactly as before. Seven regression cases were added in `tests/markdownTableMath.test.ts`.

## Documentation

- **New Chinese user manual**: `docs/USER_MANUAL.zh-CN.md` is a complete end-user manual covering installation and first run, the library and reader, note authoring and maintenance (page types and templates, excerpt cards, academic citations, graph and health report, vault two-way sync), the Agent workspace, knowledge graph, review drafting, local RAG, MCP and external-agent integration, backups and privacy, a settings reference, and updating/troubleshooting — with keyboard-shortcut and FAQ appendices.
- **README and MCP integration guide now document the notes feature set**: the README's quick navigation links the user manual, and the notes workspace/editor tables cover the v0.2.0 capabilities (page-type templates, database-backed folders, live sequential citations with GB/T 7714-2015 / APA 7 / IEEE styles, note write tools, Obsidian-compatible vault sync). `docs/MCP_AGENT_INTEGRATION.md` documents `list_note_tags` / `list_note_folders` plus a new "note maintenance tools (with guardrails)" section describing write semantics and the require-a-manifest rule for bulk deletes.
- **CHANGELOG and README caught up on 0.2.0**: the 0.2.0 notes-system overhaul had no CHANGELOG entry and no README highlight; both are now recorded, and the stale `v0.1.48` version badges were updated.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **Markdown 表格内的行内公式不再退化为字面 `$`**：表格单元格里写裸 LaTeX（例如 `仅 T_i`）时，行内公式补全的候选串会跨过 `|` 单元格分隔符把相邻格内容一起吞下，补出的 `$` 因此分别落在两格里；remark-math 不会跨单元格配对，整行公式只剩字面 `$`，KaTeX 一个节点也不产出。现在表格行按单元格分别补全，`$` 不再跨格；非表格中含 `|` 的表达式（`A = |x| < 1`、`P(A | B) = 0.5`）行为完全不变。新增 `tests/markdownTableMath.test.ts` 七例回归。

## 文档

- **新增中文用户手册**：`docs/USER_MANUAL.zh-CN.md` 是面向使用者的完整手册，覆盖安装与首次启动、文献库与阅读器、笔记的使用与维护（页面类型与模板、摘录卡、学术化引用、图谱与体检、vault 双向同步）、Agent 工作区、知识图谱、综述写作、本地 RAG、MCP 与外部 Agent 接入、数据备份与隐私、设置参考、更新与排障，并附快捷键与常见问题两个附录。
- **README 与 MCP 接入指南同步笔记能力**：README 快速导航加入用户手册入口，笔记工作区与编辑器特性表补齐 v0.2.0 的能力（页面类型模板、分类入库持久化、实时顺序编号的内联引用与 GB/T 7714-2015 / APA 7 / IEEE 样式、笔记写入工具、Obsidian 兼容 vault 同步）；`docs/MCP_AGENT_INTEGRATION.md` 补入 `list_note_tags` / `list_note_folders` 与新增的「笔记维护工具（带运行护栏）」小节，说明写入语义约定与批量删除前先出清单确认的要求。
- **CHANGELOG 与 README 补齐 0.2.0**：0.2.0 的笔记系统重构此前既没有 CHANGELOG 条目也没有 README 更新说明，现已补记，并更新了停留在 v0.1.48 的版本徽章。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
