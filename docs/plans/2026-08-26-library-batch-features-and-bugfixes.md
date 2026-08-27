# 2026-08-26 文库批量功能、RAG/概览 Bug 修复与 Agent 架构评估计划

> 本文以问答形式梳理本轮提出的全部需求与问题，给出根因分析、技术方案、涉及文件与实施顺序。
> 需求来源：用户反馈（2026-08-26），附两张截图（概览重复生成、侧栏 RAG 404）。
>
> **状态（2026-08-26 更新）**：P0–P2 已全部完成并通过 `tsc` / `npm test`（195 例）/ `npm run build` 验证，详见 `../changes/2026-08-26-library-batch-ops-and-rag-overview-fixes.md`。P3（Agent 架构优化）尚未开始，仍按 Q7 路线图执行。

## 需求总览

| # | 类型 | 内容 | 本文章节 |
| --- | --- | --- | --- |
| 1 | 新功能 | 文库页多选文献并批量操作 | Q1 |
| 2 | 新功能 | 批量标题翻译 | Q2 |
| 3 | 新功能 | 批量导出 Bib 文件（两种格式） | Q3 |
| 4 | Bug | 已生成的概览在重新打开文献时再次生成 | Q4 |
| 5 | Bug | 阅读器侧栏问答 RAG 报 `Embedding HTTP 404`，Agent 处"看似正常" | Q5 |
| 6 | Bug/增强 | 侧栏问答找不到思考强度设置；Agent 缺少 max 档 | Q6 |
| 7 | 架构评估 | 当前 Agent 架构是否完善，参考 pi / DeepTutor / Yuxi 的优化方向 | Q7 |

---

## Q1：文库页如何支持多选文献并批量操作？

### 现状

- `src/features/literature/LiteratureLibraryView.tsx` 中只有单选状态：`selectedPaperId: string | null`（约 L262），`selectedPaper` 取单个文献传给右侧 `LiteraturePaperDetails`。
- `src/features/literature/components/LiteraturePaperList.tsx` 列表行只有单击选中（`onSelectPaper(paper.id)`）+ 双击打开 + 右键菜单 + 拖拽排序/拖拽分类，没有 checkbox 与多选态。
- 后端命令均为单篇粒度：`library_update_paper`、`library_delete_paper`、`library_assign_paper_category`（`electron/backend/libraryCommands.cjs`），没有批量命令，但循环调用即可满足。

### 方案

**1. 状态与交互（LiteratureLibraryView / LiteraturePaperList）**

- 新增 `selectedPaperIds: string[]`（有序，保留最后选中项作为"锚点"），保留 `selectedPaperId` 作为主选中（详情面板仍显示单篇）。
- 交互遵循桌面惯例：
  - 普通点击：单选（清空多选）。
  - `Ctrl/Cmd + 点击`：切换该篇选中态。
  - `Shift + 点击`：从锚点到当前行范围选择（按当前列表顺序）。
  - 行首新增 checkbox 列（hover 或已有选中时显示，避免常态视觉噪音），与现有 `GripVertical` 拖拽手柄共存：多选激活时隐藏拖拽手柄，避免拖拽排序与多选拖拽移动分类冲突。
  - `Esc` 或点击空白处清除多选；`Ctrl/Cmd + A` 全选当前过滤结果。
- 拖拽到分类树时，若拖拽的文献在多选集合内，则整组移动（复用现有 `library_assign_paper_category` 循环）。

**2. 批量操作栏**

- 多选数量 ≥ 2 时，在列表顶部（或底部浮动条）显示批量工具栏：`已选 N 篇 | 翻译标题 | 导出 Bib | 移动分类 | 收藏/取消收藏 | 删除 | 取消`。
- 删除、移动分类、收藏：循环调用现有单篇命令，全部完成后统一 `loadPapers()` 刷新；删除需二次确认对话框。
- 翻译标题、导出 Bib 见 Q2、Q3。
- 与 Agent 联动（可选增强）："发送到 Agent"把选中集合写入 Agent 的 `currentPaperScopeIds`（`src/features/agent/agentPaperScopes.ts` 已支持 scope 概念）。

**3. 涉及文件**

| 文件 | 改动 |
| --- | --- |
| `src/features/literature/LiteratureLibraryView.tsx` | 多选状态、批量工具栏、批量操作 handlers |
| `src/features/literature/components/LiteraturePaperList.tsx` | 行 checkbox、多选高亮、Shift/Ctrl 键处理、批量拖拽 |
| `src/services/library.ts`（或对应 service 封装） | 视情况增加 `updatePapers`/`deletePapers` 批量封装（前端循环即可，非必须） |
| `tests/` | 新增多选状态 reducer/工具函数的纯逻辑测试（范围选择、反选、与排序/过滤交互） |

**4. 注意点**

- 多选与手动排序拖拽（`manualSortingEnabled`）互斥：多选激活时禁用排序拖拽。
- `LiteraturePaperDetails` 在多选时显示"已选 N 篇"摘要 + 批量操作入口，单选时保持现状。
- 右键菜单在多选状态下对整组生效。

---

## Q2：如何批量翻译文献标题？

### 现状

- 已存在**单篇**标题翻译：`useReaderLibraryActions.ts` 的 `handleNativeLibraryTranslatePaperTitle`（约 L868），调用 `translateTextOpenAICompatible`，结果填入详情编辑表单的 `titleZh` 草稿，需手动保存。
- 已存在通用**批量框架**：`src/features/reader/useReaderLibraryBatchActions.ts` 的 `handleBatchMineruParse` / `handleBatchGenerateSummaries`——worker 池并发（`clampBatchConcurrency(settings.libraryBatchConcurrency)`）、暂停/继续/取消（ref + `BatchProgressState`）、逐项进度回调，模式成熟可直接复用。
- 后端 `library_update_paper` 的 `UpdatePaperRequest` 已支持 `titleZh`（`src/types/library.ts` L207 起）。

### 方案

1. 新增 `handleBatchTranslatePaperTitles(papers: LiteraturePaper[])`：
   - 输入为 Q1 的多选集合（未多选时入口隐藏或作用于当前过滤结果，二选一，建议仅作用于多选集合，语义清晰）。
   - 对每篇调 `translateTextOpenAICompatible`（复用翻译模型 preset：baseUrl/apiKey/model/apiMode，思考强度取 `getModelRuntimeConfig(settings, 'translation')`）。
   - 成功后**直接落库**：`library_update_paper({ paperId, titleZh: translated })`——批量场景下再逐篇人工确认保存不现实；失败项记录错误，最后汇总 `成功 X / 失败 Y`。
   - 跳过逻辑：默认跳过已有 `titleZh` 的文献，工具栏提供"覆盖重译"开关。
2. 复用批量框架的并发/暂停/取消/进度模式；进度显示在现有批量进度 UI 位置（与批量解析/概览一致）。
3. 列表标题列在 `titleDisplayMode` 支持下即可显示中文标题（现有 `resolvePaperTitleDisplay` 已支持双语标题展示）。

**涉及文件**：`useReaderLibraryActions.ts`（或拆出 `useBatchTitleTranslation.ts`）、`LiteratureLibraryView.tsx`（入口接线）、`tests/`（并发与跳过逻辑可抽纯函数测试）。

---

## Q3：如何批量导出 Bib 文件（两种格式）？

### 现状

- 代码库中**没有 BibTeX 导出**（仅知识图谱用到 `bibliography` 字段做参考文献匹配）。
- 已有写文件能力：`write_text_file`（`electron/backend/fileCommands.cjs` L383）+ 写路径审批机制（`approvedWritePaths`）；`select_save_pdf_path`（L346）限定 PDF filter，需泛化；`select_directory`（L240）已存在。

### 方案

**1. BibTeX 生成器（纯前端，可测试）**

新建 `src/utils/bibtex.ts`：

- `paperToBibtexEntry(paper, options)`：由 `LiteraturePaper` 生成条目。
  - entry 类型推断：`publication` 含 journal 类关键词 → `@article`；含 conference/proceedings → `@inproceedings`；否则 `@misc`（`howpublished`/`note` 兜底）。
  - citation key：`第一作者 familyName + year + 标题首个实词小写`（如 `chen2026electric`），去除非 ASCII 与标点；冲突时追加 `b/c/...`。
  - 字段映射：`title`/`author`（`Family, Given and ...` 格式）/`year`/`journal|booktitle`/`doi`/`url`/`abstract`/`keywords`；`titleZh` 放入 `titleaddon`（BibLaTeX 风格）或 `note`。
  - 特殊字符转义（`& % $ # _ { } ~ ^ \`）。
- 相关参考：Zotero 导入侧（`zoteroLocal.ts`/`zoteroApi.ts`）已有作者名字段（`givenName`/`familyName`），直接可用。

**2. 两种导出格式（形态）**

| 格式 | 形态 | 后端需求 |
| --- | --- | --- |
| A. 合并单文件 | 所有选中文献写入一个 `library-YYYYMMDD.bib` | `select_save_file_path`（由 `select_save_pdf_path` 泛化，filters 参数化）+ `write_text_file` |
| B. 每篇独立文件 | 选目录，每篇生成 `{citationKey}.bib` | `select_directory` + `approve_write_path` + `write_text_file` 循环 |

> "两种格式"按上述两种导出形态实现；条目语法均为标准 BibTeX。如果实际需求是"BibTeX vs BibLaTeX 两种语法风格"，生成器预留 `dialect: 'bibtex' | 'biblatex'` 选项即可低成本支持。

**3. 入口**：Q1 批量工具栏的"导出 Bib"按钮弹出格式选择（合并/逐篇），导出完成显示路径与篇数。

**涉及文件**：`src/utils/bibtex.ts`（新增）、`electron/backend/fileCommands.cjs`（保存对话框泛化）、`src/platform/electron/` 命令封装、`LiteratureLibraryView.tsx`（入口）、`tests/bibtex.test.ts`（生成器快照测试）。

---

## Q4：为什么概览已经生成过，重新打开文献还要重新生成？

### 现象（截图 tmp6DF8.png）

文库预览中概览已生成；打开文献切到概览页，显示"生成中..."并重新调用模型。

### 根因：两套互不通用的 sourceKey 算法

概览缓存以 `sourceKey` 为文件名 hash 存到 MinerU 缓存目录（`buildMineruSummaryCachePathCandidates` → `summaries/{hash(sourceKey)}.json`）。但**生成/读取缓存的两个入口使用了不同的 key**：

1. **文库预览**（`src/features/reader/readerLibraryPreview.ts` `buildLibraryPreviewSummaryRequest`）：
   ```
   ${item.workspaceId}::${SUMMARY_PROMPT_VERSION}::${language}::mineru-markdown::blocks::${blocks.length}
   ```
2. **阅读器**（`src/features/reader/documentReaderSummarySource.ts` `buildPaperSummarySourceKey`）：
   ```
   ${item.itemKey}::${promptVersion}::${language}::mineru-markdown::${mineruPath || currentJsonName}::${blockCount}
   ```

差异点：前缀（`workspaceId` vs `itemKey`）、中缀（`blocks` vs `mineruPath` 绝对路径或 JSON 文件名）。因此文库预览写入的缓存文件，阅读器永远查不到；阅读器内 `autoGenerateSummary` 检测到 `paperSummarySourceKey !== paperSummaryNextSourceKey` 便自动生成，`tryLoadSavedSummary` 必然 miss，于是重新调 API。

次要风险点：

- 阅读器版 key 中的 `mineruPath` 是绝对路径/云端 `cloud:` 标识，解析来源切换时 key 漂移，即使统一算法后仍可能 miss。
- `loadSavedSummaryCache` 在 `mineruCacheDir` 未配置时直接返回 `null`（缓存完全不生效），属于预期行为但需要在设置中引导配置。
- 历史记录恢复（`loadPaperHistory` → `setPaperSummarySourceKey`）与 `autoSummarySourceKeyRef` 防重入逻辑正常，不是主因。

### 修复方案

1. **统一 sourceKey 算法**：抽出一个共享函数（如 `buildSummarySourceKey`，放 `documentReaderSummarySource.ts` 或新 `summarySourceKey.ts`），文库预览与阅读器都调用：
   ```
   ${itemKey}::${promptVersion}::${language}::${sourceMode}::${contentSignature}
   ```
   - `itemKey`：统一用阅读器的 `item.itemKey`（预览侧构造 WorkspaceItem 时已有）；兜底 `workspaceId`。
   - `contentSignature`：用稳定内容签名替代 `mineruPath`——`blockCount` + MinerU markdown 的 `textSignature`（`readerShared.ts` 已有）或首末块 hash。避免路径漂移。
2. **迁移兼容（双 key 查找）**：`loadSavedSummaryCache` 读取时按 `[新key, 旧预览key, 旧阅读器key]` 候选依次尝试（旧 key 算法保留一个版本周期），命中旧 key 后按新 key 重写一份，完成无感迁移。
3. **展示优先级**：打开文档时若 `history.paperSummary` 存在直接展示（现有逻辑），`nextSourceKey` 变化时不再立即自动生成，而是在概览卡片显示"文档内容已变化，可刷新概览"提示条；`autoGenerateSummary` 仍触发但先走缓存（key 统一后必然命中）。
4. **验证**：`tests/documentReaderCache.test.ts` 增加双 key 候选查找用例；手工回归"预览生成 → 打开文献 → 概览直接显示"。

**涉及文件**：`documentReaderSummarySource.ts`、`readerLibraryPreview.ts`、`documentReaderCache.ts`、`mineruCache.ts`（候选路径无需改）、`DocumentReaderTab.tsx`、`tests/`。

---

## Q5：为什么侧栏问答总是 RAG 失败（Embedding HTTP 404），而 Agent 处"可以"？

### 现象（截图 image.png）

侧栏问答提示："本次未命中本地 RAG：检索失败，已回退到 MinerU 全文。错误：Error invoking remote method 'paperquay:invoke': Error: Embedding HTTP 404: Not Found"。

### 根因分析

**1. 404 的直接原因：Embedding 端点不存在**

调用链：侧栏 `resolveLocalRag`（`src/services/localRag.ts`）→ `embedRagText`/`embedRagChunks`（`src/services/rag.ts`）→ IPC `rag_embed_text` → `embedTexts`（`electron/backend/utils.cjs` L955）→ `POST {normalizeBaseUrl(baseUrl)}/embeddings`。

`Embedding HTTP 404` 表示该 baseUrl 的服务**没有 `/v1/embeddings` 端点**。最常见情况：把 chat 模型服务商的地址直接填进了 Embedding 配置——例如 DeepSeek 官方 API 就不提供 embeddings 接口（截图中侧栏模型正是 deepseek 系），某些聚合中转站也未开通该端点；或模型名填了 chat 模型。

**2. "Agent 处可以"是错觉：失败被静默吞掉**

两处使用**同一份** embedding 配置（`settings.embeddingBaseUrl/embeddingModel` + `secrets.embeddingApiKey`）：

- 侧栏（`DocumentReaderTab.tsx` 约 L1824）：`resolveLocalRag` 失败 → 构造 `kind: 'failed'` → UI 明确展示错误与回退信息（`readerQaContext.ts` L264-273）。
- Agent（`src/services/libraryAgent.ts` 约 L858）：`resolveLocalRag` 被 `try/catch` 包裹，失败仅 `console.warn('Failed to build local Agent RAG context', error)`，然后**静默回退**到 MinerU 全文/PDF 文本。回答看起来正常，实际上 RAG 同样没命中。

也就是说：**Agent 的 RAG 也在 404，只是没有告诉你**。

### 修复方案

1. **配置自检（治本）**：设置页模型配置区增加"测试 Embedding 连接"按钮（复用 `handleTestLlmConnection` 模式，实际调一次 `embedTexts(['ping'])`），明确报告"端点不存在/模型名错误/鉴权失败"；在 embedding 配置旁标注"该服务需提供 OpenAI 兼容 `/v1/embeddings` 端点"，并给出可用示例（OpenAI `text-embedding-3-small`、硅基流动 `bge-m3`、Jina 等）。
2. **Agent 状态透传（消除错觉）**：Agent 回退时在回答元信息中附带与侧栏一致的 RAG 状态条（"本次未命中本地 RAG：…，已回退到全文"），复用 `readerQaContext.ts` 的文案函数；同时在 `console.warn` 之外把失败写入该会话消息元数据，便于排查。
3. **失败治理（已有基础增强）**：`localRag.ts` 已有索引失败 cooldown（`ragIndexFailureCache`）；补充：embedding 连续 404 时在侧栏/Agent 提示"Embedding 服务不可用，已暂停本地 RAG 索引重试"，并给"前往设置"跳转。
4. **验证**：配置一个无 embeddings 端点的 baseUrl 复现 404 → 修复后 Agent 侧应显示与侧栏一致的状态条；配置正确 embedding 服务后两侧均应命中（消息中"本地 RAG"来源标识 + 引用页码）。

**涉及文件**：`readerQaContext.ts`、`libraryAgent.ts`、`src/services/rag.ts`、`electron/backend/aiCommands.cjs`（可增 `rag_test_embedding` 命令）、设置页 `readerPreferencesModelsSection.tsx`。

---

## Q6：为什么侧栏问答找不到思考强度设置？Agent 能加 max 档吗？

### 侧栏入口问题（UI bug）

侧栏其实**有**思考强度控件（`assistantSidebarChat.tsx` `ReasoningEffortPicker`，约 L1580），但渲染条件是：

```tsx
{!compactComposer || ultraCompactComposer ? (<ReasoningEffortPicker .../>) : null}
```

- 宽模式：底部直接显示选择器；
- **中等紧凑宽度（侧栏较窄，截图正是此状态）：底部选择器被隐藏**，只能点"更多操作"菜单里的 `reasoningAction`——该菜单项只是循环切换档位（auto→low→medium→high→xhigh），**不显示当前档位、无可选项列表**，几乎无法发现；
- 超紧凑：底部显示紧凑版选择器。

**修复**：

1. `ReasoningEffortPicker` 改为始终渲染（compact 时用其已有的 `compact` 图标模式）；中等紧凑菜单中的 `reasoningAction` 显示当前档位（如"思考强度：高"），或直接从菜单移除（底部入口已可达）。
2. 条件 `!compactComposer || ultraCompactComposer` 这个"中间态消失"的写法本身可疑，一并修正。

### max 档位

当前 `ModelReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh"`（`src/types/reader.ts` L264），后端直传 `reasoning_effort`（chat）或 `reasoning.effort`（responses）（`electron/backend/utils.cjs` L371/L524）。增加最高档只需：

| 位置 | 改动 |
| --- | --- |
| `src/types/reader.ts` | 联合类型加 `'max'` |
| `src/features/reader/readerShared.ts` `MODEL_REASONING_OPTIONS` | 增加 `{ value: 'max', labelZh: '最高', ... }`，说明"仅部分新模型/服务商支持，不支持时可能报错或被降级" |
| `src/services/libraryAgent.ts` `normalizeAgentRuntimeConfig`（约 L433-439） | 白名单加 `'max'` |
| `assistantSidebarChat.tsx` L836 循环数组 | 加 `'max'` |
| 后端 | 无需改动（非 auto 原样透传）；不支持该档位的服务商会返回 400，错误会正常冒泡显示 |

**注意**：`reasoning_effort: 'max'` 并非所有 OpenAI 兼容服务都支持；UI 文案需提示"若调用报错请降档"。

---

## Q7：当前 Agent 架构如何？参考 pi / DeepTutor / Yuxi 还应优化什么？

### 当前架构（基于代码事实）

- **入口与 UI**：`src/features/agent/AgentWorkspace.tsx`（1441 行）+ `AgentWorkspaceView/Messages/ExecutionCards` 等组件；会话状态在 `agentSessionState.ts`。
- **服务层**：`src/services/libraryAgent.ts`（2415 行），核心入口 `runConversationalLibraryAgent`（L2097）：
  1. `decideLibraryAgentPaperContextOpenAICompatible`：先让模型决定"直接答 / 需要加载论文上下文（context-request）/ 请用户选文献（choice-request）"；
  2. `generateLibraryAgentPlanOpenAICompatible`：一次调用生成最终回答或**结构化操作计划**（`LibraryAgentPlan`：rename / metadata / smart-tags / clean-tags / classify 五类工具）；
  3. 计划经 UI 审批后 `applyLibraryAgentPlan` 落库（plan-and-approve 模式）。
- **上下文**：默认 metadata-only；按需经 `loadPaperContext` → `resolveLocalRag` 做单篇 RAG；`agentPaperScopes.ts` 维护当前/历史文献范围。
- **能力特征**：流式输出、thinking 提取、动态用户选择卡片（`requestDynamicUserChoices`）、RAG 引用跳转（`createAgentRagCitationJumpRequestId`）。

**评价**：对"文库整理助手"定位是**够用且稳健**的——计划审批、范围追踪、回退链都完整。但它本质是"**单轮结构化输出生成器**"：没有多轮工具调用循环，模型不能自主地"查一下→再查一下→综合回答"，RAG 失败静默（Q5），也无持久化运行日志与成本观测。

### 参考项目调研结论（2026-08-26 调研）

| 维度 | [pi](https://github.com/earendil-works/pi)（Agent harness，TS） | [DeepTutor](https://github.com/HKUDS/DeepTutor)（agent-native 学习台，Python） | [Yuxi](https://github.com/xerrors/Yuxi)（知识智能体平台，LangGraph） |
| --- | --- | --- | --- |
| 工具系统 | `AgentTool` + schema；并行/串行；`beforeToolCall` 可审批拦截 | 两层：上下文门控 Tools + 多阶段 Capabilities | LangGraph 工具 + Skill 门控（激活才暴露）+ 审批中间件 |
| 上下文/RAG | 双层消息管线；turn 边界结构化压缩 + 文件轨迹累积；JSONL 会话树 | 引擎可插拔（向量+BM25 / PageIndex 页级引用 / GraphRAG）；三层可审计文件记忆 | Agentic RAG（多轮检索 + Rerank + 可溯源引用）；内置检索评估 |
| 规划 | 核心刻意无计划模式 | Capability = 显式阶段流水线（改写→分解→检索→成文） | DeepAgents 子任务规划；审批走 checkpoint resume |
| 多 Agent | 不内置（扩展机制） | Partners 人格 + 私有记忆 | 子 Agent 隔离线程共享 runtime |
| 可观测性 | 全量事件流 + token/成本 footer | StreamBus + 统一结果信封 + UsageTracker | Langfuse + run lease 幂等恢复 |

### 优化路线图（按投入产出排序）

1. **统一 RAG 状态透传**（与 Q5 同做）：Agent 回答携带检索状态与引用列表，消除静默回退。
2. **工具调用循环（ReAct 化）**：把现有"决策+计划"两段式扩展为循环——模型可多轮调用只读工具（`search_library`、`read_paper_overview`、`rag_search`）后再产出最终回答/计划；写操作仍走计划审批（pi 的 `beforeToolCall` 审批钩子思路）。这是从"整理助手"到"研究助手"的关键一步。
3. **检索增强**：本地 SQLite 加 FTS5 关键词检索与向量结果融合（DeepTutor 的混合检索思路），引用统一带 `{paperId, page, blockId}` 可点击跳转（现有 citation 跳转已有雏形）。
4. **上下文与记忆**：长会话做 turn 边界结构化摘要（pi compaction：目标/进度/决定/下一步），跨压缩累积"已读论文 ID + 引用页码 + 已改笔记 ID"；借鉴 DeepTutor 的三层文件型记忆（事件 trace / 主题事实 / 综合），契合本地优先定位。
5. **可观测性**：每次 run 追加写本地事件日志（JSONL 或独立 SQLite 表），记录 token 用量并在状态栏显示；支持从历史点 fork 会话。
6. **重任务 Capability 化**：综述生成等做成显式阶段流水线（改写→分解→逐题检索→成文），统一进度事件与结果信封。

---

## 实施顺序（建议）

> 原则：先修影响日常使用的 bug（小改动、即时收益），再做用户强需求功能，最后做架构级优化。每阶段独立可发布。

| 阶段 | 内容 | 预计规模 | 依赖 |
| --- | --- | --- | --- |
| **P0 Bug 修复** | Q4 概览 sourceKey 统一（含双 key 迁移）；Q5 Embedding 测试按钮 + Agent RAG 状态透传；Q6 侧栏思考强度入口修复 + max 档 | 小（1-2 天） | 无 |
| **P1 多选框架** | Q1 多选状态 + 列表交互 + 批量工具栏（先接删除/移动分类/收藏等零成本操作） | 中（2-3 天） | 无 |
| **P1 批量标题翻译** | Q2 复用批量 worker 框架，接入多选集合 | 小（0.5-1 天） | Q1 |
| **P2 Bib 导出** | Q3 bibtex 生成器 + 两种导出形态 + 后端保存对话框泛化 | 中（1-2 天） | Q1 |
| **P3 Agent 优化** | Q7 路线图 1→2→3（状态透传已在 P0 完成则顺延 ReAct 化与混合检索） | 大（按子项拆分） | P0 |

> P3 已展开为独立详案：[`2026-08-26-agent-architecture-p3-plan.md`](./2026-08-26-agent-architecture-p3-plan.md)（含工具注册表、ReAct 循环、FTS5 混合检索、上下文压缩与三层记忆、运行事件日志、分阶段顺序与风险回退）。

**验证基线**：每阶段完成执行 `npm run build` + `npm test`；涉及渲染层交互的按 `docs/DEVELOPMENT.zh-CN.md` 做桌面端手工回归；用户可感知变更追加 `docs/changes/` 记录。

**文档位置说明**：本文件为计划与问答记录；各项目落地完成后，按 `docs/changes/README.md` 格式（现象/根因/修改/验证）分别补变更记录。
