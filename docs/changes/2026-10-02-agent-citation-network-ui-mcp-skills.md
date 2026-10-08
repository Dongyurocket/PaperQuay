# 2026-10-02 — Agent 引用一致性、模型错误诊断、Composer 响应式与 MCP/Skills 契约修复

## 现象

1. Agent 正文中 `[n]` 引用旁的论文题名/页码由模型手写，与 `[n]` 实际指向的 canonical 引用记录可能不一致（界面显示「文献 A，第 26 页」，跳转却打开「文献 B，第 70 页」）；多篇论文上下文追加时局部编号重复，`find()` 静默取第一条。
2. 模型网络失败只显示 `Error invoking remote method 'paperquay:invoke': Error: fetch failed`，且同一失败在执行轨迹出现两条「执行错误」卡片。
3. 首次打开 Agent、窗口较窄或系统缩放较高时，Composer 工具栏的「思考强度」控件被横向滚动容器裁切，无法正常选择。
4. MCP 与 Skills 存在契约漂移：`SERVER_VERSION` 硬编码 `0.3.0`（应用已 0.4.4）；`get_paper_details` schema 暴露了实现未支持的 `pageKind`；`create_note` schema 重复声明 `pageKind`；写入护栏仅识别已安装的 `PaperQuay.exe`，开发模式（`electron`）不受保护；仓库仅有一个 notes skill。

## 根因

- 引用：正文 `[n]` 只是 Markdown 文本；渲染层只按 label 取引用，不校验模型手写的题名/页码；`addUniqueAgentCitations` 按 id 去重但不重编号。
- 错误：后端 `agentStreamSafeError` 只保留 `error.message`，丢弃 `error.cause` 中的 `ENOTFOUND/ECONNREFUSED` 等诊断码；loop 的 `error` 事件与外层 catch 各自向 trace 写一条错误。
- UI：工具栏 `flex-nowrap + overflow-x-auto` + 全部 `shrink-0` + 固定发送按钮，宽度不足时尾部控件被裁出可视区。
- MCP：schema 由手写维护，无版本对齐与契约测试；运行护栏只靠进程名检测。

## 修改

### 引用一致性（`src/services/agentCitationRegistry.ts` 新增）

- 新增运行级 `AgentCitationRegistry`：以稳定 citation `id` 去重、首次见到即分配全局唯一 label；`buildAgentRagCitations`/`rag_search` 的 id 增加 `sourceType:chunkId` 防止不同 chunk 撞号。
- `libraryAgent.ts` 的初始上下文、`request_paper_context`、`rag_search` 与对比调研 research 阶段全部经 registry 注册；`# Source [n]` 头部经 `rewriteAgentCitationSourceLabels` 一次性改写，不会级联替换。
- `AgentMarkdown` 改用 `findUniqueAgentCitationByLabel`：重复 label 不再可点击（拒绝「首条获胜」）；新增 `[[cite:<citation-id>]]` 结构化 token 渲染为 canonical `[n]`。
- `agentAnswerEvidence.ts`：重复 label 判定为 `dangling-citation`；同句显式题名/页码与 `[n]` canonical 记录冲突时标记 `partial / citation-mismatch`；支持 `[[cite:id]]` 解析；笔记门禁随之拒绝 mismatch 草稿。
- ReAct 系统提示收紧：正文只写 `[n]`，禁止手写引用题名/页码/内部 ID。
- 边界说明：graph-report 与 note-distill 的引用编号由能力内部生成且与其文本自洽，未强制重编，后续如需再统一。

### 模型错误诊断（`electron/backend/utils.cjs`、`src/services/agentError.ts` 新增）

- `openAiChat` fetch 边界新增 `modelRequestError`：分类 `AGENT_MODEL_NETWORK_ERROR` / `AGENT_MODEL_TIMEOUT` / `AGENT_MODEL_ABORTED`，保留 `error.cause.code` 与 endpoint origin，不含 API Key、Bearer、请求体或完整 URL。
- `agentChat.ts` 经 `normalizeAgentChatErrorMessage` 将稳定错误码转为可操作中文提示；HTTP 401/4xx/5xx 服务端错误保留原文，不误报为网络故障。
- `AgentWorkspace.model.ts`：同一终态错误（相同 detail）在 trace 中只保留一条卡片。

### Composer 响应式（`AgentWorkspaceView.tsx`、`ReasoningEffortPicker.tsx`）

- 工具栏改为按容器宽度换行的两组布局：附件/记忆/RAG/选文献为辅助组；模型选择、思考强度、发送/取消为运行配置组，不再经横向滚动裁切。
- Agent 思考强度改用共享 `ReasoningEffortPicker`（紧凑图标触发，保留 title/aria-label）；菜单复用 `placeAnchoredMenu` 视口定位，支持 ArrowUp/Down、Home/End、Esc 关闭与焦点恢复。
- 模型选择器保持非紧凑，完整显示当前模型名。

### MCP 与 Skills 契约

- `desktopRunMarker.cjs` 新增：应用后端初始化后立即写入多实例运行标记（PID + startedAt），正常退出时仅移除自身条目；标记损坏/不可读返回 unknown。`main.cjs` 注册失败时不暴露无护栏实例。
- `knowledgeMcpService.cjs`：运行判定 = 标记或已安装进程检测；状态未知（null）时**保守拒绝**写入；`allowWhileAppRunning: true` 时返回带说明的 warning。
- `paperquay-mcp.cjs`：`SERVER_VERSION` 改为读取 `package.json`；移除 `get_paper_details` 未实现的 `pageKind` 参数与 `create_note` 的重复 `pageKind`；`paperquay_sync_from_zotero` 补充 `allowWhileAppRunning` schema。
- 新增仓库 skills：`paperquay-knowledge-search`、`paperquay-zotero-sync`、`paperquay-library-manage`；`paperquay-notes` 同步护栏说明。`docs/MCP_AGENT_INTEGRATION.md` 与用户手册同步：23 个工具、版本以 `serverInfo.version` 为准、运行标记覆盖开发模式。

## 验证

- `npm run build`（tsc + vite）通过；658 个测试全部通过（`TEMP/TMP` 指向仓库内临时目录以规避系统临时目录的 esbuild 访问拒绝）。
- 新增测试：`agentCitationRegistry.test.ts`（唯一编号/头部改写/歧义拒绝）、`agentAnswerEvidence.test.ts`（mismatch、重复 label、`[[cite:]]`）、`agentChat.test.ts`（网络错误本地化、HTTP 保留）、`modelRequestErrors.test.ts`（诊断码保留与脱敏）、`desktopRunMarker.test.ts`（多实例标记、unknown 保守拒绝）、`paperquaySkills.test.ts`（23 工具契约 + skill 引用解析）、`agentSessionState.test.ts`（错误卡片去重）、`knowledgeMcp.test.ts`（版本对齐 + 精确工具/schema 断言）。
- 未做桌面 Computer Use 走查：本会话无 UI 自动化工具。Composer 响应式与引用跳转的 deepseek-flash 实测待桌面复验。

## 未覆盖边界

- 模型仍可能写出无 `[n]` 的虚构题名/页码文本（无编号即按 `not-in-library` 统计，不阻断展示）。
- `[[cite:id]]` token 暂未向模型暴露 id 清单，当前为渲染与证据层的前向兼容能力。
- 图谱报告与笔记蒸馏的编号仍由能力内部维护（与其文本自洽），未并入运行级 registry。
