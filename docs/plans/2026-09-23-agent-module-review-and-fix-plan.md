# Agent 模块审查：问题清单与修复方案

- 日期：2026-09-23
- 状态：**已实施**（2026-09-23，分支 `fix/agent-module-review-2026-09-23`，变更记录见 `docs/changes/2026-09-23-agent-module-review-fixes.md`）。唯一未实施项：wheel delegate 触控板惯性（M5，疑似问题，需运行态验证后另行处理）。
- 范围：`src/services/agent*.ts`、`src/features/agent/*`、`src/services/libraryAgent.ts`（ReAct 与 legacy 路径、调研阶段）、`electron/backend/ragStore.cjs` / `aiCommands.cjs` / `agentMemoryStore.cjs` 的 agent 相关段落
- 方法：三个独立只读审查（UI 层 / 架构 / Bug 排查）并行执行，Top 级结论经第二次代码复核（含行号核对与调用链交叉验证）。时序类结论为静态推演，未做运行时复现。

## 总体判断

架构骨架健康：`agentLoop.ts` 是纯函数式、依赖注入的通用 ReAct 循环，读写工具分离 + 审批计划模型清晰，核心纯模块有测试覆盖。问题集中在三处：

1. **运行结束 / 取消 / 恢复的状态收尾不闭环**——高严重度 bug 集中在 `finally` 收尾、500ms 强制清理、中断恢复三段代码；
2. **流式期间的持久化放大**——每个 token 触发 IPC + SQLite 写入 + trace 全量读回 + localStorage 全量序列化，是流式卡顿和事件表膨胀的直接来源；
3. **审批卡生命周期管理缺失**——计划 / 记忆卡执行后不回写终态，导致"复活重复执行"和"重复提交覆盖"两类数据风险。

## 一、必须修复的 Bug

### P0-1. `finally` 中的流式提交覆盖所有终态内容

- **位置**：`src/features/agent/AgentWorkspace.tsx:939-956`（`commitStreamedAgentMessage`）、`1363-1369`（`finally` 无条件调用）
- **问题**：`try` 各分支（answer / plan / error / abort）已写入正确最终内容后，`finally` 再执行一次流式提交，把内容替换为**跨所有轮次累积**的 `streamedAgentAnswer`，meta 固化为字面量 `streaming / Running`，`error` 被清成 `undefined`。
- **后果**：最终答案被"中间轮输出 + 最终答案"拼接文本替换；取消后消息看上去像正常回复；plan 说明文字被模型原始输出覆盖。影响每一次运行。
- **方案**：在 `try` 各结果分支写入最终内容前清空流式缓冲；或引入 `finalized` 标志位，结果分支置 true，`commitStreamedAgentMessage` 仅在未达终态时生效。

### P0-2. 运行恢复对长 run 必然失败，事件表持续膨胀

- **位置**：`AgentWorkspace.tsx:1790`（恢复查询不传 afterId/limit）、`854-858`（每个 `answer_delta` 落库）；`electron/backend/ragStore.cjs:1906-1917`（`ORDER BY id LIMIT 200`）
- **问题**：流式每个 token 产生一条事件行（一次 IPC + 一条 SQLite INSERT + 一次 `agent_runs` UPDATE）；恢复时读到的是**最旧** 200 条——超过约 200 个 delta 的 run，其 `checkpoint` 事件全部在窗口外，恢复静默失败并直接把 run 标记为不可恢复后 aborted。越长的 run 越恢复不了，与设计目标相反。
- **方案**：`answer_delta` 不落库（payload 本来只有字符数，可聚合为每条 assistant 消息一行）；恢复查询改为 `id DESC` 取最新 N 条或按 `kind='checkpoint'` 过滤，并为 `kind` 列加索引。

### P0-3. 已执行 / 已取消的审批计划"复活"，可重复执行本地写入

- **位置**：`AgentWorkspace.tsx:521-532`（`restoreDraftStateFromMessages` 无条件恢复最近 plan 并重置全选）；`applyPlan` / `cancelPlan` 只清 state 不回写消息
- **触发**：执行批量重命名 → 切换会话再切回 → 计划面板复活且默认全选 → 再次「确认执行」→ 同一批写入重复落库。
- **方案**：执行 / 取消后把终态（applied / cancelled）回写到消息或 plan 对象（如 `planStatus` 字段），恢复时跳过终态计划。

### P0-4. 计划项超过 4 个时不可见、不可单独取消，但会被一起执行

- **位置**：`src/features/agent/AgentWorkspaceMessages.tsx:685`（`items.slice(0, 4)`）；`AgentWorkspace.tsx:619-623`（默认全选所有项）
- **后果**：20 项计划用户只能审 4 项，其余 16 项被默认勾选并执行。审批透明度问题，涉及写入安全。
- **方案**：渲染全部项（或折叠但明示未展示项数与内容）；未展示的项不得默认勾选。

### P1-5. 取消按钮的 500ms 强制清理制造双 run 竞态

- **位置**：`AgentWorkspace.tsx:1390-1405`（`handleCancelAgentRun`）
- **问题**：`abort()` 后若 run 未在 500ms 内退出（工具忽略 signal、网络挂起、legacy 路径必然超时），强制删 controller + 清 running 标志；用户立即重发后，旧 run 的 `finally` 会误删**新 run** 的 controller 并把新 run 标为空闲，导致新 run 无法取消、两个 run 互踩会话消息。
- **方案**：去掉定时器强清，`abort()` 后仅依赖 run 自身 `finally` 收敛；`finally` 中校验 controller 身份（`abortControllersRef.current.get(sid) === 本 run controller` 才清理）；UI 取消按钮置 "cancelling" 态直到 running 标志真正消失。
- **关联**：`src/services/libraryAgent.ts:2881-2892` legacy 执行路径不透传 `signal`，取消对其完全无效，且使本竞态必然触发。需为 legacy 链路（`decideLibraryAgentPaperContextOpenAICompatible`、`generateLibraryAgentPlanOpenAICompatible`、`requestDynamicUserChoices`）透传 `signal`。

### P1-6. 进行中的 run 被误判为"中断运行"

- **位置**：`AgentWorkspace.tsx:1786-1830`；`ragStore.cjs:1919-1941`（`listInterruptedAgentRuns` 仅按 `status='running'` 过滤）
- **问题**：切换会话后 run 仍在后台执行是特性，但再次打开该会话时弹出虚假"运行被中断"确认，并把活着的 run 标记为 aborted；之后活 run 的 `finally` 再以 `done` 覆盖，造成 `agent_runs` 状态先错后改的脏写窗口。
- **方案**：渲染进程维护活跃 runId 集合（基于 `abortControllersRef` 的 session→controller 映射同步维护），恢复查询排除本进程活跃 run；或后端 `agent_run_start` 记录进程代际（boot id），恢复查询只返回非本代际的 running 行。
- **附带**：`AgentWorkspace.tsx:1786` 只取 `[0]`，同会话其余遗留 running 行永不清理，每次打开重复提示。

### P1-7. 恢复检查点产生孤儿 tool 消息

- **位置**：`src/features/agent/agentRunRecovery.ts:24-40`；`AgentWorkspace.tsx:96-114`（`recoverySnapshotMessages`）
- **问题**：工具调用轮的 assistant 消息 `content` 为空串，被 `!content` 过滤掉，但其后的 tool 结果消息被保留——恢复出的消息序列含带 `toolCallId` 的 tool 消息却没有前置 assistant `toolCalls` 消息，直接发给 OpenAI-compatible API 多数 provider 会 400 拒绝。另外 `messages.slice(-32)` 可能从 tool 组中间切开制造同样问题，且丢掉 `messages[0]` 的系统提示。
- **方案**：过滤时保留带 `toolCalls` 的 assistant 消息（空 content 用 `' '` 占位）；快照切片后校验首条 role，为 tool 则向前回退到其 assistant 消息；确保系统提示始终保留。

### P1-8. 记忆审批卡可重复提交，旧内容覆盖新记忆

- **位置**：`AgentWorkspace.tsx:1485-1499`（`applyMemoryPlan` 成功后不清除 `message.memoryPlan`）；`AgentWorkspaceMessages.tsx:557-575`（按钮成功后不消失、无拒绝按钮）
- **后果**：记忆是整文件覆盖写，过期卡片的二次点击用旧 content 覆盖新记忆，是数据回退风险。
- **方案**：apply 后回写卡片终态并禁用按钮；增加拒绝按钮。与 P0-3 一起统一为"审批卡生命周期闭环"。

## 二、UI 层问题

### 遮挡 / 布局

| 位置 | 问题 | 方案 |
|---|---|---|
| `AgentWorkspaceMessages.tsx:349` + `index.css:514-520` | 图表预览 `fixed inset-0 z-[100]` 被祖先 `.pq-workspace-surface` 的 `backdrop-filter` 限定为 fixed 包含块，遮罩盖不满视口 | 改用 `createPortal` 挂到 body（`AgentReasoningPicker` 已是正确范式） |
| `AgentWorkspaceMessages.tsx:411-412` | 用户气泡 `max-w-[72%]` + `whitespace-pre-wrap` 无 `break-words`，长 URL / 代码横向溢出；markdown 链接、表格单元格同理 | 补 `break-words` / `overflow-wrap: anywhere` |
| `AgentWorkspaceView.tsx:407` | 折叠侧栏只显示前 12 个会话圆点，其余折叠态不可达 | 折叠态也提供滚动或"更多"入口 |
| `AgentWorkspaceView.tsx:172-181` | 思考强度菜单（约 300px）无 max-height，矮视口可能超顶 | 加 `max-h` + 内部滚动 |

### 逻辑冲突

- **删除 / 清空运行中会话产生孤儿 run**：`handleDeleteHistorySession`（`AgentWorkspace.tsx:1876-1893`）与 `handleClearAgentHistory`（`1895-1913`）不 abort 正在跑的 run；run 继续耗 token，结果被静默丢弃，且取消按钮只认 `activeSessionId`，再无入口中止。方案：删除前 abort 该会话的 run 并等待 `finally` 收敛。
- **中断恢复 confirm 的跨会话竞态**：capability 分支（`1793-1816`）在 `window.confirm` + await 后直接 `setComposerValue`，缺少 loop 分支（`1850`）那样的 `activeSessionIdRef` 复查，可覆盖另一会话的输入框草稿。方案：统一在 await 后复查活跃会话。
- **Capability 触发判定双份实现且基准不同**：UI 内联正则基于 `selectedPapersSnapshot.length`（`AgentWorkspace.tsx:799`）vs 服务层基于 `modelPapersSnapshot.length`（`agentCapabilityTrigger.ts`），进度卡与实际执行路径可分叉。方案：删除 UI 内联判定，统一走服务层单点。
- **运行中守卫可被同 tick 双调用穿透**：`AgentWorkspace.tsx:738-747` 读 `runningSessionIdsRef`（useEffect 同步），同一事件循环内两次 `runAgent` 都可通过。方案：在 `runAgent` 入口同步写入 ref 再 setState。
- **wheel delegate 捕获阶段劫持滚轮（疑似）**：`useWheelScrollDelegate.ts:60-107` 命中委派时 `preventDefault` + 手动 `scrollTop +=`，丢失触控板惯性；聊天容器内 3 处嵌套滚动区依赖 delegate 串联，失效时出现内外都滚不动的死角。

## 三、架构优化建议（按收益 / 代价比排序）

1. **事件持久化瘦身（收益最大，代价小）**：流式 `answer_delta` 每个 token 触发一次 IPC → SQLite 事务（`ragStore.cjs:1834-1858`）→ 主进程 `appendFileSync` + **读回整个 trace 文件**（`agentMemoryStore.cjs:117-139`，返回值被 `aiCommands.cjs:1682` 丢弃）。一次长回答 ≈ 数千次同步主进程 IO，trace 文件 O(n²) 读放大；恢复逻辑只消费 checkpoint 事件，delta 毫无重放价值。方案：delta 不落库、trace 追加去掉全量读回、事件写入批量事务。
2. **流式渲染层持久化节流**：每个 token 全量序列化最多 30 个会话写 localStorage（`AgentWorkspace.tsx:466-468`、`agentSessionState.ts:33-58`）；`saveAgentHistorySessions` 无 try/catch，超配额会在 effect 内抛未捕获异常。方案：delta 不触发会话快照更新；保存防抖（1s trailing）；写盘加容错。
3. **审批卡生命周期闭环**：plan / memoryPlan 统一引入终态字段，恢复与渲染都以终态为准（解决 P0-3、P0-4、P1-8）。
4. **模型调用超时 + 流式 stall 检测**：`electron/backend/utils.cjs:727-728` 默认无超时，provider 挂起只能手动取消。
5. **错误处理对称性**：写工具失败直接终止 run、读工具失败可回喂重试（`agentLoop.ts:323-336`，不对称）；混合 paper+memory 写在工具执行完后才抛错硬失败（`agentLoop.ts:396-413`）；写工具返回空 items 硬失败，但 UI 本就支持空计划文案（`libraryAgent.ts:3115-3127` vs `AgentWorkspace.tsx:1238-1250`）。方案：统一为"错误作为 tool 结果喂回模型"，让模型分拆或改用文字回答。
6. **对比调研上下文无总量上限**：N 篇 × 16,000 字符拼进单 prompt（`libraryAgent.ts:2796-2818`），30 篇约 48 万字符，且 N 篇 PDF 全文并发抽取造成内存峰值。方案：按 `preset.contextWindow` 设总量预算动态分配每篇配额，超出时先摘要化或要求用户缩小范围。
7. **上下文压缩健壮性**：见第五节。

**明确不建议做**：不引入 Redux / Zustand；不再为 legacy / react 双执行路径做兼容抽象（`agentExecutionMode.ts` 已标注过渡产物，应删除而非兼容）；写工具 per-tool schema 细化优先级最低（`convertGeneratedAgentPlan` 已兜底）。

## 四、修复批次建议

| 批次 | 内容 | 理由 |
|---|---|---|
| 第一批（数据正确性） | P0-1、P0-3、P0-4、P1-8 | 都在 UI 层，改动小，直接消除错误结果覆盖与重复写入 |
| 第二批（运行生命周期） | P1-5、P1-6、P0-2、P1-7 | 收尾 / 恢复链路彼此耦合，适合一起改并补单元测试 |
| 第三批（性能） | 架构 1、2 | 流式体验直接受益 |
| 第四批（健壮性） | 架构 4-7 | 按风险逐步推进 |

优先补的单元测试（均为纯函数，覆盖成本低）：`runAgentLoop` 事件序列；`recoveryCheckpointToChatMessages` / `latestAgentRecoveryCheckpoint` 对空 content assistant 消息的处理；事件读取窗口语义。

## 五、上下文自动压缩：现状与不足

**已有自动压缩能力**，链路为 `agentLoop.ts` 每轮开头调用 `compactContextAtTurnBoundary` → `agentContextBudget.ts` 的 `planAgentContextCompaction` 判断是否需要 → `libraryAgent.ts:3229-3268` 注入的 `compact` 回调执行。

工作机制：

1. **触发条件**：`estimateMessagesTokens(messages) > contextWindow - reserve`。窗口取模型 preset 的 `contextWindow`（默认 128,000），reserve 默认 16,384；token 估算为字符数启发式（英文约 4 字符/token，中文约 1.5 字符/token）。
2. **压缩范围**：只压缩根系统提示与**最新一条 user 消息**之间的历史（`findLatestUserTurnBoundary`），当前活跃轮次的工具结果不会被拆开。
3. **压缩方式**：用同一模型（temperature 0、reasoningEffort low）把历史消息 + 产物轨迹（已读论文、引用页码、已执行计划）总结为固定结构的"会话进度摘要"，替换原历史；**摘要调用失败时自动降级**为保留最近 8 条非空消息摘录（`fallbackCompactionSummary`），不会因摘要失败中断 run。
4. **可观测**：压缩后 emit `context_compacted` 事件（token 估算、丢弃消息数、是否 fallback）。

已识别的不足（纳入第三 / 四批修复）：

- **token 估算偏乐观**：`estimateMessagesTokens`（`agentContextBudget.ts:44-46`）只统计 `content`，不含 toolCalls 参数和附件 base64——视觉附件单次最多 8MB，可能在估算未触发压缩时就把请求撑爆。
- **压缩边界误判**：工具视觉附件注入的伪 user 消息（`agentLoop.ts:481-486`）会被当作轮次边界，可能把真实用户指令折进摘要、把 "Visual content returned…" 留作最新 user 消息，导致后续轮次偏离任务。
- **无超限兜底**：压缩后仍超限（或估算漏算）时，ReAct 路径没有 legacy 路径那样的"缩小范围 / 摘要化"动态降级，用户直接拿到 provider 的 400 原始错误。方案：chatTurn catch 中识别 context-size 错误，触发一次强制压缩重试。
- **摘要请求不受取消控制**：`compact` 回调不传 `signal`（`libraryAgent.ts:3229-3258`），用户取消时摘要请求仍跑到完成。

## 审查覆盖与遗留风险

- 已通读：agent 服务层全部、`AgentWorkspace.tsx` 全文（2020 行）、model / state / recovery 全部、后端 agent_run 相关段落。
- 未逐行覆盖：`AgentWorkspaceView.tsx`（1000 行展示层）、`libraryAgent.ts` 中段约 1400 行模型输出解析函数（畸形 JSON、字段缺失边界只抽查了签名）。
- 涉及时序的结论（P1-5 竞态、对比调研内存峰值、wheel delegate 手感）为静态推演，建议修复后做运行时回归。
