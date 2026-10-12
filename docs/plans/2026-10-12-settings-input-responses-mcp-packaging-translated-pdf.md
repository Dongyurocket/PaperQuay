# 设置页数值输入、Responses 完整支持、MCP 随包发布与翻译版 PDF 工具修复计划

- 日期：2026-10-12
- 状态：**implemented（2026-10-12，分支 `feat/settings-responses-mcp-translated-pdf`）**
- 范围：模型预设设置页交互、Agent/QA 的 OpenAI Responses API 支持、MCP 服务的安装包分发、MCP 翻译版 PDF 附件工具
- 关联：`docs/plans/2026-09-30-agent-capability-memory-graph.md`（第 8.3 节 maxOutputTokens）、`docs/MCP_AGENT_INTEGRATION.md`、`docs/changes/2026-09-06-translated-pdf-mcp-academic-metadata.md`

## 问题清单

| # | 现象 | 根因定位 | 严重度 |
|---|------|----------|--------|
| 1 | 设置页「上下文窗口」「最大输出」无法直接键入，输入 1 立即跳成 4096/256 | 受控输入每次击键即归一化夹取 | 中（UI 阻断） |
| 2 | Agent 未完整支持 Responses 格式 | finishReason 语义未归一化；非流式 function_call 的 id/call_id 取错 | 高（功能错误） |
| 3 | 新用户安装 MCP 时发现服务未随安装包发布，需回源码仓库取文件 | electron-builder `files` 未覆盖 `bin/` 与 `eventsource-parser`；asar 内文件外部 Node 不可执行 | 高（分发阻断） |
| 4 | MCP 缺少附加翻译版 PDF 的能力 | 23 个 MCP 工具未覆盖 translated-pdf 附件写路径 | 中（能力缺口） |

---

## 问题 1：设置页数值输入框被即时夹取，无法键入

### 现象

模型预设编辑区「上下文窗口」「最大输出」两个数字输入框无法直接填写：键入第一个数字（如 1）立即被改写为 4096（或 256），导致永远输不出 128000 这类多位的合法值。

### 根因

调用链为「受控组件 + 每次击键即归一化」：

1. `src/features/reader/readerPreferencesModelsSection.tsx:421-447`：两个 `SettingsInput` 是受控 `type="number"` 输入，`value={preset.contextWindow ?? ''}`，`onChange` 每次击键都调用 `onQaModelPresetChange(preset.id, { contextWindow: Number(value) })`。`SettingsInput` 本身是裸 `<input>`（`readerPreferencesPrimitives.tsx:144`），没有任何缓冲。
2. `src/features/reader/useReaderSettings.ts:196-232`：`updateQaModelPreset` 把 patch 直接送进 `createQaPreset({...preset, ...patch})`。
3. `src/features/reader/readerShared.ts:413-420`：`createQaPreset` 对 `contextWindow` 立即 `Math.max(4096, ...)`、对 `maxOutputTokens` 立即 `Math.max(256, ...)`。

击键「1」→ `Number('1')=1` → 夹取为 4096 → 受控 value 回显 4096。归一化本身是必要的最终防线（`tests/modelMaxOutputTokens.test.ts` 已锁定该语义），错在把**存储态归一化**施加到了**编辑中间态**。

### 方案

编辑态与归一化分离，存储语义不变：

1. `readerPreferencesModelsSection.tsx` 新增本地草稿组件（如 `PresetNumberField`）：以 `defaultValue`/本地 string state 承接键入，`onChange` 只更新草稿、不写库；`onBlur` 与 `Enter` 时才把解析后的数值交给 `onQaModelPresetChange` 归一化持久化。草稿与外部值在 `preset.id` 或非编辑态外部值变化时同步（`key={preset.id}` 或受控同步 effect）。
2. 非法输入（空、非数字、超范围）在 blur 提交时由现有 `createQaPreset` 夹取兜底；输入框旁加一行 hint 文案说明合法区间（4096–2,000,000 / 256–200,000），夹取发生后输入框显示夹取结果，不产生静默跳变。
3. `createQaPreset` / `normalizeQaModelPreset` 的夹取逻辑**保持不变**，继续作为持久化与消费的最终防线。
4. 同文件其余 number 输入（温度 `normalizeModelTemperature` 路径）如存在同类即时归一化一并改为 blur 提交。

### 涉及文件

- `src/features/reader/readerPreferencesModelsSection.tsx`（新增草稿式数字字段，替换两处 `SettingsInput`）
- `tests/`：新增组件或纯逻辑用例——模拟逐字符键入 `128000`，断言过程中不触发持久化、blur 后值为 128000；键入 `1` 后 blur 得 4096（夹取提示）；清空后 blur 归 `undefined`。

### 验证

- `npm test` 全绿；手工在设置页分别键入 `128000`、`8192`、`1`、清空，确认无中间态跳变，blur 后符合预期。

---

## 问题 2：Agent 未完整支持 OpenAI Responses 格式

### 现状

`apiMode: 'responses'` 的请求构造（`buildResponsesRequestBody`）、消息转换（`messagesToResponseInput`）、流式合并（`mergeResponsesChunks`）、正文/思维链提取（`pickChatText`/`pickChatThinking`）已存在，Agent 主循环全链路透传 `apiMode`（`libraryAgent.ts:3337/3382`）。但有三处语义断点。

### 根因 A：finishReason 语义未归一化，截断恢复与 UI 完成态失效

- `electron/backend/aiCommands.cjs:632-637` `agentChatTurnResult`：responses 模式下直接把 `data.status` 当 `finishReason` 返回。Responses 的 `status` 取值是 `completed` / `incomplete` / `failed` / `cancelled`，而下游全部按 chat 语义判断：
  - `src/services/agentLoop.ts:952/1000` 只认 `finishReason === 'length'` 触发截断自动恢复与本地化报错；
  - `src/features/agent/AgentWorkspace.model.ts:605-616` 只有 `'stop' | 'answer'` 标成功、`'length' | 'max_turns'` 标警告；
  - `src/features/agent/AgentWorkspace.tsx:1146` 对非 `stop/answer/max_turns` 的结束态走异常分支。
- 后果：responses 成功回合得到 `finishReason='completed'` → UI 轨迹误判；`status='incomplete'`（`incomplete_details.reason='max_output_tokens'`）不映射为 `length` → 截断回答被静默当完整结果，恰好违背 `docs/plans/2026-10-09-agent-retrieval-rendering-delivery-quality.md` 第 103 行「非空但被长度截断的回答也不能静默认定完整」。
- 流式侧 `mergeResponsesChunks`（`utils.cjs:388`）只识别 `response.completed`/`response.done`，不处理 `response.incomplete` / `response.failed` / `response.cancelled`，截断流直接丢 status。

### 根因 B：非流式 responses 的 function_call 取了 item id 而非 call_id

- `electron/backend/utils.cjs:926` `pickToolCalls`：`id: cleanString(outputItem?.id || outputItem?.call_id)` —— 优先 `id`。OpenAI 真实 Responses 输出中 function_call item 同时携带 `id`（`fc_…`）与 `call_id`（`call_…`），而下一轮回传的 `function_call_output.call_id` 必须等于 `call_id`。
- 流式路径幸存是因为 `mergeResponsesChunks:330` 用 `item.call_id || item.id` 归一后写回了 `id` 字段；非流式路径（`readRequestJson` 直接拿原始 JSON）不经合并，取到的是 `fc_…`。受影响调用：所有 `stream:false` 且带工具的 responses 请求（如 legacy plan 生成链路）——工具结果回传时 `messagesToResponseInput:695` 会把错误 id 写成 `call_id`，provider 报孤儿 tool output。
- 测试盲区：`tests/agentChatTurn.test.ts` 的 responses 用例只有流式，且 fixture 中 `id`/`call_id` 语义未按 OpenAI 真实形态区分。

### 根因 C（次要）：`status: 'failed'/'cancelled'` 未转成错误

`agentChatTurnResult` 会把 `failed` 当普通结束态返回空内容，上层显示为空回答而非可诊断错误。

### 方案

1. `utils.cjs` 新增 `normalizeResponsesFinishStatus(data)`：
   - `completed` → `'stop'`；
   - `incomplete` + `incomplete_details.reason ∈ {max_output_tokens, max_tool_calls}` → `'length'`；其他 reason → `'incomplete:<reason>'`；
   - `failed` / `cancelled` → 抛含 `error.message` 的 Error；
   - 无 status → 保持现有 `'stop'` 兜底。
   `agentChatTurnResult` 改调该函数。
2. `mergeResponsesChunks` 增加捕获 `response.incomplete`（同 `completed` 一样吸收 `chunk.response`，并保留 `status`/`incomplete_details`）；`response.failed`/`response.cancelled` 记录 status 与 error 供结果层抛错。
3. `pickToolCalls` 改为 `id: cleanString(outputItem?.call_id || outputItem?.id)`（call_id 优先，id 兜底）；`mergeResponsesChunks` 保持现状（已等价）。
4. 审计旁路消费方：`knowledgeGraphCommands.cjs`（复用 utils，自动受益）、QA 流式（只读文本增量，不涉及 tool/完成态）、翻译/综述非流式（`pickChatText` 已兼容，无 tool 时不触碰根因 B）——确认无需额外改动。

### 涉及文件

- `electron/backend/utils.cjs`（normalizeResponsesFinishStatus、mergeResponsesChunks、pickToolCalls）
- `electron/backend/aiCommands.cjs`（agentChatTurnResult 接入）
- `tests/agentChatTurn.test.ts`：新增 3 例——非流式 responses function_call（`id='fc_1'`、`call_id='call_1'`，断言取 `call_1`）；流式 `response.incomplete` + `max_output_tokens` 断言 `finishReason==='length'`；`completed` 断言 `'stop'`。
- `tests/modelMaxOutputTokens.test.ts`：补 responses 截断映射断言（如已有合适位置）。

### 验证

- `npm test`；用支持 Responses 的真实端点（或本地 mock）跑一轮 Agent 工具调用循环 + 一轮故意小 `maxOutputTokens` 的截断场景，确认轨迹显示与恢复行为与 chat_completions 一致。

---

## 问题 3：MCP 服务未随安装包发布

### 现象

新用户通过安装包安装 PaperQuay 后无法配置 MCP：`app.asar` 里只有 `package.json` 的 `bin` 声明，入口 `bin/paperquay-mcp.cjs` 本体缺失（2026-10 实际排障记录：只能从官方仓库按装机一致 tag 拉源码重建运行环境）。`docs/MCP_AGENT_INTEGRATION.md` 第 107-174 行的示例配置也全部指向源码仓库路径。

### 根因

1. **入口未打包**：`package.json` build.files（119-152 行）包含 `dist/`、`electron/`、`src/shared/` 与一份手工维护的 node_modules 白名单，**不含 `bin/`**。
2. **依赖未打包**：MCP 运行链 `bin/paperquay-mcp.cjs → electron/mcp/knowledgeMcpService.cjs → electron/backend/utils.cjs:5` 依赖 `eventsource-parser`，而它**不在** files 白名单（`adm-zip`、`sql.js`、`sqlite-vec` 在）。
3. **asar 不可外部执行**：即便补齐 1、2，外部 Agent 用系统 Node 直接运行 `resources/app.asar/bin/...` 也不可行（asar 只有 Electron 补丁过的 fs 能读）。
4. **运行时前提**：MCP 依赖 `node:sqlite`（`electron/backend/nodeSqlite.cjs:20`），要求 Node ≥ 22.5，用户机器不保证有合适 Node。

### 方案（推荐 A，B 为备选）

**方案 A：构建期产出自包含 MCP bundle，经 `extraResources` 放到 asar 之外**

1. 新增构建脚本（如 `scripts/Bundle-Mcp.ps1` 或并入 `electron/build.cjs` 前置步骤）：用 devDependencies 已有的 esbuild 把 `bin/paperquay-mcp.cjs` 打为单文件 cjs bundle——内联 `adm-zip`、`eventsource-parser`、`sql.js`、`electron/backend/*`、`src/shared/*`；`node:*` 保持 external；`sqlite-vec` 为原生模块不打包，按平台把 `node_modules/sqlite-vec-{win32,darwin,linux}-*/` 随行复制到 bundle 旁的 `node_modules/`。产物落到 `packaging/mcp/`（入 `.gitignore`）。
2. `package.json` build 增加：
   - `extraResources: [{ from: 'packaging/mcp', to: 'paperquay-mcp' }]`，安装后位于 `resources/paperquay-mcp/server.cjs`；
   - files 白名单补 `node_modules/eventsource-parser/**/*`（顺带消除 asar 内同模块缺失的隐患）。
3. 启动方式二选一（实现时验证后定稿）：
   - **首选**：用应用自带的 Electron 二进制以 `ELECTRON_RUN_AS_NODE=1` 当 Node 启动 bundle（Electron 官方支持；Electron 42 内嵌 Node ≥ 22.5，天然满足 `node:sqlite`），安装版用户零额外依赖；
   - **兜底**：系统 Node ≥ 22.5 直接 `node server.cjs`。
4. 设置页新增「MCP 服务」区块：展示安装版 bundle 实际路径、按所选启动方式生成可复制的外部 Agent 配置片段（含 `--data-dir` 说明）、Node 版本自检提示；开发模式显示源码路径配置。
5. 文档：`docs/MCP_AGENT_INTEGRATION.md` 增加「已安装桌面版」章节；`README.md`/用户手册 MCP 段落同步。

**方案 B（备选，不推荐单独采用）**：只把 `bin/` 与缺失依赖补进 files —— 仍要求用户有 Node ≥22.5 且要解决 asar 执行问题，不能闭环，仅作为 A 的依赖补口子集保留。

### 涉及文件

- `scripts/Bundle-Mcp.ps1`（或 `electron/build.cjs` 前置 esbuild 步骤）（新增）
- `package.json`（extraResources + files 补丁）
- `src/features/reader/readerPreferences*.tsx`（设置页 MCP 区块，位置随现有设置分区）
- `electron/backend/`（新增读取安装版 bundle 路径/生成配置片段的只读命令）
- `docs/MCP_AGENT_INTEGRATION.md`、`docs/USER_MANUAL.zh-CN.md`、`README.md`

### 验证

- `npm run electron:build` 后在干净目录核对 `resources/paperquay-mcp/` 存在且可启动；用 stdio 握手脚本完成 `initialize` → `tools/list`（应为 23+ 个工具）→ `search_papers` 只读调用；
- 模拟新用户路径：不克隆仓库，仅凭安装包完成外部 Agent 的 MCP 配置。

---

## 问题 4：MCP 缺少附加翻译版 PDF 的工具

### 现状

桌面端已支持 translated-pdf 附件全生命周期（`library_add_attachment` / `library_remove_attachment`，`libraryCommands.cjs:901-1001`）：统一落入 `translatedPdfDir`（默认 `<storageDir>/translated-pdfs`）、同文献单份替换、提交元数据后再安全清理旧副本。MCP 现有 23 个工具（`bin/paperquay-mcp.cjs` TOOLS 表）无对应能力——外部 Agent 用 retainpdf 等工具产出译文 PDF 后，只能请用户回桌面端手动附加，工作流断在最后一公里。

### 方案

1. **抽取共享实现，避免双端漂移**：把 `libraryCommands.cjs` 中 `resolveTranslatedPdfStorageDir` 与 translated-pdf 附件增删逻辑抽为 `electron/backend/translatedPdfAttachments.cjs`（纯函数 + 注入 store/appPaths），`library_add_attachment` / `library_remove_attachment` 与 MCP 新工具同调一份实现。注意遵守 `AGENTS.md` 红线：文献写入必须走 store 的 UPSERT 语义路径（MCP 侧沿用 `withWritableLibrary` 的 load→mutate→save，与现有 `importPdfs`/`updatePaper` 相同，不得引入 `INSERT OR REPLACE`）。
2. **MCP 新增 2 个写工具**（23 → 25）：
   - `attach_translated_pdf({ paperId, sourcePath, allowWhileAppRunning })`：校验 PDF 存在 → 复制入统一目录 → 单份替换 → 返回 attachmentId/storedPath/relativePath 与是否替换了旧版。走 `withWritableLibrary` 护栏（桌面运行时拒绝，`PAPERQUAY_MCP_WRITE=off` 全局只读均生效）。
   - `remove_translated_pdf({ paperId, deleteFile = true, allowWhileAppRunning })`：按文献定位其 translated-pdf 附件移除。
   - 页数一致性：桌面端附加前比对原版/翻译版页数并警告。MCP 侧用已在依赖白名单中的 `pdf-lib` 读两份 PDF 页数，不一致时在结果中返回 `pageCountMismatch: { original, translated }` 警告而不拒绝（MCP 无交互确认通道）。
   - `get_paper_details` 已返回 attachments，无需扩展；在返回结构说明中明确 translated-pdf 附件字段，便于 Agent 先查后写。
3. **文档与 Skill 同步**：`docs/MCP_AGENT_INTEGRATION.md` 工具清单与护栏说明补 2 个工具；`paperquay-library-manage` skill 增补「附加/移除翻译版 PDF」用法；`AGENTS.md` 的 MCP 工具计数同步为 25。

### 涉及文件

- `electron/backend/translatedPdfAttachments.cjs`（新增，自 `libraryCommands.cjs` 抽取）
- `electron/backend/libraryCommands.cjs`（改调共享实现）
- `electron/mcp/knowledgeMcpService.cjs`（attachTranslatedPdf / removeTranslatedPdf 方法）
- `bin/paperquay-mcp.cjs`（TOOLS 表 + dispatch）
- `tests/`：MCP 层用例——附加成功、重复附加替换旧副本且旧文件被清理、paperId 不存在报错、运行中拒绝与 `allowWhileAppRunning` 覆盖、页数不一致返回警告
- `docs/MCP_AGENT_INTEGRATION.md`、`AGENTS.md`、相关 skill 文档

### 验证

- `npm test`；桌面端手工回归：MCP 附加的翻译版 PDF 在文献详情与阅读器「PDF 对照」中可见可用；桌面端附加/替换/移除路径行为不变（共享实现回归）。

---

## 实施顺序与工作量估算

| 步骤 | 内容 | 依赖 | 估算 |
|------|------|------|------|
| 1 | 问题 2（Responses 归一化与 call_id） | 无 | 1 天 |
| 2 | 问题 1（设置页草稿式数字输入） | 无 | 0.5 天 |
| 3 | 问题 4（共享附件实现 + 2 个 MCP 工具） | 无 | 1 天 |
| 4 | 问题 3（MCP bundle + extraResources + 设置页区块 + 文档） | 建议在 3 之后，一次打包即含新工具 | 1.5–2 天 |

步骤 1、2、3 互相独立可并行；步骤 4 最后做，使首个携带 MCP 的安装包即包含 25 个工具。

## 统一验证门槛

- `npm run check`（构建 + 测试）全绿；
- 桌面端手工回归覆盖：设置页数值输入、Agent 一轮含工具调用的 responses 会话、翻译版 PDF 附加/对照阅读；
- 安装包级验证：新用户仅凭安装包完成 MCP 配置并调用成功；
- 变更记录按 `docs/changes/README.md` 格式归档；发布按 `docs/RELEASE.md` 执行。

## 风险与注意

- 问题 3 的 `ELECTRON_RUN_AS_NODE=1` 启动方式需先做一次 spike 验证（含 `sqlite-vec` 原生模块在该模式下的加载）；不可行则退回「系统 Node ≥22.5 + 安装器环境检测提示」。
- esbuild 打包 `knowledgeMcpService.cjs` 依赖链时需全量 smoke：23+2 个工具逐一至少一次调用（只读工具在测试数据目录上跑），防止动态 `require` 被静态打包漏掉。
- 问题 1 的草稿式输入要处理「编辑中切换预设」的脏草稿丢弃，避免串档。
- `pickToolCalls` 的 call_id 优先改动会影响存量 chat_completions 路径的兼容性测试，需跑全量 Agent 测试套件确认无回归。
