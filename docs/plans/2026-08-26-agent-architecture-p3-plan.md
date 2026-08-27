# P3：Agent 架构优化详细实施计划

> 来源：`docs/plans/2026-08-26-library-batch-features-and-bugfixes.md` Q7 节（Agent 架构评估与优化路线图）。
> 本文将该路线图展开为可执行的工程计划，写清数据结构、函数签名、文件改动锚点、分阶段顺序与验证方式。
> 前置状态（2026-08-26）：P0–P2 已完成，其中路线图第 1 项"统一 RAG 状态透传"已随 P0 落地（`ragNotice`），本文不再包含。
> 参考项目：pi（earendil-works/pi，Agent harness）、DeepTutor（HKUDS/DeepTutor）、Yuxi（xerrors/Yuxi），调研结论见 Q7 对比表。

## 0. 现状架构基线（代码事实）

| 层 | 位置 | 关键事实 |
| --- | --- | --- |
| UI | `src/features/agent/AgentWorkspace.tsx`（1441 行）+ `AgentWorkspaceView/Messages/ExecutionCards` | 会话状态 `AgentHistorySession[]`，localStorage `paperquay-agent-history-v1`，最多 30 会话 |
| 服务编排 | `src/services/libraryAgent.ts`（约 2400 行）`runConversationalLibraryAgent` | 两段式：先 `decideLibraryAgentPaperContextOpenAICompatible`（路由决策），后 `generateLibraryAgentPlanOpenAICompatible`（一次调用产出 answer/plan/choice-request/context-request） |
| 后端 LLM | `electron/backend/aiCommands.cjs` | `buildLibraryAgentModelRequest` 组 system prompt + papers payload；唯一工具是 `request_paper_context`（`REQUEST_PAPER_CONTEXT_TOOL`），`toolChoice: 'auto'`；流式经 `AGENT_STREAM_EVENT` 事件 |
| 计划执行 | `libraryAgent.ts` `applyLibraryAgentPlan` | 五类写工具（rename/metadata/smart-tags/clean-tags/classify）生成 `LibraryAgentPlan` → UI 审批 → 落库 |
| RAG | `src/services/localRag.ts` + `electron/backend/ragStore.cjs` | SQLite + sqlite-vec；`retrieveDocumentChunks` 用 `v.embedding MATCH ? AND k = ?` 单向量检索；`rag_chunks` 表含 chunk_id/source_type/page_index/block_id/text |
| 上下文 | `agentPaperScopes.ts`、`loadPaperContext` | 默认 metadata-only；context-request 后按篇加载（RAG 命中用检索片段，否则 MinerU 全文/PDF 文本） |

**核心局限**：模型每轮只能回答或请求上下文一次，不能"查一下→再查一下→综合"；无 FTS 关键词通道；无 token 预算与压缩；无运行级持久化（localStorage 仅存 UI 消息）。

---

## P3-1：ReAct 工具调用循环（核心改造）

> 目标：把"决策 + 单次计划"两段式升级为多轮工具调用循环。模型可自主多轮调用只读工具，最终产出回答或写操作计划；写操作保持现有计划审批不变。

### 1.1 工具注册表

新增 `src/services/agentTools.ts`：

```ts
export interface AgentToolDefinition {
  name: string;
  description: string;
  /** OpenAI function-calling JSON schema */
  parameters: Record<string, unknown>;
  /** read=直接执行；write=转为计划项进入审批流 */
  kind: 'read' | 'write';
  /** 上下文门控：不满足时不挂载（DeepTutor ToolMountFlags 思路） */
  available?: (ctx: AgentToolMountContext) => boolean;
  execute: (args: Record<string, unknown>, ctx: AgentToolRuntimeContext) => Promise<AgentToolResult>;
}

export interface AgentToolResult {
  /** 注入回消息的文本（截断到 MAX_TOOL_RESULT_CHARS=4000） */
  content: string;
  /** UI 卡片数据（引用、论文列表等） */
  cards?: AgentToolCard[];
}

export interface AgentToolMountContext {
  papersCount: number;
  hasOpenDocument: boolean;
  ragReady: boolean;        // embedding 配置完整
  localLibraryMode: boolean;
}
```

**首批工具**（全部是现有能力的薄封装，不引入新后端逻辑）：

| 工具 | kind | 实现来源 | 门控 |
| --- | --- | --- | --- |
| `search_library`（按标题/作者/标签/摘要在当前 papers 中过滤） | read | 纯前端过滤 `papers` | 总是 |
| `read_paper_metadata`（单篇完整元数据） | read | `LiteraturePaper` 字段 | 总是 |
| `read_paper_overview`（读 `aiSummary`/概览缓存） | read | `readerLibraryPreview.readSavedPreviewSummary` 复用 | `localLibraryMode` |
| `rag_search`（对指定论文做 RAG 检索，返回带页码片段） | read | `resolveLocalRag` 复用，question=args.query | `ragReady` |
| `request_paper_context` | read | 现有工具原样迁移 | `papersCount > 0` |
| `rename/metadata/smart-tags/clean-tags/classify` | write | 现有 plan 生成逻辑 | 总是（走审批） |

`rag_search` 返回结构（引用回溯基础）：

```ts
{ chunks: Array<{ paperId: string; page: number | null; blockId: string | null; snippet: string; score: number }> }
```

### 1.2 循环运行时

新增 `src/services/agentLoop.ts`：

```ts
export interface AgentLoopOptions {
  maxTurns?: number;            // 默认 8，防失控
  preset: LibraryAgentModelPreset;
  tools: AgentToolDefinition[]; // 已按门控过滤
  mountContext: AgentToolMountContext;
  runtimeContext: AgentToolRuntimeContext;
  onEvent?: (event: AgentLoopEvent) => void;
  signal?: AbortSignal;
}

export type AgentLoopEvent =
  | { kind: 'turn_start'; turn: number }
  | { kind: 'tool_call'; turn: number; name: string; args: Record<string, unknown> }
  | { kind: 'tool_result'; turn: number; name: string; ok: boolean; preview: string }
  | { kind: 'answer_delta'; text: string }
  | { kind: 'turn_end'; turn: number; finishReason: string };

export async function runAgentLoop(options: AgentLoopOptions): Promise<LibraryAgentRunResult>
```

循环逻辑：

1. 维护 `messages: AgentLoopMessage[]`（system + 历史 + user + 逐轮 assistant/tool）。
2. 每轮调后端新命令 `agent_chat_turn`（见 1.3），带当前工具 schema。
3. 若返回 `tool_calls`：
   - 只读工具：并行执行（pi 默认 parallel），结果截断后以 `role: 'tool'` 消息追加，进入下一轮；
   - 写工具：**不直接执行**——收集为 `LibraryAgentPlanItem[]`，循环终止，返回 `kind: 'plan'` 走现有审批 UI（`beforeToolCall` 审批语义的本地化版本）。
4. 若返回文本 → `kind: 'answer'`，结束。
5. 达到 `maxTurns` → 强制收尾：注入一条 system 消息"请基于已获得的信息直接回答"，最后一轮禁止工具。
6. 工具执行抛错 → 以 `isError: true` 的 tool 消息回注（pi 约定：工具失败 throw，由循环转成 tool 错误消息），模型可自我修正。

**与现有入口的关系**：`runConversationalLibraryAgent` 保留为兼容包装——内部改为调用 `runAgentLoop`；`decideLibraryAgentPaperContext` 首轮路由**保留**（它省 token 且体验好），路由结果作为循环的初始上下文注入。`buildToolUseLibraryAgentPlan`（指定工具直出计划）不受影响。

### 1.3 后端改动（`electron/backend/aiCommands.cjs`）

新增命令 `agent_chat_turn`：

```js
async agent_chat_turn({ request }, event) {
  // request: { options: {baseUrl, apiKey, model, apiMode, temperature, reasoningEffort},
  //            messages: OpenAI 格式消息数组（前端维护）, tools: JSON schema[] | undefined,
  //            toolChoice: 'auto' | 'none', stream: boolean, requestId }
}
```

- 复用 `openAiChat` / `readOpenAiStreamResponse` / `pickToolCalls` / `pickChatThinking`（全部已存在）。
- 消息构建从前端移到调用方传入（当前 `buildLibraryAgentModelRequest` 在后端组 prompt——ReAct 化后 messages 由前端循环维护，后端退化为"带 PaperQuay 默认 system 前缀的通用 chat 转发"。system 前缀抽取为 `buildAgentSystemPreamble(options)` 仍由后端拼接，保证文献库 payload 注入逻辑不丢）。
- 流式事件复用 `AGENT_STREAM_EVENT`，payload 增加 `kind: 'tool_calls'`（一轮结束时携带解析后的 tool calls）。

### 1.4 UI 改动

- `AgentChatMessage` 增加 `steps?: AgentTurnStep[]`（每轮的工具调用/结果/耗时），渲染为可折叠的"执行轨迹"（现有 `AgentTraceStep`/`AgentExecutionCards` 模式扩展，不新造组件）。
- 运行中显示当前轮次与正在执行的工具（`turn_start`/`tool_call` 事件驱动）。
- 计划审批 UI 不变。

### 1.5 验证

- `tests/agentLoop.test.ts`：mock `agentChatTurn` 驱动循环——只读工具多轮后回答、写工具转 plan、maxTurns 强制收尾、工具报错回注、abort 中断。
- 手工回归：普通问答 / 跨多篇论文比较（触发多次 rag_search）/ 批量重命名（仍弹审批）。

---

## P3-2：混合检索（FTS5 + 向量 RRF 融合）

> 目标：向量检索之外增加关键词通道，解决专有名词/型号/公式符号等向量不敏感查询的 miss；引用结构保持 `{paperId, page, blockId}`。

### 2.1 存储改动（`electron/backend/ragStore.cjs`）

建库时新增 FTS5 虚表（与 `rag_chunks` 外部内容关联）：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
  text,
  content='rag_chunks',
  content_rowid='id',
  tokenize='unicode61'
);

-- 同步触发器
CREATE TRIGGER IF NOT EXISTS rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
  INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN
  INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN
  INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO rag_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
```

兼容性：`CREATE VIRTUAL TABLE` 失败（旧 SQLite 无 FTS5）时 catch 并记录 `ftsAvailable=false`，退回纯向量检索（优雅降级）。首次升级对已有库执行一次性回填：`INSERT INTO rag_chunks_fts(rag_chunks_fts) VALUES('rebuild')`。

### 2.2 检索融合

`retrieveDocumentChunks` 扩展为：

```js
function retrieveDocumentChunks(request) {
  // request 新增 queryText?: string
  const vectorResults = /* 现有 sqlite-vec 查询 */;
  if (!request.queryText?.trim() || !ftsAvailable) return vectorResults;
  const ftsResults = searchFts(db, request.queryText, documentKey, sourceType, topK * 2);
  return rrfFuse(vectorResults, ftsResults, { k: 60 }).slice(0, topK);
}

// RRF：score(d) = Σ 1 / (k + rank_i(d))，两路各自排序后按名次融合
function rrfFuse(vectorRows, ftsRows, { k = 60 } = {}) { /* ... */ }
```

- FTS 查询：`SELECT rowid, bm25(rag_chunks_fts) AS rank FROM rag_chunks_fts WHERE rag_chunks_fts MATCH ?` + document_key/source_type 过滤（JOIN rag_chunks）；query 先做 token 转义（双引号包裹、去 `MATCH` 运算符字符），多词默认 OR。
- 结果结构与现有一致（`chunkId/sourceType/pageIndex/blockId/text/score`），score 归一化到 RRF 分值；`localRag.ts` 的 `filterRelevantRetrievals` 基于相对 margin 过滤，对 RRF 分值同样适用，无需改。
- `src/services/rag.ts` 的 `RagRetrieveRequest` 加 `queryText?: string`；`localRag.ts` 调 `ragRetrieveDocumentChunks` 时传 `question`（现成）。

### 2.3 验证

- `tests/ragStore.test.ts` 新增：FTS 命中关键词但向量未命中的 chunk 进入最终结果；FTS 不可用时降级为纯向量；触发器同步（更新 chunk 文本后 FTS 结果更新）。
- 手工：对一篇含特定型号/缩写（如 "MTOW"、"L/D"）的论文提问该缩写，对比纯向量与混合检索的引用命中。

---

## P3-3：上下文压缩与三层记忆

> 目标：长会话不爆 context；跨会话记住"用户研究主题、已读论文、已有结论"。借鉴 pi 的 turn 边界压缩与 DeepTutor 的 L1/L2/L3 文件型记忆，落地为本地优先形态。

### 3.1 Turn 边界自动压缩（`src/services/agentContextBudget.ts`）

- token 估算：`estimateTokens(text) = ceil(chars / 4)`（英文）与中文按 `chars / 1.5` 取大者；无需引入 tokenizer 依赖。
- 触发条件（每轮调用前检查）：

```ts
const budget = preset.contextWindow ?? 128_000;
const reserve = 16_384; // pi 默认同款
if (estimateMessagesTokens(messages) > budget - reserve) → compact()
```

- **只在 user turn 边界切割**，绝不在 tool result 中间切（pi 原则）：找最近的 user 消息索引作为切点。
- 压缩调用：用当前 preset 以低 reasoning（low）跑摘要，输出固定结构（注入为一条 system 消息）：

```
## 会话进度摘要
- 目标: ...
- 已完成: ...
- 关键决定: ...
- 引用的论文与页码: [paperId#page]
- 下一步: ...
```

- **产物轨迹累积**（pi `details.readFiles` 思路）：`AgentSessionArtifacts { readPaperIds: string[]; citedPages: string[]; appliedPlanIds: string[] }` 在压缩前后都保留，追加到摘要消息尾部，跨压缩不丢。

### 3.2 三层记忆（本地文件，用户可见可编辑）

存储位置：`{userData}/PaperQuay/agent-memory/`（与现有 SQLite 并列）：

```
agent-memory/
  trace/YYYY-MM-DD.jsonl      # L1：append-only 事件（tool_call/答案/计划应用）
  L2-topics.md                # L2：按主题整理的事实（带 L1 行号引用）
  L3-synthesis.md             # L3：跨主题综合（带 L2 小节引用）
```

- L1 写入：P3-4 的事件日志天然复用（同一事件流双写）。
- L2/L3 更新：手动触发 + 会话结束时可选"整理记忆"按钮（一个专门的 LLM 调用，读取增量 trace 更新 L2/L3 文件）；Agent system prompt 中注入 L2/L3 摘要（各截断 2000 字符），并提供 `read_memory`/`write_memory` 只读/审批写工具（P3-1 工具表扩展）。
- UI：设置页新增"Agent 记忆"区：查看/编辑/清空三个文件，显示大小与更新时间。

### 3.3 验证

- `tests/agentContextBudget.test.ts`：token 估算边界、切点选择（不在 tool result 中间）、摘要消息结构。
- 手工：连续 20+ 轮问答观察压缩发生与回答质量；记忆文件可编辑后下一轮生效。

---

## P3-4：可观测性与会话恢复

> 目标：每次 Agent 运行可追溯（事件日志）、可恢复（中断续跑）、可度量（token 用量）。

### 4.1 运行事件日志

新增 SQLite 表（放 `paperquay-rag.sqlite` 同库，避免新库文件；`ragStore.cjs` 初始化时建表）：

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,           -- running | done | error | aborted
  model TEXT, preset_id TEXT,
  instruction TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  turns INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agent_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- turn_start | tool_call | tool_result | answer_delta | error
  payload TEXT NOT NULL           -- JSON
);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON agent_run_events(run_id, id);
```

- 写入点：`runAgentLoop` 的 `onEvent` 默认处理器（前端）→ 新 IPC `agent_run_event_append` / `agent_run_finish`（`aiCommands.cjs`）。
- token 用量：后端 `openAiChat` 响应的 `usage` 字段透传到 turn 结束事件（chat/completions 与 responses 模式都有）；不支持 usage 的服务商记 0。
- 状态栏：Agent 输入框旁显示本次运行累计 token（`agent_runs` 实时累计），会话列表显示各会话总用量。

### 4.2 会话恢复与 fork

- 运行中断（关窗/崩溃）：`agent_runs.status='running'` 残留即"可恢复"——下次打开会话时提示"上次运行中断，是否从最近完整轮继续？"，从 `agent_run_events` 重建 messages 到最近 `turn_end`。
- Fork：会话消息菜单加"从此处分支"——复制 `messages[0..i]` 为新会话（localStorage 层即可，消息已有稳定 id；参考 pi 会话树，简化为单次 fork 不做多分支树）。

### 4.3 验证

- `tests/ragStore.test.ts`（或新 `tests/agentRuns.test.ts`）：事件追加、状态流转、用量累计。
- 手工：运行中断网 → 重开提示恢复；fork 后两会话互不影响。

---

## P3-5：重任务 Capability 化（综述/批量调研流水线）

> 目标：把"多阶段、长耗时"的请求从单轮对话中解放出来，成为显式阶段的流水线（DeepTutor Level-2 Capability 思路）。以"选中论文的对比调研报告"为首个落地场景（复用现有综述能力的输入端）。

### 5.1 结构

```ts
export interface AgentCapability {
  id: string;                   // 'comparative-survey'
  stages: CapabilityStage[];    // 显式阶段
  run: (input, ctx, emit) => AsyncGenerator<CapabilityEvent, CapabilityResult>;
}

// comparative-survey 的四阶段：
// rephrase（改写调研问题）→ decompose（分解子题）→ research（逐子题 rag_search 循环）→ report（综合成文）
```

- 每个阶段经统一事件总线（复用 P3-4 的 run events）汇报 `stage_start/progress/stage_end`；产出统一信封 `{ markdown, citations, tokenUsage, artifacts }`。
- 触发：Agent 检测到调研类指令时返回 `kind: 'capability'` 结果（`LibraryAgentRunResult` 扩展一个分支），UI 渲染阶段进度卡片（可取消）。
- 中间产物：每阶段结果写入会话 artifacts（P3-3），中断后可从最近阶段续跑。

### 5.2 验证

- 单测：阶段顺序、失败重试、取消传播。
- 手工：对 3 篇选中论文跑对比调研，检查阶段进度、引用与最终报告。

---

## P3-6：让 Agent 看到论文图片（视觉上下文注入）

> 目标：RAG 命中或按需取出的论文图片（MinerU figure/table 块）以视觉附件形式注入模型请求，Agent 可以回答"图 3 说明了什么"这类问题。前提：当前 Agent 模型 preset 需为视觉模型。

### 6.1 现状基础（代码事实，链路均已存在）

| 环节 | 位置 | 事实 |
| --- | --- | --- |
| 图片资源定位 | `src/services/mineru.ts` | `extractMineruAssetPathFromBlock(block)` 提取相对路径；`resolveMineruAssetPath(mineruPath, rel)` 解析为绝对路径 |
| 图片读取 | `src/services/assets.ts` | `loadLocalAssetDataUrl(path)` 读本地文件为 dataUrl（带缓存） |
| 论文图片清单 | `src/services/libraryAgent.ts` `loadMineruAgentContext`（L672 起） | 已产出 `figures: LibraryPaperReviewFigure[]`（id/caption/pageIndex/blockId/assetPath），目前仅供综述使用，未注入对话 |
| RAG 关联 | `src/features/reader/readerRag.ts` `buildMineruRagChunks` | 检索 chunk 带 `blockId`，与 MinerU block 一一对应 |
| 视觉注入通道 | `electron/backend/aiCommands.cjs` L442 | 后端已把消息中 `dataUrl && (kind === 'image' \|\| 'screenshot' \|\| mimeType.startsWith('image/'))` 的附件作为 vision 内容发给模型——**无需改后端** |

### 6.2 方案设计（两层，先独立落地、后并入 ReAct）

**F1：RAG 命中图片自动随行（不依赖 P3-1，可独立发布）**

在 `loadPaperContext`（`libraryAgent.ts`）的 RAG 命中路径中：

1. `resolveLocalRag` 返回的 `citations`/`retrievals` 含 `blockId`；用它反查 `mineruContext.blocks` 中 `type === 'image' | 'table'` 的块；
2. 对命中的 figure 块执行 `resolveMineruAssetPath` → `loadLocalAssetDataUrl`；
3. 构造 `DocumentChatAttachment`（`kind: 'image'`、`name: \`fig-p${pageIndex + 1}\`、`mimeType`、`dataUrl`、`summary: caption`），挂到该轮 Agent 请求的用户消息 `attachments` 上；
4. `LibraryAgentRunResult` 的 answer/plan 分支增加 `figures?: LibraryPaperReviewFigure[]`（字段已存在于 PaperContextPayload，透传即可），UI 在引用区显示图片缩略图（复用 `AgentRagCitationChips` 位置，新增图片 chip，点击放大）。

**F2：ReAct 工具（依赖 P3-C）**

- 新增只读工具 `read_paper_figure(paperId, blockId | pageIndex)`：返回指定图的 dataUrl + caption，由模型自主决定何时看图；
- `rag_search` 工具结果中 figure 块附带 `hasImage: true` 标记，引导模型按需调用 `read_paper_figure`（避免每轮无条件带图）。

### 6.3 成本与安全约束（硬限制）

```ts
const AGENT_VISION_LIMITS = {
  maxImagesPerTurn: 4,           // 单轮最多注入图片数
  maxImageEdge: 1568,            // 最长边像素（OpenAI high-detail 阈值）
  maxTotalBytes: 8 * 1024 * 1024 // 单轮图片 dataUrl 总大小上限
};
```

- 图片压缩：渲染层用 Canvas 重采样到 `maxImageEdge` 以内，转 JPEG（quality 0.85）；超限图片跳过并计入 `ragNotice` 式提示。
- 命中图片超过上限时按检索 score 排序截取，未注入的图在引用区显示"另有 N 张图未注入"。
- **视觉能力检测**：`QaModelPreset` 增加 `supportsVision?: boolean`（设置页 preset 编辑区加复选框，默认 false）；非视觉 preset 时跳过图片注入并在 meta 中提示"当前模型不支持视觉，图片未发送"。不设自动探测（OpenAI 兼容服务无统一能力查询接口，手动标记最可靠）。

### 6.4 涉及文件

| 文件 | 改动 |
| --- | --- |
| `src/services/libraryAgent.ts` | F1 注入逻辑、`figures` 透传、F2 工具注册 |
| `src/services/agentVision.ts`（新增） | 图片收集、压缩、限额、attachment 构造（纯函数可测） |
| `src/types/reader.ts` | `QaModelPreset.supportsVision` |
| `readerPreferencesModelsSection.tsx` | preset 编辑区加"支持视觉"复选框 |
| `AgentWorkspaceMessages.tsx` | 引用区图片缩略图与放大预览 |
| `tests/agentVision.test.ts`（新增） | 限额、压缩参数、blockId 反查、非视觉模型跳过 |

### 6.5 验证

- 单测：限额截断、caption 注入 summary、非视觉 preset 跳过。
- 手工：视觉模型 preset 下问"论文中的架构图展示了哪些组件"，确认回答引用图片且引用区出现缩略图；切非视觉 preset 确认提示与不注入。

---

## 实施顺序与依赖

| 阶段 | 内容 | 依赖 | 规模估计 | 风险 |
| --- | --- | --- | --- | --- |
| **P3-A** | P3-4.1 事件日志与 token 用量（表结构 + 埋点 + 状态栏） | 无 | 1.5 天 | 低，纯增量 |
| **P3-B** | P3-2 混合检索（FTS5 + RRF） | 无 | 1.5 天 | 中（FTS5 可用性需降级保护） |
| **P3-C** | P3-1 ReAct 循环（工具注册表 + agentLoop + 后端 `agent_chat_turn` + UI 轨迹） | 无（P3-A 完成后直接受益） | 4-5 天 | 高：核心链路改造，需保留旧路径开关 `settings.agentLegacyMode`（默认关，一个版本后移除） |
| **P3-D** | P3-3 上下文压缩 + 三层记忆 | P3-C（循环内的预算检查点） | 3 天 | 中（压缩质量影响体验，先保守阈值） |
| **P3-E** | P3-4.2 恢复与 fork + P3-5 Capability | P3-A、P3-C | 3-4 天 | 中 |
| **P3-F** | P3-6 视觉上下文：F1 RAG 图片随行（独立可发），F2 读图工具（挂 P3-C 后） | F1 无依赖；F2 依赖 P3-C | 2-3 天 | 中（图片 token 成本） |

**总顺序**：P3-A → P3-B → P3-C → P3-D → P3-E。A/B 可并行，C 是最大单点，D/E 依赖 C 的稳定。**P3-F1 独立，可在 P3-B 之后随时插入发布**；F2 随 P3-C 落地。

**每阶段验收基线**：`npm run build` + `npm test` 全绿；新增逻辑均有 `tests/` 单测；核心路径桌面端手工回归；用户可感知变化按 `docs/changes/` 格式记录；完成后递增版本发布（参照 `docs/RELEASE.md`）。

## 风险与回退

1. **ReAct 循环回归风险**：保留 `runConversationalLibraryAgent` 旧路径与设置开关，一个版本周期内可随时切回。
2. **FTS5 不可用**：旧版 SQLite 环境降级为纯向量检索（代码内 catch + 日志），不阻塞升级。
3. **压缩丢信息**：只在 user turn 边界切 + 产物轨迹累积；摘要失败时退化为"截断最旧消息"策略。
4. **记忆文件误写**：`write_memory` 属写工具，走审批；L2/L3 文件人类可读可编辑，损坏时可手动修复或直接删除重建。
5. **token 成本**：循环与多阶段会显著增加调用量——UI 常显累计 token（P3-A），`maxTurns` 与每工具结果截断是硬约束。
