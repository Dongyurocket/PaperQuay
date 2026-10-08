# Agent 引用、网络错误、首屏工具栏与 MCP/Skills 修复计划

- 日期：2026-10-02
- 状态：**implemented（2026-10-02）**。实施与验证记录见 `docs/changes/2026-10-02-agent-citation-network-ui-mcp-skills.md`；桌面 Computer Use 走查与 deepseek-flash 实测未在本实施轮覆盖，列为复验项。
- 触发：桌面端实际使用发现 Agent 正文引用题名/页码与跳转目标不一致；模型请求只显示 `fetch failed` 且在执行轨迹中重复展示；首次打开 Agent 时“思考强度”控件在较窄可用宽度下被裁切；需要审查 PaperQuay MCP 与仓库内相关 Skills 的契约、版本和维护边界。
- 范围：`src/features/agent/`、`src/services/libraryAgent.ts`、`src/services/agentLoop.ts`、`src/services/agentChat.ts`、`electron/backend/aiCommands.cjs`、`electron/backend/utils.cjs`、`bin/paperquay-mcp.cjs`、`electron/mcp/knowledgeMcpService.cjs`、`docs/MCP_AGENT_INTEGRATION.md`、仓库内 `skills/`，以及对应测试和变更记录。
- 非目标：不改变外部 MCP 写入必须先经用户确认的产品政策；不把 API Key、Authorization、完整可能含密钥的 URL 写入日志或 UI；不在本计划阶段直接升级 DSH 全局已安装的 skill 包。

## 1. 现象与已确认根因

### 1.1 Agent 正文引用与实际跳转不一致

实际界面中，正文可显示“文献 A，第 26 页”并带有 `[3]`，而悬浮提示和点击跳转却是“文献 B，第 70 页”。这不是分组列表排序后传错对象：`AgentRagCitationChips` 将原始 `page.citation` 传给 `onOpenCitation`，`handleOpenRagCitation` 也只从该对象生成 `paperId`、`pageIndex` 和 `blockId`。

根因在正文引用渲染模型：

1. `AgentMarkdown` 把模型输出文本内的 `[3]` 转成内部链接，并仅以 label 查询当次引用数组的第一条匹配记录。
2. 模型自行写出的题名与“第 N 页”只是普通 Markdown 文本，未从该记录生成，也没有校验是否与 `[3]` 相同。
3. `bindAnswerEvidence()` 检测到 numeric label 时优先绑定该 label，未将同一句中的显式题名/页码视为需校验的断言；结果只显示支持度汇总，不会阻止错误元数据被当作有效引用展示。
4. 普通 ReAct 路径的后续 `request_paper_context` 追加上下文时按 citation `id` 去重，但没有在整次运行内重分配 label。单篇 RAG 上下文的局部编号可能再次出现；当前 `find()` 会静默选择第一条，使同一个 `[n]` 再次产生歧义。

### 1.2 Agent 模型错误显示为 `fetch failed`

模型调用链为：渲染层 `runOpenAiCompatibleAgentChatTurn` -> `paperquay:invoke` -> `agent_chat_turn` -> `runAgentChatTurn` -> `openAiChat()` -> `fetch(completionEndpoint(options))`。

`fetch failed` 表示 Electron/Node 在收到 HTTP 响应之前失败，通常属于 Base URL、DNS、代理、防火墙、TLS 证书、连接被重置或连接超时；它通常不是 API Key 无效，因为 Key 无效应能收到可识别的 HTTP 401/403 响应。当前后端的 `agentStreamSafeError()` 只保留 `error.message`，没有保留安全的 `error.cause` 代码，因而无法区分 `ENOTFOUND`、`ECONNREFUSED`、`ECONNRESET`、`ETIMEDOUT`、证书错误和 abort。

同一失败会被重复展示：`runAgentLoop` 先发出 `kind: 'error'` 事件，页面将其加入 trace；外层运行 catch 又把同一错误再次加入 trace，并在底部显示错误。因此截图中的两条“执行错误”通常不是两次独立模型请求。

### 1.3 首次打开 Agent 时思考强度无法选择

截图所示的控件不是 portal 下拉菜单被其他层覆盖。`AgentReasoningPicker` 的菜单已经挂到 `document.body`，并使用 `fixed z-[9999]`。

真正的根因是 composer 工具栏布局：左侧控件组为 `flex-nowrap` 且 `overflow-x-auto`，每个控制都 `shrink-0`；右侧发送按钮也固定占位。当 Composer 的实际内容宽度不足以容纳附件、记忆、RAG、选文献、模型和思考强度时，后面的思考强度按钮被裁切到滚动容器的可视边界之外。截图中模型选择器后只剩一小段思考按钮，正是该行为。

### 1.4 MCP 与 Skills 的维护结论

MCP 的核心读取、混合检索、Zotero 预检、写入护栏和 23 个工具总体可用，当前不需要为了“更新”而无目的扩展工具数量；但协议/文档/Skill 有需要收敛的漂移和安全边界：

1. `bin/paperquay-mcp.cjs` 的 `SERVER_VERSION` 为 `0.3.0`，而 `package.json` 为 `0.4.4`。
2. `get_paper_details` 的 schema 声明了 `pageKind`，`PaperQuayKnowledgeService.getPaperDetails()` 实现却只接收 `paperId`，形成无效的公开参数。
3. `create_note` 的 schema 重复声明 `pageKind`，虽在 JavaScript 对象中后者会覆盖前者，但对维护、生成文档和 schema 审查均不可靠。
4. MCP 写入护栏只检测已安装应用进程 `PaperQuay.exe` / `PaperQuay`；开发模式的 `electron` 不能可靠识别。开发期间使用 MCP 写库仍可能造成桌面内存快照与外部数据发生 lost-update。
5. 仓库目前只有 `skills/paperquay-notes/SKILL.md`。历史变更和当前产品能力还需要可版本化的知识检索与 Zotero 选择性同步 SOP；全局环境中同名 skills 不受本仓库版本控制，不能代替仓库发布物。
6. `docs/MCP_AGENT_INTEGRATION.md` 与 repo skill 之间没有可自动验证的工具契约快照，未来增加、改名或删参数时容易再次漂移。

## 2. 修复目标与不变量

1. 每个可点击 Agent 引用都映射到当次运行中唯一、可追溯的 canonical citation；UI 不信任模型自由书写的题名、页码或 label。
2. 运行内 numeric label 全局唯一。重复 label 是程序错误，不能继续“首条获胜”。
3. 网络失败对用户给出可操作、无密钥泄漏的中文说明；内部保留可定位错误类型；HTTP 服务错误与未得到 HTTP 响应的网络错误保持区分。
4. 一次失败在执行轨迹只出现一次，底部错误提示保留。
5. 在 composer 实际内容宽度不足时，模型和思考强度仍必须始终可见、可点击、键盘可达；不得依赖用户横向滚动寻找关键运行配置。
6. MCP 的 schema、实现、stdio `tools/list`、接入文档和 repo-owned skills 来自同一版本化契约；所有写入继续默认拒绝应用运行期间的外部写操作。

## 3. 工作包 A：引用身份与渲染

### A1. 单次运行引用注册表

在 `libraryAgent.ts` 增加运行级 citation registry，作为唯一追加入口：

- 以稳定 `citation.id` 去重；首次见到时分配不可复用的全局 label。
- 初始论文上下文、`rag_search`、`request_paper_context`、Capability 的 recover/append 路径全部调用同一入口。
- 返回给模型的上下文文本中的 `# Source [n]` 与 registry 的 label 同步重写，不能保留每篇文献的局部 label。
- 最终响应前断言 label 唯一；若断言失败，报告诊断而不是让 `find()` 任意选第一条。

### A2. 结构化引用 token 与兼容层

首选协议是向模型提供 canonical citation token，例如 `[[cite:<citation-id>]]`；渲染前仅从 registry 生成 `[n]`、题名、页码、预览与跳转目标。模型不得把手写题名/页码作为链接事实源。

过渡期兼容 `[n]`：

- 保留现有 numeric citation 的解析；只在 label 唯一时生成可点击链接。
- 识别同句/紧邻文本中“论文题名 + 第 N 页”或“`[title, p.N]`”的显式元数据；若与 `[n]` 的 canonical citation 冲突，标记 `citation-mismatch`。
- 不将 mismatch 文本显示为可信可点击来源。UI 需明确区分 canonical 引用与模型未验证文本，且不要擅自把错误论断静默改写为正确论断。

### A3. 证据绑定扩展

将 `citation-mismatch` 纳入 `AnswerEvidenceStatus` 或独立的 `reason`，并让 Agent 消息显示可见但不喧宾夺主的引用校验提示。现有 `supported/partial/not-in-library` 统计必须保持兼容，笔记门禁对 mismatch 至少与 `partial` 同等严格。

### A4. 测试与验收

- 覆盖两篇论文的相同局部 label，验证最终标签唯一、正文 `[n]` 与跳转对象一致。
- 覆盖“`[3]` 指向 B p.70，但正文写 A p.26”，验证结果为 mismatch，不能生成错误的有效跳转。
- 覆盖分组页点击仍使用原始 canonical citation。
- 覆盖没有重复时既有 `[n]`、bare paper ID 和 citation group 行为不回归。

## 4. 工作包 B：模型网络错误、超时与去重展示

### B1. 后端安全诊断契约

在 `electron/backend/utils.cjs` 的 completion fetch 边界捕获异常，构造稳定的内部错误：

- 分类为 `AGENT_MODEL_NETWORK_ERROR`、`AGENT_MODEL_TIMEOUT`、`AGENT_MODEL_ABORTED` 或保留明确 HTTP 状态错误。
- 仅记录/透传 endpoint `origin` 或经审查的 host、请求阶段、`error.name`、`error.cause?.code`；不得包含 API Key、Bearer token、请求体或完整可携带密钥的 URL。
- 流式与非流式共用该分类函数；流式另有可配置连接/首字节超时，取消仍优先呈现 abort。

### B2. 前端规范化与单一错误事件

- 在 `agentChat.ts` 或共享错误工具中，将稳定错误码转换为中文可操作提示；可复用 `reviewWriting.ts` 的网络错误归一化策略，避免两个产品面给出不同文案。
- 保留 HTTP 401/403、429、4xx/5xx 的服务端详情分类，不把它们误报为网络错误。
- 建立 terminal-error 标记或 trace event id：已处理过 loop `error` 的运行，外层 catch 只更新最终消息/状态，不再重复插入“执行错误”。

### B3. 测试与验收

- 模拟 `ENOTFOUND`、`ECONNREFUSED`、`ECONNRESET`、超时、abort、HTTP 401 和 HTTP 503；断言用户文案、内部分类与脱敏行为。
- 断言一次失败只产生一条 trace error，底部错误仍出现。
- 选择并确认 `deepseek-flash` 后，分别执行一次正常流式 Agent 问答与受控错误回归；不把离线 mock 冒充真实模型验收。

## 5. 工作包 C：Composer 响应式布局与思考强度控件

### C1. 布局改动

在 `AgentWorkspaceView.tsx` 将“所有工具一行 + 横向隐藏”的模型改为可换行的两组布局：

- 文件/截图、记忆、RAG 和文献范围属于辅助动作组；模型和思考强度属于运行配置组。
- Composer 宽度不足时，辅助组可换行或收纳，运行配置组必须完整显示；发送/取消按钮保持稳定尺寸和可达性。
- 限制模型选择器的响应式最大宽度，避免其独占剩余空间；不要以 `overflow-x-auto` 裁切思考强度按钮。
- `AgentReasoningPicker` 继续使用 portal，但在控件可见后复核上开/下开定位、可视视口边界、点击外部关闭、Esc、焦点返回和键盘选择。

推荐优先实现基于 composer 容器宽度的 `flex-wrap`/grid，而非仅按屏幕媒体查询，因为截图说明可用宽度受历史栏、缩放和 composer 最大宽度共同影响。

### C2. 测试与验收

- 新鲜 Agent 会话与已有消息会话分别检查。
- 在 1024x768、1366x768、以及 Windows 125%/150% 缩放对应的窄 CSS 宽度下，模型与思考强度按钮完整可见并可点击。
- 通过桌面 Computer Use 打开每个思考选项，选择后再发送请求，确认实际使用的 reasoning effort 与 UI 一致。
- 不允许 UI 自动化以旧截图/窗口句柄操作；验收使用当轮观察到的窗口状态。

## 6. 工作包 D：MCP 与仓库 Skills 契约收敛

### D1. MCP 服务和文档

1. 从 `package.json` 导出或构建时注入 MCP `serverInfo.version`，消除 `0.3.0` 与应用 `0.4.4` 的硬编码漂移。
2. 删除 `create_note` 的重复 `pageKind` 定义；决定 `get_paper_details.pageKind` 的产品语义：要么实现其对关联笔记/页面的真实过滤，要么从 MCP schema、文档和客户端示例移除，不能暴露无效参数。
3. 对 `tools/list` 添加精确工具数、名称集合、关键 schema 字段与 `serverInfo.version` 的 contract test，而非只断言少数工具存在。
4. 将开发模式写入风险从“已知无法识别”改为可执行安全方案。优先评估应用启动时维护可验证的运行标记/锁，并使 MCP 写操作在标记存在时默认拒绝；无法可靠判定时默认保守拒绝并返回可操作说明。不得让开发模式成为隐式绕过写护栏的常规路径。
5. 同步 `docs/MCP_AGENT_INTEGRATION.md`、用户手册和变更记录，明确 23 个工具、混合检索网络边界、写入护栏、应用运行时的刷新/拒绝语义和 schema 版本。

### D2. Repo-owned Skills

将外部 Agent 的标准作业流程拆为最小、可发布且可测试的 repo 内容：

- `paperquay-knowledge-search`：只读检索顺序为 `search_papers` / `get_paper_details` / `search_knowledge_base` / `read_paper_content` / `search_notes`；要求输出 `paperId`、页码、`blockId`、retrieval mode 与降级 warning，禁止把检索摘要伪装成原文。
- `paperquay-notes`：保留现有笔记宪章边界，修正可用工具/参数表，并明确不覆盖带锚点、文献引用或表格的笔记正文。
- `paperquay-zotero-sync`：固化“浏览/检索 -> preview diff -> 向用户展示 ready/alreadyExists/missingPdf -> 获得确认 -> sync”的强制确认链。
- 可选的 `paperquay-library-manage`：只覆盖导入、分类、元数据和删除；写操作先列预览、逐项确认、默认不传 `allowWhileAppRunning` 与 `deleteFiles`。

Skills 不内嵌已经会漂移的完整 schema，而是引用 MCP 集成文档和工具名称；CI 通过读取 Skill frontmatter、核验其引用工具在 `TOOLS` 中存在，防止 SOP 调用不存在的接口。DSH/Proma 等全局安装的 skill 应由各自发布渠道更新，但本仓库应提供可追溯源文件、版本和安装说明。

## 7. 实施顺序与回滚

1. 先完成 A1/A4，消除重复 label 和“首条获胜”这一数据正确性风险。
2. 再完成 A2/A3，将正文引用显示收敛为 canonical 数据；兼容模式保留一版并有 mismatch 提示。
3. 完成 B 的错误分类和 trace 去重，避免网络故障继续以不可诊断的 UI 噪声出现。
4. 完成 C，先用固定宽度回归证明不会裁切，再进行桌面验收。
5. 最后完成 D；MCP schema 变化如影响外部客户端，提供一个兼容版本窗口和迁移说明。

每个工作包独立提交、独立记录到 `docs/changes/`。引用注册表或 MCP schema 若造成外部行为改变，需保留兼容转换或显式版本说明；不得通过静默改写用户回答来掩盖引用不一致。

## 8. 总体验收

- `npm run build` 与 `npm test` 通过，新增测试覆盖本计划的所有 bug 路径。
- 用 `deepseek-flash` 进行桌面实测，确认模型已选中后再发送：多论文 RAG 回答中的每个可点击引用均打开其 canonical 文献、页码与 block。
- 人为配置不可达的模型 endpoint，确认只出现一次执行轨迹错误，用户得到中文网络排障提示，诊断不泄漏秘密；恢复有效 endpoint 后正常流式回答。
- 在窄可用宽度和高缩放场景中，首次进入 Agent 后无需横向滚动即可选择模型和思考强度。
- MCP stdio `initialize` / `tools/list` / 只读检索 / 写护栏拒绝路径通过；repo skills 的每一个工具引用均能在 MCP contract 中解析。
- 仅在验证完成后，将实际修改、未覆盖边界和真实桌面截图/记录写入 `docs/changes/`；本文件状态由 `proposed` 更新为分项实施状态。
