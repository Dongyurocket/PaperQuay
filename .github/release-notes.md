# PaperQuay v{{VERSION}}

## Notes System Overhaul

- **Agents can now read and write notes**: the built-in Agent gains note read tools (`list_notes`, `read_note`, …) plus a `write_notes` tool with a dedicated approval card — note creates/updates/deletes are reviewed (with diffs) before anything touches the database. Paper, note, and memory writes are enforced in separate turns.
- **MCP note tools for external agents (Codex / DSH / Claude Code)**: the Knowledge MCP server now exposes `create_note`, `update_note`, `delete_note`, `list_note_tags`, and folder management (`list/create/rename/delete_note_folder`), reusing the existing write guardrails (`PAPERQUAY_MCP_WRITE`, app-running protection). Ships with an Agent Skill package at `skills/paperquay-notes/SKILL.md` for one-shot onboarding.
- **Note folders live in the database**: the folder tree moved from `localStorage` to a new `note_folders` SQLite table — folders survive reinstalls, sync over WebDAV, and are visible to MCP.
- **Markdown vault two-way sync (Obsidian-compatible)**: point PaperQuay at a folder and notes sync to `.md` files with YAML frontmatter (`id`, `type`, `paperId`, `folder`, `tags`, `sources`, `anchors`). Edit in Obsidian/VS Code and changes flow back; anchor IDs survive the round trip. Tiptap JSON remains the single source of truth.
- **Academic citations in notes**: inline `paperReference` nodes render as sequential `[n]` citations (same paper = same number, derived live from the document — never stored in the node), and vault exports append a GB/T 7714 reference list.
- **Distilled excerpt cards**: select text in the reader and click "AI Distill to Card" — a two-step CoT prompt cleans OCR/layout noise, then paraphrases into a faithful summary (never verbatim). Source anchors stay immutable and jump back to the exact PDF location; "Append to Current Card" accumulates multiple segments across pages onto one card with multiple anchors.
- **Notes graph + health report**: a new graph view groups notes by folder/paper with `[[wiki-link]]` edges; health badges surface orphan notes, broken links, untitled/untagged notes, and notes stale for 30+ days — click a badge to highlight them.
- **Notes charter & templates**: `docs/notes-charter.md` defines the red lines (Tiptap JSON is the source of truth; anchor IDs must survive; distillation is free, evidence must stay faithful) and 8 page types; the editor ships 11 templates including excerpt cards.

## Cleanup

- **Legacy one-shot Agent path removed**: `runLegacyConversationalLibraryAgent` and its entire plan-generation chain (~800 lines), the orphaned IPC commands, the `agentLegacyMode` setting key and its UI toggle are gone. The multi-turn ReAct loop is now the only path; the paper-context router and cancellation plumbing were kept and renamed.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

## 笔记系统重构

- **内置 Agent 可直接读写笔记**：新增笔记只读工具与 `write_notes` 写工具，配独立审批卡——增删改经 diff 审批后才落库；论文、笔记、记忆写操作强制分轮进行。
- **MCP 笔记工具（供 Codex / DSH 等外部 Agent）**：Knowledge MCP 新增 `create_note` / `update_note` / `delete_note` / `list_note_tags` 及文件夹管理工具，复用写护栏（`PAPERQUAY_MCP_WRITE`、应用运行保护）；附 `skills/paperquay-notes/SKILL.md` Agent Skill 包，一键接入。
- **文件夹入库**：文件夹树从 `localStorage` 迁入 `note_folders` SQLite 表——重装不丢、可随 WebDAV 同步、MCP 可见。
- **Markdown vault 双向同步（兼容 Obsidian）**：指定目录后笔记导出为带 YAML frontmatter（`id`/`type`/`paperId`/`folder`/`tags`/`sources`/`anchors`）的 `.md`；在 Obsidian/VS Code 中编辑可回写，锚点 ID 往返不丢。Tiptap JSON 仍是唯一事实源。
- **学术化引用**：`paperReference` 内联节点以顺序编码 `[n]` 呈现（同一文献同号，编号实时派生不落盘），vault 导出自动附 GB/T 7714 参考文献列表。
- **提炼式摘录卡**：划词后点「AI 提炼为摘录卡」，两步 CoT 先清洗 OCR/排版再忠实改写（不逐字）；来源锚点保真可跳回 PDF 原位；「追加到当前摘录卡」支持跨页多段累加，一卡多锚点。
- **笔记图谱 + 体检**：新图谱视图按文件夹/论文分组、展示 `[[双链]]` 边；体检 badge 汇总孤立笔记、断链、无标题/无标签、30 天未更新，点击高亮定位。
- **笔记宪章与模板**：`docs/notes-charter.md` 定义三条红线（Tiptap JSON 唯一事实源；锚点 ID 不可丢；提炼可自由、证据须保真）与 8 种页面类型；编辑器内置 11 个模板（含摘录卡）。

## 清理

- **移除旧版一次性 Agent 路径**：`runLegacyConversationalLibraryAgent` 及其计划生成链（约 800 行）、孤儿 IPC 命令、`agentLegacyMode` 设置键与 UI 开关全部删除；多轮 ReAct 循环成为唯一路径，保留并重命名了论文上下文路由器与取消机制。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
