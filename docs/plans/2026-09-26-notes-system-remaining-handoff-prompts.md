# 笔记系统剩余工作交接提示词（5 个会话）

> 用法：每个会话新开一个 Agent 对话 + 一个新分支，把对应小节的提示词**连同文末「公共尾部」整段**一起粘贴发送。不要在一个会话里塞多个主题——按 token 估算每个会话约 100万–300万，刚好是一个 Agent 会话能稳定交付的量。
>
> 依赖顺序：**A 先行**（序列化底座是所有写路径的地基）→ **B、C 可并行**（互不依赖）→ **D 依赖 A+C**（聚合管线需要 page_kind 过滤与回链保真）→ **E 最后**（E1 语义检索独立，E2 多模态重识别在 A 之后做更顺）。E 体量最大，跑不动就拆成 E1/E2 两个会话。
>
> 方案与验收的唯一依据是 `docs/plans/2026-09-24-notes-system-painpoints-and-solutions.md`（含 2026-09-26 复审增补）。提示词只给入口指针，具体设计让 Agent 读文档，不要把文档内容复制进 prompt——既省 token，又避免拿到过时副本。

---

## 会话 A：Markdown↔Tiptap 序列化底座 + vault 冲突副本（P3-1 + P3-2）

在 `C:\Users\yusen\.proma\agent-workspaces\paperquery\workspace-files`（PaperQuay：Electron + React 桌面 AI 论文工作台）完成笔记系统复审路线中的 P3-1 与 P3-2。

### 背景

方案文档：`docs/plans/2026-09-24-notes-system-painpoints-and-solutions.md`。先读其中「方案设计评审」的痛点 1/4 小节、「复审结论与后续路线」的 P3-1/P3-2 两条，以及 `docs/notes-charter.md` 全文（重点 §0 三条根本原则、§3 摘录卡红线、§5 与 Obsidian 的边界）。基线：main @ `b898255`（v0.2.1），`npm run check` 全绿（487 测试）。开工前先跑一次确认基线。

核心问题：笔记正文唯一事实源是 Tiptap JSON，但三条写路径（vault 回导、MCP 写入、内置 Agent `write_notes`）的输入都是 Markdown，目前统一退化为「`contentJson` 置 null + 编辑器按纯文本空行分段重建」（`src/features/notes/notesTiptap.ts` 的 `noteContentToTiptap` 兜底）——标题层级、列表、加粗、`[[双链]]`、`#标签`、`[n]` 文献引用、锚点链接全部损失。vault 侧已有**单向**序列化（`electron/backend/noteVault.cjs` 的 `serializeInline`/`serializeBlock`：paperReference→`[n]`+文末 GB/T 7714 列表、noteAnchorLink→`paperquay://anchor/<id>` 链接、wikiLink→`[[...]]`、hashTag→`#...`），没有反向解析。

### 任务一：Markdown→Tiptap 解析器（P3-1）

1. 新增双端可用的共享解析模块：前端 Vite/TS 与后端 `electron/*.cjs` 都要能 import，但后端不能 import TS——建议做成纯 `.cjs` 模块、前端经 default interop 引入；**先验证可行性再动手**，确实行不通则说明理由，改用「双实现 + 对齐测试」（`noteVault.cjs` 里 `formatGbt7714Entry` 就是前车之鉴，不要再造第三份靠注释维系的重复实现）。
2. 分级支持。第一级：标题/段落/有序无序列表/加粗/斜体/删除线/行内代码/代码块/引用块/`[[wikilink]]`/`#hashtag`。第二级：`[label](paperquay://anchor/<id>)` 重建 noteAnchorLink 节点；`[n]` 配合文末「参考文献」列表重建 paperReference 节点（paperId 从列表行反查文献库，查不到则保留为纯文本）。节点 attrs 以扩展定义为准：`src/features/notes/extensions/PaperReference.ts`、`NoteAnchorLink.ts`、`WikiLink.ts`、`HashTag.ts`；`src/features/notes/notePolish.ts:29` 有一个受限版 Markdown→节点转换器可参考思路。
3. 接入三个消费点：(a) `noteVault.cjs` 阶段 1 导入——回导时用解析器重建 `contentJson`，不再置 null；(b) MCP `create_note`/`update_note`（`electron/mcp/knowledgeMcpService.cjs:1490` 附近）——写入时重建 `contentJson`；(c) `noteContentToTiptap` 兜底——`contentJson` 缺失时走解析器而非纯文本分段。
4. **往返保真测试是本任务的验收核心**：构造含全部节点类型的笔记 → vault 导出 → 模拟外部编辑（改正文但不动占位语法）→ 回导 → 再导出，断言锚点 ID、引用编号、双链、标签逐项存活。测试写法参照 `tests/noteVault.test.ts`。

### 任务二：vault 冲突副本 + frontmatter 时钟（P3-2）

现状：`noteVault.cjs` 阶段 1 用 `stat.mtimeMs > updatedAt + 1000` 判定新旧，双侧同时修改时新的一方静默覆盖另一方（计划文档风险章节已点名此问题）；frontmatter 里写了 `updatedAt` 却未用于判定。

1. 新旧判定改为以 frontmatter `updatedAt` 为主、mtime 为辅（OneDrive 等云同步工具会改 mtime）。
2. 双侧变更检测：文件内容变化 **且** DB `updatedAt` 晚于上次导出（manifest 需增记导出时的 `updatedAt`，保持旧 manifest 兼容）时，不覆盖——生成 `<文件名>--conflict-<yyyymmdd-hhmmss>.md` 副本保留文件侧内容，DB 侧保持不变；`stats` 增加 `conflicts` 计数，并在同步结果提示中暴露（UI 入口在 `src/features/notes/NotesWorkspace.tsx` 的 vault 同步按钮附近）。
3. 补冲突场景测试：双侧都改 → 产生副本且 DB 无损；仅文件侧改 → 正常导入；仅 DB 侧改 → 正常导出。

### 约束

- 锚点 ID 与 paperId 在往返中不可丢失、不可伪造——宪章红线，测试必须钉死。
- 不改变 vault 文件布局；manifest 可加字段但必须向后兼容。
- 单篇文献元数据写入用 UPSERT，不要用 `INSERT OR REPLACE`（外键 `ON DELETE CASCADE` 会连带删除参考文献）。
- 不要动 `scripts/` 目录下未跟踪的脚本。

（发送时附上文末「公共尾部」。）

---

## 会话 B：低成本三项——MCP FTS / vault 自动同步 / 样式入设置（P3-5/7/8）

> 2026-09-26 更新：P3-4（宪章注入）已由会话 D 顺带落地——系统提示（`libraryAgent.ts:727` 附近）已含聚合配方、引用红线、体检修复与系统页维护规则，`write_notes` 工具描述已补锚点/快照保真要求。B 不再包含 P3-4，原「任务一」删除。

在 `C:\Users\yusen\.proma\agent-workspaces\paperquery\workspace-files` 完成笔记系统复审路线 P3-5、P3-7、P3-8 三个低成本项。先读 `docs/plans/2026-09-24-notes-system-painpoints-and-solutions.md` 的「复审结论与后续路线」对应条目与 `docs/notes-charter.md`。基线 `npm run check` 全绿，开工先确认。

### 任务二：MCP `search_notes` 切 FTS（P3-5）

- 现状：`electron/mcp/knowledgeMcpService.cjs` 的 `searchNotes` 是四字段 `LIKE %q%` 模糊匹配；应用内走 FTS——`notes_fts` 虚表由 `electron/backend/noteStore.cjs` 的 `syncFtsRow`（:694 附近）维护。`MATCH` 写法参照同文件 `rag_chunks_fts MATCH ?`（:779 附近）。
- 改为 FTS5 查询（title/content 加权或不加权均可，保持现有返回字段结构不变），FTS 表不存在或查询异常时回退 LIKE。补 `tests/knowledgeMcp*.test.ts` 用例：中文分词、多关键词、排序稳定性。

### 任务三：vault 自动同步（P3-7）

- 现状：同步只能手动点按钮（`src/features/notes/NotesWorkspace.tsx:860` 附近 → IPC `notes_vault_sync_now`，`electron/backend/noteCommands.cjs:49-58`）。
- 做：(a) NotesWorkspace 挂载时若已配置 vault 目录则自动同步一次（防抖，静默失败不打扰用户）；(b) 设置项可选「定时自动同步」（默认关，间隔 15–60 分钟可调）。**不做** OS 级文件 watcher——如认为 watcher 价值大到值得加依赖，先停下来说明理由再定。

### 任务四：引用样式入设置 + 笔记列表增强（P3-8）

- 引用样式：`src/features/notes/bibliography.ts:21` 的 `loadNoteCitationStyle` 走 localStorage，不随 WebDAV 同步。迁入阅读器设置体系（类型 `src/types/reader.ts`、默认值与归一化 `src/services/readerShared.ts`），保留 localStorage 旧值的一次性迁移。
- 列表增强：`src/features/notes/NotesList.tsx` 加排序（更新时间/创建时间/标题）与多选批量操作（批量打标签、批量移动文件夹），数据层走现有 `updateNote`，不要新起存储路径。

（发送时附上文末「公共尾部」。）

---

## 会话 C：页面类型入数据模型 + 改名双链传播（P3-3 + P3-6）

在 `C:\Users\yusen\.proma\agent-workspaces\paperquery\workspace-files` 完成笔记系统复审路线 P3-3 与 P3-6。先读计划文档「方案设计评审」痛点 3 小节、「复审结论」P3-3/P3-6 两条，以及 `docs/notes-charter.md` §1（8 种页面类型）与 §2（标题即唯一键的风险说明）。基线 `npm run check` 全绿，开工先确认。

### 任务一：`page_kind` 入数据模型（P3-3）

背景：旧 `type` 是来源语义（`highlight/area/standalone/ai-chat`），页面类型是结构语义（`paper-card/concept/synthesis/qa/excerpt/index/log/overview`），维度不同——计划评审已明确应新增列而非复用。

1. `electron/backend/noteStore.cjs` 给 `notes` 表加 `page_kind` 列（`ensureColumn` 模式见 :110），CRUD、`rowToNote`、FTS 同步全链路带上；`src/types/notes.ts` 的 `Note` 加 `pageKind` 字段，8 值 + `null`（未指定）。
2. 迁移策略：旧 `type` 保留不动；`highlight`→`excerpt`、`ai-chat`→`qa` 可一次性回填，其余留 `null`，**不要**强行猜测归类。迁移逻辑幂等。
3. 消费点全接通：编辑器应用页面类型模板时写入对应 `pageKind`（模板 id 已对齐宪章，见 `src/features/notes/noteEditorUtils.ts:170` 之后的 11 个模板）；`search_notes`/`listNotes` 支持 `pageKind` 过滤（内置 Agent `src/services/agentTools.ts`、MCP `bin/paperquay-mcp.cjs` 的 `create_note`/`update_note` 增加 8 值白名单参数、侧栏 UI 筛选）。
4. 更新 `docs/notes-charter.md`：§1 标注 page_kind 已入库及与旧 `type` 的关系。

### 任务二：改名双链传播（P3-6）

背景：`note_links` 按 `target_note_id` 存储（改名安全），但正文 `[[标题]]` 重新解析时按标题匹配（`resolveNoteLinks`，`noteStore.cjs`），目标笔记改名后其他笔记再次保存即丢链。

1. 方案二选一：(a) 改名时在事务内全库扫描 `content_json`，把 `wikiLink` 节点中指向旧标题的 label 改写为新标题（同步 FTS）；(b) `wikiLink` 节点增加 `noteId` attr、解析以 ID 优先、标题仅作显示快照——更稳，但要动 `WikiLink` 扩展与序列化约定。**若会话 A 的解析器已落地，优先 (b) 并与解析器协同；否则用 (a)**。动手前先确认会话 A 状态，选错路线会返工。
2. 测试钉死：A 笔记改名后，引用它的 B 笔记重新保存，双链与图谱关系不断；循环改名（A→B→A）不丢链。
3. 更新宪章 §2「标题即唯一键」的表述（改名传播机制落地后该风险已消解或缓解到什么程度，如实写）。

（发送时附上文末「公共尾部」。）

---

## 会话 D：聚合管线 + 系统页自动维护 + 体检修复闭环（深入方向 1/2/4）

在 `C:\Users\yusen\.proma\agent-workspaces\paperquery\workspace-files` 完成笔记系统复审的深入方向 1、2、4。**前置依赖：会话 A（回链保真）与会话 C（page_kind 过滤）已落地**——先确认这两项，未落地就停下来，不要基于纯文本重建做聚合。先读计划文档「复审结论与后续路线」第四节与痛点 8 全文、`docs/notes-charter.md`。

### 任务一：聚合管线（深入方向 1）

目标：两个 Agent 高阶能力可用——「把这篇文献的散摘录整理成精读卡」「把主题 X 的跨文献摘录整理成概念页」。

1. 优先用「配方」而非新工具实现：在 Agent 系统提示或 capability 层加入两条聚合配方（检索过滤条件：`pageKind='excerpt'` + paperId 或标签；产出结构：精读卡/概念页模板 + 每要点回链 `[[摘录卡标题]]` + 文献引用节点），产出走既有 `write_notes` 审批。若评估后认为必须加专门工具（如 `aggregate_notes`），说明理由再动手。
2. 概念页中的文献引用必须写成 paperReference 节点（paperId + 可选页码），由既有管线自动编号、自动维护文末文献列表——**Agent 永远不手写引用文本**（计划文档痛点 7 第 5 条）。
3. 测试：模拟 3 张摘录卡 → 聚合产出精读卡草稿 → 断言回链与引用节点正确、锚点未被改动。

### 任务二：系统页自动维护（深入方向 2）

1. 触发钩子挂在 `applyAgentNoteWritePlan` 成功后（`src/services/agentNotePlan.ts:144`）：每次批量写笔记后向 `log` 页追加一条操作记录（时间、操作类型、涉及笔记链接）。
2. `index`/`overview` 页按节流刷新（每 N 次写操作或用户手动触发），不要每次写操作都全量重建。
3. 漂移处理：用户手改过的系统页不覆盖（用 `pageKind` + 内容标记位或人工锁判定，方案自定但要写进变更记录）。
4. 三个系统页模板已存在（`noteEditorUtils.ts:301/314/325`），维护逻辑复用模板结构。

### 任务三：体检 → 修复闭环（深入方向 4）

1. `src/features/notes/noteHealth.ts` 已能产出孤立/断链/无标题/无标签/陈旧五类报告。加「让 Agent 修复」入口：体检报告卡片加按钮 → 把报告交给 Agent → Agent 生成 `write_notes` 修复计划走审批（删除类操作默认只列清单不执行，遵循 `skills/paperquay-notes/SKILL.md` 的作业规范）。
2. 断链修复与会话 C 的改名传播机制对齐，不要两套修法。

（发送时附上文末「公共尾部」。）

---

## 会话 E：笔记语义检索 + 提炼预览与多模态重识别（深入方向 3/5）

在 `C:\Users\yusen\.proma\agent-workspaces\paperquery\workspace-files` 完成笔记系统复审的深入方向 3 与 5。**本会话体量大，建议拆成 E1/E2 两次**；先读计划文档「复审结论与后续路线」第四节、`docs/notes-charter.md` §3。

### E1：笔记语义检索（深入方向 3）

1. 文献混合检索的现成实现：向量 `MATCH` 在 `electron/mcp/knowledgeMcpService.cjs:659/696` 附近，RAG 提取与检索在独立 Worker（见项目地图）。笔记库加笔记 chunk 的嵌入存储（新表或复用 RAG 库加 `source='note'` 维度，评估后择一并写明理由）；嵌入 API 配置复用阅读器现有设置，不新增配置面。
2. 索引时机：笔记保存/导入后异步增量索引；删除随软删除失效。
3. 检索升级：`searchNotes` 升级为 向量 + FTS5 + RRF 混合（配置了 embedding API 时），返回结构带 `retrievalMode`/`channels`/降级 warning，与文献检索的契约对齐；内置 Agent `search_notes` 与 MCP `search_notes` 同步受益。
4. 测试：无 embedding 配置时静默降级 FTS；有配置时混合结果含两路 channel 标记。

### E2：提炼预览 + 多模态重识别（深入方向 5）

现状：提炼管线为纯文本两步 CoT——前端 `src/services/noteDistill.ts`、后端命令 `notes_distill_excerpt_openai_compatible`（`electron/backend/aiCommands.cjs`）、入口 `src/features/reader/readerSelectionQuickActions.tsx:432`（「AI 提炼为摘录卡」）、建卡/追加在 `DocumentReaderTab.tsx:2865` 附近。提炼结果**直接入库**，无预览确认。

1. 并排预览：提炼完成后先入预览面板（左：原始识别文本；右：提炼稿，可编辑），用户确认后才建卡/追加；保持「我的想法」区分离与锚点只增不改的现有约定。
2. 多模态重识别（可选勾选）：公式/表格选区支持「AI 重识别」——区域截图（`src/features/pdf/pdfBlockCrop.ts` 已有切块能力）送多模态模型重建 LaTeX/三线表，再进提炼管线。视觉基础设施复用 `src/services/agentVision.ts` 与现有模型配置，不新增模型设置面；重识别结果打 `aiEnhanced` 标记（宪章 §3 快照规则的留痕要求）。
3. 测试：预览确认/取消两条路径；重识别失败时回退纯文本提炼且锚点不受影响。

（发送时附上文末「公共尾部」。）

---

## 公共尾部（每个会话都附上）

### 约束

- 不要回退已有行为：笔记编辑器、锚点回跳、文献引用、图谱、RAG 问答、MCP 全部工具保持可用。
- 锚点与原文快照保真是宪章红线：Agent 只可新增锚点，不可改指、不可伪造；原文快照不可改写。
- 单篇文献元数据写入用 UPSERT，不要用 `INSERT OR REPLACE`（外键 `ON DELETE CASCADE`）。
- 不要动 `scripts/` 目录下未跟踪的脚本；不要提交 API key、PDF、解析产物、SQLite 数据库、`dist/`。

### 仓库约定（AGENTS.md）

- 功能用 `feat/*` 分支（本会话一个分支）；门禁 `npm run check`（`npm run build` + `npm test`）。
- 测试是 `node --test tests/*.test.ts`。Node ESM 类型剥离两条硬规则：`.ts` 值导入必须带 `.ts` 后缀；`.tsx` 导入不能带后缀。
- 用户可感知的变更写 `docs/changes/` 记录，格式参照 `docs/changes/2026-09-23-rag-worker-and-reader-budget.md`；提交信息用中文，按「现象 / 根因 / 修改 / 验证」组织，feat 带 scope。
- 纯逻辑优先抽成能在 `node --test` 下直接跑的模块，不要只在组件里验证。

### 交付

1. 功能实现 + 测试；`npm run check` 全绿（487 个既有测试不回归）。
2. 变更记录写进 `docs/changes/`，写清方案原文要求、实际做法、仍然收窄或偏离方案的地方及理由——**不要为了对齐方案硬造无用抽象**。
3. 更新 `docs/plans/2026-09-24-notes-system-painpoints-and-solutions.md`：状态行与「落地状态核对」表对应项改为已落地。
4. 手工回归一遍与本任务相关的桌面端行为（在交付说明里列出回归项与结果）。

先读指定文档与文件再动手。有疑问先问，不要猜方案意图。
