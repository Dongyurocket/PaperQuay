# PaperQuay 笔记宪章（Notes Charter）

> 规定笔记的页面类型、命名与链接规范、摘录卡的证据红线。外部 Agent（经 MCP）和用户共同遵守。修改本文件需写明理由，并同步更新编辑器模板（`src/features/notes/noteEditorUtils.ts` 的 `NOTE_TEMPLATES`）。

## 0. 三条根本原则

1. **Tiptap JSON 是唯一事实源**。正文存于 `notes.content_json`；Markdown / HTML 只是导出与同步格式。
2. **锚点 ID 不可丢**。指向文献位置（页码、blockId、pdfLocation）的锚点，在编辑、AI 改写、Markdown 往返中都必须保真。
3. **提炼可以自由，证据必须保真**。提炼性文字可任意改写；来源锚点和原文快照一个字都不能动。

## 1. 页面类型（Page Types）

每篇笔记最多属于一种页面类型，存于 `notes.page_kind`。类型决定模板与最低内容要求，不决定文件夹归属。

`notes.type` 是来源语义（`highlight`、`area`、`standalone`、`ai-chat`），`page_kind` 是结构语义（下表 8 值），两者不可互相替代。旧数据打开时自动回填（`highlight → excerpt`、`ai-chat → qa`），其余历史笔记可为 `null`。编辑器模板、笔记检索的 `pageKind` 过滤和 MCP 写入都按 `page_kind` 校验，非法值直接拒绝。

| 类型 | 标识 | 用途 | 最低要求 |
|------|------|------|----------|
| 论文卡片 | `paper-card` | 一篇文献的结构化档案：问题、方法、实验、我的判断 | 必须挂 paperId；必须含「我的判断」 |
| 概念页 | `concept` | 一个概念、方法或术语的定义与理解 | 必须有定义段；尽量挂来源锚点 |
| 综述页 | `synthesis` | 跨多篇文献的比较、归纳、研究脉络 | 至少引用 2 篇文献（paper-reference） |
| 问答页 | `qa` | 一个具体问题及其回答与证据 | 必须有「证据位置」段 |
| 摘录卡 | `excerpt` | 对一段原文的提炼式摘录 | 必须有来源锚点；见 §3 红线 |
| 索引页 | `index` | 一个主题或项目的入口与目录 | 主要由 [[双链]] 组成，少写正文 |
| 日志页 | `log` | 按时间推进的研究日志 | 条目倒序（最新在上），每条带日期 |
| 总览页 | `overview` | 全局学习、研究状态的总览 | 每周手工或由外部 Agent 刷新一次 |

## 2. 命名与链接规范

- **双链按 `noteId` 解析**：Tiptap `wikiLink` 节点同时保存目标 `noteId` 与标题快照。关系解析、`note_links` 写入、显示和导出都优先按 `noteId` 取当前标题，目标改名后无需改写引用方笔记。
- **残留风险**：纯 Markdown 中手写的 `[[旧标题]]` 没有 `noteId`，只能按标题解析，目标改名后可能失配或歧义。vault 导出把已有 ID 的双链写成当前标题，回导时再恢复 ID。
- **概念页用术语命名**：如「KV Cache」「FlashAttention」，不加「笔记」「总结」等后缀。
- **论文卡片用「年份 第一作者 短题」**：如「2023 Vaswani Attention Is All You Need」。
- **标签是横切维度，文件夹是归属维度**：一篇笔记只在一个文件夹，可有多个 `#标签`。项目、领域用文件夹；主题、方法用标签。
- **索引页链接而非复制**：只放 `[[双链]]` 和一句话说明，不粘贴正文。

## 3. 摘录卡红线（Excerpt Contract）

摘录卡正文是对原文的提炼改写，**不是逐字复制**。

1. **来源锚点保真**：`anchors[]`（paperId、pageIndex / blockId / pdfLocation、label）由系统写入，人工和 AI 都不得编辑。
2. **原文快照保真**：锚点携带的原文快照（`excerpt` 字段）是证据，不得改写。
3. **提炼正文自由**：正文可以重写、重排版、重识别（入库后）。
4. **不得无中生有**：提炼不得引入原文没有的主张；拿不准的推断标注为「我的推断」。

## 4. 外部 Agent 与 MCP 写入边界

- 应用内不再提供独立的 Agent 工作区或笔记 AI 润色；写作入口只保留手工编辑和阅读器问答/摘录。外部 Agent 一律经 MCP 写入同一条笔记存储路径。
- MCP 写入要求：标题与正文不能同时为空，`type` 与 `pageKind` 只接受白名单值，标签最多保留前 30 个。桌面应用运行时写入必须携带 `expectedUpdatedAt`；冲突返回 `NOTE_CONFLICT`，不静默覆盖。
- 含锚点的笔记更新正文时，必须保留每个 `paperquay://anchor/<id>` 链接；缺失锚点返回 `NOTE_ANCHOR_MISSING`，只允许改标题、标签、文件夹与页面类型。
- Agent 新建页面时优先使用对应页面类型的模板（编辑器工具栏的模板菜单或 `/` 菜单）。
- Agent 不得修改锚点与原文快照，不得把摘录卡的提炼正文当作原文引用回文献。

## 5. 与 Obsidian 的边界

笔记工作区可手动触发 Markdown vault 双向同步（`electron/backend/noteVault.cjs`）：

- 每篇笔记对应一个 `.md` 文件，frontmatter 携带 `id`、`type`、`pageKind`、`paperId`、`folder`、`tags`、`sources`、`createdAt`、`updatedAt`、`anchors`。
- `id` 是同步锚，不要在 Obsidian 侧修改；没有 `id` 的新文件在导入时按新笔记处理。
- 富文本在 Markdown 中的表示：锚点芯片为 `paperquay://anchor/<id>` 链接；文献引用为 `[n]` 加文末 GB/T 7714 参考文献列表；行内公式与块级公式为 `$...$` / `$$...$$`；`[[双链]]` 与 `#标签` 原样保留。
- 回导、MCP 笔记写入和编辑器缺失 `content_json` 时，由共享解析器 `src/shared/markdownToTiptap.cjs` 重建标题、列表、基础内联格式、代码块、引用块、公式、双链和标签。只有 frontmatter 或本地文库已知的锚点 ID 与 paperId 才恢复为专用节点，未知值保留为普通文本。
