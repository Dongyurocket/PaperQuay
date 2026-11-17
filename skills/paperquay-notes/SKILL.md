---
name: paperquay-notes
description: 通过 PaperQuay Knowledge MCP 维护 PaperQuay 论文阅读器的笔记库——检索、创建、更新、删除笔记，管理文件夹与标签，遵循笔记宪章的页面类型与红线约定。
---

# PaperQuay 笔记维护 Skill

外部 Agent 经 `paperquay` MCP 服务（stdio）读写笔记库。连接方式见 `docs/MCP_AGENT_INTEGRATION.md`「客户端配置」，优先复制应用设置页「MCP 服务」生成的片段。参数以 `tools/list` 和该文档为准。

## 护栏（先读）

- 桌面应用运行中或运行状态无法确认时，写入工具默认拒绝。请用户先关闭 PaperQuay。
- 确需在应用运行时写入，才传 `allowWhileAppRunning: true`；应用界面不会自动刷新，写入后需重新加载才能看到。
- `PAPERQUAY_MCP_WRITE=off` 时所有写入工具禁用。

## 笔记工具

| 工具 | 说明 |
| --- | --- |
| `search_notes` | 只读。语义 + 关键词混合检索，可按 `paperId`、`pageKind` 过滤；返回 `retrievalMode`、`channels`、`warning` |
| `list_note_tags` / `list_note_folders` | 只读。标签与使用次数 / 文件夹树 |
| `create_note` | 新建；`title`、`content` 至少一个非空；`type` 为 `standalone`（默认）/`highlight`/`area`/`ai-chat`；`tags` 去 `#`、最多 30 个；可带 `paperId`、`pageKind`、`folderId` |
| `update_note` | 局部更新 `title`/`content`/`tags`/`pageKind`/`folderId`；`tags` 整体替换；`pageKind`、`folderId` 传空串分别清除、移到未分类 |
| `delete_note` | 软删除 |
| `create_note_folder` / `rename_note_folder` / `delete_note_folder` | 文件夹管理；删除文件夹时其中笔记移到未分类 |

正文中的 `[[笔记标题]]` 在目标已存在时解析为双链，`#标签` 合并进标签。

## 笔记宪章（红线）

1. **Tiptap JSON 是唯一事实源**：MCP 写入 Markdown，写入时经共享解析器重建为富文本 JSON。摘录卡锚点块和原文快照无法从 Markdown 还原，不要覆盖含这些内容的正文。
2. **锚点 ID 不可丢**：来源锚点只增不改，不可伪造。
3. **提炼可以自由，证据必须保真**：可以改写提炼正文，不得改写原文快照。

含文献引用或表格的笔记，覆盖正文时须保留 `[n]` + 文末参考文献列表和表格语法；否则只改标题、标签或文件夹。

## 页面类型

`paper-card`（论文卡片）、`concept`（概念）、`synthesis`（综述）、`qa`（问答）、`excerpt`（摘录卡）、`index`（索引）、`log`（日志）、`overview`（总览）。详见 `docs/notes-charter.md`。

## 整理流程

1. 用 `search_notes`、`list_note_folders`、`list_note_tags` 了解现状。
2. 先建文件夹树，再用 `update_note` 改 `folderId` 移动笔记。
3. 批量改标题、补标签用 `update_note`。
4. 不批量删除；先向用户列出待删清单并确认。
