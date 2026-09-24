---
name: paperquay-notes
description: 通过 PaperQuay Knowledge MCP 维护 PaperQuay 论文阅读器的笔记库——检索、创建、更新、删除笔记，管理文件夹与标签，遵循笔记宪章的页面类型与红线约定。
---

# PaperQuay 笔记维护 Skill

面向 Codex / DSH 等外部 Agent：经 PaperQuay Knowledge MCP（stdio）读写笔记库。

## 连接

```json
{
  "mcpServers": {
    "paperquay-knowledge": {
      "command": "node",
      "args": ["<paperquay-repo>/bin/paperquay-mcp.cjs"],
      "env": { "PAPERQUAY_MCP_WRITE": "on" }
    }
  }
}
```

## 护栏（必须先读）

- `PAPERQUAY_MCP_WRITE=off` 时全局只读（默认 on）。
- PaperQuay 桌面应用运行中默认拒绝写操作（`PaperQuay.exe` 进程检测；开发模式下该护栏不生效）。
- 若确需在应用运行时写入，工具参数传 `allowWhileAppRunning: true`——但桌面 UI 持内存快照，外部写入需用户重启或重新加载后才能看到，请谨慎。

## 笔记工具

| 工具 | 说明 |
| --- | --- |
| `search_notes` | 全文检索（只读） |
| `list_note_tags` | 标签列表（只读） |
| `list_note_folders` / `create_note_folder` / `rename_note_folder` / `delete_note_folder` | 文件夹树 |
| `create_note` | 新建；`title`/`content` 必填；`type ∈ highlight/area/standalone/ai-chat`；`tags` 去 `#` 前缀、上限 30；可带 `folderId` |
| `update_note` | 局部更新；替换 `content` 会清空富文本缓存由编辑器重建 |
| `delete_note` | 软删除 |

笔记正文中的 `[[笔记标题]]` 会被解析为双链（仅当目标已存在），`#标签` 自动归一化。

## 笔记宪章（红线）

1. **Tiptap JSON 是唯一事实源**——MCP 写入的是 Markdown 纯文本，富文本由桌面编辑器重建。
2. **锚点 ID 不可丢**——摘录卡的来源锚点只增不改；不可伪造锚点。
3. **提炼可以自由，证据必须保真**——可改写提炼正文，不得改写原文快照。

## 页面类型

`paper-card`（论文卡片）/ `concept`（概念）/ `synthesis`（综述）/ `qa`（问答）/ `excerpt`（摘录卡）/ `index` / `log` / `overview`。详见仓库 `docs/notes-charter.md`。

## 整理任务建议流程

1. `search_notes` + `list_note_folders` 摸清现状；
2. 先建文件夹树，再移动（`update_note` 改 `folderId`）；
3. 批量改名/补标签用 `update_note`；
4. 不要批量删除——先向用户列出待删清单。
