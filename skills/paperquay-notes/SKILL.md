---
name: paperquay-notes
description: 通过 PaperQuay Knowledge MCP 维护 PaperQuay 笔记库——按版本读写笔记与文件夹，保留锚点，遵循笔记宪章的页面类型与红线约定。
---

# PaperQuay 笔记维护 Skill

外部 Agent 经 `paperquay` MCP 服务（stdio）读写笔记库。连接方式见 `docs/MCP_AGENT_INTEGRATION.md`「客户端配置」，优先复制应用设置页「MCP 服务」生成的片段。参数以 `tools/list` 和该文档为准。

## 护栏（先读）

- 桌面应用运行中或运行状态无法确认时，写入工具默认拒绝。请用户先关闭 PaperQuay。
- 确需并行写入时传 `allowWhileAppRunning: true`，并携带读取到的 `expectedUpdatedAt` / `expectedFolderVersions`。这是受检并行写：版本缺失或变化返回 `NOTE_CONFLICT`，不会静默覆盖。
- 写入提交后桌面应用会刷新笔记列表；正在编辑的笔记显示「外部更新」横幅，由用户选择刷新或继续。
- `PAPERQUAY_MCP_WRITE=off` 时所有写入工具禁用。

## 笔记工具

| 工具 | 说明 |
| --- | --- |
| `search_notes` | 只读。语义 + 关键词混合检索，可按 `paperId`、`pageKind` 过滤；返回 `retrievalMode`、`channels`、`warning` |
| `get_note` | 只读。按 ID 分页读取正文、锚点与 `updatedAt`；使用 `nextOffset` 继续读取 |
| `list_note_tags` / `list_note_folders` | 只读。标签与使用次数 / 文件夹树（含 `updatedAt`） |
| `create_note` | 新建；`title`、`content` 至少一个非空；`type` 为 `standalone`（默认）/`highlight`/`area`/`ai-chat`；`tags` 去 `#`、最多 30 个；可带 `paperId`、`pageKind`、`folderId` |
| `update_note` | 局部更新 `title`/`content`/`tags`/`pageKind`/`folderId`；需 `expectedUpdatedAt` |
| `delete_note` | 软删除；需 `expectedUpdatedAt` |
| `create_note_folder` / `rename_note_folder` / `delete_note_folder` | 文件夹管理；改名需版本，删除需目标版本 + `expectedFolderVersions`，其中笔记移到未分类并返回受影响 ID 与新版本 |

正文中的 `[[笔记标题]]` 在目标已存在时解析为双链，`#标签` 合并进标签。

## 写入流程（先读后写）

1. `get_note` / `list_note_folders` 读取目标与版本。
2. 只传需要修改的字段；`tags` 是整体替换，`pageKind` / `folderId` 传空串清除或移到未分类。
3. 冲突（`NOTE_CONFLICT`）时重新读取、合并本地意图，再用最新版本重试，不要自动覆盖。
4. 写入后回读，核对标题、正文、标签、文件夹与 `updatedAt`，报告实际变更。

## 笔记宪章（红线）

1. **Tiptap JSON 是唯一事实源**：MCP 写入 Markdown，写入时经共享解析器重建为富文本 JSON。摘录卡锚点块和原文快照无法从 Markdown 还原。
2. **锚点 ID 不可丢**：含锚点的笔记更新正文时，新 Markdown 必须保留每个 `paperquay://anchor/<id>` 链接；缺少任一锚点时服务返回 `NOTE_ANCHOR_MISSING` 并拒绝正文更新，此时只改标题、标签、文件夹或页面类型。
3. **提炼可以自由，证据必须保真**：可以改写提炼正文，不得改写原文快照或伪造锚点。

含文献引用或表格的笔记，覆盖正文时须保留 `[n]` + 文末参考文献列表和表格语法；否则只改元数据字段。

## 文件夹与 Vault

- 级联删除先读 `list_note_folders`，把所有受影响父子文件夹的 `updatedAt` 作为 `expectedFolderVersions` 传入；任一变化整批拒绝。
- Vault 同步只由用户触发：手动同步，或用户在设置中显式开启定时同步。挂载笔记页不会隐式同步。冲突会保留 `.conflict` 副本，不要删除冲突文件。

## 页面类型

`paper-card`（论文卡片）、`concept`（概念）、`synthesis`（综述）、`qa`（问答）、`excerpt`（摘录卡）、`index`（索引）、`log`（日志）、`overview`（总览）。详见 `docs/notes-charter.md`。

## 整理流程

1. 用 `search_notes`、`list_note_folders`、`list_note_tags` 找到目标，必要时用 `get_note` 分页读取完整正文及锚点。
2. 列出待修改或删除的笔记、字段与版本；删除前取得用户明确确认。
3. 先建文件夹树，再用 `update_note` 改 `folderId` 移动笔记；仅传需要修改的字段。
4. 写入后重新读取目标，核对字段、锚点及操作结果，并报告失败或跳过的项目。
