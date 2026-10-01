# Agent 回答证据绑定、Capability 注册表、工作记忆与图谱只读工具

- 日期：2026-09-30
- 状态：**阶段 A、A2、A3、B、C、D、E 已实施并完成桌面核心流程回归（2026-10-01）；阶段 F 不在本次实施**。验收边界见 `docs/changes/2026-10-01-agent-desktop-e2e-acceptance.md`。
- 范围：内置 Agent 的回答证据绑定、能力路由、四个本地 Capability、L2/L3 工作记忆契约、图谱只读工具，以及三个桌面使用问题修复（引用列表按文献归类、正文内部 paper ID 解析、截断未产出回答的收尾）。不改外部 MCP 工具面，不改阅读器选区提炼的入口。
- 前置：P3 ReAct、混合检索、三层记忆、对比调研流水线、2026-09-23 审批卡终态与运行恢复修复均已落地。本方案在这些事实之上追加，不重做它们。
- 非目标：技能市场、过夜实验循环、第二模型强制审稿、把 L2/L3 迁成 Neo4j、八级概念抽取、对每一次普通问答再调一次模型做蕴含判断。

## 0. 要解决的问题

当前 Agent 只有一条硬编码分叉：`isComparativeSurveyInstruction` 命中「对比调研」等词，且论文不少于 2 篇时，整段跑 `runComparativeSurveyCapability`，不进入工具循环。其余请求，包括引用核对、笔记聚合、图谱探索，都挤在默认 8 轮 ReAct 里。

长期结论写在 `L2-topics.md` / `L3-synthesis.md`。这两份文件整文件覆盖，系统提示各截 2000 字。文件一长，注入的就是过期摘要，而且和笔记页、图谱关系形成第二套知识库。

图谱服务已经能按 `localNodeId` 取邻域、列出关系、建议关系。Agent 工具表没有对应只读工具。`suggestKnowledgeGraphRelations` 也没有接到循环里。

回答侧还有一个独立缺口。`rag_search` 和论文上下文会把带页码、`blockId` 的片段放进当次运行的引用列表，系统提示只要求 `Prefer evidence from paper context and preserve page citations`。运行结束后，界面挂上的是这批检索结果，不是对回答逐句反查的结果。模型可以给一个加强后的句子挂上正确编号，也可以在片段被截到 4000 字之后用参数知识把句子补完。再加一条“只根据证据写”的提示词几乎不增加调用成本，但写句子和宣布自己遵守了提示词仍是同一次生成，不能在笔记落库前拒绝写错的句子。

这四件事一起做，是因为它们共用同一条边界：

- 能力只在命中时注入说明和阶段机，平时不进主上下文。
- 可复用的研究结论进笔记，关系建议进图谱审批，L2/L3 只留当前任务进度和被否定的主张。
- 图谱探索调用的函数，和普通循环里的只读工具是同一套，不复制一份检索逻辑。
- 每次回答都对当次引用列表做本地绑定。这不是另一次模型调用。语义上的支持、部分支持、库内没有、相反，只在用户进入引用核对时才交给模型判断。

## 1. 现状锚点

| 事实 | 位置 |
| --- | --- |
| 关键词分叉在进入 `runAgentLoop` 之前 | `runConversationalLibraryAgent` 调用 `isComparativeSurveyInstruction` |
| 关键词表与 `paperCount < 2` 短路 | `src/services/agentCapabilityTrigger.ts` |
| 对比调研四阶段、checkpoint、重试 | `src/services/agentCapability.ts` 的 `runComparativeSurveyCapability` |
| 运行结果把 capability 焊死为 `'comparative-survey'` | `LibraryAgentRunResult` 的 `kind: 'capability'` |
| UI 阶段卡同样焊死四个 stage id | `AgentWorkspace.tsx` 的 `createCapabilityView` |
| 恢复只认这一个 capabilityId | `src/features/agent/agentRunRecovery.ts` |
| L2/L3 注入各 `slice(0, 2000)` | `buildReActAgentMessages` |
| 记忆写入只产审批计划 | `write_memory`，`AgentMemoryWritePlan.file` 仅为 `topics` 或 `synthesis` |
| 记忆文件上限目前是 2_000_000 字符，不是工作记忆上限 | `electron/backend/agentMemoryStore.cjs` |
| 笔记写入只产审批计划，已支持 `pageKind` | `write_notes`、`createAgentNoteWritePlan` |
| 笔记宪章：摘录锚点不可改，综述至少两篇文献，问答必须有证据位置 | `docs/notes-charter.md` |
| 阅读器选区提炼是另一条 IPC | `distillExcerpt` → `notes_distill_excerpt_openai_compatible` |
| 图谱节点 id | `paper:${paperId}`、`note:${noteId}`，见 `knowledgeGraphCommands.cjs` |
| 邻域查询已经存在 | `knowledge_graph_get` 的 `localNodeId` + `localDepth`（1–4） |
| 自定义关系落在 JSON 文件，不是 papers 表 | `paperquay-knowledge-graph-relations.json` |
| 回答上的引用列表来自检索累积，不来自逐句核对 | `runAgentLoop` 把 `options.citations` 原样放进结果；`searchRag` 在运行中往同一数组追加 |
| 工具结果过长会被截断 | `agentLoop.ts` 的 `MAX_TOOL_RESULT_CHARS = 4000` |
| 现有提示只表达偏好，不产生可拒绝的状态 | `buildReActAgentMessages` 中的 `Prefer evidence from paper context and preserve page citations` |

实施时不要把 `comparative-survey` 改名。恢复、事件 payload 和已有测试都认这个 id。

## 2. 目标架构

```mermaid
flowchart TD
  user[用户指令与可选能力钉选] --> route[resolveAgentCapabilityRoute]
  route -->|user 或 keyword| cap[Capability Runner]
  route -->|无命中且需要判断| clf[短分类调用]
  clf -->|confidence 达阈值| cap
  clf -->|否则或失败| loop[runAgentLoop]
  route -->|明确不路由| loop
  cap --> tools[同一套只读函数]
  loop --> tools
  tools --> notes[笔记与 RAG]
  tools --> graph[图谱邻域]
  cap -->|笔记草稿| notePlan[write_notes 审批]
  cap -->|被否定的主张| memPlan[write_memory 审批]
  loop --> memPlan
  cap --> bind[bindAnswerEvidence]
  loop --> bind
  bind -->|无额外模型调用| shown[回答照常显示，附绑定计数]
  bind -->|not-in-library 或 partial| rejectNote[拒绝写入 excerpt / synthesis]
  notePlan --> noteDb[notes.sqlite]
  memPlan --> workmem[L2/L3 工作记忆]
```

不变量：

1. 写笔记、写 L2/L3、写图谱关系，都先产计划，用户批准后才落库。阶段 F 之前不新增图谱写入。
2. Capability 失败、分类调用失败、记忆文件不可读，都降级回 ReAct 或空记忆，不阻断普通问答。
3. 能力说明只在该能力被选中时注入。主循环平时只多三个短工具描述，不多四份阶段提示词。
4. `distillExcerpt` 仍只服务阅读器选区。Agent 的笔记能力不得调用它来伪造锚点。
5. 回答证据绑定不发起模型调用。它只使用当次运行已经取回的引用对象。引用核对能力里的 `judge` 阶段才是模型判断，而且只在该能力被选中时运行。

## 3. 回答证据绑定

这一层回答“检索到的片段是否被最终句子用上”，不回答“换一个更会写的提示词能否少写错”。提示词仍然要收紧，但它和绑定是两件事。

### 3.1 为什么检索列表不够

当次引用列表证明这些片段被取回来了。最终回答是模型生成的新文本。两者之间现在没有程序。具体缺口：

- 编号可以是对的，句子却比片段更强。
- `[n]` 可以指向本次运行里不存在的编号。
- 工具结果在 4000 字处截断后，模型可以用参数知识补完后半句，界面上仍显示本次检索到的片段。
- `excerpt` 和 `synthesis` 一旦经审批写入，错误句子会变成笔记库里的事实。宪章已经禁止摘录无中生有，Agent 回答和 `write_notes` 草稿还没有对应的拒绝条件。

不在每次回答后再调一次模型。那会让普通问答稳定地多付一轮生成成本，而多数句子用当次引用对象就能判定“没有挂上库内片段”。语义蕴含、以及片段是否与句子相反，留给第 5.2 节的引用核对，只在用户钉选或分类器选中该能力时运行。

### 3.2 提示词只做便宜的一半

`buildReActAgentMessages` 的证据句改成约束，而不是偏好：

- 实质陈述句末尾必须带本次工具结果里的 `[n]`。
- 库内没有对应片段时，写明“当前库内没有查到”，不要把句子补完。
- 推断必须写成「我的推断」，并且不能放进 `excerpt` 或 `synthesis`。

这只增加几十个 token，不增加调用次数。它降低写错的比例，但不产生可测试的状态，也不能在 `write_notes` 里拒绝草稿。

### 3.3 本地绑定

新增 `src/services/agentAnswerEvidence.ts`。纯函数，输入是已经生成的回答和当次引用数组。

```ts
export type AnswerEvidenceStatus = 'supported' | 'partial' | 'not-in-library';

export interface BoundCitation {
  label: string;
  paperId: string;
  paperTitle: string;
  pageIndex: number | null;
  blockId: string | null;
  snippet: string;
}

export interface AnswerEvidenceClaim {
  text: string;
  status: AnswerEvidenceStatus;
  citations: BoundCitation[];
  reason: 'snippet-overlap' | 'cited-without-overlap' | 'no-citation-in-run' | 'dangling-citation';
}

export function bindAnswerEvidence(input: {
  answer: string;
  citations: Array<{
    label: string;
    paperId: string;
    paperTitle: string;
    pageIndex?: number | null;
    blockId?: string | null;
    previewText?: string;
  }>;
}): { claims: AnswerEvidenceClaim[]; counts: Record<AnswerEvidenceStatus, number> }
```

引用集合必须是运行过程中累积的那一个数组，包括 `searchRag` 在工具执行期间追加的项。不要在 `runAgentLoop` 开始时把数组拍成快照再传给绑定函数。`write_notes` 执行时，通过 `AgentToolRuntimeContext` 读这个活数组。

切句规则：

- 去掉 Markdown 标题、空行、代码块。
- 短于 12 字的句子、纯问句、只含引用编号的行，不计入主张。
- 其余按中英文句号、问号、叹号切开。一条主张最多保留 240 字，超出截断后再判定，避免一段没换行的综述被当成一句。

编号只从当次 `citations[].label` 解析。模型写出的论文标题，只有在引用列表里唯一精确匹配时才可解析。匹配到多篇或匹配不到，视为没有引用。

状态规则，全部是本地字符串检查：

| 状态 | 条件 | reason |
| --- | --- | --- |
| `not-in-library` | 没有解析到任何当次引用，或 `[n]` 不在引用列表 | `no-citation-in-run` 或 `dangling-citation` |
| `supported` | 至少一条解析后的 `previewText` 与主张有重叠 | `snippet-overlap` |
| `partial` | 解析到了引用，但没有任何一条片段达到重叠阈值 | `cited-without-overlap` |

重叠阈值：主张里长度不少于 2 的连续中文片段，或长度不少于 4 的英文词，至少两个出现在对应 `previewText` 中。这不是蕴含判断。它只区分“片段里看得见这些说法”和“只挂了编号”。本函数不产出 `contradicted`。片段意思相反但用词重叠时，这里仍可能是 `supported`；要判相反，走引用核对。

绑定发生在回答已经生成之后：

- ReAct 的 `kind: 'answer'`。
- `comparative-survey` 的 report Markdown，对照 `citationAccumulator`，不额外调用 report 模型。
- `graph-explore` 的报告同样绑定。没有论文焦点、因而没有引用时，报告中的事实句会落成 `not-in-library`。该能力应把缺口写成“当前库内没有这些关系”，这种句子如果带了图谱工具返回的 paperId，绑定函数要把这些 paperId 也视为当次引用。实现上由 `graph-explore` 把报告所用论文补进绑定输入，而不是让绑定函数去查库。

回答照常显示。绑定结果挂在消息上，不替换正文，也不因为存在 `partial` 就阻断发送。用户看到的是计数，不是另一轮生成。

### 3.4 写入门

显示和落库分开。`not-in-library` 与 `partial` 可以出现在对话里，不能进入 `excerpt` 或 `synthesis`。

`write_notes` 在 `createAgentNoteWritePlan` 之前调用 `assertEvidenceForNoteDraft`：

| pageKind | 门 |
| --- | --- |
| `excerpt` | 任一实质句不是 `supported` 即拒绝。无系统锚点的创建仍由第 5.3 节拒绝，两道门都要过 |
| `synthesis` | 任一实质句不是 `supported` 即拒绝。原有“至少两篇论文”的要求保留 |
| `qa` | `not-in-library` 拒绝。`partial` 仅当该句包含「我的推断」时放行，且「证据位置」段里的编号必须能解析到当次引用 |
| `concept`、`paper-card` | `not-in-library` 拒绝。`partial` 仅当该句包含「我的推断」时放行 |
| `index`、`log`、`overview` | 不跑这道门。系统页仍由现有维护逻辑写 |

拒绝方式与现有写工具一致：`write_notes` 抛出包含未通过句子和状态的错误，循环把它当成 `isError` 回注，不生成审批卡，不终止整个 run。笔记蒸馏能力在 `plan` 阶段先调用同一函数；不通过则把错误喂回草稿器一次，仍不通过就返回说明，不产卡。

这道门不调用引用核对，也不调用第二个模型。否则每次准备写综述笔记都会偷偷多一次生成。

### 3.5 与引用核对的分工

| | 回答证据绑定 | 引用核对 `citation-audit` |
| --- | --- | --- |
| 何时运行 | 每次产生回答或综述报告之后；`write_notes` 生成计划之前 | 仅该能力被钉选或分类器选中 |
| 模型调用 | 无 | `extract` 与 `judge` 各有模型调用；`retrieve` 复用现有检索 |
| 状态 | `supported` / `partial` / `not-in-library`，规则是编号解析加片段重叠 | 同样三个状态，外加 `contradicted`；`judge` 只许根据检索片段判定 |
| 失败时 | 绑定函数本身不抛异常；没有引用列表时，实质句全部为 `not-in-library` | 能力失败则回说明，不改写已经显示的普通回答 |
| 笔记 | 能拒绝 `excerpt` / `synthesis` 草稿 | 不创建笔记 |

引用核对不得在普通回答后面自动补跑。用户要语义核对时，钉选该能力，或在下一轮明确要求核对上一句。

## 4. Capability 注册表

新增 `src/services/agentCapabilityRegistry.ts`。注册表是纯数据加 runner 引用，不在模块加载时读库、不调 IPC。

```ts
export type AgentCapabilityId =
  | 'comparative-survey'
  | 'citation-audit'
  | 'note-distill'
  | 'graph-explore';

export interface AgentCapabilityDefinition {
  id: AgentCapabilityId;
  title: { 'zh-CN': string; 'en-US': string };
  /** 选中后才注入，不超过 400 字符。 */
  summary: string;
  stages: readonly string[];
  minPapers: number;
  available?: (ctx: AgentToolMountContext) => boolean;
}
```

四个定义：

| id | UI 名 | 阶段 | 挂载条件 | 结束产物 |
| --- | --- | --- | --- | --- |
| `comparative-survey` | 库内综述 | `rephrase` `decompose` `research` `report` | 论文不少于 2 | 带引用的 Markdown，沿用现有 `ComparativeSurveyResult` |
| `citation-audit` | 引用核对 | `extract` `retrieve` `judge` | 本地库模式 | 主张状态表 + 可选记忆建议，不自动写笔记 |
| `note-distill` | 笔记蒸馏 | `collect` `draft` `plan` | 本地库模式 | `AgentNoteWritePlan`，不直接写库 |
| `graph-explore` | 图谱探索 | `neighbors` `gaps` `topics` `report` | 本地库模式 | 结构化缺口报告，v1 不写关系 |

`LibraryAgentRunResult` 的 capability 分支改为：

```ts
| {
  kind: 'capability';
  capabilityId: AgentCapabilityId;
  result: AgentCapabilityResult;
  citations?: LibraryAgentRagCitation[];
  ragNotice?: string | null;
}
```

`AgentCapabilityResult` 是判别联合：

```ts
export type AgentCapabilityResult =
  | { kind: 'survey'; survey: ComparativeSurveyResult }
  | { kind: 'audit'; audit: CitationAuditResult }
  | { kind: 'note-plan'; notePlan: AgentNoteWritePlan; answer: string }
  | { kind: 'graph-report'; report: GraphExploreReport };
```

现有 `kind: 'capability'` 且只带 `result: ComparativeSurveyResult` 的调用点，在适配层读 `result.kind === 'survey'`。不要让 UI 再假设所有 capability 结果都有 `markdown`。

### 4.1 路由

新增 `src/services/agentCapabilityRoute.ts`。纯函数加一个可注入的分类器，方便测试。

```ts
export type AgentCapabilityRouteSource = 'user' | 'keyword' | 'model' | 'none';

export interface AgentCapabilityRoute {
  capabilityId: AgentCapabilityId | null;
  source: AgentCapabilityRouteSource;
  reason: string;
}

export function resolveAgentCapabilityRoute(input: {
  instruction: string;
  paperCount: number;
  pinnedCapabilityId?: AgentCapabilityId | 'auto' | null;
  mountContext: AgentToolMountContext;
  classifierResult?: { capabilityId: AgentCapabilityId | null; confidence: number } | null;
}): AgentCapabilityRoute
```

判定顺序固定：

1. **用户钉选**。`pinnedCapabilityId` 为具体 id 且 `available` 通过时，直接采用，`source: 'user'`。钉选 `comparative-survey` 但论文少于 2 篇时，不降级去跑别的能力，runner 返回一条说明答案：需要至少两篇论文。这和「静默改走 ReAct」不同，避免用户以为钉选生效了。
2. **关键词兜底**。仅当未钉选或钉选为 `auto`，且 `isComparativeSurveyInstruction` 为真。不新增第二套正则，不把引用核对、笔记、图谱做成关键词表。
3. **模型分类**。仅当前两步都未命中，且指令 trim 后不少于 12 字。分类器由调用方注入。未注入、超时、解析失败、`confidence < 0.75`、或返回的 id 不满足 `minPapers` / `available`，一律 `capabilityId: null`，`source: 'none'`。
4. 分类器不得在主循环的系统提示里再放一份。它自己的提示只列四个 id 和各一句 summary，并写明：文库整理（重命名、标签、分类、元数据）必须返回 null。

分类调用放在 `runConversationalLibraryAgent`，不放进 `runAgentLoop`。参数：`temperature: 0`，`toolChoice: 'none'`，不流式，超时 20 秒，期望输出仅一个 JSON 对象 `{ "capabilityId": string | null, "confidence": number }`。失败只记一条 run 事件 `capability_route_failed`，然后进入 ReAct。

用户钉选和关键词命中都不调用分类器。

### 4.2 与循环的关系

选中 capability 后，不再进入 `runAgentLoop`。这和今天的对比调研一致，避免阶段机和 8 轮工具循环互相抢同一条消息历史。

未选中时，`runAgentLoop` 照旧。第 7 节的三个图谱工具默认挂在这条循环上，因为它们是只读、描述短，不需要先进入 `graph-explore`。

不增加 `select_capability` 工具。中途从循环跳进阶段机会把 checkpoint 切成两套消息，恢复更难测。路由只发生在运行开始。

### 4.3 事件与恢复

保留 `ComparativeSurveyEvent`，在 `libraryAgent` 边界映射为通用事件：

```ts
export type AgentCapabilityEvent =
  | { kind: 'stage_start'; capabilityId: AgentCapabilityId; stage: string; attempt: number }
  | { kind: 'stage_progress'; capabilityId: AgentCapabilityId; stage: string; completed: number; total: number; detail?: string }
  | { kind: 'stage_end'; capabilityId: AgentCapabilityId; stage: string }
  | { kind: 'stage_retry'; capabilityId: AgentCapabilityId; stage: string; attempt: number; error: string };
```

checkpoint payload 改为 `{ capabilityId, artifacts }`。`comparative-survey` 的 artifacts 形状不变，旧恢复数据没有 `capabilityId` 时按 `comparative-survey` 读。

`createCapabilityView` 改为 `createCapabilityView(id: AgentCapabilityId)`，阶段列表来自注册表，不再写死四个 id。

## 5. 四个能力的契约

### 5.1 库内综述

不新写流水线。`comparative-survey` 继续调用 `runComparativeSurveyCapability`。本方案只把它登记进注册表，并让 UI、结果类型和恢复走通用外壳。

行为保持：

- 未钉选时，仍要关键词且论文不少于 2 篇。
- 研究阶段仍按 `contextWindow` 给每篇分配正文配额，全文加载并发 4。
- 取消信号继续透传。
- 不在这条流水线里调用 `write_notes` 或 `write_memory`。用户若要把综述存成笔记，下一轮再走笔记蒸馏或普通 `write_notes`。避免一篇综述运行同时产生两种审批卡。

### 5.2 引用核对

新增 `src/services/agentCitationAudit.ts`。它核对的是用户这句话或指定笔记里的主张，不是给普通问答自动打分。普通回答的编号和片段重叠由第 3 节负责，不进入这里。

```ts
export type CitationAuditStatus = 'supported' | 'partial' | 'not-in-library' | 'contradicted';

export interface CitationAuditClaim {
  id: string;
  text: string;
  status: CitationAuditStatus;
  citations: Array<{
    paperId: string;
    paperTitle: string;
    pageIndex: number | null;
    blockId: string | null;
    snippet: string;
  }>;
  reason: string;
}

export interface CitationAuditResult {
  claims: CitationAuditClaim[];
  markdown: string;
  /** 仅建议，不落盘。由 UI 决定要不要生成 write_memory 审批卡。 */
  rejectedClaimLines: string[];
}
```

阶段：

1. `extract`：从指令中抽出最多 8 条可核对主张。抽不出时直接说明，不编造主张。
2. `retrieve`：每条主张调用与 `rag_search` 相同的检索函数，topK 8。不新写检索器。
3. `judge`：这是本方案里唯一用来判断“片段是否支持这句话”的模型调用。只允许根据第 2 步取回的片段判定四个状态。片段不足以支持时必须是 `not-in-library` 或 `partial`，禁止模型用参数知识把状态改成 `supported`。`judge` 的输入引用必须先经过第 3 节的编号解析；解析不到的主张直接标 `not-in-library`，不再送给 `judge`。

`contradicted` 只在片段明确相反时使用，且只由本能力产出。拿不准用 `partial`。

`rejectedClaimLines` 只收录 `not-in-library` 和 `contradicted`。格式见第 6 节。运行结束时，若该数组非空，结果里带建议，UI 显示「写入工作记忆」按钮，点击后才生成 `AgentMemoryWritePlan`。没有按钮点击就没有任何记忆写入。

本能力不创建笔记。核对结果要留下，走 `qa` 页时必须由用户另一次要求，并走 `write_notes`。

### 5.3 笔记蒸馏

这是把已有摘录、问答页或 RAG 片段收成一张可审批笔记，不是阅读器里的 `distillExcerpt`。

新增 `src/services/agentNoteDistillCapability.ts`。阶段：

1. `collect`：按指令调用 `search_notes`。默认 `pageKind: 'excerpt'`，用户提到概念或跨篇时同时搜 `qa`。没有笔记命中时，允许对已选论文做一次 `rag_search`，但检索片段不能当成摘录卡的原文快照。
2. `draft`：生成一张笔记草稿。页面类型由草稿器选择，允许值只有 `concept`、`synthesis`、`qa`、`paper-card`。默认不允许这个能力创建 `excerpt`。没有系统锚点时，Agent 不能发明 `anchors[]`。
3. `plan`：调用现有 `createAgentNoteWritePlan`。操作种类只有 `create` 或 `update`，本能力不发 `delete`。

草稿约束，在计划构建前用纯函数 `validateAgentDistillDraft` 检查，不通过则把错误喂回草稿器一次，仍不通过就返回说明，不产审批卡：

| pageKind | 要求 |
| --- | --- |
| `concept` | 有定义段；每个实质句用 `[[笔记标题]]` 链回收集到的摘录或问答页；标题不加「笔记」「总结」 |
| `synthesis` | 至少两个不同 `paperId` 的文献引用，引用形式遵守现有 `[n]` + `## 参考文献` 规则 |
| `qa` | 有「证据位置」段，且每条证据带 paperId 与页码或 blockId |
| `paper-card` | 必须有 `paperId`，正文含「我的判断」 |
| `excerpt` | 本能力拒绝。要做摘录卡，走阅读器选区，由系统写锚点 |

更新已有笔记时，`createAgentNoteWritePlan` 已会读出 `before`。本能力不得在 `update` 里改写调用方找不到的锚点文本。计划正文里如果包含 `paperquay://anchor/`，必须原样来自 `before`，否则校验失败。

批准后的落库仍走 `applyAgentNoteWritePlan`。不新增写入通道。

### 5.4 图谱探索

阶段机只负责编排第 7 节的三个只读函数，并写出报告。它不调用 `suggestKnowledgeGraphRelations`，也不调用 `createKnowledgeGraphRelation`。

```ts
export interface GraphExploreReport {
  markdown: string;
  neighbors: GraphNeighborResult[];
  missingEdges: GraphMissingEdge[];
  topics: GraphConceptTopic[];
}
```

焦点论文来自当前 `currentPaperScopeIds`。未选择时，先用 `search_library` 的同一匹配函数从指令里解析最多 8 篇；解析不到就只跑概念主题聚合，并在报告里说明没有论文焦点。

报告可以指出缺边，但措辞必须是「当前库内没有这些关系」，不能写成「这两篇论文无关」。

## 6. 工作记忆契约

L1 `trace/YYYY-MM-DD.jsonl` 不变：继续随 run 事件追加，继续脱敏。它不是研究记忆。

L2 `L2-topics.md` 和 L3 `L3-synthesis.md` 改称为工作记忆。它们不再承担文献结论库。

### 6.1 长度

| 位置 | 现在 | 改后 |
| --- | --- | --- |
| 文件写入上限 | 2_000_000 字符 | L2/L3 各 4_000 字符；trace 上限不变 |
| 系统提示注入 | 各 `slice(0, 2000)` | 各最多 1_200 字符 |
| 超长已有文件 | 会整段注入前 2000 字 | 不自动截断落盘；注入前 1_200 字，并加一行「工作记忆超过上限，文献结论应写入笔记」 |

超限的 `write_memory` 在生成计划前拒绝，不把一份无法落盘的计划交给用户。拒绝信息回注模型，要求改写到上限内，或改走 `write_notes`。

`agentMemoryStore.cjs` 对 `topics` / `synthesis` 使用新上限。不要把 trace 的 8MB 上限套到这两份文件上，也不要把 4_000 套到 trace 上。

### 6.2 文档形状

新增 `src/services/agentMemoryContract.ts`，纯函数，不碰 IPC。

```ts
export interface RejectedClaimLine {
  text: string;
  status: 'not-in-library' | 'contradicted' | 'user-rejected';
  reason: string;
  source: string;
}

export function formatWorkingMemory(input: {
  file: 'topics' | 'synthesis';
  updatedOn: string;
  currentTask: string;
  openQuestions: string[];
  rejectedClaims: RejectedClaimLine[];
  progress?: string;
  nextStep?: string;
}): string

export function parseRejectedClaims(content: string): RejectedClaimLine[]

export function mergeRejectedClaims(
  existing: string,
  incoming: RejectedClaimLine[],
): { content: string; added: number; droppedBecauseFull: number }
```

L2 模板：

```markdown
# Working memory
Updated: 2026-09-30

## Current task

## Open questions

## Rejected claims
```

L3 模板只保留 `## Progress` 和 `## Next step`。不设「文献结论」段。

`mergeRejectedClaims` 按主张文本去重，已存在的否定项不删除。新项放在段尾。合并后超过 4_000 字符时，不再删旧的否定项，返回 `droppedBecauseFull`，由调用方告诉模型改走笔记。否定项优先于开放问题保留。

### 6.3 提示词

`buildReActAgentMessages` 里现在的 `[Local Agent memory]` 块改成固定短政策加可选注入：

- 政策句始终在：工作记忆只记录当前任务、未决问题和已被否定的主张；文献结论、概念定义和跨篇综述写入对应 `pageKind` 的笔记，并等待审批。
- L2/L3 正文仅在文件非空时附加，各截 1_200 字符。
- `write_memory` 的工具描述同步改写：禁止用它保存论文结论；`content` 必须是完整工作记忆文档，不是补丁。整文件覆盖这个现有语义保持不变，避免再做一套 patch 协议。

### 6.4 谁可以建议写入

| 来源 | 可否产生记忆计划 | 条件 |
| --- | --- | --- |
| 模型调用 `write_memory` | 可以 | 内容通过长度和模板校验；文献结论口吻不自动拦截，只靠提示词约束。不做不可靠的语义分类器 |
| 引用核对的 `rejectedClaimLines` | 可以 | 只经过「写入工作记忆」按钮，合并进现有 L2 的 Rejected claims，不覆盖 Current task |
| 笔记蒸馏、库内综述、图谱探索 | 不可以 | 它们的持久化出口是笔记计划或当次报告 |
| 设置页手工编辑 | 保持现状 | 设置页仍可查看和清空；清空仍是用户动作 |

引用核对生成的计划必须用 `mergeRejectedClaims`，不能把模型返回的整份 L2 覆盖掉用户刚批准的任务进度。因此 `AgentMemoryWritePlan` 增加可选字段：

```ts
mode?: 'replace' | 'merge-rejected-claims';
rejectedClaims?: RejectedClaimLine[];
```

缺省 `replace`，与今天的行为一致。`merge-rejected-claims` 在用户批准时才读当前 L2 并合并，避免计划生成和批准之间的覆盖。批准路径仍是 `writeAgentMemory('topics', merged)`。

## 7. 图谱只读工具

新增 `src/services/agentGraphQuery.ts`。查询函数纯计算，输入是已经取回的节点和边。取数在 `agentTools.ts` 里做，测试不需要 Electron。

节点 id 规则与后端一致：`paper:${paperId}`、`note:${noteId}`。工具参数用论文 id 和笔记 id，不要求模型自己拼前缀。拼错前缀时工具先去掉已知前缀再拼一次。

### 7.1 `graph_neighbors`

```ts
export interface GraphNeighborResult {
  focusId: string;
  focusLabel: string;
  nodes: Array<{ id: string; type: string; label: string; paperId?: string; noteId?: string }>;
  edges: Array<{ source: string; target: string; type: string; label: string }>;
  truncated: boolean;
}
```

取数：对每个焦点调用现有 `getKnowledgeGraph`：

```ts
getKnowledgeGraph({
  localNodeId: paperNodeId(paperId),
  localDepth: 1,
  includeCoAuthors: false,
  includeEmbeddingEdges: false,
  includeReferences: true,
  embeddingEdgeLimit: 0,
})
```

深度固定 1。模型传入 2 时接受，但上限 2，避免把全图拉进工具结果。返回最多 40 个节点、80 条边，超出设 `truncated: true`。

默认不含共作者和向量边。这两类边数量大，会把「有没有引用或笔记连接」淹没。向量边只在 `graph_missing_edges` 的第二阶段、并且调用方明确请求时读取。

### 7.2 `graph_missing_edges`

```ts
export interface GraphMissingEdge {
  leftPaperId: string;
  rightPaperId: string;
  leftTitle: string;
  rightTitle: string;
  sharedTags: string[];
  sharedCategoryIds: string[];
  reason: 'shared-tag' | 'shared-category' | 'embedding-near';
}

export function findMissingPaperEdges(input: {
  papers: Array<{ id: string; title: string; tagNames: string[]; categoryIds: string[] }>;
  edges: Array<{ source: string; target: string; type: string }>;
  embeddingPairs?: Array<{ leftPaperId: string; rightPaperId: string; similarity: number }>;
  embeddingMinSimilarity?: number;
}): GraphMissingEdge[]
```

论文集合最多 12 篇。两两组合最多 66 对，输出最多 24 对。

一对论文算「已连接」，只要诱导子图里存在任一路径，边类型属于：

- `paper_cites_paper`
- `paper_reference`
- `custom_relation`
- `ai_suggested`
- 或者两边都有 `note_paper` / `note_link` 指向同一 `note:` 节点

不算连接的边：`paper_tag`、`paper_category`、`co_author`、`related_by_embedding`。共享标签正是缺边的理由，不能同时又算作已经连接。

缺边理由优先级：`shared-tag`，然后 `shared-category`，然后 `embedding-near`。没有共享标签、共享分类，也没有达阈值的向量对，就不报缺边。不要把「没有边」本身报成缺口。

v1 的向量对不是新后端。工具先不含 `embedding-near`。函数把 `embeddingPairs` 留成可选参数，测试覆盖它；工具调用先不传。这样缺边在没有 Embedding 配置时仍然可用，也不必为 Agent 新增一次全库向量扫描。

取数方式：对集合中每篇论文各取一次深度 1 邻域，在工具内合并。不调用不带 `localNodeId` 的全图快照。12 次 IPC 是上限，且每次由后端 `filterLocalGraph` 限制。论文少于 2 篇时返回空数组和说明，不报错。

### 7.3 `graph_concept_topics`

```ts
export interface GraphConceptTopic {
  noteId: string;
  title: string;
  definitionSnippet: string;
  linkedPaperIds: string[];
  linkedPaperCount: number;
}
```

取数：

1. `searchNotes({ pageKind: 'concept', query, limit: 15 })`。无 query 时用指令中的关键词；仍无则列出最近的概念页，limit 15。
2. 对每条结果用已有笔记详情里的链接论文和 `paperId`。不强制再读全图。
3. `definitionSnippet` 取正文前 240 字。没有正文就不编造定义，该字段为空字符串。

这个工具回答「库里已经有哪些概念页，各自挂了哪些论文」。它不抽取新概念，也不合并同义词。同义词合并留给以后的概念抽取，不在本方案。

### 7.4 工具注册

三个工具都是 `kind: 'read'`，`available: (ctx) => ctx.localLibraryMode`。描述各不超过两句，避免把图谱方案写进每次请求。

工具结果仍走 `agentLoop` 的 4000 字截断。上面的节点、边、缺边、主题上限要保证未截断时的 JSON 低于这个上限。截断是兜底，不是正常路径。

`graph-explore` 直接调用这三个函数，不通过模型再选工具名。这样阶段报告和 ReAct 临时查图不会分叉。

### 7.5 明确不做的图谱写入

`suggestKnowledgeGraphRelations` 和 `createKnowledgeGraphRelation` 本方案不接到 Agent。原因：建议关系会调用模型并可能被用户理解成已经写入；自定义关系落在独立 JSON 文件，需要单独的审批卡和终态，比只读工具多一套 UI。

后续若做，单独开一份计划，审批模型照抄笔记计划：生成 `AgentGraphRelationPlan`，批准后才 `createKnowledgeGraphRelation`，拒绝或执行后写终态，避免卡片复活。本文件不实施这一步。

meta-knowledge-graph 的四类研究点，本方案只落「缺边」这一种，而且限定在共享标签或共享分类的论文对。叶节点外延、瓶颈、方法迁移需要概念层级，当前图谱没有这层，不做。

## 8. 使用问题修复

2026-09-30 桌面实操反馈的三个问题。它们共用同一条展示与运行收尾链路，单独成节，可最先合并（见阶段 A3）。

### 8.1 回答后的引用列表按文献归类

**现状**：一次回答后挂着 64+ 个引用胶囊，逐条是 `[n] 标题 第 X 页`。同一篇《加/减速度状态下倾转旋翼飞行器动态过渡走廊》出现十几次，只是页码不同；《风洞试验手册》第 531 页重复出现两次。

**原因**：

- `AgentRagCitationChips`（`AgentWorkspaceMessages.tsx`）直接 `citations.map`，一条引用一个胶囊，没有任何聚合。
- 引用集合按 `(paper, page, block)` 粒度去重（`addUniqueAgentCitations` 以完整 id 为键），同一文献不同页、同一页不同块都保留。
- 列表是整次运行的检索累积（含全部 `rag_search`、`request_paper_context` 命中），不区分回答是否真的用到。

**方案**：

- 新增纯函数模块 `src/features/agent/agentCitationGroups.ts`：`groupAgentCitations(citations)` 按 `paperId` 聚合为 `{ paperId, paperTitle, count, pages: [{ label, pageIndex, blockId, citation }], firstLabel }`。组内按 `pageIndex` 升序，同页多条只保留首条（其余视为同页重复）；无页码条目归组，子项显示 `全文`。
- `AgentRagCitationChips` 改为两级：每组一个主胶囊 `标题 · N 处`（多页写 `· 第 2–16 页`，单页写 `· 第 83 页`）；点击展开组内子胶囊 `[n] 第 X 页`，子胶囊点击仍走现有 `handleOpenRagCitation`。默认全部收起。
- 默认只渲染前 6 组，其余收进「展开全部（N 篇）」。
- 不改引用数据本身，不改跳转协议。证据绑定（第 3 节）落地后可选增加「只看回答引用到的」过滤，默认关。

**验收**：截图中的 64 条渲染为 10 余个主胶囊；同页重复不出现；子胶囊跳转与今天一致。

### 8.2 正文内部 paper ID 解析为可跳转胶囊

**现状**：正文出现 `雅可比矩阵法 (paper_mtst6kd0_83967d5e, p.83)`。`protectBarePaperIds` 只把它包成行内代码，渲染为灰色代码样式，没有标题、没有跳转，用户无法知道是哪篇。

**原因**：

- 模型把内部 ID 抄进正文。系统提示未禁止；payload 中的论文 `id` 字段就是这个形态。
- 渲染层只有「保护」没有「解析」：`protectBarePaperIds(content)`（`AgentMarkdown.tsx`）不接收引用列表，也不生成链接。

**方案**（提示降概率、渲染兜底）：

- 提示层：`buildReActAgentMessages` 的证据句补一句：「引用文献只用 [n] 编号或『标题，第 X 页』；不要在正文写 paper_ / category_ 开头的内部 ID。」与第 3.2 节的证据约束在同一处修改。
- 渲染层：`protectBarePaperIds` 升级为 `resolveBarePaperIds(content, citations, titleFallbackById)`：
  - 匹配 `paper_[A-Za-z0-9_-]{8,}`，并向前吞掉可选的页码尾巴 `[,，]\s*(?:p(?:age)?\.?\s*|第\s*)(\d+)\s*页?`。
  - 在当次 `ragCitations` 中按 `paperId` 找到条目：替换为 `[标题](#agent-paper-<paperId>?page=<1-based>)`；页码尾巴若能与引用条目的 `pageIndex + 1` 对上就用它，对不上按该文献首条引用跳转。
  - `AgentMarkdown` 的 `a` 渲染器增加 `#agent-paper-` 协议：渲染成与 `[n]` 同款的小胶囊（标题 + 可选页码），点击构造 citation 调用现有 `onOpenRagCitation`。
  - `ragCitations` 里找不到该 ID 时，用运行时论文表（渲染侧已有的 `papers` 数据）查标题，仍找不到则退化为当前代码样式并加 `title="未在本次引用中"`。
  - 代码块、行内代码、已有 markdown 链接内不处理（沿用现有 fence 拆分）。
- `category_` 前缀一并支持（同协议走分类跳转，低优先，可留 TODO）。

**验收**：截图中的 `paper_mtst6kd0_83967d5e, p.83` 渲染为「民用飞机总体设计 · 第 83 页」胶囊并可跳转；代码块中的同类字符串保持原样。

### 8.3 截断导致无最终回答的收尾修复

**现状**：执行轨迹显示「第 1 轮完成：length。」，随后「最终回答 SUCCESS 正在生成最终回答。」；消息区是一大段推理文本，最后一行 `The model did not return a final answer.`。用户看到思考但没有回答。

**原因链**（代码核对）：

1. 该轮模型把输出预算花在推理上（或推理走 `<think>` 内容通道），命中 provider 输出长度上限，`finish_reason = 'length'`。
2. `agentLoop.ts` 空正文分支：`const answer = response.content.trim() || 'The model did not return a final answer.'`——空正文被当成正常回答，用英文兜底句结束 run。
3. 全链路没有 `finishReason === 'length'` 的分支：不重试、不报错、不标警告。
4. `AgentWorkspace.model.ts` 的轨迹更新只有 `finishReason !== 'tool_calls'` 就把「最终回答」标 success，界面呈现为成功。
5. `pickChatText` 会剥掉 `<think>` 块；若整段输出都在未闭合 `<think>` 内，最终正文恰好为空，同样落入第 2 条。
6. 输出上限不可配：请求体构造（`utils.cjs`）只有 `reasoning_effort`，没有 `max_tokens` / `max_output_tokens`。推理 effort 高时更容易耗尽默认输出预算。

**方案**（A / B / C 必做，D 可选）：

- **A. 空回答不再当答案**：`agentLoop` 判定「无工具调用且正文为空」时：
  - 追加一条系统消息（仅本次运行内）：「上一次输出被长度限制截断，没有产生最终回答。请直接给出简洁最终回答，不要继续推理，不要输出 think 标签。」；
  - 以强制回答方式再跑一轮（复用现有 `forceFinalAnswer` 机制：`turnTools = []`），最多恢复一次；恢复轮计入轮次预算。
  - 恢复轮产出正文 → 正常返回 answer。
- **B. 明确的失败态替代英文兜底**：
  - 删除 `'The model did not return a final answer.'` 字面量；恢复失败后 emit `error` 事件并抛本地化错误：「模型输出被长度上限截断（finish_reason=length），没有产生最终回答。请重试，或在设置里调低思考强度 / 调大最大输出」。英文对应句同页维护。
  - UI 显示「执行错误」，不再伪装成功。
- **C. 输出上限可控 + 轨迹修正**：
  - `QaModelPreset` 增加可选 `maxOutputTokens`；`readerShared.ts` 归一化（如 256–200000）；模型预设编辑区（`readerPreferencesModelsSection.tsx`，`contextWindow` 输入旁）加选填数字输入。
  - `utils.cjs` 请求体构造：`chat_completions` 写 `max_tokens`，`responses` 写 `max_output_tokens`；留空不发送。runner 透传。
  - 轨迹：`finishReason === 'length'` 时该轮显示警告态「第 N 轮输出被长度上限截断」（不标 success）；只有真实产出回答才把「最终回答」置 success。
  - 恢复轮已用尽仍失败时，消息附注「已尝试自动恢复」。
- **D.（可选，低优先）**：流式期间对 `<think>` 内容做缓冲分流——`<think` 至 `</think>` 之间的文本送 thinking delta，其余送 answer delta；流结束时未闭合的缓冲并入 thinking。避免推理文字在回答气泡里闪现后又被替换。（若确认长文本已走 thinking 通道，可跳过 D。）

**验收**：

- 构造 `finishReason=length` + 空正文的回合，loop 自动追加恢复轮；恢复成功输出最终回答。
- 恢复仍失败：无英文兜底句；轨迹出现「执行错误」，错误信息为中文可读文案。
- 配置 `maxOutputTokens` 后请求体出现对应字段；未配置时请求体与今天一致。
- 正常回答、工具轮、现有测试不受影响。

## 9. UI

改动限于 Agent 工作区，不改图谱工作区的画布。

- 输入区增加能力选择：自动、库内综述、引用核对、笔记蒸馏、图谱探索。默认自动。选择只随本次发送，不写成全局设置。
- 回答和综述报告下方显示证据计数：supported、partial、not-in-library。点击句子只高亮当次片段，不触发新的模型请求。计数来自第 3 节，不来自引用核对。
- 阶段卡用注册表的 `stages` 渲染。进行中、完成、重试的状态字段沿用现在的 stage status，不再假设一定有 `research`。
- 引用核对结果用表：主张、状态、页码、理由。状态用文字，不用只靠颜色。`rejectedClaimLines` 非空时显示「写入工作记忆」，不显示「写入笔记」。
- 笔记蒸馏结束时走现有笔记审批卡。不新做一种卡片。
- 图谱探索结果先作为 Markdown 报告加一个缺边列表。缺边不带「创建关系」按钮。
- 引用胶囊按文献分组（第 8.1 节）：默认每组一个主胶囊，展开显示页码子胶囊。
- 正文中的内部 paper ID 解析为标题胶囊并可跳页（第 8.2 节）。
- 截断或空回答的收尾走「执行错误」样式，不用英文兜底句（第 8.3 节）。

运行记录里增加 `capability_route` 事件：`capabilityId`、`source`、`reason`。分类失败另记 `capability_route_failed`，不把分类器原始输出里的思维链写入 trace。

## 10. 文件改动

| 文件 | 动作 |
| --- | --- |
| `src/services/agentAnswerEvidence.ts` | 新增。回答切句、编号解析、片段重叠、笔记草稿门 |
| `src/services/agentCapabilityRegistry.ts` | 新增。四个定义与查找函数 |
| `src/services/agentCapabilityRoute.ts` | 新增。路由纯函数 |
| `src/services/agentCitationAudit.ts` | 新增。核对阶段与状态归一 |
| `src/services/agentNoteDistillCapability.ts` | 新增。草稿校验与计划组装 |
| `src/services/agentGraphQuery.ts` | 新增。邻域整形、缺边、主题整形 |
| `src/services/agentGraphExplore.ts` | 新增。编排三个只读函数并生成报告 |
| `src/services/agentMemoryContract.ts` | 新增。模板、解析、合并、长度 |
| `src/services/agentCapability.ts` | 不改阶段逻辑。只导出可被注册表引用的定义需要的类型 |
| `src/services/agentCapabilityTrigger.ts` | 保留。禁止在此文件增加新关键词 |
| `src/services/libraryAgent.ts` | 路由、分类调用、通用 capability 结果、记忆注入上限与政策句 |
| `src/services/agentTools.ts` | 注册三个图谱工具；收紧 `write_memory` 描述与长度拒绝；`write_notes` 调用证据门 |
| `src/services/agentLoop.ts` | 工具运行时上下文传入当次引用活数组；回答结果附带绑定计数；截断/空回答恢复与本地化失败态（第 8.3 节） |
| `src/features/agent/agentCitationGroups.ts` | 新增。引用按文献分组纯函数（第 8.1 节） |
| `src/features/agent/AgentWorkspaceMessages.tsx` | 引用胶囊改两级分组渲染（第 8.1 节） |
| `src/features/agent/AgentMarkdown.tsx` | `protectBarePaperIds` 升级为 `resolveBarePaperIds`，支持 `#agent-paper-` 协议（第 8.2 节） |
| `src/features/agent/AgentWorkspace.model.ts` | `length` 结束的轮次显示截断警告，不标成功（第 8.3 节） |
| `src/types/reader.ts` | `QaModelPreset` 增加可选 `maxOutputTokens`（第 8.3 节） |
| `src/features/reader/readerShared.ts` | 归一化 `maxOutputTokens` |
| `src/features/reader/readerPreferencesModelsSection.tsx` | 模型预设编辑区增加最大输出输入 |
| `electron/backend/utils.cjs` | 请求体按 apiMode 写入 `max_tokens` / `max_output_tokens` |
| `src/services/agentMemory.ts` | `AgentMemoryWritePlan` 增加 `mode` 与 `rejectedClaims` |
| `electron/backend/agentMemoryStore.cjs` | L2/L3 写入上限改为 4_000 字符 |
| `src/features/agent/AgentWorkspace.tsx` | 钉选传入运行；通用阶段卡；记忆建议按钮 |
| `src/features/agent/AgentWorkspace.types.ts` | capability 视图改为按 id 生成 |
| `src/features/agent/agentRunRecovery.ts` | 按注册表识别 capabilityId，兼容旧的 comparative-survey payload |
| `tests/agentAnswerEvidence.test.ts` | 新增 |
| `tests/agentCapabilityRoute.test.ts` | 新增 |
| `tests/agentMemoryContract.test.ts` | 新增 |
| `tests/agentGraphQuery.test.ts` | 新增 |
| `tests/agentNoteDistillCapability.test.ts` | 新增 |
| `tests/agentCitationAudit.test.ts` | 新增 |
| `tests/agentCapabilityTrigger.test.ts` | 只断言没有新增关键词路径；现有用例保持通过 |
| `tests/agentCitationGroups.test.ts` | 新增 |
| `tests/agentMarkdownPaperId.test.ts` | 新增 |
| `tests/agentLoopTruncation.test.ts` | 新增 |

不改 `electron/mcp/knowledgeMcpService.cjs`。外部 Agent 仍用现有笔记和文库工具。图谱只读若以后要给 MCP，另作一次协议变更。

## 11. 实施顺序

每阶段都要能单独合并，后一阶段不依赖未落地的写入通道。

### 阶段 A：注册表与路由外壳

- 加入注册表、路由纯函数、通用事件映射。
- `comparative-survey` 走新外壳，输入输出与现在一致。
- 用户钉选接入发送路径。
- 分类器先不调用。`resolveAgentCapabilityRoute` 在未注入 `classifierResult` 时，行为只有钉选和关键词。

验收：未钉选且不含关键词的指令仍进 ReAct。含「对比调研」且论文不少于 2 篇仍进原流水线。钉选引用核对时，即使文本含「对比调研」，也不得进入综述。这个优先级要用测试钉死。

### 阶段 A2：回答证据绑定

可与阶段 A 并行，笔记蒸馏之前必须完成。

- 实现 `bindAnswerEvidence` 与 `assertEvidenceForNoteDraft`。
- ReAct 回答和库内综述报告在返回前绑定，不新增模型调用。
- `write_notes` 对 `excerpt` 和 `synthesis` 执行写入门。
- 收紧系统提示里的证据句。

验收：挂有 `[n]` 但编号不在当次引用列表的句子是 `not-in-library`。编号有效而片段不包含主张用词的句子是 `partial`。这两种句子不能进入 `synthesis` 审批计划。绑定函数的测试里不出现模型或 IPC 调用。

### 阶段 A3：使用问题修复

三个使用问题互相独立，均可最先合并，不依赖 A、A2 或其他阶段。

- 引用分组（第 8.1 节）：纯展示改动。
- paper ID 解析（第 8.2 节）：渲染层解析 + 提示句收紧。
- 截断收尾（第 8.3 节）：`agentLoop` 空回答恢复、本地化失败态、`maxOutputTokens` 透传、轨迹警告态。

验收：见第 12 节新增用例；桌面回归里 64 条引用渲染为分组胶囊，正文 ID 可跳转，length 截断不再出现英文兜底句。

### 阶段 B：图谱只读工具

- 实现 `agentGraphQuery.ts` 和三个工具。
- 工具失败返回错误字符串，由循环按现有 `isError` 回注，不终止 run。
- `graph-explore` 可以在本阶段只作为手动钉选能力跑通；分类器仍不启用。

验收：两篇共享标签且无引用、无共同笔记的论文，出现在缺边列表。已有 `paper_cites_paper` 的一对不出现。概念页工具不创建笔记。

### 阶段 C：工作记忆契约

- 存储上限、注入上限、政策句、`mergeRejectedClaims`。
- 已有超长 L2/L3 不在启动时改写。
- 设置页清空和手工编辑继续可用。

验收：4_001 字符的 `write_memory` 计划被拒绝。合并否定项时，原 Current task 段还在。注入文本不超过 1_200 字符加一行超限说明。

### 阶段 D：笔记蒸馏

- 只产审批计划。
- 校验函数覆盖第 5.3 节的表，并调用第 3 节的证据绑定。
- 确认不调用 `distillExcerpt`。

验收：没有锚点的草稿不能变成 `excerpt`。只有一篇论文引用的草稿不能变成 `synthesis`。通过校验的草稿出现在现有笔记审批卡，未批准时笔记库不变。

### 阶段 E：引用核对与分类器

分类器放到最后。前面四个能力的钉选和综述关键词已经可用，分类器误判不会堵死入口。

验收：分类器抛错时运行仍进入 ReAct，并有 `capability_route_failed`。`confidence` 为 0.74 的 `note-distill` 不得执行。核对结果里没有检索片段的主张，状态不是 `supported`。否定项只有在按钮确认后才进入 L2。

### 阶段 F：不在本次实施

图谱关系审批卡、概念同义词合并、向量缺边、对每一次普通问答自动跑引用核对的 `judge`。本地证据绑定属于第 3 节，是完成条件，不是本阶段的排除项。

## 12. 测试与验证

纯函数测试用仓库现有的 `node --test`，不要新增测试框架。

必须有的用例：

- 路由优先级：钉选 > 关键词 > 分类器 > none。
- 分类器不可用时等于 none，不抛到 `runConversationalLibraryAgent` 之外。
- `comparative-survey` 在论文数为 1 且被钉选时返回说明，不调用 research handler。
- 缺边：共享标签且无桥接边为缺边；仅共享标签边本身不算已连接；引用边或共同笔记算已连接；输出不超过 24 对。
- 邻域整形：深度、节点上限、未知 id 返回空结果而不是抛异常。
- 工作记忆：合并去重、不删除旧否定项、超限丢弃新项并保留旧项、注入截断。
- 笔记草稿：`synthesis` 少于两篇拒绝，`excerpt` 拒绝，锚点链接被改写时拒绝，合法 `concept` 通过并带 `[[标题]]`。
- 回答绑定：悬挂编号为 `not-in-library`；有编号但无片段重叠为 `partial`；片段含主张用词为 `supported`；标题行不计入。
- 笔记门：`synthesis` 含 `partial` 或 `not-in-library` 时不产计划；`qa` 中带「我的推断」的 `partial` 可以过。
- 引用核对：无片段不得为 `supported`；相反片段可为 `contradicted`；空主张列表不产记忆建议。普通回答路径不调用 `judge`。
- 引用分组：同 paper 多页合并一组；组内同页去重保留首条；无页码条目归组显示全文；默认展示上限与展开计数正确。
- paper ID 解析：命中引用时输出标题链接；未命中时保留代码样式并带提示；代码块内不处理。
- 截断收尾：`length` + 空正文触发一次恢复轮；恢复仍空输出本地化错误且不含英文兜底句；正常回答不受影响。
- 最大输出：配置后 `chat_completions` 请求体出现 `max_tokens`、`responses` 出现 `max_output_tokens`；未配置时不出现。

阶段 E 完成后跑：

```bash
npm test
npm run build
```

桌面手工回归覆盖五条：自动模式下的普通问答仍走工具循环，且网络面板里没有绑定阶段的额外模型请求；钉选库内综述的阶段卡按四个阶段更新；笔记蒸馏的审批卡取消后笔记不变；含未绑定句子的综述草稿不出现审批卡；超长旧 L2 文件打开设置页仍能读到全文，注入被截断但不改文件。

## 13. 风险

- **分类器误路由**。所以它最后做，且失败和低置信度都回 ReAct。用户钉选始终可覆盖。
- **邻域 IPC 次数**。缺边最多 12 次深度 1 查询。不在 Agent 路径构建全图。若以后实测慢，再给 `knowledge_graph_get` 加 `focusNodeIds`，不在本方案先改 IPC 协议。
- **工作记忆与笔记双写**。政策句和能力出口分开，就是为了避免同一结论既进 L2 又进笔记。引用核对只把否定项送进 L2，不把支持项摘要写进 L3。
- **旧恢复数据**。没有 `capabilityId` 的 checkpoint 继续按 `comparative-survey` 解释。新能力的 checkpoint 必须带 id，否则恢复逻辑拒绝续跑并提示重新发送，不猜测能力类型。
- **重叠不等于蕴含**。本地 `supported` 只表示片段里看得见主张的用词。用词重叠但意思相反时，这层不会标成 `contradicted`。方案接受这个漏报，不用另一次模型调用去补。需要这层判断时，用户进入引用核对。
- **切句过宽或过窄**。没标点的长段会被截到 240 字再判定，可能把后半句的编号留在下一主张。实施时用固定样例钉住，不在运行时调用模型重切。
- **宪章漂移**。笔记蒸馏的校验表和证据门要和 `docs/notes-charter.md` 第 1、3、4 节一致。实施时如果校验严于宪章，先改宪章再改校验，不在代码里另立一套页面规则。

## 14. 完成定义

以下全部成立：

1. 每次回答和库内综述报告都经过 `bindAnswerEvidence`。该函数不发起模型调用。`dangling-citation` 不会被标成 `supported`。
2. `excerpt` 与 `synthesis` 的 `write_notes` 计划在存在 `partial` 或 `not-in-library` 实质句时不会生成。对话里的回答仍然显示。
3. 四个能力都在注册表里，主系统提示不包含它们的阶段说明。引用核对的 `judge` 不会在普通回答后自动运行。
4. 未钉选、未命中综述关键词、分类器未启用或失败时，行为与现在的 ReAct 一致，外加本地证据绑定。
5. `comparative-survey` 的 id、阶段名和恢复兼容旧数据。
6. 笔记蒸馏只通过现有审批计划写笔记，且不能制造无锚点摘录卡。
7. L2/L3 有 4_000 字符写入上限和 1_200 字符注入上限；否定项合并不覆盖当前任务段；已有超长文件不被静默改写。
8. 三个图谱工具只读，缺边判定不把共享标签边当成已连接，探索报告不写入关系 JSON。
9. 回答后的引用列表按文献分组展示，同页重复合并；展开后仍可回到现有跳转。
10. 正文中的内部 paper ID 渲染为标题胶囊并可跳转；代码块内容不受影响。
11. `finish_reason=length` 导致空正文时自动恢复一次；仍失败则显示本地化错误，不再出现 `The model did not return a final answer.`；`maxOutputTokens` 可选配置并生效。
