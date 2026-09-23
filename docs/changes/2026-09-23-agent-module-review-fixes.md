# 2026-09-23 - Agent 模块审查修复：审批卡生命周期、运行收尾与持久化性能

依据 `docs/plans/2026-09-23-agent-module-review-and-fix-plan.md` 实施，分支 `fix/agent-module-review-2026-09-23`。

## 现象

1. 每次 Agent 运行结束后，最终答案会被跨轮累积的流式文本覆盖，meta 固化为 `streaming / Running`，取消标记被清除。
2. 执行/取消过的批量计划，在切换会话再切回后"复活"且默认全选，可重复执行本地写入；计划项超过 4 个时只渲染前 4 个，其余项不可见却被一起执行；记忆审批卡写入成功后按钮仍可点击，旧内容可覆盖新记忆。
3. 取消运行后 500ms 强制清态，旧 run 的收尾会误删新 run 的取消控制器；legacy 执行路径完全无法取消。
4. 切换会话后仍在后台运行的 run，再次打开会话时被误判为"中断运行"并标记 aborted。
5. 中断恢复读取最旧 200 条事件，流式 delta 又按 token 落库，长 run 的 checkpoint 永远在窗口外，恢复必然失败；恢复消息序列含孤儿 tool 消息，provider 直接 400。
6. 流式期间每个 token 触发 IPC + SQLite 事务 + trace 文件全量读回 + localStorage 全量序列化，造成卡顿与事件表膨胀。
7. 图表预览遮罩被祖先 `backdrop-filter` 限定，盖不满视口；长 URL/代码在气泡与表格中横向溢出。

## 根因

- 运行收尾（`finally`）、取消（500ms 定时器强清）、恢复（最旧窗口 + 消息过滤）三段代码未闭环。
- 审批卡缺少终态字段，执行/取消后不回写消息，恢复草稿时无法区分待审与已终态计划。
- delta 事件无重放价值却走完整持久化管线；`appendTrace` 返回值（全量读回）被调用方丢弃。
- 上下文压缩的 token 估算只统计文本 content，视觉附件注入的伪 user 消息被当作轮次边界。

## 修改

### 数据正确性（UI 层）

- `AgentWorkspace.types.ts`：`AgentChatMessage` 新增 `planStatus` / `memoryPlanStatus` 终态字段。
- `AgentWorkspace.tsx`：`restoreDraftStateFromMessages` 跳过终态计划；新增 `markPlanTerminalStatus` / `markMemoryPlanTerminalStatus`，`applyPlan` 执行后、`cancelPlan` 取消后、`applyMemoryPlan` 写入后回写终态；新增 `rejectMemoryPlan`。
- `AgentWorkspaceMessages.tsx`：计划项全量渲染（容器限高滚动），卡片显示"已执行/已取消/已拒绝"徽章；记忆卡增加拒绝按钮，终态后按钮禁用。
- `AgentWorkspace.tsx`：`finally` 不再提交跨轮累积的流式缓冲（各终态分支已写最终内容）；流式 meta 本地化。

### 运行生命周期

- 取消：去掉 500ms 强制清态，`finally` 校验 controller 身份后才收敛；新增 `cancellingSessionIds` 状态，取消中按钮显示"正在取消"并禁用。
- legacy 路径取消：前端 `generateLibraryAgentPlanOpenAICompatible` / `decideLibraryAgentPaperContextOpenAICompatible` 生成 requestId 并在 abort 时调用 `agent_chat_turn_cancel`；后端这两个命令（含 stream 变体）注册到 `activeAgentTurnControllers`，`runLegacyConversationalLibraryAgent` 全链路透传 `signal`。
- 中断恢复：会话有活跃 controller 时跳过恢复流程；同会话遗留的多余 running 行一并标记 aborted；恢复读取改为 `order=desc` 最新 200 条（`ragStore.cjs` 支持 desc 窗口）。
- 恢复消息序列：保留空 content 的 assistant toolCalls 消息；`sanitizeRecoveredLoopMessages` 双向清理孤儿 tool 消息与无应答 toolCalls；`recoverySnapshotMessages` 始终保留系统提示且不从 tool 消息开始切片。

### 持久化性能

- 流式 `answer_delta` 不再落库（事件表膨胀与逐 token IPC 消除）。
- `agentMemoryStore.cjs` `appendTrace` 返回 stat 信息，不再全量读回 trace 文件。
- `saveAgentHistorySessions` 加 try/catch（配额容错）；历史写盘在有运行中会话时 800ms 防抖，空闲时立即落盘。

### 健壮性

- Capability 触发判定统一走 `isComparativeSurveyInstruction`，UI 与服务层均基于 `modelPapersSnapshot.length`。
- `agentLoop`：混合论文写 + 记忆写执行前预检并喂回模型分拆；写工具失败作为 tool 结果回喂而非终止 run；上下文超限错误识别后强制压缩并重试一次。
- `agentContextBudget`：token 估算计入工具调用参数与附件 base64；合成视觉上下文消息（`AGENT_VISUAL_CONTEXT_MESSAGE`）不再作为压缩边界；压缩摘要请求透传取消信号。
- 写工具返回空 items 不再抛错，走正常空计划审批卡。
- 后端非流式 Agent 调用默认超时（decide 120s、plan 生成与 agent_chat_turn 300s）。
- 对比调研 research 阶段：每篇论文正文配额按 `preset.contextWindow` 动态分配，上下文分批加载（并发 4）。

### UI 布局

- 图表预览 overlay 改 `createPortal` 挂到 body，遮罩不再受 `backdrop-filter` 包含块限制。
- 用户气泡、markdown 段落/列表/链接/代码/表格单元格补断行规则，表格块级横向滚动。
- 折叠侧栏会话圆点移除 12 个上限（容器本可滚动）；思考强度菜单限高 50vh 并可滚动。
- 删除/清空会话前中止对应运行中的 run；capability 恢复确认后写输入框前复查活跃会话；运行守卫同步写 ref。

## 验证

- `npm run build` 通过（tsc + vite）。
- `npm test` 428 个测试全部通过；新增/更新用例：恢复消息清理（孤儿 tool、空 content assistant）、压缩边界跳过视觉伪消息、附件与工具参数计入估算、混合写预检、写工具失败回喂、`appendTrace` 返回值契约。
- 桌面端手工回归未执行；建议重点回归：批量计划执行后切换会话、取消运行后立即重发、中断恢复、对比调研。
