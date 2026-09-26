# PaperQuay v{{VERSION}}

This release closes out the notes-system review series: semantic note search, a preview before anything is distilled into a card, aggregation recipes with auto-maintained system pages, eight page kinds wired through the whole stack, and Markdown round-trip fidelity with vault conflict copies.

## Highlights

- **Semantic note search (vector + FTS5 + RRF)**: note retrieval now fuses vector KNN with FTS5 keyword search through reciprocal rank fusion, reusing the reader's Embedding configuration and the existing RAG database — no new settings, no fourth database. Notes are indexed incrementally after save, import and vault round-trip; deletes invalidate immediately; and the notes toolbar gains a "Rebuild note semantic index" action with visible queued / done / failed states. Both the built-in Agent and the external MCP server return `retrievalMode` and per-hit `channels` (`vector` / `fts` / `like`), and degrade to keyword search with a notice when no embedding API is configured. Anchors, citation nodes and source snapshots are evidence, and are excluded from the embedded corpus.
- **Distill preview and multimodal re-recognition**: "AI distill to excerpt card" now opens a side-by-side panel — the original recognized text on the left, an editable title and distilled body on the right — and nothing is stored until you confirm; cancelling just closes the panel. Appending to an existing card previews the combined text, inserting new anchors and paragraphs before the "💭 我的想法：" section while leaving existing anchors untouched. Inside the preview, a vision-capable model can re-recognize formula and table regions from a crop of the original PDF; the action is disabled with an explanation when the selected model lacks vision support, and cropping or call failures fall back to the plain text with a notice in the preview. Accepted re-recognitions are marked `aiEnhanced` and shown as "AI 重识别" on the card.
- **Aggregation recipes and self-maintaining system pages**: the Agent can aggregate excerpt cards into paper cards or concept pages — every bullet links back to its source card, and body citations written as `[n]` are rebuilt into real citation nodes. Each successful note write appends a `log` entry, and every five successful writes refresh the `index` / `overview` navigation pages. System pages are recognized by a content marker: once you edit one by hand, automatic maintenance skips it instead of overwriting your text.
- **Health report one-click repair**: the notes health report gains a "Let the Agent fix" action that opens the Agent with a repair brief pre-filled. Deletions are listed only, never generated; broken links are re-attached by their existing `noteId` where possible; anchors and source snapshots are preserved as-is.
- **Eight page kinds across the whole stack**: `notes.page_kind` is independent from the legacy source `type`, and existing rows are backfilled idempotently on open (`highlight → excerpt`, `ai-chat → qa`). Page kinds travel through editor templates, sidebar filtering, the built-in Agent, MCP note write / search tools and vault frontmatter, and invalid values are rejected.

## Improvements

- **Markdown round-trip fidelity**: a new shared Markdown→Tiptap parser backs vault import, MCP note writes and the editor fallback, so headings, lists, bold/italic/strikethrough, inline code, code blocks, block quotes, `[[wikilinks]]`, `#tags` and anchor links survive the round trip. Only anchors confirmed by frontmatter or context, and reference entries that uniquely match a local paper, are rebuilt as real nodes — anything unknown stays plain text, so no fake anchors or `paperId`s are invented.
- **Wikilinks now resolve by ID**: wikilink nodes store both `noteId` and a title snapshot, resolving by ID first and falling back to the title. Renaming a target note no longer breaks incoming links, and vault exports still write Obsidian-compatible `[[title]]` that follows the new title.
- **Vault auto-sync**: opening the notes workspace silently syncs a configured vault once, and settings offer an opt-in 15–60 minute timer (off by default, 30 minutes when enabled).
- **Note list sorting and batch tidy-up**: sort by updated time, created time or title; batch-append tags or move several notes into a folder, touching only `tags` / `folderId` and never the note body.
- **Faster MCP note search**: `search_notes` uses FTS5 trigram queries (whitespace tokens combined with AND) when available, keeping `paperId` / `pageKind` filters and stable ordering, and falling back to the four-field LIKE search for short tokens or missing tables — existing databases are not migrated.
- **Citation style moves into reader settings**: GB/T 7714-2015 / APA 7 / IEEE selection now lives with the rest of the reader settings, and the old localStorage key is migrated once.

## Fixes

- **Vault edits on both sides are no longer silently overwritten**: sync now treats the frontmatter `updatedAt` as the primary clock (falling back to mtime). When the file and the database both changed since the last export, the original file is left alone and the conflicting content is written to a `--conflict-YYYYMMDD-HHmmss.md` copy while the app-side version wins; the sync result reports how many conflicts occurred.
- **Renaming a note no longer drops its links**: re-saving a note whose target was renamed keeps its `note_links` rows, including after repeating renames.
- **Distill no longer pollutes source snapshots**: recognition errors in formula/table regions no longer flow straight into an excerpt card; a failed re-recognition falls back to the original text and does not set `aiEnhanced`, and existing snapshots are never rewritten silently.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本次发布收束了笔记系统复审系列：笔记语义检索、提炼前并排预览、聚合配方与系统页自动维护、八种页面类型贯通全链路，以及 Markdown 往返保真与 vault 冲突副本。

## 亮点

- **笔记语义检索（向量 + FTS5 + RRF）**：笔记检索把向量 KNN 与 FTS5 关键词检索经 RRF 融合，复用阅读器 Embedding 配置与既有 RAG 库——不新增设置项、不新增数据库。笔记在保存、导入与 vault 回导后异步增量索引，删除立即失效；笔记工具栏新增「重建笔记语义索引」，排队、完成、失败状态与最后错误可见。内置 Agent 与外部 MCP 均返回 `retrievalMode` 与每条命中的 `channels`（`vector` / `fts` / `like`），未配置 Embedding 时降级关键词检索并给出提示。锚点、文献引用节点与原文快照属证据内容，不进入向量语料。
- **摘录提炼并排预览与多模态重识别**：「AI 提炼为摘录卡」现在先打开左右对照面板——左侧原始识别文本、右侧可编辑的标题与提炼正文，确认才写入，取消只关闭面板。追加到已有摘录卡同样先预览合并后的完整正文，新锚点与新段落插入「💭 我的想法：」之前，已有锚点保持不变。预览内可用视觉模型从原 PDF 裁切区域重识别公式 / 表格内容；所选模型不支持视觉时入口置灰并说明原因，切片或调用失败时自动回退原始纯文本并在预览中提示。采用重识别结果的锚点标记 `aiEnhanced`，卡片上显示「AI 重识别」来源。
- **聚合配方与系统页自动维护**：Agent 可按配方把摘录卡聚合为精读卡 / 概念页，每个要点回链来源摘录卡，正文中以 `[n]` 书写的引用会重建为真实文献引用节点。每次成功写入追加 `log` 记录，每累计 5 次成功写操作刷新 `index` / `overview` 导航页。系统页按内容标记判定归属：一旦你手工编辑过，自动维护会跳过该页，不覆盖手写内容。
- **体检报告一键交给 Agent 修复**：笔记体检卡新增「让 Agent 修复」，一键打开 Agent 并预填修复指令。删除类问题只列清单、不生成删除；断链优先按已有 `noteId` 重挂；锚点与原文快照只做保真，不改写。
- **八种页面类型贯通全链路**：`notes.page_kind` 独立于旧的来源语义 `type`，打开数据库时幂等回填（`highlight → excerpt`、`ai-chat → qa`）。页面类型贯通编辑器模板、侧栏过滤、内置 Agent、MCP 笔记写入 / 检索与 vault frontmatter，非法值会被拒绝。

## 改进

- **Markdown 往返保真**：新增共享 Markdown → Tiptap 解析器，vault 回导、MCP 笔记写入与编辑器兜底统一走该解析器，标题、列表、粗体 / 斜体 / 删除线、行内代码、代码块、引用块、`[[双链]]`、`#标签` 与锚点链接均可在往返中保留。只有 frontmatter 或上下文能确认的锚点、以及唯一匹配本地文献的参考文献条目才重建为真实节点，未知值保留为纯文本，不伪造锚点或 `paperId`。
- **双链按 ID 稳定解析**：双链节点同时保存 `noteId` 与标题快照，解析以 ID 优先、标题兜底。目标笔记改名后引用方不会断链，vault 导出仍写 Obsidian 兼容的 `[[标题]]` 并跟随新标题。
- **vault 自动同步**：打开笔记工作区时对已配置 vault 静默同步一次；设置中提供默认关闭的 15–60 分钟定时同步（启用后默认 30 分钟）。
- **笔记列表排序与批量整理**：支持按更新时间、创建时间、标题排序；可批量追加标签或把多篇笔记移入文件夹，只改 `tags` / `folderId`，不触碰正文。
- **MCP 笔记检索提速**：`search_notes` 在 FTS5 可用时改用 trigram 查询（关键词按空白分组、AND 组合），保留 `paperId` / `pageKind` 过滤与稳定排序；短词、FTS 缺失或查询异常自动回退四字段 LIKE，旧数据库无需迁移。
- **引用样式进入设置体系**：GB/T 7714-2015 / APA 7 / IEEE 选择迁入阅读器设置，旧 localStorage 键一次性迁移。

## 修复

- **vault 双侧修改不再静默覆盖**：同步以 frontmatter `updatedAt` 为主时钟（缺失时回退 mtime）。文件与数据库在上次导出后都发生变化时，原文件不再被覆盖，冲突内容写成 `--conflict-YYYYMMDD-HHmmss.md` 副本，应用侧版本保留，同步结果显示冲突数量。
- **笔记改名不再丢链**：目标笔记改名后，引用方重新保存仍保持 `note_links` 关系，循环改名也不丢。
- **摘录提炼不再污染原文快照**：公式 / 表格区域的识别错误不再直接进入摘录卡；重识别失败时回退原始文本且不写入 `aiEnhanced`，已有锚点快照不被静默改写。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
