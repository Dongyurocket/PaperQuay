# MCP update_note 契约对齐（pageKind 参数与写入边界重建富文本）

## 现象

两处契约与实现/设计不一致：

1. `update_note` 的 MCP 工具描述称，替换 `content` 会「clear the stored rich-text JSON so the editor rebuilds it」；MCP 接入指南、用户手册与 notes skill 亦称「替换 content 会清空富文本缓存，编辑器按纯文本重建」。但自共享 Markdown → Tiptap 解析器落地（2026-09-25）起，MCP 与内置 Agent 两条写入路径都在**写入边界**调用 `parseMarkdownToTiptap` 重建 `contentJson`（并清除 `contentHtml` 缓存）。
2. `update_note` 的服务实现支持 `pageKind`（8 值白名单，空串清除），内置 Agent 的 `write_notes` update 亦支持，且 2026-09-26 的收尾清单明确要求「MCP `create_note`/`update_note` 增加 8 值白名单参数」；但 `update_note` 的工具 schema 从未声明该参数，客户端无法发现，项目地图也据此记录「update_note 不可改页面类型」。

## 根因

共享解析器与 page_kind 数据模型（2026-09-25/26）落地时，服务行为与部分文档已更新，但工具描述、schema 与多处文档停留在更早状态；0.4.5 的「stale pageKind schema fields removed」清理只覆盖 `get_paper_details` 的未实现参数与 `create_note` 的重复字段，`update_note` 的遗漏未被发现。

## 修改

- `bin/paperquay-mcp.cjs`：
  - `update_note` 描述与 `content` 参数说明改为「写入时经共享解析器解析并重建富文本 JSON，清除 HTML 缓存；已知锚点 ID 与唯一匹配的 `[n]` 引用恢复为专用节点，未知值保留纯文本」，并补充「不要覆盖含锚点块的摘录卡正文」提示。
  - 补回 `update_note` 的 `pageKind` 参数（8 值白名单，空串清除），与 `create_note` 及内置 Agent 对齐。
- `docs/MCP_AGENT_INTEGRATION.md`：笔记写入语义约定按写入边界重建重写；风险提示收窄为摘录卡锚点块与引用/表格的格式要求；工具表补齐 `create_note`/`update_note` 的 `pageKind` 参数。
- `docs/USER_MANUAL.zh-CN.md`：5.4（内置 Agent）与 5.5（MCP）两处同步。
- `skills/paperquay-notes/SKILL.md`：工具表与宪章转述同步。
- 项目根 `AGENTS.md`：宪章红线摘要与 `pageKind` 能力描述同步。
- 契约测试：`tests/knowledgeMcp.test.ts` 断言 `update_note` schema 的 `pageKind` 白名单；`tests/knowledgeMcpNotesWrite.test.ts` 覆盖更新、清除与非法值拒绝。
- `packaging/mcp/server.cjs` 重新打包。

## 验证

- `node --test tests/knowledgeMcpNotesWrite.test.ts tests/paperquaySkills.test.ts tests/markdownToTiptap.test.ts tests/mcpPackaging.test.ts tests/knowledgeMcp.test.ts`：全部通过（含新增断言）。
- `node --check bin/paperquay-mcp.cjs packaging/mcp/server.cjs`：语法通过。
- 重新打包后核对：`packaging/mcp/server.cjs` 已无「clears the stored rich-text JSON」，新描述与 `pageKind` 参数存在。

## 边界说明

- 正文重建行为自 2026-09-25 起未变，本次为契约与文案对齐；`pageKind` 从「服务端接受但未声明」改为正式声明。
- 安装版中的服务描述随下一次构建/安装更新；开发模式重启 `bin/paperquay-mcp.cjs` 服务后生效。
