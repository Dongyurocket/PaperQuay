# PaperQuay v{{VERSION}}

MCP `update_note` contract alignment, plus a fix so clearing page kinds persists.

- `update_note` now documents what the implementation does: the body is parsed through the shared Markdown parser at write time and the stored rich-text JSON is rebuilt (wiki-links, tags, known anchor IDs and uniquely matched `[n]` references are reconstructed; unknown values stay plain text), instead of "clears the stored rich-text JSON so the editor rebuilds it".
- The documented `pageKind` parameter is restored for `update_note` (8-value whitelist, empty string clears), matching `create_note` and the built-in Agent.
- Fixed noteStore ignoring an explicit `null` page kind, so clearing a page kind through MCP now actually persists.
- README, README_EN and the Chinese user manual were refreshed to the v0.4.12 baseline (25-tool MCP inventory, release notes, manual chapters).
- The risk note in the MCP guide and the notes skill is narrowed to excerpt-card anchor blocks and citation/table formatting requirements.

Validation: frontend build passed; all 855 tests passed, including new schema contract assertions and update/clear behavior coverage. Installers are built by the `app-v{{VERSION}}` release workflow.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

MCP `update_note` 契约对齐，并修复页面类型清除不生效的问题。

- `update_note` 的描述现在与实现一致：正文在写入时由共享 Markdown 解析器解析并重建富文本 JSON（双链、标签、已知锚点 ID 与唯一匹配的 `[n]` 引用恢复为专用节点，未知值保留纯文本），不再表述为「清空富文本 JSON、由编辑器重建」。
- 补回 `update_note` 的 `pageKind` 参数（8 值白名单，空串清除），与 `create_note` 及内置 Agent 对齐。
- 修复 noteStore 忽略显式 `null` 页面类型的问题，通过 MCP 清除页面类型现在真正生效。
- README、README_EN 与中文用户手册同步刷新到 v0.4.12 基线（25 个 MCP 工具清单、近期更新、手册章节）。
- MCP 接入指南与笔记 skill 的风险提示收窄为摘录卡锚点块与引用/表格格式要求。

验证：前端构建通过；全部 855 项测试通过，含新增的 schema 契约断言与更新/清除行为覆盖。安装包由 `app-v{{VERSION}}` Release 工作流构建。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
