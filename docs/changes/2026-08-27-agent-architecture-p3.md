# 2026-08-27 - Agent 架构 P3：ReAct 循环、混合检索、上下文压缩与三层记忆、可观测性、视觉上下文

对应计划文档：`docs/plans/2026-08-26-agent-architecture-p3-plan.md`（P3-A ~ P3-F 已全部落地）。

## 一、ReAct 工具调用循环（P3-1 / P3-C）

**修改**：

- 新增 `src/services/agentLoop.ts`：多轮工具调用循环运行时。只读工具并行执行、结果截断（4000 字符）后以 tool 消息回注；写工具不直接执行，收集为计划项终止循环并走既有审批 UI；`maxTurns`（默认 8）到达时强制收尾且禁止工具；工具报错以 `isError` tool 消息回注供模型自我修正；支持 abort 中断与轮次 checkpoint。
- 新增 `src/services/agentTools.ts`：工具注册表（名称/schema/`read|write` 类别/上下文门控）。首批工具：`search_library`、`read_paper_metadata`、`read_paper_overview`、`rag_search`、`request_paper_context`、`read_paper_figure`、`read_memory`/`write_memory`（记忆写入走独立审批卡），以及 rename/metadata/smart-tags/clean-tags/classify 五类写工具。
- 后端 `aiCommands.cjs` 新增 `agent_chat_turn`：messages 由前端循环维护，后端退化为带 PaperQuay system 前缀的通用 chat 转发；流式事件复用 `AGENT_STREAM_EVENT`，一轮结束携带解析后的 tool calls 与 token `usage`。
- `runConversationalLibraryAgent` 保留为兼容包装，内部改走 `runAgentLoop`；首轮路由决策保留以省 token。新增设置开关 `agentLegacyMode`（设置页可切，默认关=ReAct），一个版本周期内可切回旧两段式路径。
- UI：`AgentChatMessage` 增加执行轨迹（每轮工具调用/结果/耗时，复用 `TraceTimeline`/`ToolCallCard` 折叠渲染）；运行中显示当前轮次与正在执行的工具；计划审批 UI 不变。

## 二、混合检索：FTS5 + 向量 RRF 融合（P3-2 / P3-B）

**修改**：

- `ragStore.cjs`：新建 `rag_chunks_fts` FTS5 虚表（外部内容关联 `rag_chunks`）与 INSERT/DELETE/UPDATE 同步触发器；首次升级对已有库执行一次性 `rebuild` 回填；`CREATE VIRTUAL TABLE` 失败时记录 `ftsAvailable=false` 并优雅降级为纯向量检索。
- `retrieveDocumentChunks` 增加 `queryText`：向量与 BM25 两路检索按 RRF（k=60）融合后取 topK；FTS 查询经 `buildFtsMatchQuery` 转义；结果结构不变（`chunkId/pageIndex/blockId/text/score`），前端 `filterRelevantRetrievals` 无需改动。
- `services/rag.ts` 的 `RagRetrieveRequest` 新增 `queryText`，`localRag.ts` 检索时传入问题原文。

## 三、上下文压缩与三层记忆（P3-3 / P3-D）

**修改**：

- 新增 `src/services/agentContextBudget.ts`：token 估算（英文 chars/4、中文 chars/1.5 取大）；每轮调用前检查 `contextWindow - 16384` 预算；只在 user turn 边界切割，绝不在 tool result 中间切；压缩摘要失败时退化为截断最旧消息；产物轨迹（已读论文/引用页码/已应用计划）跨压缩保留。
- 三层记忆落地于 `{userData}/PaperQuay/agent-memory/`：`trace/YYYY-MM-DD.jsonl`（L1，随运行事件流双写）、`L2-topics.md`、`L3-synthesis.md`；新增 `electron/backend/agentMemoryStore.cjs` 与 `agent_memory_list/read/write/append` IPC。
- Agent system prompt 注入 L2/L3 摘要（各截断 2000 字符）；`read_memory` 只读工具与 `write_memory` 审批写工具已注册。
- 设置页新增「Agent 记忆」区（`AgentMemorySettingsSection.tsx`）：查看/编辑/清空记忆文件，显示大小与更新时间。

## 四、可观测性与会话恢复（P3-4 / P3-A、P3-E）

**修改**：

- `ragStore.cjs` 新增 `agent_runs` 与 `agent_run_events` 表（同库存放，避免新库文件）；`aiCommands.cjs` 新增 `agent_run_start/event_append/finish` 命令，token `usage` 透传累计；新增 `src/services/agentRuns.ts`。
- 状态栏：Agent 输入框旁显示本次运行累计 token；会话列表显示各会话总用量。
- 会话恢复：中断残留 `status='running'` 的运行在下次打开会话时提示「从最近完整轮次恢复」，由 `agent_run_events` 的 checkpoint 重建消息（`agentRunRecovery.ts`）。
- 会话 fork：消息菜单「从此处分支」复制 `messages[0..i]` 为新会话（`forkAgentHistorySession`），两分支互不影响。

## 五、重任务 Capability 化（P3-5 / P3-E）

**修改**：

- 新增 `src/services/agentCapability.ts`：对比调研四阶段流水线（rephrase → decompose → research → report），阶段事件经统一事件总线汇报，产出统一信封（markdown/citations/tokenUsage/artifacts），支持取消与从最近阶段续跑。
- `agentCapabilityTrigger.ts`：检测调研类指令（如「对比调研/比较综述」，选中 ≥2 篇）时进入 Capability 路径；UI 渲染阶段进度卡片。

## 六、视觉上下文注入（P3-6 / P3-F）

**修改**：

- 新增 `src/services/agentVision.ts`：RAG 命中 chunk 按 `blockId` 反查 MinerU 图片/表格块，压缩（最长边 1568、JPEG 0.85）后以 vision 附件随行人模型请求；硬限制单轮 4 张、总计 8MB，超限跳过并提示；`prepareAgentVisionAttachments` 的读取/压缩均为可注入依赖，便于测试。
- F2 工具 `read_paper_figure` 已注册，`rag_search` 结果对图片块附带标记引导模型按需取图。
- `QaModelPreset` 新增 `supportsVision`（设置页 preset 编辑区复选框，默认关）；非视觉 preset 跳过注入并提示「当前模型不支持视觉，图片未发送」。
- 引用区显示图片缩略图与点击放大预览（`AgentWorkspaceMessages.tsx`）。

## 验证

- `npm run check`（`tsc && vite build` + `node --test tests/*.test.ts`）全绿：234 个测试全部通过，含新增 `agentLoop` / `agentTools` 相关、`agentContextBudget`、`agentVision`、`agentMemoryStore`、`agentRunRecovery`、`agentCapability`、`agentExecutionMode` 与 `ragStore`（FTS/RRF/agent_runs）测试。
- 修复过程中发现并解决：`agentVision.ts` 顶层静态 import 平台资源链导致 Node 原生 test runner 解析失败（改为惰性动态导入，保持构建行为不变）；非视觉提示文案与计划口径统一为「当前模型不支持视觉，图片未发送」。
- 桌面端手工回归建议项：普通问答、跨多篇比较（多次 `rag_search`）、批量重命名审批、运行中断恢复提示、会话 fork、视觉 preset 下图片问答、记忆文件编辑后生效。
