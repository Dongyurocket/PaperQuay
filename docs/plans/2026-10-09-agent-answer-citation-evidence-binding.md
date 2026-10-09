# Agent 回答句子与可跳转引用的证据绑定修复计划

- 日期：2026-10-09
- 状态：**已实施，自动化检查通过，用户确认人工核验通过**（2026-10-09；发布版本 0.4.6）
- 后续调整（2026-10-09，0.4.8）：来源身份决定编号与跳转，内容核验改为主动触发的提示；用户已确认该调整人工验证通过。本计划的自动核验及跳转门禁为历史设计，现行行为和验收范围见[来源跳转与可选内容检查变更记录](../changes/2026-10-09-agent-local-citation-navigation.md)，笔记证据门禁继续独立执行。
- 触发：Agent 的一段回答文字中插入了可跳转的 `[n]`，但点击后打开的文献片段并不是该段文字实际依赖或能够支撑的文献。此问题不同于链接跳转到错误页面：跳转会忠实使用 `[n]` 对应的 citation 对象，问题出在模型为句子选择了不相关的 `[n]`，而现有程序没有在展示前阻止它成为有效链接。
- 范围：`src/services/libraryAgent.ts`、`src/services/agentCitationRegistry.ts`、`src/services/agentAnswerEvidence.ts`、`src/features/agent/AgentMarkdown.tsx`、`src/features/agent/AgentWorkspaceMessages.tsx`、Agent 消息类型与持久化、对应测试、`docs/changes/`。
- 前置方案：`docs/plans/2026-10-02-agent-citation-network-ui-mcp-skill-remediation.md` 已实施的“运行内 label 唯一化”和“重复 label 不取第一项”仍然有效；本计划补足其未覆盖的“句子和证据是否真正相关”问题，不回退该方案。
- 非目标：不将任意模型生成内容当作已经被文献证明；不通过静默改写用户可见的论述来伪造证据；不变更笔记、MCP 或 PDF 阅读器的既有跳转协议，除非为消费新的 canonical citation 数据所必需。

## 1. 现象和边界

用户看到的现象是：一段关于论点 X 的文字末尾有可点击 `[3]`，但 `[3]` 打开的片段论述的是论点 Y，或者来自另一篇论文。此时跳转目标可能是一个存在、可定位且编号唯一的真实 RAG 片段，但它不是该文字的来源。

需要区分三类问题，避免用错误的修复覆盖错误的范围：

1. **编号身份冲突**：两个 citation 共享 `[3]`，渲染层取其中第一条。该问题已由运行级 `AgentCitationRegistry` 的全局重编号和 `findUniqueAgentCitationByLabel()` 的歧义拒绝处理。
2. **显式元数据冲突**：模型写“论文 A，第 26 页 `[3]`”，但 `[3]` 实际代表论文 B，第 70 页。现有 `bindAnswerEvidence()` 可以将其统计为 `citation-mismatch`，但页面仍保留 `[3]` 的可点击链接。
3. **语义证据冲突（本计划的重点）**：模型不写错误题名或页码，只是在论点 X 后选择了实际无关的 `[3]`。编号与目标对象一一对应，因此现有 identity 检查不会报错；用户点击后才发现片段不支撑该句。

本计划必须同时收敛第 2、3 类问题。只消除重复编号或仅在提示词中要求“正确引用”，都不能保证一条可点击引用确实支撑它所在的句子。

## 2. 当前链路与已确认根因

### 2.1 当前数据流

1. `libraryAgent.ts` 建立本轮 `citations` 与 `AgentCitationRegistry`。初始上下文、`rag_search`、`request_paper_context` 等把 RAG 片段注册为唯一 label，并将工具上下文中的 `# Source [n]` 重写为本轮编号。
2. `buildReActAgentMessages()` 在系统提示中要求模型只写 `[n]`，不要手写论文题名、页码、block 或内部 ID。
3. 模型仍返回自由文本。它可以输出任意 `[n]`，也可以把某个工具结果的编号附到并不由该片段支持的句子后。
4. `AgentMarkdown` 扫描回答中的 `[n]`；只要该 label 在 `message.ragCitations` 中唯一，就将它渲染成可点击按钮。点击后原样把该 citation 交给 `onOpenRagCitation`。
5. `AgentWorkspace` 根据 citation 的 `paperId`、`pageIndex`、`blockId` 打开阅读器。它没有也不应猜测正文中的真实来源，因此跳转行为本身是正确的。
6. `bindAnswerEvidence()` 在部分路径对完成回答做关键词重叠和显式题名/页码检查，结果只压缩为 `supported / partial / not-in-library` 计数。消息 UI 显示汇总统计，却没有将失败结果关联回某个具体 `[n]`，也没有阻止该链接继续可点。

### 2.2 根因一：引用选择仍由自由文本模型决定

运行级 registry 解决了“`[3]` 到哪条记录”的身份问题，却没有控制“模型为什么在这句话里选择 `[3]`”。模型拿到的是多个带数字的片段，它可根据语言流畅度、上下文位置或错误的推理选中任意编号。数字是易猜测、易误用的展示符号，不是可验证的证据引用协议。

影响：即使所有 label 在本轮唯一，错误的 label 仍能稳定、可复现地跳转到错误的证据。

### 2.3 根因二：验证结果没有成为渲染和交互的输入

`bindAnswerEvidence()` 的 `citation-mismatch` 与关键词重叠结果目前用于统计和笔记写入门禁。它不产出“回答中第几个引用 token 是否通过”的结构化结果，`AgentMarkdown` 也未接收这种结果。因此“部分支持”只是回答下方的一项总计，用户无法知道哪一个引用失效，链接仍与已核验链接一样可点击。

影响：即使程序检测出“正文说 A，编号指向 B”，系统仍把 B 以可信、可跳转的形式呈现。

### 2.4 根因三：现有本地重叠算法不足以单独判定语义支撑

`previewText` 只是一小段检索片段。纯关键词重叠会出现：

- 同一领域的两篇论文共享“旋翼、优化、性能”等词，却支撑不同结论；
- 含数字、范围、比较对象或因果关系的主张，词重叠但结论不一致；
- 同一论文的不同页都提到相同术语，只有其中一页给出目标结论。

因此不能把“有两个词重叠”直接等同于“文献支撑”。本地规则适合做廉价预筛和明显冲突检测，不能作为唯一放行器。

### 2.5 根因四：消息引用集合混合了“检索过”和“正文实际引用”

`message.ragCitations` 目前保存本轮累积的检索片段，正文渲染和底部文献组都使用同一集合。集合内包含模型未在回答中使用的片段。虽然这不是行内 `[n]` 跳转错位的直接原因，却让用户难以区分“系统为回答检索到的材料”与“当前句真正使用的证据”，也使证据审计范围被放大。

## 3. 修复目标与不变量

1. 每个可点击行内引用都同时满足两项条件：能唯一映射到 canonical citation，且已通过该句与该证据的绑定核验。
2. 模型不再直接决定用户可见的数字编号；模型只能复制本轮提供的结构化 citation token。
3. 模型写出的裸 `[n]`、伪造 token、重复 token、无关 token，均不得自动成为可信可点击链接。
4. 验证失败时保留原回答文字，并明确显示该引用未验证或不可用；不得悄悄把错误的论文、页码或结论替换为看似正确的内容。
5. 已验证的 citation 保持现有打开行为：目标仍是 canonical `paperId`、`pageIndex`、`blockId` 与 `previewText`。
6. 一条文献可以支撑多句话，一句话也可以引用多条文献；每个 token 的核验结果必须独立保存。
7. 旧消息、恢复消息和不包含结构化 token 的历史回答仍可展示，但作为 legacy 引用处理，不能伪装成已通过新协议验证的证据。

## 4. 目标协议与数据模型

### 4.1 以 citation ID 作为模型协议，以 `[n]` 作为展示层

每条 registry citation 已有稳定 `id`。模型上下文应将来源头改为如下形式：

```text
[[cite:agent-rag:paper-a:mineru-markdown:chunk-42]]
论文标题：...
页码：26
片段：...
```

模型最终回答只能逐字复制该 token，例如：

```text
该方法将设计变量与性能反馈迭代耦合。[[cite:agent-rag:paper-a:mineru-markdown:chunk-42]]
```

渲染层才把已验证 token 转换为用户看到的 `[3]`。模型不再见到或生成可决定跳转的数字 `[3]`。数字可随本轮 registry 的显示顺序变化，ID 与证据对象保持稳定。

### 4.2 新增“引用绑定结果”而非只保留聚合计数

在消息领域模型中新增可序列化的结果，名称可为 `citationBindings`：

```ts
interface AgentCitationBinding {
  tokenId: string;              // canonical citation.id
  citationId: string;
  sentenceIndex: number;
  sentenceText: string;
  status: 'verified' | 'rejected' | 'unverified';
  reason:
    | 'supported'
    | 'explicit-metadata-mismatch'
    | 'no-token-in-registry'
    | 'insufficient-snippet'
    | 'semantic-contradiction'
    | 'verifier-unavailable';
  verifier: 'rule' | 'model' | 'legacy';
}
```

该数据是 `AgentMarkdown` 是否将 token 渲染成按钮的唯一依据。`evidenceStats` 可以继续用于摘要，但必须从 bindings 汇总生成，不能再作为唯一的验证产物。

### 4.3 处理消息与恢复兼容性

- 新消息持久化 `citationBindings`，以保证重新打开工作区后链接的可信状态不改变。
- 旧消息缺少 bindings 时标记为 `legacy`：保留既有跳转能力或降级为“未验证的历史引用”文本，具体 UI 由实施阶段在兼容性评审后决定；不得把它标为已验证。
- 流式输出期间 token 可先显示为普通 `[[cite:...]]` 占位或非可点击 `[n]`；完成绑定后一次性切换为按钮，避免在答案仍未验证时出现短暂的可信链接。

## 5. 工作包 A：生成与 registry 改造

### A1. 上下文改为输出结构化 token

修改 `AgentCitationRegistry` 与上下文构造函数：

1. 保持当前 `citation.id` 去重和显示 label 唯一化。
2. 新增 `formatCitationEvidenceToken(citation)`，只由该函数生成 `[[cite:<id>]]`。
3. 将 RAG 上下文内的 `# Source [n]` 改写为 token，同时保留标题、1 基页码、block ID 和片段作为供模型判断的证据内容。
4. 在 `buildReActAgentMessages()` 中把约束改为：事实句仅能使用上下文原样给出的 `[[cite:...]]`；不能输出裸 `[n]`；没有可复制 token 时必须写“当前库内没有查到”。
5. 对 capability 调用、`rag_search`、`request_paper_context`、运行恢复和上下文压缩路径执行同一改写，禁止一条路径继续向模型提供数字 source header。

### A2. 输出规范化

新增纯函数，例如 `normalizeAgentCitationTokens(answer, citations)`：

- 提取且保留 canonical token；未知 ID 标记为悬挂引用。
- 将模型输出的裸 `[n]` 标记为 legacy/unverified，不能仅按数字直接建立链接。
- 对同一句同时存在 token 与手写论文题名、页码的情况，与 canonical citation 比较；不一致时生成 `explicit-metadata-mismatch` binding。
- 不通过自动修改正文来掩盖错误。必要时把错误 token 渲染为带说明的不可点击标识。

## 6. 工作包 B：逐句证据核验

### B1. 规则预筛

扩展 `bindAnswerEvidence()` 或拆出无 UI 依赖的 `verifyAgentCitationBindings()`：

1. 保留现有代码块、标题、短句与问句过滤规则，但使输出带 token 在原文中的位置或句子索引。
2. 立即拒绝未知 token、重复或歧义 token、显式题名/页码冲突。
3. 对主张的数值、比较对象、否定词和因果关系做规则提取；这些与片段明显冲突时拒绝，不能被普通关键词重叠掩盖。
4. 对片段为空、仅元数据、关键词重叠过低的 token 标记 `unverified`，不赋予可点击可信状态。

规则预筛的职责是尽早排除确定错误和缺少证据的引用，不声称解决全部学术语义判断。

### B2. 受限二次判定

对于规则未拒绝、但不足以确定支持的“主张 + 候选片段”对，调用一个受限的 verifier：

- 输入仅包含该句、该 citation 的论文题名/页码/片段和严格 JSON schema，不传递整段回答或无关文献。
- verifier 只能返回 `supported`、`insufficient` 或 `contradicted` 及简短理由；片段不能完整支撑时必须返回 `insufficient`。
- 使用当前 Agent 所选模型，或新增可配置的低成本 verifier 配置；必须记录模型与失败状态，不能将调用失败默认为通过。
- `supported` 才生成 `verified` binding；`insufficient`、`contradicted` 对应不可点击状态。

此步骤应在最终回答流结束后执行。对于超时、网络失败、模型不可用，所有尚未确认的 token 统一保持 `unverified`，不会降级为可点击。

### B3. 失败处理与用户可见行为

- 已验证：显示现有样式的 `[n]` 按钮，可跳转。
- 拒绝：显示非链接的 `[n]` 和简短 tooltip，例如“该引用未能支撑此句，未提供跳转”。
- 未验证：显示中性状态，提示“证据核验未完成”；不造成“已由文献支持”的印象。
- 回答下方显示可理解的数量，如“已核验 3 条，未验证 1 条”，并可展开查看是哪一条句子以及原因。
- 用户可选择“核验引用”重新运行 binding verifier，但不允许手工把任意 citation 强行标为已验证。

## 7. 工作包 C：渲染、引用列表和跳转

### C1. `AgentMarkdown` 只信任 binding

调整渲染输入，使 `AgentMarkdown` 接收 citations 与 `citationBindings`：

- 对 `[[cite:id]]` 查找 binding 和 citation；仅 `status === 'verified'` 时输出 `#agent-cite-...` 链接。
- 不再把回答中的裸 `[n]` 直接转换成链接；为过渡兼容明确区分 `legacy`，不使用当前回答的自动可信样式。
- 从 canonical citation 生成按钮的 label、tooltip、论文名和页码，绝不从模型的临近文字读取这些值。
- 有多个 citation 的句子逐个处理，避免一个成功 binding 误放行同句其他 token。

### C2. 底部引用区域只显示已使用的证据

派生两个集合：

- `retrievedCitations`：本轮检索成功的所有片段，仅用于执行轨迹或“本轮检索材料”折叠信息。
- `usedVerifiedCitations`：回答中有至少一个 `verified` binding 的片段，作为正文下方“已核验证据”文献组。

`AgentRagCitationChips` 改为使用第二个集合。每一个页按钮仍传递原始 canonical citation 给 `onOpenRagCitation`，不改动阅读器定位逻辑。

### C3. 跳转回归要求

`AgentWorkspace` 的 `handleOpenRagCitation` 已使用 citation 中的 `paperId`、`pageIndex`、`blockId` 构造阅读器定位。该函数不负责推断正文语义，本计划不改其对象传递语义；测试需证明 verified binding 传入的仍是同一 canonical 对象。

## 8. 测试计划

### 8.1 单元测试

新增或扩展以下测试：

1. 两篇论文、多个相近主题片段：模型为旋翼噪声主张使用倾转旋翼总体设计 token，规则或 verifier 返回拒绝，该 token 不获得 `verified`。
2. “论文 A，第 26 页 + B 的 token”返回 `explicit-metadata-mismatch`，UI 不生成链接。
3. token 对应片段明确支持主张时，生成 `verified`，渲染为目标 citation 的唯一 label。
4. 未知 ID、重复 token、裸 `[n]`、不完整 token、同一句多 token、同一 token 支撑多句均有确定行为。
5. verifier 超时、网络失败、非法 JSON 和空响应全部 fail closed，输出 `unverified`。
6. label 唯一化、bare paper ID、历史消息显示和既有 citation group 逻辑不回归。

### 8.2 组件测试

1. verified token 是按钮，点击回调收到正确 `paperId`、`pageIndex`、`blockId`。
2. rejected/unverified/legacy token 不是可点击跳转按钮，具备可访问名称和可理解的原因提示。
3. 底部“已核验证据”不包含仅被检索但未在正文通过绑定的文献。
4. 流式完成前后不会让未验证 token 短暂变成可点击链接。

### 8.3 桌面验收

使用开发实例和 `deepseek-flash`：

1. 选择至少两篇主题相近但结论不同的文献，提出需要页码证据的比较问题。
2. 对每个正文可点击引用，记录正文句、按钮 tooltip、打开的论文/页/block 以及片段原文；确认片段直接支持该句。
3. 诱导模型输出一个无关引用或用测试桩返回无关 token，确认它显示为未验证且不能跳转。
4. 关闭并重新打开工作区，确认已验证/未验证状态及跳转目标保持一致。

## 9. 实施顺序、提交与回滚

1. 先完成数据模型与 token registry，保留旧渲染作为显式 legacy 分支。
2. 实现规则预筛、binding 持久化和 fail-closed 渲染；先不启用二次模型 verifier。
3. 完成 verifier，观察其成本、延迟、误拒绝率和网络失败行为，再决定默认启用范围。
4. 切换底部引用区到 `usedVerifiedCitations`，补足组件和桌面回归。
5. 每个工作包独立提交，完成后按 `docs/changes/README.md` 写入事实性变更记录，并将本文件更新为 `implemented` 或分项状态。

回滚开关应允许停用 verifier 调用，但不能恢复“任何 `[n]` 默认可点击”的旧行为。verifier 不可用时维持 unverified 展示，保护证据可信度。

## 10. 验收标准

1. 任何用户可点击的 Agent 行内引用，都有一个唯一 canonical citation 和一个已通过的句子级 binding。
2. 当正文与目标文献不相关时，该编号不可点击，并能说明“未验证”或具体拒绝原因。
3. 正文、tooltip、底部已核验证据列表和阅读器跳转使用同一 citation 对象。
4. 检索到但未被答案实际使用的文献不会混入“已核验证据”。
5. verifier 失败、超时或网络异常不会把未核验引用放行为可信链接。
6. `npm run build`、`npm test` 通过；新增单元、组件和开发桌面验收覆盖本计划中的身份冲突、显式元数据冲突和语义证据冲突三类路径。

## 11. 实施记录（2026-10-09）

- A 已完成：共享结构化 token 协议，ReAct/比较调研/工具上下文/压缩统一传递；checkpoint 独立保存 canonical citation，旧恢复字段兼容。图谱、引用审计和笔记能力中的确定性旧数字报告按 legacy 展示，不静默改写为已验证 token。
- B 已完成：逐出现位置绑定、规则预筛、当前模型受限 JSON 核验；最多 48 对、并发 3、单次 15 秒超时，异常与取消均保持不可点击。默认启用；保留停用开关。
- C 已完成：只有 verified occurrence 可跳转，核验明细与重新核验、消息持久化与分叉、仅已用已核验证据页按钮、检索材料折叠展示。
- 自动化检查已完成：`npm run build` 通过；`npm test` 678/678 通过；`git diff --check` 通过。实际 ReactMarkdown/消息卡片组件测试覆盖可信按钮、canonical 对象回调、流式未核验状态、伪造链接和底部证据过滤。
- 人工核验已完成：2026-10-09 用户确认“经测试，通过人工核验”，授权提交、推送、构建及发布 0.4.6。未收到逐项截图记录，延迟/成本及误拒绝率尚未量化。验收步骤留档见 [变更记录](../changes/2026-10-09-agent-answer-citation-evidence-binding.md)。
