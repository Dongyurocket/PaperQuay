# 2026-10-01 — Agent 能力与记忆桌面端验收

## 结论

截至 2026-10-01 02:54（Asia/Shanghai），五组用例已完成桌面走查并取得 UI、运行事件、笔记数据库和文件前后对照证据。**整体验收不通过**：运行时路由事件报错、能力结束后执行轨迹不收尾、引用核对缺少 report 阶段、普通自动问答有额外模型调用、内部 ID 胶囊出现 KaTeX 错误，另有笔记与记忆反馈问题。成功的审批和记忆闭环不能抵消这些失败。

`npm run check` 已在本次运行：构建成功，619/619 测试通过。日志为本机临时目录中的 `check-delivery.log`；单测通过不作为桌面通过的替代证据。

## 测试对象与方法

- 当前仓库：`C:\Users\yusen\.proma\agent-workspaces\paperquery\workspace-files`；PaperQuay 0.3.3，Electron 42.2.0，Node.js 24.19.0。
- 开发入口为当前仓库 `electron/dev.cjs`，renderer 地址 `http://127.0.0.1:1420/`。Computer Use 目标窗口为临时同版本运行时 `electron-clean\electron.exe`，窗口 ID 19863994。没有操作已安装旧版。
- Windows UI 操作使用 computer-use skill 的 `@oai/sky`；落库和文件验证使用只读 SQLite 查询及哈希对照，没有以数据库写入替代审批点击。
- 用户补充模型约束前有三次 GPT 测试；约束后所有 Agent 请求均经 UI 确认或数据库核验为 **deepseek-flash**。重载会重置到 GPT 默认模型，发送前已切回，重载后没有发出 GPT 请求。
- 文库 174 篇。主要选用 `Conceptual Design of an AAM Tiltrotor via Aircraft-Level Weight-Performance Feedback`，ID `paper_mufwwou2_5a014354`，DOI `10.1007/s42405-026-01204-9`，已解析并 RAG 索引。
- 初始有效笔记 3 条；初始 L2 为 0 字节。未提交代码，未修改或清理个人 scripts 资产。

## 用例结果

| 用例 | 判定 | 实际证据与限制 |
| --- | --- | --- |
| 普通选中论文问答 | 未通过 | 原始“总结所选论文”请求跑满 8 轮，模型未识别选中范围，读元数据报错并请求用户提供文献。显式提供 paperId 后 deepseek-flash 完成一次 rag_search 和两轮回答。 |
| 本地证据绑定不发模型请求 | 绑定函数成立；整体请求条件未通过 | bindAnswerEvidence 是同步纯函数。实际普通自动请求有分类器，未选范围的历史对话还发生两次上下文压缩，共 5 个 agent_chat_turn（1 分类器、2 压缩、2 流式轮次）。没有发现绑定器发请求。renderer Network 为空不能证明模型请求为零，因为请求在主进程经 IPC 执行。 |
| 引用归组、同页去重、折叠 | 单篇场景通过 | 一组覆盖第 1–15 页；展开只有 8 个唯一页码：1、2、3、6、7、9、14、15；同页多块合并；再次点击折叠收回页按钮。本次未验证多文献超过三组时的“更多”计数。 |
| 页码引用跳转 | 部分通过 | 首次打开未加载阅读器停在 Page 1/15，目标第 3 页未保持；资源加载后第二次点击成功 Page 3/15，正文区块及 PDF 均高亮。 |
| 正文内部 ID 标题胶囊 | 未通过 | ID 解析产生标题链接，但进入 KaTeX，红色显示链接源码，报 `Expected 'EOF', got '#'`，无法作为胶囊点击。 |
| 合法 qa / concept 批准落库 | 审批与结构通过，内容质量未通过 | 批准前数据库无测试笔记。qa 批准后卡片禁用“已写入”，Notes 可见，Tiptap 标题/列表完整。concept 从真实 qa 收集来源后通过并批准；JSON 为 wikiLink，note_links 记录 concept→qa，qa 的 BACKLINKS 同时显示 concept 和研究日志。但 concept 原句被来源 600 字符限制截为半句仍放行。 |
| 笔记审批拒绝 | 通过 | 第二份合法 qa 草稿点击“拒绝”，卡片禁用“已拒绝”；有效笔记数仍为 5，拒绝标题没有落库。 |
| 无锚点 excerpt | 结果通过，路径有限 | 请求明确 excerpt 且无选区/anchors，返回阅读器选区说明，不生成审批卡，无摘录记录；该次 collect 无来源，未触及有证据时的 excerpt 草稿校验分支。源码另有直接 excerpt 拒绝规则。 |
| 引用核对状态 | 判定场景通过，展示未通过 | 第一轮四条主张：partial 1 / not-in-library 3，无虚构 supported。第二轮相同英文原句 increase/decrease：supported 1 / contradicted 1，理由引用原文“增加三倍”。有无关片段的虚构主张没有被当作 supported；检索为全库，未稳定制造真正空片段的 UI 场景。 |
| 引用核对四阶段 | 未通过 | UI 和数据库事件仅 extract→retrieve→judge，均有 start/end/progress；注册表也是三个阶段，缺 report。报告一次性呈现，不能称四阶段流式通过。 |
| 否定主张确认前不写 | 通过 | 报告出现建议，点击“写入工作记忆”只生成审批卡；两次确认前哈希均为 `6DA71FD33760EFD4B4FFE0AA85F42FEE590B110D5B491655C42E42B2FA3EBB3D`。 |
| 确认合并保留 Current task | 通过 | 审批后 L2 为 606 字符，Rejected claims 追加 3 条，Current task 与 Open questions 原文保留；按钮禁用“已写入”，没有重复入口。 |
| 4000 字符写入上限 | 上限通过，反馈未通过 | 3990 字符夹具批准追加一条相反主张后仍 3990，哈希完全不变，新条目被丢弃；UI 却显示“已写入”，未说明容量不足或实际 added=0。 |
| 单篇 synthesis 拒绝 | 结果通过 | 只有一篇证据，返回校验失败说明，不产生 synthesis 审批卡，没有相关笔记落库；此次模型先返回拒绝形状，未稳定触发“两个不同 paperId”门禁分支。 |
| 超长 L2 注入 | 通过 | 实际 agent_chat_turn 脱敏诊断输出 memoryChars=1200、overLimitHint=true；3990 字符原文件 SHA256 前后相同。诊断的 kind 分类只是简易文本启发式，不能用于认定此请求为主张抽取；stream/长度字段来自实际 request。 |

## 待修复问题

1. **运行事件 IPC 报错**：主进程反复 `Unsupported agent run event kind: capability_route`，路由事件没有正常持久化。`onCapabilityUsage` 还把核对/蒸馏/分类器用量统一记录为 comparative-survey。
2. **执行轨迹终态错误**：能力卡 done、run done，甚至笔记或记忆已批准后，通用轨迹仍 2/6，任务计划 RUNNING，最终回答 WAITING。普通 ReAct 也残留通用 WAITING 行，同时另列最终回答 SUCCESS。
3. **核对检索范围与来源名称**：已选择单篇仍检索全库；注册表 adapter 没传 currentPaperScopeIds，paperTitle 缺失时直接为空，报告出现《》。真实 CAMRAD II / NDARC 主张因检索来源标识不全被 partial。
4. **缺 report 阶段**：实现与四阶段验收要求不一致。
5. **ID 胶囊数学解析冲突**：标题链接进入数学表达式，出现 KaTeX ParseError 和红色源码。
6. **常规 qa 证据位置误拦截**：`- [1] paperId: ..., page: 5` 被当成实质结论，要求“我的推断”。第二次重试删了定位字段又触发位置结构失败。给位置行附真实英文原句后才通过，正常合法草稿不应依赖这个绕法。
7. **paperId 富文本失真**：qa 定位行下划线被解析为 italic，Notes 显示 `papermufwwou25a014354`，没有保留完整内部 ID 字符串。
8. **concept 来源截断**：收集 qa 正文前 600 字符包含结构和问题，答案原句被截在 `CAMRAD II mid-fidelity`；半句仍通过结构和证据门并可落库。
9. **记忆容量反馈错误**：合并新增为 0 仍宣称写入成功，用户无法知道新否定项未保存。
10. **Notes 标题状态串页**：切换到 concept 或 qa 时正文/标签/反链正确，标题输入却保留“研究日志”或最初未命名，显示 Unsaved；未点击 Save，数据库中真实标题仍正确。
11. **首次阅读器引用定位丢失**：初次资源加载回到第一页，再点击才正确定位。
12. **自动普通请求开销**：分类器必然额外调用；无选择范围时携带全库上下文，8 字寒暄消耗 117,785 prompt tokens，后一条普通请求消耗 238,845 prompt tokens 并压缩两次。选中单篇的同类请求约 13,657 prompt tokens。token 来自 agent_runs，不把分类器和压缩误归为绑定器开销。

## 开发启动修复和环境限制

- 原路径 Electron 桌面启动退出 `0x80000003`，官方符号定位 `sandbox::policy::Sandbox::Initialize`。用户退出 Windhawk 后仍复现，并验证模块未加载，因此不能归因于 Windhawk。
- 同版本官方缓存包解压到临时目录即可启动，exe 哈希相同，原路径与临时路径 ACL 不同；仅能说明路径/访问环境相关，精确根因未确定。使用 ELECTRON_OVERRIDE_DIST_PATH，未降级 Electron、未禁用沙箱、未更改安全设置或 ACL。
- 本次修复 Vite 开发模式本地 CJS named export 错误：serve-only 插件转换共享 markdownToTiptap.cjs 导出，后端 CJS 文件不改。
- 本次补齐已有但未渲染的能力钉选状态：AgentWorkspaceView 增加选择器，Workspace 传递 pinnedCapabilityId/setter。
- esbuild 原位置遇到 Access denied；同一个 exe 复制临时位置后，以 ESBUILD_BINARY_PATH 运行 check 成功。
- Windows 文件监听曾未使临时诊断代码进入 Vite 响应，重启当前仓库 Vite 后才取得注入和调用数量证据。旧缓存时的无日志不当作零调用证据。
- 临时 core.ts 诊断仅记录调用类型、stream、记忆长度和超限标志，不输出 key/提示词/个人正文，交付前已移除。其他已复现问题本次以验收记录为产出，没有一并修复。

## Warning / Error

- Electron 开发 CSP `unsafe-eval` 警告。
- Cytoscape 自定义 wheel sensitivity 警告（两次）。
- Cytoscape `color: var(--pq-text)` invalid（两次）。
- Browserslist caniuse-lite 数据约六个月旧。
- 初始 renderer CJS named export SyntaxError（已修复）。
- 主进程 capability_route 事件错误（未修复）。
- ID 胶囊 KaTeX ParseError（未修复）。
- 原始普通问答还观察到回答段落重复和 max_turns 收尾，发生在模型补充约束前，不把该次 GPT 行为当作 deepseek-flash 结论。

## 数据收尾与复测入口

- L2 原始空文件已备份到临时目录，测试中 606 字符合并结果保存为 `L2-approved-evidence.md`；3990 字符夹具保存为 `L2-limit-fixture.md`。最终已恢复 **0 字节** L2；没有将人工测试任务留为用户记忆。
- 留下两张明确命名的测试笔记供复核：qa `note_muof4tfs_29db66b6` / `E2E验收-合法问答-20261001`；concept `note_muogltj0_b732db70` / `E2E验收-反馈迭代-20261001`。首次批准还自动生成一张研究日志，有效笔记最终 6 条。拒绝、excerpt、synthesis 均未落库。
- 没有删除用户笔记；没有修改文献内容或库元数据。测试对话、运行记录及阅读器访问记录按正常 UI 保留。
- 临时日志目录：`C:\Users\yusen\AppData\Local\Temp\paperquay-e2e-20261001\`。包含 dev-clean 日志、Vite 刷新日志、启动调试与 check-delivery.log，不纳入 Git。
- 关键 deepseek-flash run：qa 门禁误拦截 `ad698964-a1b5-49cf-a40e-5a1896621bf5`；qa 批准 `f4c7efe9-085d-4dd9-808d-4f616a4f9450`；qa 拒绝 `073981b8-be35-4b70-b4cb-3d1efa4bbaf2`；核对虚构主张 `cb9a4b03-c41f-4460-a53c-61ef7b97ef21`；正反原句 `400e2a97-298a-4975-8839-cf1978af9a32`；长 L2 请求 `6a4aedc8-569b-463f-bdb7-8740c360cbab`；调用数量/胶囊 `1c75aa01-8ef1-4ddf-8a1a-a039764bf858`；concept `1a663876-e403-4b7c-9f3b-72046b29b845`。
- 所有要求已逐项给出判定；多文献“更多”计数、真正空检索片段和有证据的 excerpt/synthesis 校验分支仅有源码/单测证据，本次未声称取得对应完整 UI 覆盖。修复失败项后需在当前开发实例使用 deepseek-flash 复验，再签署通过结论。
收尾核验（2026-10-01 03:02）：临时诊断已从源码及 Vite 实际响应移除；L2 与备份逐字节一致。开发服务刷新后曾短暂保持空壳，Ctrl+R 后文库正常恢复，未再发送模型请求。开发窗口保持打开。

## 后续桌面复测（2026-10-01 下午，Asia/Shanghai）

仍使用当前仓库的 `http://127.0.0.1:1420/` 开发窗口，没有操作已安装旧版。用户提供的 `C:\Users\yusen\Downloads\paperquay测试截图\S00.png` 至 `S08.png` 覆盖开发实例、模型选择及单篇问答引用展开/折叠；以下补测集中在笔记、核对和落库。原记录是当时的快照，下面的新结果不倒改历史结论。

- `deepseek-flash` 的合法 concept 草稿 `E2E复测-反馈迭代-20261001` 经 UI 批准后，Notes 数据库新增 `note_mup7auqx_f26a6b9c`，`page_kind=concept`，正文 JSON 中有 `wikiLink`，`note_links` 完整，有效笔记数从 6 到 7。另一份合法草稿 `E2E复测-拒绝-20261001` 点击拒绝后卡片为禁用的“已拒绝”，笔记数保持 7，没有该标题的记录。
- 无选区 excerpt 请求均没有审批卡或落库，但上下文收集均为笔记 0 条、RAG 0 条，未真正覆盖有来源时的 excerpt 锚点校验。单篇 synthesis 请求收集笔记 1 条、RAG 0 条，先报“综述页参考文献列表至少需要 2 条”，重试却将 `pageKind` 改成 `qa` 并被无引用门拦截；没有 synthesis 卡或脏数据，但页面类型约束没有保持。
- Notes 打开新 concept 时，数据库中的标题与正文完整，编辑器却一度显示旧 concept 的标题且状态为 `Unsaved`；切到旧笔记再切回后正文补全，标题仍是旧标题。未点击 Save，数据库未受损。需防止错误标题被保存到新笔记。
- 引用核对已出现 `extract`、`retrieve`、`judge`、`report` 四阶段及对应运行事件，原记录中“缺 report 阶段”的问题对当前工作树不再成立。`deepseek-flash` run `32e64414-16a2-4f06-bb78-cd28c3a47e7c` 准确提取三条英文原句，并给出 supported、contradicted、not-in-library 各一条；相反的航程陈述引用论文第 12 页，临床试验陈述未误标 supported。`not-in-library` 行却列出了检索到的无关论文页码，报告引用列具有误导性。
- 此前另一轮 `deepseek-flash` 核对把三条用户主张抽成五条解释/拒答句，均判为 not-in-library；错误主张曾被审批写入 L2，随后从备份恢复，最终 L2 仍为原始 0 字节。`sanitizeExtractedClaims` 只做长度与去重，没有核验抽取文本是否来自用户输入。记忆建议必须拦截这类非原文主张。
- Computer Use 操作中有一次模型菜单未关闭，点击被弹层覆盖的输入框位置误选 `gpt-6-astra`。run `2de304bb-5902-4637-8482-15b20a45340e` 因此不计入指定模型的验收；数据库记录与运行后 UI 均显示 `gpt-6-astra`，不是产品模型状态不一致。之后明确切回 `deepseek-flash`、关闭弹层并用运行记录核对了最终 run 的模型。该误操作没有触发笔记或记忆写入。
- 当前 `agent_run_events` 已能保存 `capability_route` 和四阶段事件；核对中的 token `capability` 事件仍错误标成 `comparative-survey`。通用执行轨迹在能力完成后仍显示 `3/6`，与能力卡 `done` 不一致。原 `dev-clean.stderr.log` 最后修改于 02:47，不可据此判断下午运行期间是否产生新的主进程警告；本轮没有取得新的 DevTools Console 采集。

**更新后结论：整体验收仍不通过。** 审批批准/拒绝、四阶段生命周期及本次三类核对结果通过；主张抽取真实性、Notes 编辑状态隔离、笔记上下文检索、synthesis 重试页面类型、无关引用展示及通用轨迹仍需修复和回归。`L2-topics.md` 最终为原始 0 字节，有效笔记为 7 条，只有上述已批准的复测 concept 新增。

## 修复后补测（2026-10-01 16:27，Asia/Shanghai）

- 继续使用当前仓库 `http://127.0.0.1:1420/` 的 Electron 开发窗口，UI 模型为 `deepseek-flash`；没有切换已安装旧版。普通单篇问答返回基线前飞航程 9.3 km、第 9 页，本地证据绑定显示 1 支持、0 部分支持、0 库内未查到；执行轨迹 14/14，最终回答为 SUCCESS。普通问答通用轨迹不再误称能力流水线。
- 对该回答执行“核对上一条回答”时，核对器逐字抽取到两句真实回答；四阶段与执行轨迹 6/6 均收尾。首次结果把短句“基线前飞航程为 9.3 km”误判库内无证据，同时把包含相同数值和事实的完整句判为支持。根因是两句独立检索，短句无片段后直接落为无证据。现已让共享明确数值和中文术语的同次主张复用已检到的片段，再逐条交给模型判定；真正没有可关联片段的主张仍不得标支持。
- 修复后的桌面复测以两句原文再次核对：两条均为 supported，均引用当前论文第 9 页，没有错误的“写入工作记忆”建议。新增针对短句检索为空、同一事实片段复用、无关主张保持 not-in-library 的回归测试。
- 来源文本截断、上一条真实回答抽取、笔记页面类型重试约束、通用轨迹摘要等此前代码修复已纳入构建与单测。最终 `npm run check` 构建成功、627/627 通过；`git diff --check` 退出码 0，仅提示既有文件换行符转换。L2 文件仍为原始 0 字节。
- 本轮没有重新进行完整的笔记批准/拒绝落库、超长 L2 注入、真正空检索、两篇以上综述及 DevTools Console 全量采集；这些路径继续以此前桌面结果或针对性单测为证据，不能据此宣称整套桌面端端到端验收全部通过。旧历史对话中的错误判定是持久化快照，不会因热更新自动重算。
- 后续代码审查发现本地词面绑定在数字不同时仍可能把两个词重叠误标为 supported。现要求同一被绑定片段包含主张的所有数值，否则降为 partial；数值型错误主张与正确主张的回归测试已加入。该绑定仍是本地启发式，事实真伪以引用核对能力的检索加判定报告为准。最终 `npm run check` 构建成功、628/628 通过。

## 蒸馏拒绝门补测与修复（2026-10-01 16:46，Asia/Shanghai）

- 当前仓库的 Electron 开发窗口继续使用 `http://127.0.0.1:1420/`，UI 模型为 `deepseek-flash`，选中文献 1 篇。没有操作已安装旧版。
- 修复前，明确要求无阅读器选区的 excerpt 摘录卡虽然未生成审批卡，但仍检索到 8 个 RAG 片段、调用草稿模型约 27 秒，并以“问答页证据位置”错误结束。明确限定单篇的 synthesis 也调用模型约 15 秒后才报至少两篇，均属无意义请求及误导性反馈。
- 现对这两类确定不可生成的请求在蒸馏入口直接拒绝。桌面复测 excerpt 在 162 ms 返回“阅读器选区”说明，单篇 synthesis 在 117 ms 返回“至少两篇”说明；两次均无审批卡、无 token 用量显示。回归测试确认两种情况不调用检索或草稿器，且从已有摘录卡蒸馏概念页仍可进入正常流程。
- 只读数据库核对 `notes` 总数仍为 7，L2 工作记忆仍为原始 0 字节。`npm run check` 构建成功、630/630 通过；`git diff --check` 退出码 0（仅既有换行符提示）。
- 这次没有重新覆盖批准/拒绝落库、超长 L2 注入、真正空检索、多篇综述及 DevTools Console 全量采集；整套桌面端端到端验收仍不能据此签署为全部通过。

## 两篇综述补测与来源修复（2026-10-01 17:04，Asia/Shanghai）

- 继续仅操作当前仓库 Electron 开发窗口（`http://127.0.0.1:1420/`），选中上述两篇倾转旋翼论文，模型为 `deepseek-flash`。没有操作已安装旧版，也没有批准本轮测试草稿。
- 首次两篇综述收集到笔记 1 条、RAG 4 条，模型调用后因文末只解析到一篇论文而拒绝。发现蒸馏来源中的笔记只有笔记标题，缺少真实论文标题；现向草稿器显式传入 `paperTitle`，并将选中范围外的笔记排除出综述当次证据。
- 修复后收集到两篇论文的 RAG 片段（一次 8 条，一次 6 条）。草稿仍两次被证据门拒绝：一次模型使用不存在的 `[27]` 引用，重试后有无充分词面对应的事实句；另一次英文电池参数来源被改写为中文，数值关系虽看似一致，本地绑定仍判为 `partial`。均没有审批卡或脏笔记。草稿器现额外收到 `allowedRefs`，提示只用本次来源编号、原样填参考文献标题并保留可核对措辞。该提示修复尚未让实际两篇综述稳定产卡。
- `Ctrl+Shift+I` 成功打开开发工具。Console 当前可见 5 条 Warning（Electron 开发 CSP、Cytoscape wheel sensitivity 和无效 CSS color），未见新的 Error；主进程模型请求经 IPC，Network 面板空白不能证明模型调用数为零。
- 只读数据库检查有效笔记仍为 7 条；`L2-topics.md` 仍为 0 字节。最终 `npm run check` 构建成功、633/633 测试通过；`git diff --check` 通过（仅既有换行符提示）。
- **本轮验收仍不通过。** 两篇证据收集与不合格草稿拦截已验证，合法跨语言改写的综述草稿可用性仍未通过桌面端验证。下一步需要为笔记证据门加入有界的跨语言事实核对，并对引用编号、数值、单位和来源关系做结构化校验，之后重新跑两篇综述审批流程。此前未覆盖的多文献展开计数、真正空检索以及本轮修改后的完整批准/拒绝流程也仍需桌面回归。

## 两篇综述审批拒绝补测（2026-10-01 17:15，Asia/Shanghai）

- 在当前仓库的 Electron 开发窗口继续使用 `deepseek-flash`，对选中的两篇论文明确要求各取一句来源原文、不翻译改写。成功生成 `synthesis` 审批卡；正文 `[4]`、`[6]` 分别对应两篇不同论文，文末参考文献使用库内原题，能力与通用执行轨迹均为完成态。
- 在审批卡滚入可见视野后点击“拒绝”，按钮变为“已拒绝”。只读数据库核对有效笔记仍为 7 条，该综述标题 0 条；`L2-topics.md` 仍为 0 字节。此前点击未滚入视野的可访问性索引没有生效，不能计作一次拒绝。
- 原语言、可逐字核对的两篇综述草稿现已验证可以产卡；跨语言改写仍被词面门禁保守拒绝，尚未取得可安全放行的桌面证据。

## 最终补测与验收边界（2026-10-01 18:53，Asia/Shanghai）

- 继续使用当前仓库开发版 Electron 窗口，`RootWebArea` 为 `http://127.0.0.1:1420/`；Computer Use 模型菜单显示 `deepseek-flash` 已选中。没有操作本机已安装的旧版。
- 两篇综述的中文事实草稿已在 UI 生成并批准，`note_mupd3p6i_08be3ead` 为 `synthesis`。Notes 中已复核富文本及双向链接；另一个两篇综述草稿走拒绝流程，没有落库。此前 17:15 的“跨语言尚未放行”是当时状态。
- `deepseek-flash` 引用核对 run `c69ab024-deb0-457c-ba43-d86f85f95bf8` 为 done：四阶段结束，真实论文原句判为 supported，引用第 12 页；通用执行轨迹 6/6。该请求运行时 L2 为 3990 字符测试夹具，请求后文件哈希未变化。此前实际请求诊断还记录了 `memoryChars=1200` 与 `overLimitHint=true`；本轮没有再次抓取模型请求正文。
- 测试夹具已撤下，`L2-topics.md` 恢复为原始 0 字节，SHA256 为 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`。有效笔记当前 9 条，包含经 UI 明确批准的测试笔记；未批准草稿没有落库。
- 最终 `npm run check` 构建成功，**638/638** 测试通过。由于本机原 esbuild 路径访问被拒，运行时指定 `ESBUILD_BINARY_PATH=C:\Users\yusen\AppData\Local\Temp\paperquay-e2e-20261001\esbuild-clean.exe`。`git diff --check` 退出码 0，仅有既有的 LF/CRLF 转换提示。
- 多于六篇文献时的 UI“展开全部（共 N 篇）”计数没有桌面数据可验；分组、同页去重和计数有单测，原始 1–2 篇用例已通过桌面走查。真正零检索片段的 UI 场景也未复现：现有文库论文均有 RAG chunk，不能把关闭 RAG 当作空检索。零片段直接判 `not-in-library`、无引用且不调用 judge 的代码路径有针对性单测。
- 最新图谱 Console 只观察到 Electron 开发态 CSP 警告及 React DevTools 提示，没有再出现修复前的 Cytoscape wheel/color 警告。renderer Network 空白不能证明模型零调用，因为模型请求由主进程经 IPC 发出。本地证据绑定无模型请求以同步实现及运行事件区分为依据。

**验收结论：已复现并修复的主要故障通过针对性桌面回归，原始核心交互与数据落库闭环有实际 UI 证据；不签署“所有边界场景完整桌面 E2E 通过”。** 尚缺真正零片段和七篇以上引用的 UI 证据，且本机原 Electron 路径及 esbuild 路径的访问环境问题仍需通过临时运行时路径规避。两项边界行为的自动化测试已通过，但测试不能冒充桌面截图。

发布决定（2026-10-01）：用户明确接受上述两个 UI 覆盖缺口，后续使用中发现问题再修复；本机开发路径问题不作为本次发布阻塞项。按 `0.4.0` 发布，保留本记录中的证据边界。
