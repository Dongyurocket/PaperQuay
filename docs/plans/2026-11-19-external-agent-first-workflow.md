# PaperQuay 外部 Agent 优先工作流实施计划

> 按 `executing-plans` 逐阶段执行：先完成阶段 0 的 PaddleOCR-VL 退役，再建立安全的 MCP 运行时写入；每阶段先写定向测试并单独提交；阶段 1 完成前不开放应用运行期间的 MCP 文库写入。

**Goal:** 退役 PaddleOCR-VL，移除独立 Agent 与笔记内 AI 写作入口，保留侧边问答；让外部 Agent 通过可靠的 MCP 与 Skills 操作文献、证据和笔记，并改善 Vault 同步与图谱关系管理。

**Architecture:** 先以阶段 0 统一 MinerU 解析路径，再建立可在桌面应用运行期间安全写入的增量路径，随后收敛引用、图表检索、模型上下文预算和 Vault 冲突处理；外部 Agent 的新能力优先通过标准 MCP 工具和仓库 Skills 提供，不再建立第二套 Agent 运行时。

**Tech Stack:** React/TypeScript、Electron IPC、SQLite、MCP stdio、MinerU 结构块、Tiptap JSON 与 Markdown Vault、Node.js `node:test`。

---

- 日期：2026-11-19
- 状态：已实施（2026-11-19）；实现与验证见 `docs/changes/2026-11-19-external-agent-first-workflow.md`
- 基线：`main` @ `99237b7`（v0.4.31）；审阅时工作区只有未跟踪的本地脚本与本计划，无已跟踪改动。实施前复核目标分支与已有未提交改动。
- 关联规范：[MCP Agent 接入](../MCP_AGENT_INTEGRATION.md)、[笔记宪章](../notes-charter.md)、[UI 设计系统](../ui-design-system.md)

## 目标与边界

1. 移除独立 Agent 工作区、其桌面端执行入口和笔记编辑器内独立的 AI 润色/写作入口。保留阅读器侧边问答、模型配置、文献库、图谱与手工笔记编辑。
2. 侧边问答支持当前文献默认检索、用户选择的其他文献，以及显式开启的全库范围。回答按段落关联实际依据；文字块、图片和表格均归入“具体证据引用”，另一类是“文献级引用”。
3. 改善 PaperQuay 与 Vault 的双向同步及冲突处理。遵守笔记宪章：Tiptap JSON 仍是应用内部事实源，Markdown 是可由外部编辑并同步的表示；不丢失锚点、摘录快照、双链和表格。
4. 将 MCP 作为核心集成接口：支持证据检索与读取、笔记维护、完整白名单元数据修改、分类管理、文献删除及按明确选择删除 PDF。运行中的 PaperQuay 与 MCP 写操作必须避免相互覆盖，并刷新或提示正在编辑的界面。
5. 保留人工自定义关系并优化新建、编辑、删除流程。移除 AI 关系类型，禁止新建，并清理已存的 `ai_suggested` 关系。
6. 首版不新增图像向量索引、远程服务、任意 SQL 接口或新的 Agent 编排层。图片检索优先使用已有图注/块文本；命中后按需读取图片供支持视觉输入的模型查看。表格优先使用 MinerU 已提取的文本与结构。

### 范围判定

- **独立 Agent 指工作区及其桌面端运行入口**：包括 `AgentWorkspace`、`agent_chat_turn`/`agent_chat_turn_cancel`、`agent_run_*`、`agent_memory_*` 及只为它们服务的工具/记忆/恢复代码。只保留阅读器问答、摘要、翻译、选区翻译和块重解析需要的共享模型预设读取。
- **Vault 同步由用户控制触发**：保留手动入口和用户可选的 `notesVaultAutoSyncEnabled` 定时自动同步开关；默认关闭时只允许手动触发。移除挂载时隐式同步，不新增文件系统监听；继续复用 manifest、mtime/hash 判断和冲突副本结构。
- **MCP 写入仍以显式动作为前提**：`allowWhileAppRunning` 默认保持 `false`；完成并发保护后，显式传 `true` 才进入“受检并行写”，冲突必须拒绝，不静默覆盖。改造范围包括 `import_pdfs` 与 Zotero 同步；不存在永久拒绝清单，改造完成即允许显式受检并行写。
- **PaddleOCR-VL 退役**：删除其解析运行代码、配置与分发、IPC、专用任务状态、专用测试和现行用户文档说明，保留 MinerU 的 `isOcr` 重试，以及旧结果按通用 MinerU 缓存契约读取、备份、恢复和自愈的兼容路径。

## 当前实现基线

- 独立 Agent 入口为 `src/features/agent/AgentWorkspace.tsx`；阅读器问答独立位于 `src/features/reader/AssistantSidebar.tsx`、`assistantSidebarChat.tsx`。`loadLibraryAgentModelPreset*` 目前放在 `src/services/libraryAgent.ts`，同时被 `DocumentReaderTab.tsx`、`blockReparse.ts`、`noteDistill.ts`、`notePolish.ts` 使用，不能随 Agent 工作区直接删除。
- 笔记锚点类型位于 `src/types/notes.ts`；Vault 双向同步位于 `electron/backend/noteVault.cjs`，已有 manifest、mtime/hash 判断和 `--conflict-*` 冲突副本。Markdown 往返必须保留已知锚点；`src/shared/markdownToTiptap.cjs` 只恢复内容中实际出现的锚点链接。
- MinerU 已解析图片路径/图注及表格正文/HTML；`src/features/blocks/blockViewerContent.tsx` 可展示图片、表格。Agent 内部已有 `read_paper_figure` 能力，但外部 MCP 尚缺对应的图像读取工具；现有取图链路依赖 renderer 的 `prepareAgentVisionAttachments`（使用 `HTMLImageElement` 压缩），MCP 需要独立的后端读图路径。
- MCP 文库写入统一走 `withWritableLibrary` 的 `load → mutate → save` 全量重写，涉及 `update_paper`、`set_paper_categories`、`manage_category`、`delete_papers`、`import_pdfs`、`attach_translated_pdf`、`remove_translated_pdf` 和 Zotero 同步。桌面端 `library_update_paper`/`library_delete_paper` 已改用 `store.savePaper`/`store.deletePaper` 单篇事务，`libraryDatabaseStore` 也已有单篇 UPSERT 与关联表重建；但分类 CRUD、排序和导入仍使用全量 `store.save`。
- 桌面端详情表单持有完整文献快照，保存时会回写表单内全部字段；MCP 改了同一篇文献而界面未刷新时，用户下一次保存可能用旧值覆盖部分字段。这不是数据库层的必然全量覆盖，但结果同样是字段级丢失，需要外部变更通知或保存冲突检查。
- `noteStore.updateNote` 已支持 `expectedUpdatedAt` 冲突检查，`NoteEditor.tsx` 也已有外部更新横幅与保存前确认；缺口是 MCP 写入没有传版本参数，且跨进程写入没有通知 renderer 刷新。
- 当前图谱已有人工关系的新建与删除链路；尚未发现编辑界面或专用更新命令。MCP `delete_papers` 默认保留 PDF；`deleteFiles: true` 会在数据库提交后删除文件，但不检查文件是否为 PaperQuay 管理路径、是否被其他附件共用。桌面端删除已有 `findAttachmentsByStoredPath` 与 `isRealManagedFilePath` 保护，可直接复用。
- `ai_suggested` 仍出现在 `src/types/knowledgeGraph.ts`、`KnowledgeGraphWorkspace.tsx`、`agentGraphQuery.ts`、`agentGraphExplore.ts` 和关系命令中。删除该类型必须排在 Agent 运行时移除之后，或先把 Agent 图谱工具改成不引用它，避免 TypeScript 断链。
- 文档中的工具数量落后：`bin/paperquay-mcp.cjs` 当前注册 26 个工具，`docs/MCP_AGENT_INTEGRATION.md`、`README.md`、`README_EN.md` 仍写 25；本轮一并校正。
- 既有方案 [2026-11-18 Agent 与图谱工作流优化](2026-11-18-agent-chat-retrieval-notes-and-review-removal.md) 曾要求保留历史 `ai_suggested` 关系。本计划按用户最新决定取代该项：清理已存 AI 关系，但保留人工 `custom_relation`。

## 实施阶段

### 0. 退役 PaddleOCR-VL 并统一 MinerU 解析路径

涉及：`electron/backend/paddleOcrCommands.cjs`、`electron/backend/paddleOcrNormalize.cjs`、`electron/backend/paddleOcrRuntime.cjs`、`electron/backend.cjs`、`src/services/desktop.ts`、`src/services/documentParseTasks.ts`、`src/features/reader/mineruOcrFallback.ts`、解析配置/分发文件、PaddleOCR 专用测试、现行用户文档，以及备份恢复相关代码。

- 删除 PaddleOCR-VL 的解析运行代码、配置字段与分发、IPC 命令、专用任务状态和专用任务中心条目。MinerU 保留现有 `isOcr` 重试路径，继续承担唯一的解析与 OCR 降级入口。
- 旧解析结果继续按通用 MinerU 缓存契约读取、备份、恢复和自愈，不批量删除旧缓存。恢复旧备份时把 `parseProvider: "paddleocr-vl"` 规范化为 MinerU，丢弃 `paddleOcrApiToken`，忽略旧 PaddleOCR URL；原始 `.pqbackup` 文件保持原样。
- 解析任务中心删除实际服务于 PaddleOCR 的专用注册表、事件和条目，继续使用 MinerU 的文献级状态。旧缓存兼容、配置清理和任务状态清理分别写定向测试，确保已存在的 MinerU 结果可继续打开。
- 阶段 0 的迁移必须幂等。升级后新写入配置不再产生 PaddleOCR 字段，旧配置读取不触发未知字段错误。

**验收：** 源码中不存在 PaddleOCR-VL 的运行入口、IPC 注册、专用任务注册和现行用户功能说明；MinerU `isOcr` 重试、旧 MinerU 缓存读取/恢复/自愈、旧备份字段规范化测试通过；`npm run build` 与相关解析/备份测试通过。

### 1. 建立安全的 MCP 运行时写入

涉及：`electron/mcp/knowledgeMcpService.cjs`、`electron/backend/libraryDatabaseStore.cjs`、`electron/backend/libraryCommands.cjs`、`electron/backend/desktopRunMarker.cjs`、`bin/paperquay-mcp.cjs`、相关 MCP/存储测试。

- 把 `withWritableLibrary` 的全量 `load → mutate → save` 按工具收敛到目标记录写：
  - `update_paper`、`set_paper_categories`、`attach_translated_pdf`、`remove_translated_pdf` 使用 `store.getPaper` + `store.savePaper`（单篇 UPSERT 事务，已存在）。
  - `delete_papers` 使用 `store.deletePaper`；文件删除复用桌面端的共享附件与受管路径判断。
  - `manage_category` 的创建/重命名/移动只改分类行；删除先清理受影响论文的 `paper_categories`，再删分类及其后代。不要再用全表 `save`。
  - `import_pdfs` 与 `paperquay_sync_from_zotero` 同批改造为目标记录写：逐篇 `store.savePaper`，按需创建/分配分类，文件先复制到受管目录再提交数据库，`move` 模式只在数据库提交成功后删除源文件；Zotero 同步复用同一条导入路径并返回逐项结果。改造完成前临时拒绝运行时写入（即使传 `allowWhileAppRunning: true`），完成后与其它工具一样允许“受检并行写”；不存在永久拒绝清单。检测到重复文献时只返回 `existingPaperId`，不自动给已有文献追加目标分类，分类变更必须走带版本检查的独立工具。
- 为单篇写入加乐观并发检查：`update_paper`、`set_paper_categories` 和附件操作接受 `expectedUpdatedAt`；schema 保持可选以兼容旧客户端，但应用运行期间缺少版本时明确拒绝。`set_paper_categories` 每篇文献分别携带预期版本，任一冲突即整批拒绝。所有检查在同一事务内执行，版本不一致返回 `PAPER_CONFLICT`、当前 `updatedAt` 与“重读后重试”提示。`updatedAt` 使用 `Math.max(now, old + 1)` 单调递增，避免同毫秒写入绕过检查。`expectedUpdatedAt` 与 `deleteFilePaperIds` 作为控制参数加入 schema 与实现，不混入 `update_paper` 的字段白名单。应用未运行时保留旧客户端兼容路径。
- `manage_category` 的重命名、移动和级联删除使用 `expectedUpdatedAt`。`list_categories` 返回每个分类版本；级联删除提交目标及所有受影响分类的版本快照，任一版本变化就拒绝整批操作。创建分类不要求旧版本。删除结果返回受影响子分类数与文献数。
- 外部变更通知：MCP 写事务提交后更新数据目录下的外部写标记（与 `desktopRunMarker.cjs` 的标记同目录，记录文库/笔记版本号与时间）；主进程用 `fs.watch` 监听并广播 IPC。标记写入用就地更新或原子替换，替换后重新挂载 watch；watch 不可用时退化为窗口聚焦时检查版本号。renderer 收到后：
  - 文库列表刷新；详情表单未修改时刷新，已修改时显示“外部更新”提示，由用户选择重载或继续保存，不静默覆盖。
  - 笔记列表刷新；正在编辑的笔记沿用现有 external update 横幅与 `expectedUpdatedAt` 冲突处理，不重写编辑器。
- 保留 `PAPERQUAY_MCP_WRITE=off`、备份恢复 pending 保护和默认 `allowWhileAppRunning=false`。只有并发检查与外部变更通知的测试通过后，`allowWhileAppRunning: true` 才从“风险覆盖”变为“受检并行写”；同步更新 `bin/paperquay-mcp.cjs` 的参数描述与文档，不改变默认值。
- 增加只读删除预览 `preview_delete_papers`：列出目标文献、每篇 `updatedAt`、全部附件及类型、附件状态、将删除的文件、共享文件（其他论文/附件引用）和受管路径判断。确认删除时传回预览版本并在同一事务校验文献及附件状态；任一项发生变化就整批拒绝并要求重新预览。Skills 必须先预览、再取得用户确认、最后调用 `delete_papers`。
- `deleteFiles` 默认 `false`。若只需删除部分文献的 PDF，当前布尔参数不足；增加 `deleteFilePaperIds`（必须是 `paperIds` 的子集）或在预览后分批调用。显式删除时只删 PaperQuay 管理且未被其他记录共用的文件；数据库已删除而文件删除失败时返回 `partialFailure` 与 `fileErrors`，不能声称全部完成。
- `manage_category` 删除返回受影响子分类数与文献数；重命名、移动和级联删除都执行版本检查，级联操作校验所有受影响分类的版本快照。Skill 要求确认后再删。保留 `update_paper` 白名单和现有分类操作，不开放任意数据库命令。
- 内部顺序：先逐工具改目标记录写，再加 `expectedUpdatedAt` 冲突检查，最后接外部变更通知；通知可独立回退，不影响写保护。若工作量过大，阶段 1 可拆为 1a（元数据/分类/删除/附件）与 1b（`import_pdfs`/Zotero）；1b 未完成前只对这两个工具临时拒绝，完成后放开，不设永久拒绝。

**验收：** 隔离数据库测试覆盖应用运行时的元数据/分类/附件/删除写入、schema 可选但运行时缺版本即拒绝、`PAPER_CONFLICT` 拒绝、批量分类全有或全无、删除预览版本校验、外部变更通知、MCP 写后详情表单保存不丢字段、默认保留 PDF、`deleteFilePaperIds` 选择、共享文件保护与部分失败报告；`import_pdfs`/Zotero 同步改造完成后允许 `allowWhileAppRunning: true` 的受检并行写，测试覆盖应用运行中导入、复制/移动模式、重复文献只返回 `existingPaperId`、文件失败回滚、Zotero 部分失败与桌面刷新；只有未完成改造的工具才继续拒绝。

### 2. 简化应用内写作边界

涉及：`src/app/App.tsx`、`src/stores/useTabsStore.ts`、`src/features/agent/`、`src/features/notes/NoteEditor.tsx`、`src/features/notes/notePolish.ts`、`src/services/notePolish.ts`、`src/services/libraryAgent.ts`、`src/services/agentNoteDistillCapability.ts`、`src/features/reader/documentReaderNotes.ts`、`src/services/agentChat.ts`、`src/services/agentRuns.ts`、`src/services/agentLoop.ts`、`src/services/agentTools.ts`、`electron/backend/aiCommands.cjs`、`electron/backend/agentMemoryStore.cjs`、`electron/backend/ragStore.cjs`、`electron/backend/backupSources.cjs`、`src/features/reader/readerPreferencesModelsSection.tsx`、`src/features/reader/readerShared.ts`、`src/features/reader/useReaderSettings.ts`、`src/features/reader/AgentMemorySettingsSection.tsx`、相关测试。

- 先迁出共享模型预设读取：把 `loadLibraryAgentModelPreset`、`loadLibraryAgentModelPresetById`、`loadLibraryAgentAvailableModelPresets`、`LibraryAgentModelPreset` 及依赖的持久化读取放到独立模块（如 `src/services/modelPresets.ts`），更新 `DocumentReaderTab.tsx`、`blockReparse.ts`、`noteDistill.ts` 的 import。迁出后按调用方选择 fallback：阅读器问答优先 `qaActivePresetId`，块重解析/提炼使用各自 preset id，不再把 `agentModelPresetId` 作为通用回退。确认 `libraryAgent.ts` 只被 Agent 工作区/运行链路引用后，再删除该文件及 `agentChat`、`agentLoop`、`agentTools`、`agentRuns`、`agentMemory` 等无外部消费者的模块。
- 移除独立 Agent 工作区的导航、标签、执行/恢复、附件、执行卡、引用渲染与 `AgentWorkspace*` 组件，以及 `App.tsx`/`useTabsStore` 中的入口和旧 workspace 回退。
- 移除桌面端 Agent 运行入口：`agent_chat_turn`、`agent_chat_turn_cancel`、`agent_run_*`、`agent_memory_*` IPC 及其后端实现；同步移除只服务于 Agent 的专用任务注册表、事件和任务中心条目，保留 RAG 数据库的 `agent_runs`/`agent_run_events` 表结构。首次升级时以版本化、幂等迁移清理 Agent 历史：删除 `paperquay-agent-history-v1`、RAG 运行记录与事件、`agent-memory` 目录及遗留恢复状态，记录清理数量摘要供启动日志或诊断查看。
- 备份导出在迁移后不再包含 Agent 历史条目。已有加密 `.pqbackup` 文件保持原样；每次恢复旧备份时，无论首次升级清理标记是否已存在，都在暂存阶段过滤 Agent 历史、记忆、恢复状态及已退役角色配置，防止清理后的数据重新进入当前安装。恢复流程仍验证并导入其余用户数据。
- 移除笔记编辑器的 AI 润色 UI 与 `src/services/notePolish.ts`、后端 `notes_polish_openai_compatible`；保留 `src/features/notes/notePolish.ts` 中的 `notePolishTextToNodes`（`noteDistill.ts` 依赖），只删除 `buildNotePolishNodes`/`normalizeNotePolishScope` 等仅编辑器使用的函数。不要删除 `aiCommands.cjs` 中与提炼共享的文本清洗辅助。
- 移除设置页的 Agent 工具调用模型项（`readerPreferencesModelsSection.tsx` 的 `agent` 项）和 `AgentMemorySettingsSection`。读取旧配置时忽略 `agentModelPresetId` 与 `modelRuntimeConfigs.agent`，下一次配置写回时移除这两个旧字段/角色参数；不把旧 `agentModelPresetId` 迁移到 `reviewModelPresetId`，保留模型预设本身和仍在使用的 QA、摘要、翻译、审阅角色设置。
- 保留阅读器侧边问答、问答/摘要/翻译/选区翻译共用模型预设、迁出后的模型预设读取、Tiptap 手工编辑、页面模板、笔记检索、来源锚点和 Vault 同步。保留阅读器选中文本生成或编辑摘录卡的流程，删除独立 Agent 的跨笔记蒸馏能力及其专用入口/状态。
- 保留阅读器侧边问答的复制、人工修改、保存为笔记。
- 旧 `agent` workspace localStorage 值启动时回退到 `library`；首次升级清理本地 Agent 会话和运行历史，不映射到新流程，也不保留为独立历史页。之后创建的新备份不再包含 Agent 历史。

**验收：** 顶层无独立 Agent 工作区，设置页无 Agent 模型/记忆项，笔记工具栏无 AI 润色；阅读器问答、摘要、翻译、选区翻译、块重解析和选区摘录卡可用；首次升级清理覆盖 localStorage、RAG 运行记录/事件、Agent 记忆与恢复状态并记录数量；旧备份恢复时同样过滤 Agent 数据且原备份字节不变；迁移重复执行无副作用；旧 workspace 存储值安全回退；`npm run build` 无未解析 import 或死引用。

### 3. 收敛引用与问答检索

涉及：`src/types/reader.ts`、`src/features/reader/AssistantSidebar.tsx`、`assistantSidebarChat.tsx`、`DocumentReaderTab.tsx`、`readerRag.ts`、`readerQaNote.ts`、`src/services/mineru.ts`、`src/services/rag.ts`、`electron/backend/ragStore.cjs`、`src/features/blocks/blockViewerContent.tsx`、`electron/mcp/knowledgeMcpService.cjs` 及相关测试。

- 扩展 `DocumentChatCitation`：增加 `paperId`、`evidenceKind: 'text' | 'image' | 'table'`；`sourceType` 保留 RAG 来源语义。新问答和新保存的摘录使用新字段，旧问答会话及旧引用不做 `evidenceKind`、`paperId` 等字段迁移，继续作为可读历史文本保留；必要时只按当前文献和旧 `sourceType` 做读取兼容。`readerQaNote.ts` 为新引用生成 `NoteAnchor` 时写入 `paperId`，图片/表格锚点的 `excerpt` 使用图注或表格文本。
- 检索范围：默认当前文献；侧边栏提供“当前文献 / 选定文献 / 全库”三档，选择状态按会话保存。继续复用 `localRagTopK` 的当前默认值 6 和 1–12 归一化范围，不把它改成新的独立配置。多文献用 `documentKeys` 一次检索（`ragStore` 已支持），显式全库也走同一通道。必须排除 `ragEnabled: false`、RAG 关闭、来源模式为 `off` 和备份恢复中的来源。选定文献范围按文献计数，每篇最多使用当前 `localRagTopK`；全库范围使用一个全局 `localRagTopK` 上限。选定范围遇到未就绪索引时尝试懒建，失败后列入跳过清单；全库范围只使用已就绪索引，不自动触发整库建索引。全部文献都无法检索时停止调用模型并说明原因，部分文献可用时继续回答并明确列出被跳过的文献。
- 上下文预算：当当前 QA 模型预设填写 `contextWindow` 时，把 `readerRag.ts` 现有私有 `estimateTokens` 提取为可复用、可单测的纯函数（或等价共享实现），用它估算提示、历史消息和证据占用，再扣除已填写的 `maxOutputTokens`。未填写 `maxOutputTokens` 时不猜固定输出默认值，由模型服务端采用其默认值；未填写 `contextWindow` 时不主动截取，交由模型服务端处理。证据超出预算时先为每篇可用文献保留一条最高相关证据，再按相关性填充；若最低份额本身超预算，则按文献相关性保留可容纳的文献并列出因预算跳过的文献。被截去的文献和证据列入回答状态，不生成无依据引用。若提示和历史消息已超过可用窗口，停止调用模型并提示用户缩短问题或降低 `maxOutputTokens`。
- 证据绑定：在现有 `[n]` 引用标签基础上要求模型按段落标注；渲染端只把能映射到本次证据的 `[n]` 变成链接。模型未标注或标注不完整时退回消息级引用列表，禁止按相似度猜测段落归属。无依据段落不显示引用。
- 跨文献引用点击只展示文献名、页码和块 ID，不自动打开或切换到目标阅读器。
- 表格/图片：表格块索引改为“图注 + 表格正文/结构文本”，图片块保留图注；命中后按需读取图片/表格块，模型不支持视觉输入时返回图注与结构化文本并说明限制。复用现有 `read_paper_figure` 的定位与取图思路，但外部 MCP 需要后端直接读 MinerU 资产/切片，不能直接复用 renderer 的 `prepareAgentVisionAttachments`（依赖 `HTMLImageElement` 压缩）。
- 索引兼容：`extractTextFromMineruBlock` 的表格分支当前是 `caption || tableText`，有图注时表格正文不会进索引；`sourceSignature` 取整篇 MinerU 文本，修改抽取逻辑不会让旧索引失效。实施时给 MinerU 来源的签名加入抽取器版本（如 `mineru-chunks-v2`），让下次打开按现有懒索引流程重建受影响文献；不做全库批量重建。若不能改签名，必须提供一次性定向重建清单与用户可见提示。
- 不新增图像向量库；不把图片二进制写入 RAG 表。

**验收：** 单文献、用户选定多文献和显式全库范围测试；`ragEnabled: false`/关闭来源排除、选定范围懒建失败跳过、全库只读就绪索引、全无证据停止调用、部分可用继续并列出跳过项、按文献计数与全局 `localRagTopK`、`contextWindow`/`maxOutputTokens` 预算、每篇最低证据份额、超预算状态、段落—证据绑定、无引用段落、文字/图片/表格定位、跨文献 `paperId` 锚点保存、无视觉模型降级和不自动切换阅读器测试通过；旧索引用版本签名触发定向重建，不返回陈旧证据。

### 4. 改善 Vault 与 MCP 笔记写入

涉及：`electron/backend/noteVault.cjs`、`electron/backend/noteStore.cjs`、`electron/backend/noteCommands.cjs`、`electron/mcp/knowledgeMcpService.cjs`、`bin/paperquay-mcp.cjs`、笔记 store/IPC、`src/features/notes/`、`src/types/notes.ts`、`src/shared/markdownToTiptap.cjs`、`docs/notes-charter.md`、笔记测试。

- Vault 同步只由用户明确触发：保留手动入口和 `notesVaultAutoSyncEnabled` 定时自动同步开关；默认关闭时只允许手动触发，挂载笔记页不隐式同步。复用 manifest、`--conflict-*` 冲突副本和 mtime/hash 判断，不新增文件系统监听。补充 MCP 写入 → Vault 同步、Vault 外部编辑 → 应用导入的双向测试；冲突时保留两份并报告冲突文件，不静默覆盖。
- `update_note` 与 `delete_note` 接受 `expectedUpdatedAt` 并传给 note store；schema 保持可选以兼容旧客户端，但应用运行期间缺版本时明确拒绝，版本变化时返回 `NOTE_CONFLICT`、当前 `updatedAt` 和“重读后重试”提示。`update_note` 的 store 已支持冲突检查。Skill 要求先 `get_note` 读取版本，写入失败后重读合并，不做自动覆盖。
- 笔记文件夹重命名要求 `expectedUpdatedAt`。级联删除校验目标及所有后代文件夹的版本快照，任一变化就整批拒绝；在事务中把受影响笔记移入未分类，返回删除的文件夹 ID、受影响笔记 ID 和新 `updatedAt`。`list_note_folders` 返回完整树及各文件夹版本，供 Skill 先读后写。
- 锚点保真：含 `anchors` 的笔记在 `content` 更新时，校验新 Markdown 是否仍包含每个已有锚点 ID（`paperquay://anchor/<id>`）；缺失时拒绝正文更新并返回缺失 ID 列表，只允许改标题/标签/文件夹/页类型。若未来要支持“有意移除锚点”，用显式参数而不是默认行为。`parseMarkdownToTiptap` 对未知锚点继续保留为普通文本，不伪造引用。
- 运行时通知：MCP 笔记写提交后更新外部写标记；桌面主进程广播，笔记列表刷新，正在编辑的笔记沿用现有 `externalUpdateNote` 横幅与保存前确认（`NoteEditor.tsx` 已有测试，不重写编辑器）。
- MCP 创建/更新/删除笔记和移动/删除笔记文件夹后返回最新版本与受影响对象 ID，供下一次写入作为 `expectedUpdatedAt`；Skill 写后回读核对。
- 删除笔记保留软删除语义；删除前要求用户确认，含锚点的笔记删除不清理文献或摘录源数据。

**验收：** PaperQuay 编辑、Vault 外部编辑与 MCP 更新的双向往返测试；并发冲突保留两份内容；笔记更新/删除及文件夹重命名/级联删除的版本冲突整批拒绝；级联删除在事务中把笔记移入未分类并返回受影响 ID 与版本；锚点、原文快照、引用、双链、公式和表格回归通过；缺锚点正文更新被拒绝；运行时写入后列表/编辑器有可见更新提示。

### 5. 优化人工关系并删除 AI 关系

涉及：`src/features/graph/KnowledgeGraphWorkspace.tsx`、`src/types/knowledgeGraph.ts`、`src/services/knowledgeGraph.ts`、`electron/backend/knowledgeGraphCommands.cjs`、`src/services/agentGraphQuery.ts`、`src/services/agentGraphExplore.ts`、`tests/knowledgeGraphCommands.test.mjs`、相关 UI/回归测试。

- 用隔离图谱复现截图中的灰色“添加关系”按钮：检查起点/终点选择、表单禁用条件、重复边校验和错误提示；修正后补组件/命令测试。
- 新增按关系 ID 更新的最小命令 `knowledge_graph_update_relation`（标签、说明、权重）。首版端点固定；若产品要求改端点，走显式“重建关系”路径（校验重复与自环后替换），不静默改端点。校验起点/终点存在、标签非空且不超过 80 字符、说明不超过 2000 字符；前后端使用同一限制。更新 `updatedAt` 后同步当前图谱与持久化。
- 删除 `ai_suggested` 的新建/筛选/样式/文案路径；`normalizeCustomRelation` 对新请求拒绝 `ai_suggested`。清理存量采用显式、一次性、幂等迁移：在应用升级或首次加载关系文件时先备份原文件，再过滤并写回 `ai_suggested`，报告清理数量和备份路径；多次运行不误删 `custom_relation` 或系统边。
- 关系存储仍为 `paperquay-knowledge-graph-relations.json`、`version: 1`，不改布局；清理后保留备份。
- 旧 localStorage 的边类型筛选若含 `ai_suggested`，读取时忽略并按默认过滤；不要因未知类型崩图。
- 顺序：`ai_suggested` 仍被 `agentGraphQuery.ts`/`agentGraphExplore.ts` 的边类型集合引用。阶段 2 删除 Agent 运行时后再从 `KnowledgeGraphEdgeType` 移除；若阶段 2 保留这些模块，则先把它们改为不引用 AI 类型，再删类型，避免 TS 断链。

**验收：** 隔离 UI 可新增、编辑和删除人工关系；编辑后关系字段与持久化结果一致且不会产生重复边；标签超过 80 字符或说明超过 2000 字符时前后端均拒绝；无 AI 类型选项或生成入口；存量 AI 关系被清理且报告数量和备份路径，人工和系统关系不受影响；多次清理幂等；旧筛选值不导致崩溃。

### 6. 更新 MCP 契约与外部 Agent Skills

涉及：`bin/paperquay-mcp.cjs`、`electron/mcp/knowledgeMcpService.cjs`、`docs/MCP_AGENT_INTEGRATION.md`、`docs/USER_MANUAL.zh-CN.md`、`README.md`、`README_EN.md`、`docs/changes/`、`skills/paperquay-knowledge-search/SKILL.md`、`skills/paperquay-library-manage/SKILL.md`、`skills/paperquay-notes/SKILL.md`、`tests/paperquaySkills.test.ts`、`tests/knowledgeMcpWrite.test.ts`、`tests/knowledgeMcpNotesWrite.test.ts`、`tests/mcpWriteGuardDetection.test.ts`。

- 新增 `read_paper_figure`（按 paperId + blockId；pageIndex 仅作回退）和 `preview_delete_papers`，更新 `tools/list` 契约测试。`read_paper_figure` 返回图注、页码、块 ID、类型与有大小上限的 base64 图片；单次最多一张，超过上限返回元数据 + 图注，不返回二进制。图片用 MCP `image` content block；客户端不支持时 Skill 说明只能读图注。
- 修正文档工具数量：当前实际 26 个工具（`bin/paperquay-mcp.cjs`），`MCP_AGENT_INTEGRATION.md` 与 README/README_EN 仍写 25；新增 `read_paper_figure` 和 `preview_delete_papers` 后按 `tools/list` 重列表格并校正最终数量。工具数量断言继续从源码/注册表读取，不硬编码。
- 更新 MCP 写入 schema 与文档：`expectedUpdatedAt` 对旧客户端保持可选，但应用运行期间受检写入缺少版本时明确拒绝；`set_paper_categories` 为每篇文献传预期版本并保持整批原子性；`manage_category` 重命名/移动/级联删除传分类版本快照；`delete_papers` 只接受 `preview_delete_papers` 返回的文献与附件版本；笔记更新/删除与文件夹重命名/级联删除按同一规则传版本。更新 `allowWhileAppRunning` 的 schema 描述：默认 `false`；改造完成后，显式 `true` 表示“受检并行写”，冲突会拒绝并返回 `PAPER_CONFLICT` 或 `NOTE_CONFLICT`，不再是“会静默覆盖”。同步更新 MCP 指南、README、Skills；`import_pdfs`/Zotero 同步在改造完成前要求关闭应用，完成后与其它工具一致。
- 更新搜索 Skill：当前文献/选定文献/全库范围及索引就绪规则、预算截取与跳过状态、`read_paper_figure` 的 blockId 来源、表格与图片降级、引用保留 `paperId`/页码/块身份；跨文献点击仅显示来源信息。
- 更新文库管理 Skill：删除前 `preview_delete_papers`、确认、按预览版本删除、`deleteFile` 仅显式请求、写后回读；重复导入/同步只报告 `existingPaperId` 不自动改分类；说明分类更新版本及 `PAPER_CONFLICT` 重读流程和 `deleteFilePaperIds` 用法。
- 更新笔记 Skill：写入/删除笔记和文件夹操作前读取版本并传 `expectedUpdatedAt`；说明 `NOTE_CONFLICT`、锚点保真拒绝、文件夹级联影响结果、Vault 手动/定时同步与冲突文件、运行时刷新提示。
- 更新用户手册与 README：删除 Agent 工作区、笔记 AI 润色章节/截图/功能表；保留阅读器问答和手工笔记说明；英文版同步。同步修订 `docs/notes-charter.md` 中“内置 Agent”表述为外部 Agent/MCP 写入边界。按 `docs/changes/README.md` 增加一条用户可感知变更记录。
- 不自动修改用户的外部 Agent 配置；只更新仓库内示例和文档。

**验收：** 每个 Skill 引用的工具与 schema 一致；删除和 PDF 文件副作用表述一致；文档工具数量与 `tools/list` 一致；MCP `initialize`、`tools/list`、图表读取、元数据更新、删除预览和隔离运行时写入冒烟通过。

## 总体验收与实施约束

- 每阶段先跑新增定向测试；最终运行 `npm run build`、`npm test`（`npm run check` 等价于两者），并在隔离 `--user-data-dir` 做 Electron/MCP 冒烟。Windows 临时目录触发 esbuild `Access is denied` 时，按既有约定把 `TEMP`/`TMP` 指向仓库内一次性目录，不改产品代码。
- 文库、图谱和笔记测试使用新建隔离目录与合成数据，不访问或批量改写真实用户文库；MCP 写入测试必须覆盖“应用运行中”的冲突拒绝与外部变更通知。阶段 0 的旧缓存和备份兼容测试使用合成旧结构，不读取真实用户备份。
- 分阶段提交，先完成运行时写保护再开放应用运行期间写入；若并发测试未通过，继续拒绝运行时写入，不能用 `allowWhileAppRunning` 绕过。
- `allowWhileAppRunning` 默认仍为 `false`；`PAPERQUAY_MCP_WRITE=off`、备份恢复 pending 保护不变。只有阶段 1 验收通过后，才更新文档中的“风险覆盖”表述。
- 优先复用现有 service、SQLite 事务、MinerU 内容和 Skill；只有确认没有可行的无 schema 方案时才引入最小迁移，并在实施前记录迁移与回退步骤。
- 用户在 2026-11-19 明确要求删除存量 `ai_suggested` 关系。清理前备份关系文件；清理与人工关系保留分开测试，不清理其他关系或图谱数据。
- 本计划包含 PaddleOCR-VL 退役、独立 Agent 历史的一次性幂等清理和旧备份恢复暂存过滤。已有加密 `.pqbackup` 文件保持原样，未来新备份排除 Agent 历史；不访问真实文库或真实备份。除阶段 0 的兼容字段规范化、阶段 2 的清理标记和阶段 3 的索引签名外，不改文库/RAG/笔记 schema 与 `user_version`。如果索引签名方案被证明必须迁移，单独评审迁移与回退步骤。

## 回退策略

- 每阶段保持独立提交；阶段 1 的逐工具写路径、冲突检查和外部通知分开提交，通知失败可单独回退。
- 阶段 2 删除 Agent 前保留旧代码提交点；旧 workspace 存储值回退到 `library`。首次升级清理产生版本化迁移标记和数量摘要，代码回退不会自动恢复已清理的本地 Agent 数据，原有 `.pqbackup` 文件仍保持可供用户自行恢复；恢复旧备份时必须再次经过暂存过滤。
- 阶段 3 索引签名变更若导致检索退化，回退签名版本并保留旧索引；不删除用户索引数据。
- 阶段 5 关系清理前备份 JSON；回退代码后已删除的 AI 边不会自动恢复，需要从备份恢复。
- 阶段 6 文档/Skill 契约回退不影响应用运行。

---

## 评审记录（2026-11-19）

> 依据：`main` @ `99237b7`（v0.4.31）源码只读核对；未运行会写真实文库的命令。以下问题已直接改入正文对应章节。
> 核对文件：`electron/backend/libraryDatabaseStore.cjs`、`libraryCommands.cjs`、`noteStore.cjs`、`noteVault.cjs`、`electron/mcp/knowledgeMcpService.cjs`、`bin/paperquay-mcp.cjs`、`src/features/reader/readerRag.ts`、`src/services/mineru.ts`、`src/types/reader.ts`、`src/types/notes.ts`、`src/features/notes/NoteEditor.tsx`、`src/services/agentGraphQuery.ts`、`src/services/agentGraphExplore.ts` 及相关测试/文档。

| # | 发现 | 处置 |
|---|------|------|
| 1 | 基线把 MCP 与桌面写路径混为一谈：MCP 是全量 `load → save`，桌面单篇更新/删除已是逐记录事务，仅分类/排序/导入仍全量。 | 修正“当前实现基线”；阶段 1 逐工具列出改造范围，并把 `attach_translated_pdf`/`remove_translated_pdf`、`import_pdfs`/Zotero 同步纳入同批改造；临时拒绝不是永久策略。 |
| 2 | “版本检查 + 桌面刷新”只有目标，没有机制；同毫秒写入可能绕过 `updatedAt` 相等比较。 | 阶段 1 增加 `expectedUpdatedAt`、`PAPER_CONFLICT`、`updatedAt = max(now, old+1)`、外部写标记与主进程 `fs.watch`；脏表单只提示不静默刷新。 |
| 3 | 未说明 `allowWhileAppRunning` 默认值是否改变，和 AGENTS 的“默认拒绝并行”红线有冲突风险。 | 明确默认保持 `false`；改造后仅把显式 `true` 从“风险覆盖”变为“受检并行写”，并更新 schema 描述与文档。 |
| 4 | 漏掉共享模型预设迁移：`libraryAgent.ts` 的 preset 读取被阅读器、块重解析、笔记提炼使用。 | 阶段 2 先迁出 `loadLibraryAgentModelPreset*` 与类型，再删除 Agent 运行时；列出所有调用方。 |
| 5 | 笔记润色删除范围过粗：`src/features/notes/notePolish.ts` 的 `notePolishTextToNodes` 被 `noteDistill.ts` 使用。 | 阶段 2 只删编辑器入口、`services/notePolish.ts` 和后端专用命令；保留纯转换函数与共享文本清洗辅助。 |
| 6 | 漏掉 Agent 设置与模型 UI：`readerPreferencesModelsSection.tsx`、`useReaderSettings.ts`、`readerShared.ts`、`AgentMemorySettingsSection.tsx`。 | 阶段 2 加入这些文件；停止写入并清除 `agentModelPresetId` 与 `modelRuntimeConfigs.agent`，读取旧配置时兼容忽略；不迁移到 `reviewModelPresetId`，保留模型预设本身。 |
| 7 | `DocumentChatCitation` 缺 `paperId`/证据类型；`readerQaNote.ts` 生成锚点时不写 `paperId`，多文献保存会指向错误文献。 | 阶段 3 扩展类型并兼容旧记录；把 `readerQaNote.ts` 加入文件清单，要求锚点携带 `paperId`。 |
| 8 | 表格 RAG 实际是 `caption || tableText`，有图注时表格正文不进索引；改抽取不会让旧索引失效。 | 阶段 3 明确改为“图注 + 表格正文”，并把抽取器版本纳入 `sourceSignature`，走懒重建，不做全库批量重建。 |
| 9 | 段落级引用缺少模型输出契约与失败回退，容易变成按相似度猜测。 | 阶段 3 增加 `[n]` 段落契约；模型未标注时退回消息级引用，禁止猜测段落归属。 |
| 10 | 多文献范围未定义选择 UI、上下文预算和 `ragEnabled: false` 排除。 | 阶段 3 明确三档范围、`documentKeys`、按选定文献与全库分别限制 `localRagTopK`、索引就绪策略、来源排除、跳过状态和按 QA 模型 `contextWindow` 装箱。 |
| 11 | 笔记 MCP 写入没有使用已有的 `expectedUpdatedAt`；摘录锚点只写在 Skill 文档里，代码不阻止正文覆盖丢锚点。 | 阶段 4 增加 `expectedUpdatedAt` 参数、`NOTE_CONFLICT` 流程和锚点 ID 校验；缺锚点正文更新直接拒绝。 |
| 12 | Vault 冲突副本与外部更新横幅已存在，按原文重写会扩大范围；且未说明同步是否自动。 | 阶段 4 复用现有 manifest/冲突副本/编辑器横幅；保留手动入口和用户可选的定时自动同步开关，关闭时仅手动触发，并移除挂载时隐式同步。 |
| 13 | `ai_suggested` 仍被 `agentGraphQuery.ts`/`agentGraphExplore.ts` 引用，直接删类型会断链。 | 阶段 5 加顺序：先删 Agent 运行时或先改这些模块，再删 `KnowledgeGraphEdgeType`；并列出这些文件。 |
| 14 | 图谱清理未处理 localStorage 旧筛选值、关系文件备份与幂等。 | 阶段 5 增加旧筛选忽略、清理前备份、幂等测试和清理数量报告。 |
| 15 | 文档工具数量落后（实际 26，文档写 25），README 仍保留 Agent 工作区/笔记润色说明。 | 阶段 6 扩大到 README/README_EN/USER_MANUAL，按 `tools/list` 校正数量，并补 `docs/changes/` 记录。 |
| 16 | 计划头部的 `superpowers:executing-plans` 不是本仓库已安装的 Skill。 | 改为 `executing-plans`，与仓库 Skills 一致。 |
| 17 | `deleteFiles` 只有布尔值，无法“按明确选择”只删部分文献的 PDF。 | 阶段 1 增加 `deleteFilePaperIds`（`paperIds` 子集）或预览后分批调用；预览按附件类型列出。 |
| 18 | `manage_category` 删除是破坏性操作，但没有预览。 | 阶段 1 返回受影响子分类数与文献数；分类重命名、移动和级联删除均校验当前版本，级联操作对所有受影响分类作整批版本检查。 |
| 19 | 验收把 `import_pdfs`/Zotero 写成“运行中仍被拒绝”，与“改造完成后允许”的目标矛盾。 | 改为同批改造：完成前临时拒绝，完成后允许显式 `allowWhileAppRunning: true` 的受检并行写；验收按完成状态区分，不设永久拒绝清单。 |
| 20 | PaddleOCR-VL 退役遗漏旧缓存、备份恢复和任务中心兼容边界。 | 新增阶段 0；移除 PaddleOCR-VL 运行代码和专用状态，保留 MinerU `isOcr` 重试及旧结果兼容；旧备份导入时丢弃 Paddle 凭据、规范化 Provider 并忽略旧 URL。 |
| 21 | 移除独立 Agent 后，旧本地数据可能继续占用存储或通过旧备份恢复。 | 首次升级用幂等迁移清理 localStorage、RAG Agent 运行记录/事件、记忆目录和恢复状态；记录版本标记与数量。保留原有加密备份字节，恢复暂存时过滤 Agent 数据；之后新备份不再包含 Agent 历史。 |
| 22 | Agent 配置绑定与独立 Agent 入口移除后的遗留设置未区分。 | 清除 `agentModelPresetId` 和 `modelRuntimeConfigs.agent`，保留模型预设与其他角色设置，不迁移到审阅角色。 |
| 23 | 多文献检索的每篇证据数量、未就绪索引和全库行为未明确。 | 选定范围每篇最多 `localRagTopK` 并尝试懒建；全库范围以全局 `localRagTopK` 检索就绪索引。全部不可用时停止模型调用，部分可用时列出跳过文献。 |
| 24 | 多文献证据超过模型上下文窗口时的截取和输出预算未明确。 | 复用现有保守 token 估算并抽成可测试函数，以当前 QA 预设 `contextWindow` 扣除提示、历史和已配置的 `maxOutputTokens`；不猜未配置的输出默认值，未配置窗口则不主动截取。每篇优先保留一条证据，再按相关性填充并在状态中列出被截项。 |
| 25 | 删除与批量分类、分类树、笔记文件夹操作缺少统一的版本快照规则。 | 批量分类逐篇校验版本并全有或全无；论文删除按预览版本校验论文和附件状态；分类与文件夹级联操作校验所有受影响父子项；笔记删除/更新和文件夹改名也校验版本。schema 可选以兼容旧客户端，应用运行期间缺版本时拒绝。 |
| 26 | 旧问答引用迁移范围和跨文献点击行为尚未确定。 | 旧问答保留为可读历史文本，不迁移 `evidenceKind`/`paperId`；新引用保存来源身份。跨文献引用只展示文献名、页码和块 ID，不自动切换阅读器。 |
| 27 | 选区摘录提炼与独立 Agent 的跨笔记蒸馏能力可能被混为一项。 | 保留阅读器选中文本生成/编辑摘录卡，删除独立 Agent 跨笔记蒸馏能力。 |
| 28 | 人工关系字段限制与存量 `ai_suggested` 清理方式需要形成明确契约。 | 标签最多 80 字符、说明最多 2000 字符，前后端一致；显式一次性幂等迁移先备份关系文件，并报告清理数量和备份路径。 |
| 29 | 仅手动同步与自动同步触发边界需要厘清。 | 保留手动入口和用户可选的定时自动同步开关；默认关闭时仅允许手动触发，挂载时不隐式同步。 |
