# PaperQuay 核心工作流优化方案

- 日期：2026-11-18
- 基线：`main`，应用版本 `0.4.30`
- 状态：主要实现及隔离验证已完成；正式安装版和真实生成模型端到端体验尚未验证，详见 [验收记录](2026-11-18-agent-chat-retrieval-verification.md)。
- 范围：移除独立综述写作工作区、Agent「库内综述/对比综述」专用流程和知识图谱 AI 关系候选；小步改善 Agent、阅读器侧边问答、检索、笔记和仓库 Skills / MCP 文档与契约。
- 实施约束：不重做 Agent/检索/笔记架构，不改文库或 RAG schema / `user_version`，不写入用户文库，不删除已有笔记或旧设置值。先以隔离数据目录验证。

## 一、目标与边界

把综述生成专项界面和专项流水线移除，将日常跨文献阅读与归纳留给 Agent 普通问答、证据检索和 `synthesis` 笔记。其余工作以减少误检索、提升证据可追溯性和降低外部 Agent 使用错误为目标，复用现有实现。

同时移除知识图谱的 AI 关系候选生成。图谱仍保留语义相似、引用、共同作者、标签、分类和用户手动创建/批准的自定义关系。

“删除综述功能”在本方案中的具体含义：

- 删除顶层「综述」工作区、综述草稿编辑/生成/Word 导出入口，以及仅由该工作区使用的 Review IPC 命令和专用后端。
- 删除 Agent 注册的 `comparative-survey` 专项 capability、自动关键词路由和其恢复/专用进度卡片。用户仍可在 Agent 中要求跨文献比较；结果走现存 ReAct 工具、RAG 证据和引用校验，不承诺旧的专项阶段编排。
- 删除图谱的「AI 关系候选」面板、`knowledge_graph_suggest_relations` IPC、`suggestKnowledgeGraphRelations` 服务入口和对应模型请求。已保存的 `ai_suggested` 关系作为历史关系保留展示，并继续允许用户删除；不再新增或重新生成。
- 保留阅读器对单篇文献生成摘要的功能。它是阅读功能，不属于独立综述工作区。
- 保留笔记 `pageKind: synthesis`、综述/综合类历史笔记、Agent 记忆 `L3-synthesis.md`、笔记蒸馏为综合笔记的能力。这些不是综述写作工作区；不迁移、不删除、不改 schema。
- 清理专用综述模型选项时保留旧配置的读取兼容，令升级后的老配置可正常启动。是否完全移除旧设置键在功能删除并验证后再做，不为此扩大首轮改动。
- 图谱关系存储仍是 `paperquay-knowledge-graph-relations.json`；本轮不改变文件路径、版本或备份打包，也不清除其中已有的 `ai_suggested` 记录。

## 二、现状核对

| 区域 | 已有能力 | 本轮建议的改善 |
| --- | --- | --- |
| Agent | ReAct 工具循环、能力路由、会话隔离、checkpoint / recovery、上下文压缩、引文注册与审核、笔记/文库审批卡 | 删除综述专项路径后检验通用流程能否覆盖常见跨文献比较；更清晰地呈现 scope、使用的证据及降级原因；建立少量代表性回归用例 |
| 阅读器侧边问答 | 流式逐 token、按文档隔离会话、附件、RAG 开关、页码引用、复制、保存为笔记 | 固定单次请求使用的 question / preset / 文档快照；修复输入覆盖时检索 query 读取旧草稿的问题；补上显式停止生成和保存答案时的引用锚点 |
| 检索 | 阅读器与 Agent 有本地向量 + FTS/RRF 检索；笔记有 hybrid + 关键词降级、source channels/warning 和索引状态 | 先确保每次搜索展示模式和索引/降级状态；用现有测试集评估结果与人工标注查询；只对失败查询做针对性改进 |
| 笔记 | Tiptap JSON 唯一事实源、锚点/原文快照、自动保存、草稿、外部更新提示、语义检索、润色预览、双链和批量整理 | 通过定向自动化测试审查自动保存和外部修改冲突；优先补引用锚点流转与搜索/列表 ergonomics；不替换编辑器或笔记格式 |
| Skills | `skills/` 有知识检索、笔记、文库管理、Zotero 四个外部 Agent 工作流；测试会核对其工具名 | 先更新工具契约、写入前后检查与证据引用要求；避免仓库文档声称应用运行时动态加载这些文件 |
| MCP | 独立 stdio server，25 个工具；桌面设置页生成 Proma / Claude / Codex 配置；写入有运行时拒写护栏 | 改进配置可诊断性、契约测试和完整笔记读取体验；不先引入任意通用 SQL 或外部 MCP 客户端框架 |

### 已定位的实施风险

1. 删除 `src/features/review/` 前须把 `loadReviewEmbeddingConfig` 从 `reviewSemantic.ts` 迁至通用配置模块：`src/services/notePolish.ts` 仍从综述目录导入它。
2. 综述入口还存在于 `src/app/App.tsx`、工作区 tab store、全局命令和旧 workspace 恢复逻辑，单删组件会留下导航 / 编译引用。
3. 专项综述还被 Agent capability registry、分类器、关键词 trigger、checkpoint recovery 和消息/执行卡片引用。按专项 capability 删除，避免遗留自动路由和恢复数据的误解释。
4. 不要把 `synthesis` pageKind、笔记模板、`L3-synthesis.md` 或一般的“综述/综合”文本搜索一并删掉。
5. 侧边聊天的 `handleSubmitQa(inputOverride)` 先用 override 创建用户消息，但检索闭包从可被清空的 `qaInput` 取 query。以请求局部快照传递 query，避免附件或已有选区之外的内容处理改变行为。
6. 侧边聊天当前通过 request generation 隔离过期事件，但 streaming API 没有 abort 参数。停止按钮要包含 renderer、IPC 请求 ID 和后端 AbortController 的完整取消路径；不要只停止 UI 更新。
7. 「保存为笔记」现在保存问答文本及 chat/message ID，但没有显式把答案引用转换为笔记中的来源锚点。先确认 `DocumentChatCitation` 与 `NoteAnchor` 的对应关系并用测试锁定页码语义。
8. `skills/` 是外部 Agent 配套文档而非已发现的 app 内 SKILL.md 执行器；MCP server 也是供外部客户端连接的独立服务。保持这两个责任范围清楚。
9. 图谱 AI 候选的 `ai_suggested` 类型还出现在 snapshot 持久化测试、`agentGraphQuery` 边型集合和 `agentGraphExplore` 计数标签里；不能顺手把整个关系存储或手动 `custom_relation` 功能删掉。

## 三、实施顺序

工作包按依赖排序；每个工作包单独构建、定向测试并可单独回退。预计 6 个小 PR / 提交规模；以下为工作估时，不包含大模型端到端体验验收。

### Phase 0：删除前基线（半天）

- 记录顶层入口、tab 恢复、command palette 和设置页中综述相关选项。
- 确认综述命令是否被除 Review workspace 外的调用者使用；核对相关 npm 依赖是否还有其他运行时消费者后再决定是否移除。
- 运行现有 `reviewCommands`、综述检索、能力路由、能力恢复、设置归一化和笔记润色测试，作为删除基线。
- 使用空隔离 user-data-dir 做启动冒烟；不在本机真实目录验证或迁移。

验收：形成可复查的入口和 IPC 清单；基线失败与环境问题单独记录，不把旧失败混入删除回归。

### Phase 1：移除独立综述工作区（约 1–2 天）

- 移除导航、tab 类型/工厂、legacy workspace 自动打开、命令面板动作、App 常驻组件及 import。
- 移除 Review 专用 renderer service / 组件、review IPC 命令、`electron/backend.cjs` 注册与只服务该实现的代码。
- 先迁出笔记润色使用的 Embedding config/type；验证 `notePolish` 无 Review feature import 后再删目录。
- 从 Review 设置 UI 停止配置专用模型；旧配置字段先接受并忽略/兼容，不清理用户文件或 backup 数据。
- 仅在依赖树验证后移除专为 DOCX Review 导出引入且无其他调用者的生产依赖及打包白名单。
- 对旧的 `review` workspace localStorage 值做惰性 fallback 到 library，不启动已删除 workspace。

验收：全局搜索无存活 Review workspace/IPC 引用；TS 构建通过；`notePolish` 和设置归一化测试通过；旧配置启动不崩溃；隔离数据目录中导航可用。历史 review 草稿可留在旧 localStorage 作为无害残留，无需做破坏性清除。

### Phase 2：移除 Agent 专项综述 capability（约 1–2 天）

- 从注册表、路由分类、触发词、专项执行和专项 UI 中移除 `comparative-survey`；普通 `rag_search`、paper context、读取笔记、scope 和引用核验保持原样。
- 移除仅属于专项流水线的 Agent survey coverage / checkpoint / resume 字段及类型。逐个核查共享类型：仅被一般 Agent 使用的 trace、citation、recovery 不删。
- 旧 run 记录在展示/恢复时把未知或已移除 capability 作为一般历史文本保留，不将其映射回默认 survey。
- 更新 Agent capability 路由、checkpoint recovery、引用和交付质量相关测试；增加一次正常 Agent「比较这些论文方法」使用 RAG 引文的回归测试。
- 不禁止 Agent 按用户要求写跨文献 synthesis 笔记：该操作仍经过现有笔记 write plan 和审批；笔记模板和数据结构不变。

验收：自动分类不再进入专项综述；一般 Agent 仍能检索、多轮阅读、引用和提议审批式笔记写入；旧记录不会伪装成仍可继续的专项 run。

### Phase 2.5：移除图谱 AI 关系候选（约半天）

- 移除图谱左栏「AI 关系候选」面板、建议按钮、`aiSuggestions` 状态、approve 流程和对应模型预设依赖。
- 删除 `suggestKnowledgeGraphRelations` 渲染层服务入口与后端 `knowledge_graph_suggest_relations` command；清理仅由该功能使用的模型请求辅助代码。
- 保留 `createKnowledgeGraphRelation`、`deleteKnowledgeGraphRelation`、`listKnowledgeGraphRelations` 和关系文件。`ai_suggested` 保留为可展示的历史边类型：snapshot 继续读取已有记录，删除按钮和「人工/AI 关系」过滤继续覆盖它。
- 从 `KnowledgeGraphEdgeType` 和后端类型判断中继续保留 `ai_suggested` 值以兼容旧数据；新增/创建请求不再接受该类型。
- 图谱快照筛选 `includeCustomRelations` 仍同时控制 `custom_relation` 与历史 `ai_suggested`；若 UI 文案改为「自定义关系」，同步更新图例、帮助和测试。
- 更新 `tests/knowledgeGraphCommands.test.mjs`：保留已有 `ai_suggested` 边读取的兼容用例；新增/修改断言确保不再有建议生成入口。
- 同步更新 `docs/USER_MANUAL.zh-CN.md` 的图谱关系说明；移除 AI 推断候选文案，注明手动自定义关系与自动生成候选不同。

验收：图谱 UI 无 AI 候选入口；旧库中的 `ai_suggested` 关系仍可显示和删除；手动关系创建/删除、语义相似与引用边不受影响；关系 JSON 文件与备份打包不变。

### Phase 3：改善 Agent 和阅读器侧边问答（约 2–3 天）

- Agent：在执行/回答附近给出当次文献范围和 RAG 状态；答案采用统一证据出口，指出库内依据及页码，并诚实说明未检索、无命中或降级，不把“已搜索”误写成“已证实”。先复用已有 trace、citation registry 和 delivery checks。
- 阅读器请求：建立每次发送独立的不可变请求输入快照，至少包含 question、document/session 身份、模型预设和该轮附件；所有检索、请求、错误状态及流结束都使用同一 request ID。
- 修正 `inputOverride` 提交时问句和 RAG query 可能不一致的路径，并添加纯函数/组件边界回归测试。
- 提供停止按钮，传递 request ID 至现有 `ask_document_openai_compatible_stream` IPC；后端为 QA stream 注册 AbortController，结束/失败/取消时释放 controller。晚到的 stream 事件必须被 request ID 丢弃。
- “保存回答为笔记”把引用转换成可定位来源锚点或引用节点，并保留 question、answer、session/message 身份。引用格式不支持转换时明确保留纯文本和引用信息，不编造 anchor。

验收：停止后底层模型请求退出、运行标记被清除且会话不会被旧事件覆盖；以 override 发送时展示问句、检索 query 一致；带引用的回答保存后能从笔记定位回来源。

### Phase 4：检索质量与可解释性（约 1–2 天，分批）

- 构造 20–30 条本地代表性查询及少量人工相关证据标注，覆盖中文/英文、短语、缩写、页码线索、笔记 pageKind 和排除 scope。标注只含库内样本，不上传服务。
- 用现有 hybrid、keyword、RRF 和降级通路比较 recall@5 / hit@5；另记录零结果、无向量索引、embedding 失败、RAG exclusion 的表现。先建立基准，不先改算法或阈值。
- 统一结果提示：retrievalMode、channels、warning、索引状态和候选范围有稳定的位置与含义。Reader QA 与 MCP 现有 warning/channel 合同不应被 UI 静默丢弃。
- 只对基准暴露的问题做局部调整（查询归一化、候选数或结果展示），每种变化加针对性测试；不得更改 schema、`user_version` 或用户索引数据。

验收：基准查询结果可重复；核心指标不退化；embedding 不可用时降级可见；不同索引/模型代际不混合返回陈旧证据。

### Phase 5：笔记可靠性与 Agent 使用体验（约 1–2 天）

- 先检查现有自动保存、草稿恢复、external update 冲突通知、手动保存路径；用组件隔离测试覆盖“本地 dirty + 外部更新”与刷新/保存。只修复实际可复现的覆盖风险。
- 笔记 Agent 写入沿用当前审批计划；明确 update 默认不改写未传字段，删除必须用户明确同意；提议更新时尽量保留 anchors、参考文献节点、双链、表格和未选择范围。
- 为笔记全文读取补一条最小只读 MCP `get_note`（如确认现有 `search_notes` 不足）；返回 `contentText`、`pageKind`、paperId、tags、folder、links 和 anchor 元数据，限制返回字数并用 continuation/明确截断提示。禁止借 MCP 直接暴露原始 SQLite 或任意 SQL。
- 改善侧栏笔记检索可过滤 folder / pageKind、排序和匹配通道；复用 `searchNotes` 与现有 SQLite 索引，不引入另一套检索栈。
- 笔记宪章和模板仍为来源/锚点语义规范。若继续叫“综述页”，在 UI 说明它是可由用户和 Agent 编写的 synthesis 笔记，而不是已删除的自动综述工作区。

验收：本地草稿不会因外部更新静默丢失；`get_note` 的工具 schema、结果和安全上限有 MCP 测试；Note write approval 继续生效；锚点保真测试通过。

### Phase 6：Skills 与 MCP 契约维护（约 1 天）

- 更新 `paperquay-knowledge-search`：先搜索元数据，再获取证据切片和必要上下文；同时保留 paper title、page、block、检索通道和 warning；明确关键词 fallback 的证据局限。
- 更新 `paperquay-notes`：检索/读取在前，写入审批/外部服务护栏在前；说明读取和更新边界、页类型、锚点/摘录保真与不可重建的证据节点。
- 更新 `paperquay-library-manage` 与 `paperquay-zotero-sync`：破坏性操作前预览、列清单并得到用户确认；写后核对结果；任何 skill 都不得暗示绕过 app-running MCP 护栏。
- 明确 Skills 是仓库中供兼容客户端加载的流程文档，不是桌面 App 会自动运行的插件；MCP 是外部 Agent 的只读/有护栏写入接口，不是桌面 Agent 的 MCP 客户端。
- 若新增 `get_note`，同步更新 MCP tool schema、集成指南、对应 skill、`paperquaySkills.test.ts` 中的工具清单和契约测试。工具数断言改为基于明确列表/工具注册读取，避免与硬编码“25”失同步。
- 设置页 MCP 区域增加复制成功/失败反馈、entry 不存在原因和版本/Node 前置条件说明；一次完成一个客户端配置的安装包/开发模式冒烟。

验收：所有 skill 中引用的工具都存在且参数/权限一致；MCP 指南中全部公开工具都有定义；Proma/Claude/Codex 配置片段与当次 `tools/list` 相符。

## 四、暂缓项目

- 不拆分或重写 `AgentWorkspace.tsx`、`DocumentReaderTab.tsx` 或笔记编辑器；新逻辑放在已有 IPC/service/纯函数 seams。
- 不改成远程向量库、外部 SaaS 检索、通用 MCP client 或任意 SQL 工具。
- 不改 RAG 或笔记 schema、`user_version`、数据目录布局，不批量重建索引。
- 不以新增一组能力开关解决综述删除。
- 不在功能删除同时清除 review localStorage、老运行记录、用户配置或历史 synthesis 笔记。
- 不改图谱关系文件结构，不清除旧 `ai_suggested` 边，不移除手动关系或 Agent 图谱只读探索。
- 检索阈值调整不以主观“回答更像”代替人工标注查询集。

## 五、回归与验收命令

每个工作包先跑相关测试，再跑全量类型检查和测试；若 Windows 临时目录触发 esbuild `Access is denied`，将 `TEMP`、`TMP` 指向仓库内一次性临时目录再执行，不改产品代码。Electron/MCP 烟测使用空隔离 user-data-dir。

建议命令：

```powershell
npx tsc --noEmit
node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"
```

重点测试域：`reviewCommands`（删除后应消失）、`knowledgeGraphCommands`、`readerSettings`、`notePolish`、`agentCapabilityRoute`、`agentRunRecovery`、`agentLoop`、`readerQaStore`、`documentReaderQaSessions`、`readerRagContext`、`noteSemanticSearch`、`noteAnchorLocation`、`agentNotePlan`、`knowledgeMcp`、`knowledgeMcpNotesWrite`、`paperquaySkills`、`mcpClientConfig` 和 `mcpPackaging`。

## 六、回退策略

- 每个阶段保持独立提交，不混入版本号、发布或用户数据迁移。
- Agent 专项 removal 出问题时，先回退该阶段的源码改动；不要通过用户运行记录回填旧 schema。新增 `get_note` 出问题时暂不发布此工具并回退工具实现/对应文档契约。
- 综述 feature 被删除后，旧 localStorage 配置保持闲置，旧综述草稿不主动擦除；回滚代码后旧入口仍可恢复原行为。
- 图谱 AI 候选删除后，旧关系文件保持原样；回滚代码后历史 AI 关系仍可显示，但已删除的关系不会恢复。
- 不删除或覆盖任何用户文件、数据库、RAG 索引、旧配置或笔记。
