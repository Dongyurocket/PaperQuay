# PaperQuay 笔记系统痛点分析与解决方案

> 相关文档：[笔记宪章（Notes Charter）](../notes-charter.md) —— 页面类型、命名链接规范、摘录卡证据红线。

- 日期：2026-09-24
- 状态：**全部落地**（2026-09-26；P0-1～P0-3、P1-1～P1-5、P2-1～P2-3、P3-1～P3-8 及深入方向 1～5 均已落地，`npm run check` 全绿；实现偏差、收窄项和未执行的桌面手工回归见各项落地记录与「复审结论与后续路线」）
- 范围：笔记子系统（`src/features/notes/`、`electron/backend/noteStore.cjs` / `noteCommands.cjs`）、内置 Agent（`src/services/agentTools.ts` / `libraryAgent.ts` / `agentLoop.ts`）、MCP 知识库服务（`electron/mcp/knowledgeMcpService.cjs`、`bin/paperquay-mcp.cjs`）
- 参考项目：[nashsu/llm_wiki](https://github.com/nashsu/llm_wiki)（Karpathy LLM Wiki 模式的桌面应用实现）

## 摘要

| # | 痛点 | 根因（一句话） | 方案主线 | 建议优先级 |
|---|------|----------------|----------|------------|
| 1 | 内置 Agent 不能增删/优化笔记 | Agent 工具注册表里根本没有笔记工具（连读都没有），笔记 CRUD 只暴露给 UI 层 IPC | 在 `agentTools.ts` 注册笔记读写工具，写操作走既有审批计划模型 | P0 |
| 2 | 外部 Agent（Codex/DSH 等）无法维护笔记 | MCP 服务对笔记只开放了只读 `search_notes`；笔记存于 SQLite + Tiptap JSON，没有文件形态可供外部工具直接编辑 | MCP 增加笔记写工具（复用 noteStore 写路径 + 既有护栏）；中期做 Markdown 镜像层 | P0 |
| 3 | 笔记缺少架构、模板与写作标准 | 只有 4 个硬编码段落模板；文件夹只存 localStorage；没有索引页/日志/目的层/页面类型规范 | 借鉴 llm_wiki 三层架构（原始来源→Wiki→Schema），建立笔记宪章与页面类型体系 | P1 |
| 4 | 笔记体验不如 Obsidian 丝滑 | 数据锁在 SQLite 里，无法用 Obsidian 打开；组织元数据（文件夹）不进库、不随 WebDAV 同步；双链已入库但无图谱可视化 | Markdown vault 双向同步 + Obsidian 兼容；文件夹入库；笔记双链图谱 | P1 |
| 5 | 残留旧版 Agent 能否清理 | legacy 路径本是 P3 过渡期的"一个版本"保守回退，ReAct 默认路径已稳定数个版本且 legacy 存在取消失效等已知缺陷 | 可以清理，按清单分阶段移除并保留设置键兼容 | P2 |
| 6 | llm_wiki 参考 | —— | 采纳其三层架构、index/log/overview、frontmatter 溯源、Obsidian 兼容、本地 HTTP API + Agent Skill 六类模式 | 见各节 |
| 7 | 文献引用格式不学术 | 内联引用渲染为 `@标题` 芯片，文末列表仅"标题. 作者. 年份."简式，未利用已入库的期刊/卷期页/DOI 等完整元数据 | 编号式学术引用（[n]，decoration 派生）+ 样式化文献列表（GB/T 7714 / APA / IEEE）；引用以整篇文献为单位、点击跳转文献页码 | P1 |
| 8 | 提炼式摘录无法向上融入 | 划词成卡链路已存在但模型假设是"逐字引用"：MinerU 原文直接进引用块，与"提炼几句+改写+思考"的实际用法错配；卡落地成孤岛 | 摘录卡 = 提炼正文（可自由编辑，AI 可参与提炼/排版）+ 来源锚点（保真，可多挂）+ 可选原文快照；文献内→精读卡、跨文献→概念页聚合 | P1 |

---

## 落地状态核对（2026-09-26 复审）

v0.2.0 落地后对照本文档逐项代码复核的结果。**主干功能全部上线，但复审时以下承诺未兑现或只落地了一半**；本轮已继续补齐深入方向 5，当前状态见文档顶部：

| 路线图项 | 落地情况 | 偏差说明 |
|----------|----------|----------|
| P0-1 Agent 笔记只读工具 | ✅ 完整 | `search_notes`/`read_note` 已注册（`agentTools.ts`） |
| P0-2 Agent 写工具+审批 | ✅ 完整 | `write_notes` 生成审批计划，审批卡 UI 完整（`agentNotePlan.ts` + `AgentWorkspaceMessages.tsx`） |
| P0-3 MCP 笔记写工具 | ✅ 主干 | 写工具（create/update/delete + 文件夹管理）、护栏与 `search_notes` FTS 检索均已落地；旧数据库/短词仍保留 LIKE 兼容回退 |
| P1-1 文件夹入库 | ✅ 完整 | `note_folders` 表 + localStorage 迁移，WebDAV 随库覆盖 |
| P1-2 宪章+页面类型+系统页 | ⚠️ 部分 | 宪章（`docs/notes-charter.md`）与 11 个页面类型模板已落地；**页面类型未入数据模型**（`NoteType` 仍为旧四值，宪章 8 种类型不可存储/检索/校验）；**系统页只有模板、无 Agent 维护机制**；**宪章未注入内置 Agent 提示**（仅外部 Agent 经 SKILL.md 可见） |
| P1-3 Markdown vault | ⚠️ 部分 | 手动双向同步已落地（`noteVault.cjs`）；**`.obsidian/` 推荐配置未生成**；**自定义模板（`_templates/`）未做**；**往返丢失正文富文本结构**（机制见痛点 4 复审注记） |
| P1-4 学术化引用 | ✅ 基本完整 | `[n]` decoration + GB/T 7714/APA 7/IEEE + 工具栏切换均已落地；样式选择存 localStorage 而非设置系统，不随 WebDAV 同步（小项） |
| P1-5 摘录卡体系 | ✅ 完整 | 结构约定、两步 CoT 提炼入口、跨页多段累加、「我的想法」分离、并排预览确认、多模态重识别和聚合管线均已落地；锚点只增不改，重识别快照经确认后以 `aiEnhanced` 留痕 |
| P2-1 旧版 Agent 清理 | ✅ 完整 | 全链路移除，`agentLegacyMode` 设置键静默兼容 |
| P2-2 图谱/列表/体检 | ✅ 主干 | 笔记图谱视图、列表排序与批量打标签/移动，以及体检（孤立/断链/无标题/无标签/陈旧）均已落地 |
| P2-3 Agent Skill 包 | ✅ 完整 | `skills/paperquay-notes/SKILL.md` 已发布 |
| P3-1 Markdown→Tiptap 解析器 | ✅ 完整 | 新增前后端共用 `.cjs` 解析器；vault 回导、MCP create/update、编辑器缺失 JSON 兜底均重建结构化 JSON；未知锚点/未知文献引用保留为普通文本 |
| P3-2 冲突副本 + frontmatter 时钟 | ✅ 完整 | frontmatter `updatedAt` 为主、mtime 为辅；manifest 增加导出时间和内容哈希并兼容旧字符串路径；双侧修改生成 `--conflict-<时间戳>.md`，同步统计/UI 暴露冲突数 |

另：痛点 1 方案中"Agent 回答新增『💾 存为笔记』快捷动作"未落地（阅读器侧栏的"保存为笔记"是既有功能，非本次新增）。实际使用中直接对 Agent 说"存成笔记"即可触发 `write_notes` 审批流，快捷动作属于体验加分项而非能力缺口。

---

## 现状速览（代码证据）

### 笔记子系统其实"底子不差"

- **存储层能力完整**：`electron/backend/noteStore.cjs:33-86` 定义了 `notes`（含 `content_json` Tiptap 文档、`content_text`、`excerpt`、`anchors` 锚点、`deleted_at` 软删除、收藏/置顶）、`note_tags`、`note_links`（笔记双链）、`note_paper_links`（笔记↔文献）四张表，并有 FTS 索引（`syncFtsRow`，`noteStore.cjs:694`）与完整 CRUD（`createNote`/`updateNote`/`deleteNote`，`noteStore.cjs:914/922/936`）。
- **IPC 命令完整**：`electron/backend/noteCommands.cjs:1-35` 暴露 `notes_list/get/create/update/delete/tags/backlinks` 七个命令——**增删改查在后端全部存在，只是没接到 Agent 和 MCP 上**。
- **编辑器功能丰富**：Tiptap 扩展含 `WikiLink.ts`（`[[双链]]`）、`HashTag.ts`、`PaperReference.ts`（文献引用）、`NoteAnchorLink.ts`（可定位到 PDF 页/块的锚点）、`SlashCommand.ts`；另有 AI 润色（`notePolish.ts`，可带知识库范围引用）与参考文献列表自动生成（`noteReferences.ts`）。

### 但三个"断层"让笔记成了孤岛

1. **内置 Agent 断层**：`src/services/agentTools.ts:164-437` 共注册 8 个工具——`search_library`、`read_paper_metadata`、`read_paper_overview`、`rag_search`、`request_paper_context`、`read_paper_figure`、`read_memory`、`write_memory`。**没有任何笔记工具**（连只读的 `search_notes` 都没接）。Agent 的"写工具生成计划→用户审批"模型已经存在，笔记写操作本来可以直接挂进去。
2. **MCP 断层**：MCP 服务 15 个工具中笔记相关仅 `search_notes` 一个，且是只读 LIKE 查询（`knowledgeMcpService.cjs:968-1042`），笔记库以**只读模式**打开（`knowledgeMcpService.cjs:320`）。2026-09-21 的文库写入工具倡议为文献库补齐了 6 个写工具（`import_pdfs`/`manage_category`/`set_paper_categories`/`update_paper`/`delete_papers`/`list_categories`），但笔记被排除在外。
3. **组织断层**：笔记文件夹树存在 **localStorage**（`NotesWorkspace.tsx:46`，键 `paperquay:note-folders:v1`）——不进 SQLite、不随 WebDAV 备份（WebDAV 只上传三个数据库文件）、MCP 与 Agent 完全不可见。模板只有 4 个硬编码段落骨架（`noteEditorUtils.ts:170-231`：文献阅读/方法拆解/实验记录/问答整理），没有索引页、操作日志、页面类型、命名与链接规范等"架构层"概念。

> 🧠 **From Hindsight memory (MCP library write/management tools)** — 文库写工具的护栏设计可直接复用到笔记：`store.save()` 是全量重写，桌面应用运行时的内存状态会静默覆盖外部写入，因此所有写工具默认**显式拒绝**（`assertWritable`/`withWritableLibrary`，`knowledgeMcpService.cjs:1410-1431`），`allowWhileAppRunning: true` 可覆盖，`PAPERQUAY_MCP_WRITE=off` 全局只读。已知限制：进程检测只能发现打包后的 `PaperQuay.exe`，开发模式（`electron .`）下护栏不生效。

---

## 痛点 1：内置 Agent 不能直接与笔记交互

### 原因

- **注册表缺失**：`agentTools.ts` 的工具注册表面向"文献库 + RAG + 记忆"设计，笔记子系统从未被纳入。Agent 循环（`agentLoop.ts`）本身是通用 ReAct 循环、读写工具分离，接入成本主要在工具定义与内容格式转换，不在循环。
- **内容格式门槛**：笔记正文是 Tiptap JSON（`content_json`），Agent 直接产出合法 ProseMirror 文档容易出错；但 `content_text`/`content`（Markdown 风格原文）与 `textFromJsonContent`/`stripHtml`（`noteStore.cjs:297-351`）提供了纯文本往返的现成基础。
- **能力错配**：用户最想要的三类操作——"把这段对话/综述存成笔记""优化这篇笔记""按主题整理笔记"——都只需要 list/get/create/update 四个原语，后端早已齐备（`noteCommands.cjs`）。

### 解决方案

**P0：注册笔记工具组（只读先行，写走审批）**

| 工具 | 类型 | 说明 |
|------|------|------|
| `search_notes` / `list_notes` | 只读 | 复用 `noteStore.listNotes` + FTS；支持按 paperId、tag、folder 过滤 |
| `read_note` | 只读 | 返回标题 + `content_text`（Markdown 化正文）+ 锚点/标签/双链摘要 |
| `create_note` | 写（审批） | 输入 Markdown 正文，服务端经 `notePolishTextToNodes` 类似逻辑转 Tiptap JSON；支持挂 `paperId`、标签、文件夹 |
| `update_note` | 写（审批） | 支持 `append`（追加段落，最安全）、`replace`（全文替换）、`patch-title`/`patch-tags` 等模式；审批卡片展示 diff 摘要 |
| `delete_note` | 写（审批） | 软删除（`deleted_at`），可恢复，风险低 |

- 写工具按既有约定生成**审批计划**而非直接执行（与文献重命名/元数据修改同一语义）。
- Agent 回答中新增"💾 存为笔记"快捷动作作为轻量入口。

**P1：笔记维护型高阶能力**

- "整理某文献的所有高亮→生成精读卡"（聚合 `type='highlight'` 笔记 + 模板）。
- "优化这篇笔记"：复用 `notePolish.ts` 的润色管道，由 Agent 触发并附引用锚点。
- 笔记体检（对应 llm_wiki 的 Lint）：找孤立笔记、断链 `[[wikilink]]`、无标签笔记，产出**修复计划**走审批。

---

## 痛点 2：笔记不方便用外部 Agent（Codex/DSH）维护

### 原因

- **MCP 只读**：笔记库在 MCP 服务里以 `openReadOnlyDb` 打开（`knowledgeMcpService.cjs:320`），写工具为零。外部 Agent 能查不能改。
- **无文件形态**：笔记存于 `paperquay-notes.sqlite`，正文是 Tiptap JSON。Codex/DSH 这类**以文件为中心**的 Agent 面对 SQLite 完全使不上力——这与文献 PDF 形成鲜明对比（PDF 就在磁盘上，外部工具可自由处理）。
- **检索不一致**：MCP 的 `searchNotes` 用的是 `LIKE %q%` 模糊匹配，而应用内走的是 FTS 索引——外部 Agent 拿到的检索质量低于应用内。

### 解决方案

**P0：MCP 笔记写工具（复用既有写路径与护栏）**

完全照搬 2026-09-21 文库写工具的成熟模式：

- 在 `knowledgeMcpService.cjs` 增加 `create_note` / `update_note` / `delete_note` / `list_note_tags` / `get_note_backlinks` 等处理器，**复用 `noteStore` 写路径**（含 FTS 同步、双链解析 `resolveNoteLinks`），并在 `bin/paperquay-mcp.cjs` 注册。
- 护栏原样套用：`assertWritable`（桌面应用运行时默认拒绝 + `allowWhileAppRunning` 覆盖 + `PAPERQUAY_MCP_WRITE=off` 全局只读）。注意笔记库与文库一样是 SQLite，且 MCP 目前以只读打开——写工具需要独立的可写连接，打开前过护栏。
- 正文接口定为 **Markdown 字符串**（外部 Agent 最自然的格式），服务端负责 Markdown→Tiptap JSON 转换；返回时同时给 `content_text`。
- 检索升级为与应用一致的 FTS（读了 `notes_fts` 虚表即可），保持 LIKE 兜底。
- 同步更新 `docs/MCP_AGENT_INTEGRATION.md` 工具表与写入安全章节，补 `tests/knowledgeMcp*.test.ts` 回归。

> 📝 **复审注记（2026-09-26）**：写工具、文件夹管理、护栏与检索升级已按本节落地，集成文档与测试同步齐全；MCP `search_notes` 使用 `notes_fts` 的 trigram FTS5 查询，缺表、异常和少于 3 个字符的短查询回退四字段 LIKE，以兼容旧数据库与中文短词。

> **深入方向 3 落地（2026-09-26）**：保留上述关键词行为；配置阅读器 Embedding 后，MCP 与内置 Agent 同步升级为向量 + FTS5 + RRF。笔记向量复用 RAG 库与 Worker，保存/导入/vault 回导异步增量索引，工具栏可手动重建；软删除与正文签名即时过滤旧向量。无配置或索引不可用时降级并返回 `retrievalMode` / `channels` / `warning`。选址、查询分层、证据排除和未执行手工验证详见 `docs/changes/2026-09-26-notes-semantic-search.md`。

**P1：Markdown 镜像层（让文件型 Agent 直接上手）**

- 将笔记**单向导出/双向同步**为 `<用户目录>/PaperQuay/notes-vault/` 下的 `.md` 文件：YAML frontmatter 存 `id/type/paperId/tags/sources[]`，正文 Markdown，`[[wikilink]]` 原样保留。
- 有了 vault，Codex/DSH 不经过 MCP 也能批量重构笔记；同步器负责 vault→SQLite 的回写（带冲突检测：以 `updated_at` + 内容哈希为准）。
- 这一步同时是痛点 4（Obsidian 兼容）的基础，详见痛点 4。

---

## 痛点 3：笔记没有完善合理的架构与写作模板/标准

### 原因

- **有"编辑器模板"，无"知识架构"**：`NOTE_TEMPLATES` 只是 4 个段落骨架，解决的是"单篇笔记怎么起头"，不解决"几百篇笔记如何组织成一个体系"。
- **缺四样东西**（对照 llm_wiki/Karpathy 模式）：
  1. **目的层**（llm_wiki 的 `purpose.md`）：这个知识库为什么存在、关注什么问题——Agent 每次读写笔记时都应读到它；
  2. **结构规则**（llm_wiki 的 `schema.md`）：页面类型、命名约定、链接约定、标签词表；
  3. **导航与日志**（llm_wiki 的 `index.md`/`log.md`/`overview.md`）：内容目录、操作流水、全局概览——既是人类入口也是 Agent 导航入口；
  4. **持久化的组织元数据**：文件夹树在 localStorage 里，换台机器/重装即丢，Agent 更无从得知。
- 双链、标签、文献关联在**数据库 schema 层面已就绪**（`note_links`/`note_tags`/`note_paper_links`），缺的是"约定俗成"的使用标准。

### 解决方案：PaperQuay 笔记三层架构

```
第 1 层 原始来源（不可变）  —— 文献库 PDF、MinerU 结构块、高亮摘录（已有）
第 2 层 笔记 Wiki（Agent 维护）—— 精读卡 / 概念页 / 主题综述页 / 问答页 / 索引与日志（待建）
第 3 层 Schema（规则与配置）—— notes-charter.md：目的 + 页面类型 + 命名/链接/标签规范（待建）
```

具体落地：

1. **笔记宪章**：在设置或笔记工作区内置一份可编辑的"笔记宪章"（目的、页面类型定义、标签词表、命名约定），Agent 工具调用时注入系统提示；等价于 llm_wiki 的 `purpose.md + schema.md` 合体。
2. **页面类型体系**（复用并扩展现有 `type` 字段或新增 `page_kind`）：
   - `excerpt` 摘录卡（提炼正文 + 来源锚点 + 我的想法，痛点 8 的一等公民）；
   - `paper-card` 文献精读卡（模板已有雏形：研究问题/核心方法/实验与结果/我的判断）；
   - `concept` 概念页（理论、方法、术语——跨文献聚合）；
   - `synthesis` 主题综述页（对应 Agent 的 comparative-survey 产出落盘）；
   - `qa` 问答页（AI 对话存档，`type='ai-chat'` 笔记的规范化去向）；
   - `index`/`log`/`overview` 系统页（Agent 每次批量操作后维护）。
3. **文件夹入库**：把文件夹树从 localStorage 迁移到 notes 库新表 `note_folders`，前端读取改为 IPC；WebDAV 备份随之覆盖；MCP/Agent 立即可见。
4. **模板升级**：`NOTE_TEMPLATES` 扩到页面类型级（每类页面一个模板），并允许用户自定义模板（存库或 vault 的 `_templates/`）。

> 📝 **复审注记（2026-09-26）**：宪章与 11 个模板已落地，但页面类型**没有进入数据模型**——`notes.type` 仍是 `highlight/area/standalone/ai-chat` 旧四值，宪章的 8 种页面类型只存在于模板和文档中，不可检索、不可校验；MCP `create_note` 的 `type` 白名单同样不含它们，外部 Agent 读完宪章传入 `excerpt`/`concept` 会被直接拒绝（宪章与系统能力的硬冲突）。系统页（index/log/overview）只有模板，没有"Agent 批量操作后自动维护"的机制；宪章也未注入内置 Agent 的提示词或 `write_notes` 工具描述。自定义模板未做。以上构成文末 P3-3/P3-4 与深入方向 2。

---

## 痛点 4：笔记查看/写作/管理不如 Obsidian 丝滑

### 原因

- **根本差异是存储形态**：Obsidian = 一文件夹 Markdown 文件，可任意编辑器打开、可 Git 管理、可被任何 Agent 处理；PaperQuay = SQLite + Tiptap JSON，离开应用即不可读。
- **组织数据不持久**：文件夹在 localStorage（见痛点 3），多端/重装即失。
- **管理面短板**：双链数据已入库（`note_links`）且 backlinks 可查，但没有笔记关系图谱可视化（Graph 工作区面向文献）；列表视图的搜索/排序/批量操作弱于 Obsidian 的文件管理 + 插件生态。
- **PaperQuay 的差异化优势不能丢**：PDF 锚点回跳（`NoteAnchorLink` + `noteAnchorLocation.ts`）、文献引用节点、MinerU 块级溯源——这些是 Obsidian 给不了的，方案应是"补齐通用体验"而非"变成 Obsidian"。

### 解决方案

**P1：Obsidian 兼容 vault（核心动作，与痛点 2 的镜像层是同一工程）**

- 笔记双向同步为 Markdown vault，目录即 Obsidian vault（自动生成 `.obsidian/` 推荐配置，照抄 llm_wiki 的做法）：
  ```
  notes-vault/
  ├── index.md            # 笔记目录（Agent 维护）
  ├── log.md              # 操作日志
  ├── overview.md         # 全局概览
  ├── papers/             # 精读卡（按文献）
  ├── concepts/           # 概念页
  ├── synthesis/          # 主题综述
  └── _templates/         # 用户自定义模板
  ```
- frontmatter 携带 `id`（与库中笔记双向锚定）、`paperId`、`tags`、`sources[]`（溯源到文献/页码/块）。
- 查看/写作重度用户可直接用 Obsidian 打开 vault，PaperQuay 端负责锚点回跳与索引维护——**两个应用各取所长，而非互相替代**。

> 📝 **复审注记（2026-09-26）**：同步已落地为**手动触发**（笔记工作区按钮 → `notes_vault_sync_now`），`.obsidian/` 推荐配置未生成。最重要的偏差在**往返保真**：回导时 `contentJson` 被置 null（`noteVault.cjs` 阶段 1），编辑器再打开时按纯文本以空行分段重建——标题层级、列表、加粗、`[[双链]]`、`#标签`、`[n]` 文献引用、锚点链接全部塌成纯文本段落。锚点**数据**（`anchors` 列）经 frontmatter JSON 原样往返、无损；但正文结构损失意味着"在 Obsidian 里改一次，富文本就回不来"。本文档自己定的底线（"往返转换必须保锚点 ID 不丢"）只守住了锚点列数据这一半。修复方案（Markdown→Tiptap 解析器）列为文末 P3-1，是当前最高优先级工程项。

**P2：应用内体验补课**

- 笔记双链图谱（`note_links` 数据已就绪，接入现有 Graph 可视化基础设施）；
- 列表增强：全文搜索（FTS 已在库内）、多条件排序、批量打标签/移动；
- 大纲/反向链接面板常驻（`extractOutline`、`listBacklinks` 均已有实现）。

---

## 痛点 5：残留旧版 Agent 能否彻底清理

### 现状与结论：**可以清理，建议按清单分阶段执行**

legacy 路径的全部残留点（已逐一定位）：

| 残留点 | 位置 |
|--------|------|
| 路径选择函数 | `src/services/agentExecutionMode.ts:4-8`（注释自述："The conservative, user-controlled fallback for the **one-version P3 transition**"——本就是为过渡期设计的） |
| legacy 主实现 | `src/services/libraryAgent.ts:2366` `runLegacyConversationalLibraryAgent`（约 330 行）+ 分支入口 `libraryAgent.ts:2964` |
| legacy 专用辅助 | `libraryAgent.ts`：`generateLibraryAgentPlanOpenAICompatible`（2017）、`decideLibraryAgentPaperContextOpenAICompatible`（2111）、`requestDynamicUserChoices`（2229）、`wireLegacyAgentTurnCancel`（2000）、`legacyAgentAbortError`（1993） |
| 设置项 | `src/types/reader.ts:624`（`agentLegacyMode`）、默认值与归一化 `src/services/readerShared.ts:212,775` |
| 设置 UI | `src/features/reader/readerPreferencesModelsSection.tsx:632-638`（"使用旧版 Agent 路径"开关） |
| 测试 | `tests/agentExecutionMode.test.ts`、`tests/readerSettings.test.ts:79-80` |

### 为什么现在可以删

1. **设计意图已过期**：代码注释明确 legacy 是"P3 过渡一个版本"的保守回退；ReAct 路径默认开启（`agentLegacyMode` 默认 `false`）已历经多个版本（当前 0.1.50）。
2. **legacy 本身是已知 bug 源**：`docs/plans/2026-09-23-agent-module-review-and-fix-plan.md` P1-5 指出 legacy 链路不透传 `AbortSignal`，取消对其完全无效，并必然触发 500ms 强制清理的双 run 竞态。留着它等于留着一个"开了就出问题"的开关。
3. **能力已倒挂**：legacy 路径"不使用多轮读工具、运行轨迹和 token 记账"（设置 UI 自己的说明文字），ReAct 路径功能严格超集。

### 清理清单（建议单独一个 `chore/remove-legacy-agent` 分支）

1. 删 `libraryAgent.ts:2964` 分支与 5 个 legacy 专用函数（注意 `decideLibraryAgentPaperContextOpenAICompatible` 等被 ReAct 路径复用的部分要保留——删前先做调用方核对，上文行号仅供定位）；
2. 删 `agentExecutionMode.ts` 及其测试；
3. 删设置 UI 开关；`readerSettings` 归一化对遗留的 `agentLegacyMode` 键保持**静默忽略**（老用户配置文件不报错）；
4. 删/改相关测试；`npm run check` 全绿；
5. 手工回归：Agent 写操作审批流（重命名/元数据/批量）、流式取消、调研流水线各跑一遍；
6. 写变更记录到 `docs/changes/`。

> 说明：代码库里另有若干 `legacy*` 兼容 shim（如 `readerShared.ts` 的旧模型预设迁移、`paperHistory.ts` 的历史会话迁移），它们是**一次性数据迁移代码**，与"旧版 Agent 执行路径"无关，不影响用户感知，可不在本次清理范围。

---

## 痛点 6：llm_wiki 参考项目——可借鉴模式映射

[nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) 是 Karpathy "LLM Wiki" 模式的桌面应用实现（Tauri + React），核心理念：**知识被编译一次并持续维护，而不是每次查询时重新推导**。与 PaperQuay 的映射如下：

| llm_wiki 模式 | PaperQuay 现状 | 建议采纳度 |
|---------------|----------------|------------|
| 三层架构：Raw Sources（不可变）→ Wiki（LLM 生成）→ Schema（规则） | 第 1 层（文献库/PDF/MinerU）完整；第 2 层只有散装笔记；第 3 层缺失 | ★★★ 直接采纳（痛点 3 方案） |
| `index.md` / `log.md` / `overview.md` | 无 | ★★★ 采纳，作为 Agent 维护的系统页 |
| `purpose.md`（知识库的目的，每次 ingest/query 注入 LLM） | 无 | ★★★ 采纳为"笔记宪章"的一部分 |
| YAML frontmatter + `sources[]` 溯源 | 笔记有 `anchors`/文献关联（库内），但无文件形态 | ★★★ 随 vault 同步落地（痛点 2/4） |
| `[[wikilink]]` + Obsidian 兼容 | 编辑器有 WikiLink 扩展，库有 `note_links` 表；无 vault | ★★★ vault 方案天然获得 |
| 两步 CoT Ingest（先分析后生成） | 无对应流程（笔记由用户手写或 AI 润色） | ★★ 采纳到"文献→精读卡"自动化 |
| Lint 操作（断链/孤立页/健康检查） | 无 | ★★ 采纳为笔记体检工具（Agent 触发+审批修复） |
| 本地 HTTP API + MCP + 一键安装 Agent Skill | 有 MCP（stdio，15 工具），无 HTTP API，无 Skill 包 | ★★ MCP 先行；Skill 包（`npx skills add` 式）值得做，降低 Codex/DSH 接入成本 |
| 4 信号知识图谱 + Louvain 社区 + 图谱洞察 | Graph 工作区面向文献 | ★ 远期参考，先把笔记双链接入现有图谱 |
| Review 异步人工审核队列 | Agent 有审批计划（同步） | ★ 远期参考 |
| 向量检索（LanceDB） | 已有更完整的混合检索（向量 + FTS5 + RRF） | 不需要 |
| Rust Chat Agent / 多会话持久化 | Agent 模块已有（ReAct + 三层记忆 + run 事件） | 不需要 |

**不需要照搬的部分**：llm_wiki 的文档解析、网页剪藏、Deep Research 等面向"通用文档知识库"的能力，PaperQuay 以 MinerU/RAG/文献管理对等或超越。借鉴重点是它的**知识组织架构与 Agent 可维护性设计**，不是功能清单。

---

## 痛点 7：笔记中的文献引用格式不学术

> 用户要求（2026-09-24 补充）：笔记对文献的引用应当**学术化**——有规范的参考文献列表；点击引用可**跳转到相应文献的相应页码**；但引用格式以**整篇文献**为单位。

### 现状：基础比想象中好，差最后一步格式

已实现的能力：

- **跳转链路已打通**：内联 `paperReference` 原子节点（`src/features/notes/extensions/PaperReference.ts:22-157`）的 attrs 含 `paperId/label/anchorId/blockId/pageIndex/sourceType`；点击插件读取 `data-page-index` 等属性并回调 `onClick(paperId, location)`——"跳到这篇文献的这一页/这一块"今天就能用。
- **"以整篇文献为单位"的聚合语义已正确**：`extractNoteReferences`（`noteReferences.ts:63-125`）从文档实时派生参考文献列表，**按 paperId 去重、按首次出现排序**，并聚合每篇文献的引用位置（最多 4 个）；`upsertNoteReferenceList`（:176-205）在文末插入/替换"参考文献"有序列表；入口已有两个：润色完成时自动生成（`NoteEditor.tsx:772`）与工具栏手动按钮（`NoteEditorToolbar.tsx:302-307`）。
- **元数据完全够用**：`LiteraturePaper`（`src/types/library.ts:71-104`）带 `authors/year/publication/volume/issue/pages/doi/url/itemType/publisher`，甚至有预生成 `citation` 字段——学术格式需要的数据一个不缺，只是没有被用到。

差距（对照学术写作惯例）：

1. **内联呈现不是学术式**：引用渲染为 `@标题` 芯片（`PaperReference.ts:95`）。学术惯例是顺序编码制 `[1]`（GB/T 7714、IEEE）或著者-出版年 `(Smith, 2020)`（APA）——芯片显示标题既占版面，导出/打印后也不是合法引用标记。
2. **列表格式过于简式**：`formatReferenceListEntryText`（`noteReferences.ts:131-140`）只拼"标题. 作者. 年份."，缺期刊/会议名、卷(期):页码、DOI。
3. **内联标记与列表编号未同源**：有序列表的序号是渲染层隐式产物，内联芯片没有编号——在中间插入一条引用，全文序号无法自动重排（这正是学术编辑器必须自动做的事）。
4. **导出无约定**：痛点 2/4 的 Markdown/vault 方案里，引用如何序列化尚未定义。

### 解决方案（P1：学术化引用体系）

1. **内联引用编号化（单一事实源派生）**
   - `extractNoteReferences` 已给出"首次出现顺序 + paperId 去重"的稳定编号——它就是唯一事实源；
   - 编辑器内用 **decoration 渲染** `[n]` 角标，**不改** `paperReference` 节点及其 attrs（编号写进文档会导致任何插入/删除都级联改写全文档，污染 diff 与撤销栈）；
   - 点击 `[n]` 仍走现有 `onClick(paperId, location)`——**跳转到文献相应页码的行为完全保留**；
   - 引用以**整篇文献**为单位：同一 paperId 多处引用共享同一编号（顺序编码制惯例）；页码/块位置仅作跳转数据携带在节点上（现状已如此），不进入引用文本、也不在列表中展开为多条；
   - 可选著者-出版年样式（APA 场景）：decoration 渲染 `(第一作者, 年份)`。
2. **文献列表学术化**
   - 新增样式化格式化器 `formatBibliographyEntry(paper, style)` 替代 `formatReferenceListEntryText`，默认 **GB/T 7714-2015 顺序编码制**（中文场景），可选 APA 7 / IEEE；
   - 数据组装优先级：库内结构化字段（authors/year/publication/volume/issue/pages/doi）→ `paper.citation` 预生成串兜底 → 标题兜底；
   - 列表项保留现有位置芯片：点击仍跳文献页码。
3. **样式配置**：设置项 `noteCitationStyle: 'gbt7714' | 'apa7' | 'ieee'`（默认 `gbt7714`），工具栏可即时切换；切换只影响渲染与列表文本，不改文档数据。
4. **导出约定**：Markdown/vault 序列化时内联渲染为 `[n]`、文末附同序文献列表文本；`[n]` 与 frontmatter 的 `sources[]`（paperId）一一对应，外部 Agent 可据此重建引用关系。
5. **Agent 集成**：Agent 写笔记（痛点 1）涉及文献引用时统一写 `paperReference` 节点（paperId + 可选页码），由上述管线自动编号、自动维护文献列表——**Agent 永远不手写引用文本**。

---

## 痛点 8：提炼式摘录笔记如何融入体系

> 用户场景（2026-09-24 补充并澄清）：多数时候不是原模原样摘录——一大段甚至好几页的内容，只提炼其中几句、几段，还会做改写，加上自己的思考，形成一条笔记。MinerU 识别/排版质量差，提炼时可能让 AI 先重新识别、优化排版。这类笔记能否被整理融入体系？

**答案：能，而且比"逐字引用"模型更顺——提炼式摘录的正文就是你的智力产出（第 2 层 Wiki 内容），AI 参与重识别/提炼/排版没有任何红线冲突。真正需要保真的不是你的提炼文字，而是来源锚点与原文快照。**

### 现状：划词成卡链路已存在，但模型假设与实际用法错配

已实现的能力：

- **划词成卡**：阅读器选中内容 → `createSelectionNoteDraft`（`src/features/notes/noteUtils.ts:67-92`）自动生成 `type='highlight'` 笔记：原文进引用块、自动创建锚点（页码 / blockId / pdfLocation）、标题从摘录截取，并经 `note_paper_links` 挂到文献；笔记侧栏有专门的 "PDF" 筛选（`NotesSidebar.tsx:62`）。
- **溯源已闭环**：摘录卡上的锚点可一键跳回 PDF 对应页/块（`NoteAnchorLink` + `buildNoteAnchorPdfHighlightTarget`）。
- **多锚点已可表示**：`notes.anchors` 是数组（`noteUtils.ts:88` 目前只放一个），一条笔记挂多个来源锚点在数据模型上没有障碍。

差距：

1. **"原文引用块"模型与提炼式用法错配**：现有流程把 MinerU 识别文本原样塞进 `>` 引用块——但你要的不是它，你要的是"以此为原料提炼出的几句话"。MinerU 的识别/排版质量直接决定了卡的观感，而你的改写、你的思考在结构上混成一团。
2. **提炼 ↔ 来源的对应粒度太粗**：跨几页提炼成一段时，现有流程一次划词一个锚点，没有"一条提炼 ← 多段来源"的操作路径（数据模型支持，交互不支持）。
3. **摘录卡是终点而非起点**：摘录卡落地后即成孤岛——没有机制把一篇文献的 N 张摘录聚成精读卡，更没有按主题**跨文献**聚成概念页。
4. **划词时没有"顺手提炼+记想法"的入口**：`buildSelectedExcerptNoteCreateRequest`（`documentReaderNotes.ts:196-213`）直接建卡，提炼和想法要事后找到卡再补——打断阅读心流。

### 解决方案（P1：摘录卡一等公民化）

**边界澄清（修订版）：分层依据是"内容性质"，不是"时间"。** 三类内容三种规则：

| 内容 | 层 | 规则 |
|------|-----|------|
| **原文快照**（可选附件，逐字） | 第 1 层原始来源 | 不可变——AI 重识别可生成它，但入库后只可"生成新版本→用户确认替换"，不可顺手改写 |
| **提炼正文**（你的浓缩/改写） | 第 2 层 Wiki 内容 | **完全可自由编辑**——AI 参与提炼/排版是你的写作助手行为，无任何红线；Agent 日后整理时可修改，走审批 |
| **来源锚点** | 溯源证据 | 必须真实指向提炼所依据的原文位置——Agent 只可新增，不可改指、不可伪造。这是整个体系的信任根基 |

0. **捕获时 AI 提炼管线（ingest-time）**
   - 划词/框选（支持多段、跨页累加）→（可选）AI 重识别原料（公式/表格送区域截图给多模态模型重建 LaTeX/三线表，纯文本送 MinerU 块+相邻块）→ AI 按你的意图浓缩/改写/排版 → **并排预览**（原始识别 vs 提炼稿）→ 确认入库；
   - 每段来源自动生成一个锚点，提炼正文与锚点分离——**正文是你的话，锚点是证据**；
   - 可选勾选"保留原文快照"：需要逐字核对时挂载（折叠显示、打 `aiEnhanced` 标记）；不需要就只要锚点——锚点随时跳回 PDF 看原文，PDF 才是终极事实源。
1. **结构约定：摘录卡 = 提炼正文 + 来源锚点（+ 可选原文快照 +「我的想法」区）**
   - 模板：`提炼正文`（若干段，自由格式，段末/块级挂锚点）→ `💭 我的想法：` 区；
   - 「提炼」与「我的想法」分区，因为二者性质不同：提炼是对文献的忠实浓缩（Agent 可据锚点核对），想法是你的独立观点（Agent 只可引用，不应当"修正"）。
2. **聚合管线（摘录卡是起点，不是终点）**
   - **文献内**：一篇文献的 N 张摘录卡 → 精读卡（paper-card），精读卡每个要点回链 `[[摘录卡]]`；
   - **跨文献**：按标签/主题把多篇文献的摘录聚成概念页（concept）；概念页中每条来源以 `[[摘录卡]]` + 文献引用 `[n]` 呈现（自动进入痛点 7 的规范文献列表）；
   - 溯源链全程可跳：**概念页观点 → 摘录卡 → 锚点 → PDF 页码/块**，一路点回原文。
3. **阅读器入口优化**：划词菜单加"提炼成笔记"——唤起 AI 提炼面板（可先重识别），顺手写想法，一步完成，不打断阅读。
4. **Agent 集成**："把我关于 X 主题的散摘录整理成概念页"成为 Agent 高阶指令——`search_notes` 按 `type='highlight'` + 标签/文献过滤（type 字段已在库），聚合产出草稿走写审批；Agent 可编辑提炼正文（审批后），**不可改动锚点指向与原文快照**。

> 📝 **复审注记（2026-09-26）**：提炼结构、划词入口（"AI 提炼为摘录卡"）、跨页多段累加、「我的想法」分离均已落地，且累加时锚点只增不改，与本节设计一致。未落地的有三块：(a) **并排预览确认**——现在是提炼完直接入库/追加，事后在编辑器里改，没有"原始识别 vs 提炼稿"的对照确认步；(b) **多模态重识别**——当前提炼管线只接受文本输入，公式/表格的区域截图重建未接入；(c) **聚合管线**——"N 张摘录卡→精读卡""跨文献→概念页"没有专门能力，只能笼统指挥 Agent 即兴完成。三项列入文末深入方向 1 与 5。

---

## 方案设计评审（2026-09-26）

> 本节评审各痛点**解决方案本身的设计质量**（区别于「落地状态核对」的实现对照视角）：哪些决策是对的、哪些不合理或欠考虑、哪些只给了方向没给机制。

### 总评

痛点识别与现状证据质量高，复用既有基础设施的决策（审批计划模型、MCP 写护栏、decoration 派生引用编号）都正确。主要缺陷集中在三点：**全方案最硬的技术问题没有专项设计**；若干部件只给了方向、没给机制；**路线图缺依赖分析**。

### 痛点 1（Agent 笔记工具）—— 设计合理，一处严重低估

- 正确：只读先行、写走审批、复用既有审批计划模型，接入成本判断准确。
- 缺陷：`create_note` 的"服务端经 notePolishTextToNodes 类似逻辑转 Tiptap JSON"把全局最硬的正确性问题（Markdown ↔ 富节点的双向转换）一句话带过。内置 Agent、MCP、vault **三条写路径最终都撞在这堵墙上**（实现期统一退化为纯文本重建，见痛点 4 复审注记）。
- 修正：设**共用序列化专项**作为一切写路径的前置底座——自定义节点的 Markdown 表示规范（锚点 `paperquay://anchor/<id>`、`[n]` 引用 + 文末列表、`[[wikilink]]`、`#tag`、转义规则）+ 双向解析器 + 往返保真测试。散见本方案各处的格式约定应收拢进这一份规范（即文末 P3-1，优先级应提到最高）。

### 痛点 2（MCP 写工具）—— 复用决策正确，两处语义未定义

- 正确：完全复用文库写工具的护栏与 `noteStore` 写路径，是最省事也最安全的路线；FTS 升级方向正确。
- 缺陷：(a) 未定义 MCP 写入后 `contentJson` 的归属语义（立即重建还是编辑器懒重建）——与痛点 1 同源，应由共用序列化专项统一回答；(b) 内置 Agent 侧定义了 `append`/`replace`/`patch` 模式，MCP `update_note` 未对齐定义，两个写入口的语义会漂移。

### 痛点 3（宪章 + 页面类型）—— 方向正确，关键决策暧昧

- 缺陷 a："复用并扩展现有 type 字段**或**新增 page_kind"留了二选一。旧 `type` 是来源语义（highlight/area/standalone/ai-chat），页面类型是结构语义（paper-card/concept/…），维度不同——应明确**新增 `page_kind` 列**，并定义旧值映射与迁移。
- 缺陷 b：宪章形态不明。"设置或笔记工作区内置一份可编辑宪章"（应用内数据、用户可改、Agent 可注入）与落地形态（repo 里的 `docs/notes-charter.md`，只能约束开发者与读文档的外部 Agent）是两回事。计划应明确：存储位置、编辑入口、注入机制（注入到内置 Agent 提示词的哪一段、token 预算多少）。
- 缺陷 c：系统页（index/log/overview）只有"Agent 每次批量操作后维护"一句——无触发机制（挂在 `write_notes` 成功钩子上？定时？用户指令？）、无漂移处理（Agent 漏维护、用户手改怎么办）。llm_wiki 的这个模式恰恰依赖强制钩子，不是自觉。

### 痛点 4（Markdown vault）—— 风险认知到位，工程设计不足

- 缺陷 a（**内部不一致**）：路线图 P1-3 直接写"双向同步"，风险章节却建议"先单向导出 + 变更检测回写"——分期没有写进方案主线。修正：**阶段一** 库→vault 单向只读镜像（零风险，先赢信任）→ **阶段二** 变更检测回写（带冲突副本）→ **阶段三** Obsidian 深度集成，每阶段独立验收。
- 缺陷 b（依赖缺失）：vault 导出约定（`[n]` + 文末文献列表）依赖痛点 7 的设计，路线图却把 P1-3 排在 P1-4 之前。
- 缺陷 c（验收太弱）："锚点回跳不回归"不等于往返保真。最危险的部件需要最严的验收——导出 → 外部编辑 → 回导 → 再导出，锚点 ID / 引用编号 / 双链 / 标签逐项存活，并固化为自动化测试。
- 缺陷 d（场景缺失）：未写明同步的规模假设（全量扫描在数百至一两千篇笔记内可接受）；WebDAV（同步库）× vault（本地目录）双通道在多设备上的分叉场景完全未讨论——已补入风险章节。

### 痛点 5（legacy 清理）—— 设计良好

清单式 + 设置键静默兼容 + "删前先做调用方核对"的提醒，无需修改。

### 痛点 6（llm_wiki 映射）—— 筛选克制

采纳度分级合理、明确"不照搬功能清单"的边界正确。小疵：两步 CoT 标了 ★★ 却没进路线图（孤儿项），其正确归属是痛点 8 的提炼管线（实现期已如此归并）。

### 痛点 7（学术引用）—— 核心决策正确，架构考虑不全

- 正确：decoration 派生编号（单一事实源、不污染文档与撤销栈）是全方案最漂亮的一笔。
- 缺陷：未考虑格式化器的多端重复——前端 TS 与后端 CJS 互不能 import，手写 3 样式 × 2 端 = 6 份实现（实际已出现 `bibliography.ts` 与 `noteVault.cjs` 双份 GB/T 7714，靠注释"改动时请同步两侧"维系）。修正方向二选一：(a) 格式化逻辑放双端可 import 的共享纯 JS 模块；(b) 评估 citeproc-js + CSL 样式——学术引用场景的标准答案，一次集成获得上千种期刊样式，代价是包体积与集成复杂度。计划应写明取舍。

### 痛点 8（摘录卡）—— 内容分层模型优秀，管线设计欠深度

- 正确：快照/提炼/锚点的三层内容性质划分 + "提炼可以自由，证据必须保真"，是全方案最有设计感的部分。
- 欠深 a：聚合管线（摘录→精读卡→概念页）只有方向没有机制——触发方式（Agent 高阶指令？模板配方？）、召回依据（仅 tag/type 过滤够吗？是否需要语义检索？）、产出组织（回链格式、文献列表自动维护）均待定。这是"融入体系"承诺兑现的关键，建议补专项设计（见复审结论深入方向 1/3）。
- 欠深 b：多模态重识别只有一句"送区域截图给多模态模型"——模型选型、触发时机（自动检测公式/表格块还是用户勾选）、成本与延迟预算、与既有 `agentVision.ts` 基础设施的关系，均未定。

### 路线图层面的两个问题

1. **缺依赖分析**：P1-3(vault) 依赖 P1-4(引用导出约定) 与 P1-2(page_kind/宪章)；聚合管线依赖 page_kind。动手顺序应按依赖重排，而非按痛点编号。
2. **打包粒度过大**：8 个痛点的 P0–P2 挤在一个版本落地（实际 v0.2.0 单 commit 4600+ 行），违背本仓"改动可追踪、可回滚"的惯例——后续同等规模的改造，计划应要求按痛点拆分支、拆提交。

---

## 总体路线图建议

| 阶段 | 内容 | 解决痛点 | 验收标准 |
|------|------|----------|----------|
| **P0-1** | `agentTools.ts` 注册笔记只读工具（`search_notes`/`read_note`） | 1 | Agent 能回答"我的笔记里关于 X 写了什么" |
| **P0-2** | 笔记写工具（create/update/delete）走审批计划 | 1 | "把这次调研存为精读卡"全链路走通，审批卡片可看 diff |
| **P0-3** | MCP 笔记写工具 + FTS 检索升级 + 护栏复用 | 2 | Codex/DSH 经 MCP 完成笔记增删改；应用运行时默认拒绝写入 |
| **P1-1** | 文件夹入库（`note_folders` 表 + 迁移 + WebDAV 覆盖） | 3/4 | 重装/多端文件夹不丢；MCP 可见 |
| **P1-2** | 笔记宪章 + 页面类型 + 系统页（index/log/overview） | 3 | Agent 批量整理笔记时遵循宪章；`npm run check` 全绿 |
| **P1-3** | Markdown vault 双向同步 + Obsidian 兼容 | 2/4 | vault 可用 Obsidian 打开；外部编辑能回写库；锚点回跳不回归 |
| **P1-4** | 学术化引用体系（[n] decoration + GB/T 7714/APA/IEEE 文献列表 + 样式设置） | 7 | 同一文献多处引用同号；插入中间引用全文自动重排；点击 [n] 跳文献页码；Markdown 导出含 [n] 与规范列表 |
| **P1-5** | 摘录卡体系（结构约定 + 模板 + 划词提炼入口 + 聚合管线） | 8 | 提炼与想法结构分离；划词可一步"多段选取+AI 提炼+写想法"；一条提炼可挂多个来源锚点且跳回准确；锚点与原文快照不被 Agent 改写，提炼正文可自由编辑 |
| **P2-1** | 旧版 Agent 清理 | 5 | 按清单执行，设置键兼容，`npm run check` + 手工回归通过 |
| **P2-2** | 笔记图谱、列表增强、笔记体检（Lint） | 3/4 | 孤立笔记/断链可被发现并生成修复计划 |
| **P2-3** | PaperQuay Agent Skill 包（面向 Codex/DSH 一键接入） | 2 | `npx skills add` 式安装后外部 Agent 开箱即用 |

> 依赖提醒（2026-09-26 复审补）：P1-3 依赖 P1-4 的引用导出约定与 P1-2 的 page_kind/宪章；P1-5 的聚合管线依赖 page_kind。实际动手顺序应按依赖重排，上表顺序仅为痛点编号线索。

## 风险与边界

- **双写一致性（2026-09-26 复审：本条承诺未兑现，风险已部分成为现实）**：实际实现（`noteVault.cjs`）为手动触发的全量双向同步，新旧判定用**文件 mtime 与 `updatedAt` 的 1 秒容差比较**——没有采用本条原先要求的"内容哈希 + 冲突副本"。后果：同一笔记在应用内与 Obsidian 侧都被修改后再同步，**mtime 较新的一方静默胜出，另一方的修改被无提示丢弃**。导出后已用 `utimesSync` 对齐 mtime 消除导出-导入乒乓，正常交替编辑是安全的；风险集中在"两侧都改"的场景。修复项见文末 P3-2（以 frontmatter `updatedAt` 为主时钟、双侧变更检测、`--conflict-<时间戳>.md` 副本）。
- **MCP 写护栏的已知盲区**：进程检测只认打包后的 `PaperQuay.exe`，开发模式下护栏不生效（既有问题，非本次引入）；笔记写工具同样受其约束，文档需如实说明。
- **Tiptap JSON 是唯一事实源**：Markdown 是交换格式，锚点节点/文献引用节点等自定义节点需要定义明确的 Markdown 序列化约定（如链接式锚点语法），往返转换必须保锚点 ID 不丢——这是 vault 方案的正确性底线。（2026-09-26 复审：序列化约定已定义为 `paperquay://anchor/<id>` 链接与 `[n]`+文末 GB/T 7714 列表，但**只实现了单向序列化，没有反向解析**——回导时 `contentJson` 置 null，底线只守住了锚点列数据那一半，正文富节点全部损失。）
- **编号一致性**：内联 `[n]` 必须用 decoration 从 `extractNoteReferences` 实时派生，绝不能把编号写进 `paperReference` 节点属性——否则任何一处引用增删都会级联改写全文档（diff 噪音 + 撤销栈污染）；编号只是呈现层状态。
- **锚点与快照必须保真**：提炼正文是用户的可编辑财产（AI 提炼/排版、Agent 审批后修改都允许），但 (a) 来源锚点必须真实指向提炼所依据的原文位置，Agent 只可新增锚点、不可改指或伪造；(b) 若附原文快照（逐字），快照不可被改写——AI 重识别版替换需用户确认并打 `aiEnhanced` 标记留痕。**提炼可以自由，证据必须保真**。
- **旧版 Agent 清理前**先确认无用户依赖开关（可在变更记录中注明移除版本，必要时报一次 deprecation 警告再删）。
- **多设备分叉场景（2026-09-26 复审补）**：WebDAV 同步的是三个数据库，vault 是每台设备自己的本地目录——两台机器各自跑双向同步时，库内容经 WebDAV 合并、vault 文件各自演化，同一笔记在不同设备上的 vault 文件可能长期不一致；方案未给出该场景的任何约定（至少应声明 vault 不作同步媒介、以库为准）。
- **同步规模假设（2026-09-26 复审补）**：当前为手动触发的全量扫描同步，数百至一两千篇笔记内可接受；笔记量再上量级或改为自动同步前，需要增量机制（manifest 已记录路径，可按 mtime/哈希预筛）。
- 本文档为分析提案，实施前建议在 `docs/plans/` 拆出单项实施计划；`scripts/` 下的个人脚本与数据不属于仓库内容，任何方案都不应依赖它们。

---

## 复审结论与后续路线（2026-09-26）

> 本节为 2026-09-26 对本文档的代码级复审。复审方法：对照 v0.2.0（commit `d092d2f`）逐项核验实现文件（`agentTools.ts`/`agentNotePlan.ts`/`noteVault.cjs`/`bibliography.ts`/`noteDistill.ts`/`noteHealth.ts`/`NotesGraphView.tsx`/`noteStore.cjs`/`knowledgeMcpService.cjs`/`bin/paperquay-mcp.cjs`）、MCP 工具注册表、数据模型与测试；`npm test` 487 例全绿。

### 一、文档表述修正（本次复审已改）

1. **状态核对已完成**：2026-09-26 本轮补齐提炼并排预览、多模态重识别和 `aiEnhanced` 留痕；结合此前 P3-1～P3-8 的落地，本文档计划项与深入方向均已完成。各项仍保留实现收窄、风险边界和未执行的桌面手工回归说明。
2. **风险承诺与实现脱节**：原文写明"宁可通过冲突副本暴露问题也不要静默覆盖"，实现却是 mtime 静默覆盖——风险章节已改写为实际状态与修复项。
3. **`docs/notes-charter.md` §5 失实**：仍称 vault 同步为"规划中（P1-4）"，编号亦与本文档（P1-3）不一致——已随本次复审更正为已落地状态及其实际行为。

### 二、复审新发现的设计问题（原文未覆盖）

1. **宪章页面类型与系统能力硬冲突**：宪章定义 8 种页面类型，但 `NoteType` 与 MCP `create_note` 的 `type` 白名单只有旧四值（`highlight/area/standalone/ai-chat`）。外部 Agent 读宪章后传入 `excerpt`/`concept` 会被 schema 直接拒绝——宪章承诺的类型体系在系统里不存在。
2. **双链改名脆弱性有数据依据**：`note_links` 按 `target_note_id` 存储（改名后存量链接安全），但正文 `[[标题]]` 重新解析时按标题匹配——目标笔记改名后，其他笔记再次保存即丢链。宪章只要求"改名时请全局搜索旧标题"，没有任何工具支撑这个动作。
3. **引用样式存 localStorage**：与本方案声称的"设置项"不符，不随 WebDAV 同步，换机即丢。
4. **vault 同步曾纯手动**：复审时无启动时同步、定时或文件 watcher；本轮已补启动时静默同步和可选定时同步，仍未加入 OS watcher。
5. **同步时钟依赖 mtime**：云同步工具（OneDrive 等）与部分编辑器会改写 mtime，以其为唯一新旧依据不够稳健；frontmatter 里已写 `updatedAt` 却未被用于判定。

### 三、值得优化（建议 P3 路线，按价值/成本排序）

| 优先级 | 事项 | 价值 | 成本 |
|--------|------|------|------|
| P3-1 | **Markdown→Tiptap 解析器**（vault 导入与 MCP 写入共用）：分级支持——先标题/列表/加粗斜体/代码块/引用块/`[[双链]]`/`#标签`，再 `paperquay://anchor` 链接重建锚点节点、`[n]`+文末列表重建 paperReference | 一趟解决 vault 往返塌格式与 MCP 写入无富文本两个最大短板；`notePolish.ts` 已有受限版 Markdown→节点转换器可作起点 | 中 |
| P3-2 | **冲突副本 + frontmatter 时钟**：双侧变更生成 `--conflict-<时间戳>.md` 并计入同步统计；新旧判定以 frontmatter `updatedAt` 为主、mtime 为辅 | 消除静默丢数据，兑现本文档原始承诺 | 低 |
| P3-3 | ✅ **已落地**：`notes.page_kind` 入库，旧 `highlight/ai-chat` 幂等映射为 `excerpt/qa`，其余旧类型保留 `NULL`；编辑器模板、侧栏、内置 Agent、MCP 和检索过滤已接通并有白名单校验 | 让宪章可校验、可检索；聚合管线（深入方向 1）的前置 | 中 |
| P3-4 | ✅ **已落地**：宪章红线、聚合配方、体检修复和系统页维护规则已注入内置 Agent 系统提示与 `write_notes` 工具描述 | 内置 Agent 与外部 Agent 行为对齐 | 低 |
| P3-5 | ✅ **已落地**：MCP `search_notes` 使用 `notes_fts` trigram FTS5，保留缺表/异常/短词 LIKE 兜底，并组合 `paperId`、`pageKind` 过滤与稳定排序 | 兑现 P0-3 未竟项，内外检索质量对齐 | 低 |
| P3-6 | ✅ **已落地（方案 b）**：wikiLink 节点存 `noteId` + 标题快照，解析、关系维护、显示和 vault 导出以 ID 优先；Markdown 仍保持 `[[标题]]` | 消除宪章已承认但无工具支撑的断链来源 | 中 |
| P3-7 | ✅ **已落地**：笔记工作区挂载时对已配置 vault 静默同步一次；可选 15–60 分钟定时同步，默认关闭；未加入 OS watcher | 双应用协作不断点 | 低 |
| P3-8 | ✅ **已落地**：引用样式迁入阅读器设置并兼容旧 localStorage 一次性迁移；笔记列表支持更新时间/创建时间/标题排序，以及标签/文件夹批量操作 | 小项补齐 | 低 |

### 四、值得深入（下一阶段方向）

1. ✅ **已落地，聚合管线（痛点 8 的终点）**："这篇文献的散摘录→精读卡""主题 X 的跨文献摘录→概念页"通过 Agent 配方实现——使用 `pageKind='excerpt'` 与文献/标签/关键词召回，产出走既有 `write_notes` 审批，回链 `[[摘录卡]]`；`[n]` 与唯一参考文献条目由 P3-1 解析为 `paperReference`。
2. ✅ **已落地，系统页自动维护**：批准的 Agent 笔记写入成功后追加 `log`，每累计 5 个成功写操作刷新 `index`/`overview`；系统页使用 `pageKind` 与首行 hash 标记判定漂移，用户手改后跳过覆盖。
3. ✅ **已落地，笔记语义检索**：复用阅读器 Embedding 配置和 RAG Worker，将笔记正文 chunk 存入现有 RAG 库，以向量 + FTS5 + RRF 同时支持内置 Agent 与 MCP；保存/导入/vault 回导异步索引，支持手动重建与软删除即时失效，未配置时保留 FTS/LIKE 降级。锚点与原文快照不进入向量语料。详见 `docs/changes/2026-09-26-notes-semantic-search.md`。
4. ✅ **已落地，体检 → 修复闭环**：体检报告可通过“让 Agent 修复”载入 Agent，生成 `write_notes` 修复计划并等待审批；删除类操作默认只列清单，断链修复优先按既有 `noteId` 重挂。
5. ✅ **已落地（2026-09-26）**：提炼结果并排预览（原始识别 vs 可编辑提炼稿）确认再入库，追加场景预览完整合并结果；公式/表格选区可勾选送区域截图给共享视觉模型重建 LaTeX/Markdown 表格。无视觉能力时选项置灰；重识别失败自动回退纯文本提炼；确认后的原文快照写入 `aiEnhanced` 留痕，取消不产生任何写入。
