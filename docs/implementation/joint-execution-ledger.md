# 联合实施台账：工作区、知识图谱与长文档

- 更新日期：2026-11-12（Asia/Shanghai）；记录 L1a generation 首个生产解析链增量
- 基线：`main`，HEAD `0757957`，PaperQuay `0.4.25`
- 范围：工作区 P0、P0-T、P0-F、P1—P7；知识图谱 P0—P2；长文档 L0、L1a、L1b、L2、L3。
- 原则：状态只根据本轮源码、命令和桌面证据推进；三条线共用来源身份、文件位置解析、知识存储／写入者、版本失效及备份恢复协议。

## 当前工作区保护

开始时 `git status --short --branch` 为 `main...origin/main`。存在用户提供且尚未跟踪的三份计划、两份关联 PDF 计划及 `docs/research/`；均保留。实施期间新增的 `.codex-tmp/esbuild-temp/` 是本轮构建临时目录，须在所有相关进程退出后确认仅含本轮文件再处理。

根目录没有 `AGENTS.md`；`.codegraph/` 存在，并已优先用于按钮／主题、文件位置、知识图谱／RAG、解析任务调用链梳理。

## 工作包状态与交接

状态：`未开始`、`进行中`、`实现完成/验收待补`、`验收通过`、`待外部条件`。

| 台账 ID | 对应计划 | 依赖 | 状态 | 本轮证据／缺口 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| W-P0 | 工作区 P0 | 当前源码基线 | 进行中 | 当前契约和入口已由计划与 CodeGraph 对照；联合接口／来源身份规格尚需实施确认 | 定稿位置、来源版本、查询、保存、概览及状态投影契约 |
| W-P0-T | 工作区 P0-T | 无后端依赖 | 实现完成/验收待补 | `assistantSidebarChat.tsx` 改用强调语义类；CSS 变体复用 accent/radius 令牌；生产构建和自动化通过，图标对比度仍未有实际 computed-color 证据。`electron.cmd --version` 返回 `-2147483645`；用启动参数可创建窗口，但隔离 profile 放入仓库时引发 Vite 监听 Chromium Cookie 文件 `EBUSY`，profile 移到仓库外后显示 Electron Error 窗口。当前没有成功的 renderer 与实际计算样式 | 让 Vite 服务在 Electron 全程运行，并从 Error 窗口/日志定位具体原因；随后完成双主题、状态、缩放、嵌入/浮动截图及会话业务回归 |
| W-P0-F | 工作区 P0-F | W-P0 来源身份和位置契约 | 进行中 | 共享 resolver/reveal 接受可选 evidence ID，并按 EvidenceSpan sourceVersion 精确查询 `parseGeneration` manifest；历史 artifact 缺失不回退到新版。图谱文献节点右键已接入通用位置 dialog；章节目录仅在当前展示 PDF 与登记原文附件的 content hash/sourceVersion/磁盘 SHA-256 一致时显示。位置/evidence 专项 14/14；章节/版本专项 18/18。仍缺关系级 evidence ID、章节证据位置入口、全部状态标签/UI 竞态覆盖和 Windows Explorer 实测 | 图谱/章节接入 evidence ID 后使用精确定位；完成章节证据面板复用位置服务及 Windows Explorer 验收 |
| W-P1 | 工作区 P1 | W-P0 | 进行中 | 概览强制刷新绕过缓存，刷新期间保留旧正文，只有生成并写入缓存成功后才替换；缺配置/生成/写入失败保留旧文。阅读历史恢复移除 PDF 就绪依赖；只读缓存恢复不要求模型凭证、不静默迁移旧 key、旧版本标为未核实。表单等待保存结果、失败保留草稿；字段级并发比较只写用户修改字段、合并无关更新、拒绝同字段冲突，用户确认基于最新版本后保留草稿重试；旧记录默认 `itemType` 兼容。列表刷新失败明确报“已写入”。文献内容、分类、附件等更新单调推进 `updatedAt`。Windows 备份恢复 JSON 原子写改用唯一临时文件和锁冲突重试。最新构建通过，完整 `npm test` **985/985** 通过；恢复测试清理器仍报告部分隔离临时目录 `EPERM` 并跳过清理。组件交互仍待 Windows 桌面验收 | 补异步文献切换及保存失败分支的交互行为验证；继续 W-P2/P3 |
| W-P2 | 工作区 P2 | W-P1 | 进行中 | 新增只读 `lookup_literature_metadata_candidates` API；详情编辑器现展示 OpenAlex/Crossref 候选、字段来源与提供方状态，逐字段“应用到草稿／撤销”，最终沿用字段级冲突保存。请求绑定当前 paper ID 和序号，切换文献/后发请求会丢弃迟到结果。候选搜索只提供 DOI/标题，未自动合并 PDF/LLM 证据。生产构建通过，完整 `npm test` **987/987** 通过；测试清理器在隔离 TEMP 下仍报告 `EPERM` 并跳过部分目录清理 | 补组件交互竞态的自动化／桌面验证；评估是否增加显式“从 PDF 提取”候选通道及来源对照；随后推进 P3 与共享存储/L1a，P2 未完 |
| W-P3 | 工作区 P3 | W-P0 | 进行中 | ID 快照补取与一致枚举、类型／收藏及年份／未知年份／作者／载体／关键词／多标签、阅读状态/进度、导入/最近阅读日期区间、附件角色和类型适用元数据缺项过滤已接入 SQL 分页、count、全库 ID、加载更多及演示库。字段候选支持搜索；SQLite `pq_casefold`／`pq_trim` 对齐 Unicode 语义；全选按请求序号、筛选指纹和演示库身份丢弃迟到结果。面板具备草稿／取消／应用、输入校验、条件标签及单项移除。隔离 TEMP 构建通过；元数据缺项增量后串行全套测试 990/990、查询专项 4/4。仍待 Windows 桌面/真实文库交互验收 | 完成属性筛选桌面验收；随后进入 P4 |
| W-P4 | 工作区 P4 | W-P3 | 进行中 | 新增 `paper_processing_status` 持久表，以文献标题和登记附件身份计算来源版本；附件／标题变化使旧状态失效；保存前校验版本并在 renderer 写入后回读确认；24 小时后返回待核实；列表、count、全库 ID 共用 SQL 条件。列表行区分 available/missing/error/unknown；检查失败及阅读器解析完成事件会尽力持久化状态；文献更新事件清除会话已检查标记并触发单篇重对账。数据库打开时全库幂等 reconcile：补齐缺行、将来源签名不符的记录降为 unknown、保留仍有效的 error；SQLite 级联删除。每篇文献 UI 修订号拦截迟到成功/失败和旧批次回滚；后端拒绝文献删除后的迟到结果。最新 `npm run check` 通过，993/993；本轮专项 27/27。 | 补运行中任务与附件事件全面对账、组件级竞态自动化和 Windows 桌面验收；然后收口 P5 集成 |
| W-P5 | 工作区 P5 | W-P1—P4 | 进行中 | 详情侧栏现有资料、处理/附件、概览与热图内容已接入四页签；换选文献重置到资料，运行任务在处理页签显示状态点。资料可只读核对 DOI/URL/摘要/引用；无概览时可通过受约束的现有处理动作生成。详情顶部移除重复标题。隔离 TEMP 下最终 `npm run build` 通过（2617 modules）；串行完整测试 992/992 通过；`git diff --check` 通过。 | 补详情交互验收（窄容器、键盘、切换文献/任务）；继续列表工具栏/筛选集成及阅读器顶栏容器响应。P4 状态全库重建/恢复和 P0 桌面闸门仍阻止 P5 完整验收 |
| W-P6 | 工作区 P6 | W-P0-T、P0-F、P1—P5 | 未开始 | 本次全套验收尚未完成 | 自动化、Windows 安装版、桌面与说明文档验收 |
| W-P7 | 工作区 P7 | W-P6 | 未开始 | — | 命名视图、库隔离恢复、批量标签/收藏等 |
| KG-P0 | 图谱 P0 | 当前源码基线 | 进行中 | 缺少/未知焦点及非法深度现返回空局部结果；document similarities 要求每篇文献×维度只有一个已就绪 embedding model key，且只允许单一 sourceType 表示进入比较，比较双方表示也必须相同。不同模型／不同表示及单文献多模型混合均被隔离，旧平均向量缓存无需破坏性迁移，混合表示缓存暂不产生向量相似边。局部范围与 RAG 专项均通过；sourceVersion 绑定、完整恢复迁移仍缺 | 核对来源版本签名及备份往返边界；继续 KG-P0 覆盖与 P1 共享存储契约 |
| KG-P1 | 图谱 P1 | KG-P0、共享来源／存储／备份；W-P0-F | 进行中 | 共享 EvidenceSpan 现有精确 generation locator；来源版本、quote/offset 原文校验、sourceVersion 迟到拒绝和人工 review event 持久化均有专项。图谱文献节点现在可查看该文献登记位置，但 Claim/Relation 尚未携带 EvidenceSpan ID；实际抽取、候选审核投影与来源排除/替换事件仍缺 | 将文献/章节解析接入来源登记、证据抽取和候选审核，再用 evidence ID 精确定位；之后做来源失效竞态与备份恢复验收 |
| KG-P2 | 图谱 P2 | KG-P1 证据质量门槛、长文档 L2/L3 交接 | 未开始 | 问题卡、反例、查新与验证记录尚无 | 先完成可检验问题卡与 local-only 边界，再决定外部查新/MCP |
| LD-L0 | 长文档 L0 | 当前解析基线 | 进行中 | NASA NTRS 工程手册 `19830015360` 官方元数据标注 `GOV_PUBLIC_USE_PERMITTED`、无第三方内容；隔离下载 18,433,400 B。PDF.js 4.8.69 顺序提取：248 页中 245 页有文本、435,800 字符、599 ms，RSS 峰值约 175,357,952 B。可视抽样物理页 8/17/65/224：目录和正文次序可用；物理页 17 的跨行表格关联不可靠，物理页 224 的表格文字拆成字符片段、行列关系丢失。PDF.js 复杂表格质量闸门未通过；图像保存在 `.codex-tmp/l0-sample-review/`，未生成产品解析产物或调用付费服务 | 验证隔离的本地结构化解析路线及页码/表格检索质量；如只有付费云服务则列外部待验证。未通过前不以 PDF.js 基线替代 L0 质量验收 |
| LD-L1a | 长文档 L1a | LD-L0、KG/工作区共享契约 | 进行中 | Paddle generation 按 PDF SHA-256 持久化来源、分卷、远端 job ID 和 artifact manifest；逐卷稳定 staging/manifest 经重启校验后可复用，失败发布保留 building generation。备份 stage/apply 往返保留 generation、job ID、分卷 manifest/current，并按旧 cache root 重绑路径；未备份的大型产物仍标缺失。专项及完整 `npm run check`：1004/1004。外部 Paddle 未调用。尚无应用启动恢复 UI、取消/迟到结果闭环、旧产物引用保护/清理、可选 artifact bytes 恢复 | 补取消/来源替换竞态和 artifact 可选备份边界；实现恢复入口与引用保护/清理；后续进入 L1b/L2 |
| LD-L1b | 长文档 L1b | LD-L1a | 进行中 | Paddle 发布从 manifest 受管的 content-list 导出标题候选，扁平/页数组/页字典均支持；单元及物理页映射与 current 在同一 SQLite 事务发布。无标题时 page-only/印刷页 unknown；非法映射失败保留旧 current。只读 current 结构拒绝 building 与旧 sourceVersion。阅读器目录接入父子层级和物理页跳转；本地 viewer 额外核对登记原文路径、附件哈希、活动版本与磁盘 SHA-256。专项 18/18；完整 `npm run check` 构建通过、1014/1014 | 接入持久目录修订、章节证据 locator、单元索引及覆盖；覆盖备份恢复和真实长文档质量/资源验收 |
| LD-L2 | 长文档 L2 | LD-L1a/L1b、KG 模型空间边界 | 未开始 | 章节工具、单元索引、层级查询和覆盖界面尚无 | 结构/全文双路、单元增量 finalize、页码证据与资源预算 |
| LD-L3 | 长文档 L3 | LD-L2、KG-P1；问题卡另依赖 KG-P2 | 未开始 | 来源角色区分、选章知识抽取及图谱联验尚无 | 区分原始/二手/规范来源，迟到任务不得发布 current |

## 本轮命令证据

### 2026-11-12 图谱文献节点文件定位增量

- 图谱文献节点右键现在打开工作区共享位置 dialog，身份绑定右键节点快照。构建通过，定位／KG／EvidenceSpan 专项 14/14，`git diff --check` 通过。
- 当前图谱数据仍没有关系级 EvidenceSpan ID；所以此入口提供文献全部登记位置，不声称已实现按单条关系精确定位历史产物。长文档章节 UI 也未接入。
- 当前工作树随后执行完整 `npm run check`：构建通过，测试 1006/1006，0 失败。测试 fixture 清理器报告部分隔离目录 `EPERM` 并跳过清理；不影响进程退出码。Electron UI preview 在 1421 返回 HTTP 404，本次没有双主题截图、computed style 或 Explorer 结果。

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm run build` | 两次在 Vite/esbuild 尝试清理系统 TEMP 时失败（Windows `Access is denied`） | TypeScript 步骤先通过；临时目录隔离重跑后完整生产构建通过。构建有既有 chunk/dynamic-import 警告 |
| 2026-11-12 本轮 `npm run check`（独立 TEMP） | 失败于 Vite/esbuild 临时目录清理 `Access is denied` | TypeScript 已通过、2616 modules transformed；未进入完整测试阶段 |
| 2026-11-12 本轮 `npm test`（独立 TEMP） | 多数用例通过；最终退出码 1 | `readerSettings.test.ts` 多项因 esbuild 写入隔离临时 `readerShared.mjs` 返回 `Access is denied`；notes fixture 清理另报告 `EPERM`。不可将该运行记为全套通过 |
| `npm run build`（TEMP/TMP 指向仓库 `.codex-tmp/active-build-temp`） | 通过 | TypeScript 与 Vite 生产构建完成，2616 modules transformed；保留既有大 chunk／动态导入警告 |
| `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"`（TEMP/TMP 指向仓库 `.codex-tmp/active-test-temp`） | 989/989 通过，退出码 0 | 全套测试完成；笔记 fixture 清理仍有 `EPERM` 跳过输出，不影响断言结果 |
| `$env:TEMP=...; $env:TMP=$env:TEMP; npm run build` | 通过 | 2614 modules transformed；输出到 `dist/` |
| `$env:TEMP=...; $env:TMP=$env:TEMP; node --test tests/knowledgeGraphCommands.test.mjs tests/ragMembership.test.ts tests/readerSettings.test.ts` | 14 通过，0 失败 | 局部语义变体不触及业务，但一并验证相关图谱／阅读器回归 |
| `npm test`（隔离 TEMP） | 977 项通过，0 失败 | 完整根级 TypeScript/MJS 测试套件 |
| `node --test tests/knowledgeGraphCommands.test.mjs tests/ragMembership.test.ts tests/readerSettings.test.ts`（隔离 TEMP） | 14 项通过，0 失败 | P0-T 后再次确认相关专项 |
| `git diff --check` | 通过 | 仅覆盖当前两个源文件改动 |

| 2026-11-12 `node --test tests/libraryQuery.test.ts tests/libraryCommands.test.mjs` | 13/13 通过 | 覆盖共享附件删除、状态筛选与 count/ID 一致、来源变更拒绝迟到写入 |
| 2026-11-12 `npm run check`（TEMP/TMP 指向 `.codex-tmp/p4-check-temp`） | 构建通过；测试 991/991，退出码 0 | Vite 报既有大 chunk／无效动态导入提示；测试清理器对隔离目录报 `EPERM` 并跳过清理，不影响断言 |
| 2026-11-12 `git diff --check` | 通过 | 本轮 P4 改动与文档 |

## 桌面验收、阻塞与下一步

- 已安装桌面进程可见，但不等于当前源码。`node_modules/.bin/electron --version` 曾以 Windows 异常状态 `-2147483645` 退出；本轮用隔离 `PAPERQUAY_DEV_DATA_DIR` 和独立 Vite 1421 直接启动 Electron，命令返回 0，但无 Electron 进程或窗口。桌面窗口清单未发现 PaperQuay 窗口，未获得当前源码运行时的主题计算样式或交互截图。未操作已安装实例或其个人文库；P0-T 与 Windows Explorer 实测继续待补。
- Windows 资源管理器定位属于本地 UI 行为；P0-F 需在受控位置 fixture 与 shell 适配器下先验证，再用安装版检查实际选中文件和目录。
- 不读取或迁移个人真实文库，不执行批量付费模型调用。隔离文库、可控 PDF 和可许可长文档样本可用于工程验收。
- 本轮刷新改动后，生产构建及完整测试套件均已在隔离 TEMP 下通过；最新完整 `npm test` 为 982 项通过、0 失败。历史测试清理有临时目录 `EPERM` 输出，但命令退出码为 0。
- 2026-11-12 字段级并发保存增量后，`npm run build` 通过；完整 `npm test` 为 984/984，新增测试覆盖无关字段合并、同字段冲突及缺省 `itemType`。测试清理器曾对本轮隔离 TEMP 下的部分目录报告 `EPERM` 并跳过删除，未影响测试退出码；后续需确认该隔离临时目录内容再处理。
- 2026-11-12 KG-P0 表示隔离增量后重新运行完整验证：`npm run build` 通过，`npm test` 为 985/985；`node --test tests/ragStore.test.ts` 为 21/21。临时目录清理器仍有 `EPERM` 跳过记录，状态如实保留。
- 2026-11-12 W-P2 后端候选检索增量：`lookup_literature_metadata_candidates` 在不写库的前提下保留 OpenAlex 多候选和 Crossref 多候选、逐提供方失败状态及字段来源；旧 `lookup_literature_metadata` 继续兼容。受控响应验证 `node --test tests/libraryCommands.test.mjs`：6/6。尚无前端候选比较／应用流程，不将 W-P2 标为完成。
- W-P2 候选接口接入增量后的验证：`npm run build` 通过，完整 `npm test` 为 987/987，0 失败。测试临时目录清理器的 `EPERM` 仍单独记录为未清理成功。
- 2026-11-12 W-P2 UI 增量：详情编辑器以受控只读服务响应展示候选差异、字段来源和提供方状态；逐字段应用/撤销只更新草稿，保留既有统一保存及并发冲突流程。请求序号和即时文献 ID ref 阻止切换文献后的迟到响应污染新草稿。`npm run build` 通过，完整 `npm test` 为 987/987、0 失败；清理器仍报告隔离 TEMP 部分目录 `EPERM`。本轮没有新加组件运行时测试，桌面行为待验。
- 2026-11-12 W-P3 按 ID 补取增量：批量选中文献的详情补取不再依赖当前筛选后的分页，快照 ID 在批次间稳定；删除/失效 ID 显式返回并在 UI 提示。`npm run build` 通过，`node --test tests/libraryCommands.test.mjs` 为 7/7；完整测试套件待本阶段收口。
- 2026-11-12 W-P3 全选快照补强：renderer 改为一次 IPC 请求全库过滤 ID，主进程在同一事件循环内分批读取，避免多次 IPC 之间库写入改变 offset 和 ID 集合。加入 10,003 ID、多个内部页与过滤参数回归。最新 `npm run build` 和 `node --test tests/libraryCommands.test.mjs`（8/8）通过；完整 `npm test` 在此增量前为 988/988，此增量后待重跑。
- 该接口增量后完整 `npm test` 已重跑：989/989 通过、0 失败。隔离 TEMP 下测试清理器仍对部分临时目录报告 `EPERM` 并跳过清理。
- 2026-11-12 W-P3 属性筛选首段：新增 `itemType` 与三态收藏过滤，SQL query/count/ID 共用 `buildLibraryFilter`，列表首屏、加载更多、编辑/标签后刷新、全选 ID 及演示库均接线；筛选条件变化会清空选择。SQLite 集成用例对照 SQL 与 JS oracle，并验证 query total、count 与全选 ID 集合一致及非法类型拒绝。`npm run build`、专项 `tests/libraryQuery.test.ts`（4/4）及完整 `npm test`（989/989）通过。其余属性筛选和 P4 成果状态投影仍未实现。
- 2026-11-12 W-P5 详情页签首段：`LiteraturePaperDetails.tsx` 将已有资料编辑/查看、解析翻译和译版附件、AI 概览、最近有效阅读热图接入四个交互页签；更换文献回资料，运行任务页签显示状态提示，移除重复详情标题。生产构建（2617 modules）及串行完整测试 992/992 通过，`git diff --check` 通过。没有组件测试运行环境，未增加实现镜像测试；当前仍缺 Windows 桌面键盘、窄容器、任务中切页验收。详细记录见[详情页签增量](../changes/2026-11-12-literature-details-tabs.md)。
- 2026-11-12 W-P4 第二增量：列表行与演示库明确投影 unknown/available/missing/error，检查失败按来源版本尽力保存 error；错误状态继续触发重新检查，防止将一次失败当作有效“未解析”结论。状态辅助、查询、命令专项 25/25 通过，构建通过；全套检查待本增量后重跑。事件对账和跨重启/失败恢复验收仍缺，P4 保持进行中。
- W-P4 第二增量收口验证：`npm run check` 再次通过，TypeScript、生产构建及完整套件 991/991 成功；隔离 TEMP 清理仍有 `EPERM` 跳过信息。`git diff --check` 通过。
- W-P4 来源变更对账增量：`NATIVE_PAPER_UPDATED_EVENT` 会话监听器现在更新全库快照、清空该篇已检查标记与旧状态，并立即按新文献对象重新检查。`node --test tests/literatureLibraryUtils.test.ts tests/libraryQuery.test.ts tests/libraryCommands.test.mjs` 25/25，`npm run build` 通过；该事件竞态仍需组件级和桌面验证，且完整测试未在此最后增量后重复。
- W-P4 修复旧库触发器升级：启动 schema 会删除早期 `INSERT` 版附件删除触发器并建立仅更新已有行的新版本；新增真实 SQLite 回归先安装旧触发器、移除状态行、重启 store 再执行级联删除。阅读器解析完成事件也绑定来源版本保存并回读确认，使用事件序号拦截同篇迟到响应。最终 `npm run check` 通过（构建、完整测试 992/992），SQLite 查询/迁移专项 6/6，`git diff --check` 通过。仍缺组件级竞态、事件全覆盖、全库重建和桌面验证，P4 继续进行中。
- 2026-11-12 W-P3 筛选一致性修复：新增 `pq_casefold` 与 `pq_trim` SQLite 函数，统一与内存过滤器的 Unicode 大小写／空白处理；集成样本加入 Kelvin 符号大小写折叠、NBSP 和 `n.d.`／前置空格年份。全选响应校验请求序号、筛选指纹与演示库对象身份，迟到结果不覆盖新条件。`node --test tests/libraryQuery.test.ts` 4/4、`npx tsc --noEmit`、`git diff --check` 通过；全量阶段检查和组件交互验证尚未完成。
- 2026-11-12 W-P3 阅读状态与进度过滤：SQL、内存与演示库支持 `isRead` 和 0–100 闭区间 `progressFrom/progressTo`；面板提供已读状态及百分比边界，非法范围在 UI 与查询层拦截。`node --test tests/libraryQuery.test.ts` 4/4、`npx tsc --noEmit`、`git diff --check` 通过；本增量后完整构建/测试待跑，时间范围、附件、类型适用缺项和桌面验收仍未完成。
- 复核 W-P3 fixture 时发现 p06/p07 的 itemType/isFavorite 字段随后被样例设置覆盖；已调整为同时保留 report/favorite 与 book/non-favorite 属性。修正后 `node --test tests/libraryQuery.test.ts` 4/4 与 `git diff --check` 通过。完整套件／构建尚未在此夹具修正后重跑；细节见[结构化筛选增量记录](../changes/2026-11-12-literature-structured-filters.md)。
- 复跑阶段检查时，`npm run check` 的 Vite/esbuild 临时目录删除在默认及独立 TEMP 下均报 Windows `Access is denied`；完整测试默认并发和 `--test-concurrency=1` 均在 `readerSettings.test.ts` 写入临时编译产物时失败，另报告若干 cleanup `EPERM`。查询专项保持 4/4 通过。构建/全套测试当前标记为受环境阻塞，不能沿用修正 fixture 前的历史通过结果。
- 随后完整测试两次遇到同一 Windows 备份恢复写临时文件 rename 的 `EPERM`；单文件隔离 8 项通过。恢复原子写入增加唯一临时路径与受限重试后，`node --check electron/backend/backupImport.cjs`、恢复专项 8 项和完整 `npm test`（982/982）通过。对应记录：[备份恢复修复](../changes/2026-11-12-backup-restore-atomic-write-retry.md)。
- 当前代码修改：`src/features/reader/assistantSidebarChat.tsx`、`src/app/index.css`。计划、台账与变更记录继续保持未提交可审阅。
- 2026-11-12 筛选面板草稿交互增量后，仓库隔离 TEMP 下生产构建通过（2616 modules）；串行全套 `tests/*.test.ts` 和 `tests/*.test.mjs` 为 989/989、退出码 0。Electron 再次以 `-2147483645` 退出，仍缺 P0-T 双主题/焦点/缩放截图及真实桌面交互验收。执行方式和清理器 `EPERM` 见上表。
- 本轮已开始 W-P0-F：`electron/backend/literatureFileLocations.cjs`、`electron/backend/fileCommands.cjs`、`src/services/literatureFileLocations.ts` 与工作区列表/详情入口新增位置查询和执行。测试覆盖登记 PDF、多译版、缓存产物、missing/remote-only、拒绝任意 ID、文件与目录 shell 分流和文件消失竞态；仍不构成历史证据与桌面验收完成。
- 2026-11-12 完成筛选面板增量和 MinerU Windows 原子替换重试后，仓库隔离 TEMP 下 `npm run build` 通过（2616 modules）；串行全套 `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` 为 990/990、退出码 0。MinerU rename 重试专项与筛选查询专项合计 11/11；全套运行中笔记 fixture 清理器仍输出若干 `EPERM` 并跳过临时目录清理，不影响断言或退出码。P3 仍缺若干过滤维度、条件 chip、搜索及桌面交互；细节见[筛选变更记录](../changes/2026-11-12-literature-structured-filters.md)及[MinerU 缓存替换记录](../changes/2026-11-12-mineru-cache-atomic-retry.md)。
- 工作区 P3 新增已生效条件标签和逐维度清除按钮；`npm run build`（隔离 TEMP）通过，清除操作保持其他筛选条件，且不改写筛选草稿。真实桌面交互尚未验收。
- 工作区 P3 增加导入日期与最近阅读日期闭区间筛选。SQL、内存和演示文库共用毫秒时间边界；未读记录不匹配最近阅读范围；日期条件可独立清除。构建与 `tests/libraryQuery.test.ts`（4/4）通过；时间筛选后串行全套测试 990/990，附件角色增量后的串行全套测试仍为 990/990。适用缺项、可搜索候选和桌面验收仍缺。
- 上述 P3 时间筛选增量的完整串行测试已完成：990/990、退出码 0。运行期间笔记 fixture 的临时目录清理仍报告 `EPERM` 并跳过，不影响断言结果。
- 工作区 P3 附件角色筛选现覆盖可用原文 PDF、可用译文 PDF、缺失附件和无登记附件，SQL／内存／演示库一致，未知角色拒绝；构建、SQLite 查询专项 4/4 及增量后串行全套测试 990/990 通过。UI 桌面验收和筛选候选/适用缺项仍待补。
- 工作区 P3 类型适用缺项筛选已实现，字段候选搜索和逐项条件标签已接入；SQL／内存按每篇实际类型执行可适用字段，SQLite fixture 证明 DOI 不适用于书籍、ISBN 不适用于报告。隔离 TEMP 构建、查询专项 4/4 和完整串行套件 990/990 通过；UI 实际交互验收待 Windows 桌面可运行时完成。
- 2026-11-12 LD-L0 可视质量抽样：使用 Poppler 渲染 NASA TM-82629 物理页 8、17、65、224，并与项目 PDF.js 4.8.69 `getTextContent()` 抽取对照。目录和正文顺序基本可用；印刷页 9 表格跨行单元格拆分，印刷页 216 表格内容被拆成字符片段且行列关系丢失。图像留存在 `.codex-tmp/l0-sample-review/`，详细观察见[抽样记录](../changes/2026-11-12-long-document-l0-visual-quality-audit.md)。因此 PDF.js 正文/资源基线不满足复杂工程表格质量要求，L0 继续进行；下一步验证本地结构化解析或明确外部云服务验证条件。
- 完整 `npm test`：最新单独运行 982 项通过、0 失败；之前与构建并行的一次运行有 2 项恢复测试因 Windows 临时文件 `EPERM` 失败，已记录为并发污染并通过串行重跑消除。最新生产构建通过（2616 modules transformed）。
- KG-P0 增量：`tests/knowledgeGraphCommands.test.mjs` 覆盖局部空焦点／未知焦点／非法深度 fail-closed；`tests/ragStore.test.ts` 覆盖同维度不同 model key 的近邻比较隔离，以及文档自身多模型混合时不参与比较。改动后的两个专项文件分别 8 项和 20 项通过。
- 2026-11-12 KG-P0 表示空间补强：文档级向量缓存跨 `pdf-text` 与 `mineru-markdown` 时不再平均后参与相似关系；只比较同一来源表示类型、同维度、同模型身份的文档。混合表示旧缓存安全降级为不生成关系，保留数据等待后续版本化索引。本轮 `node --test tests/ragStore.test.ts`：21 项通过。
- 2026-11-12 W-P4 状态投影恢复增量：数据库启动事务内对全库按 ID 重建缺失投影、失效来源签名并保留有效 error；覆盖 1,000 余篇、超首屏、重启、幂等和删除级联。`npm run check` 通过，完整测试 993/993；查询专项 7/7。测试清理器仍输出隔离 TEMP `EPERM` 跳过信息；运行任务事件对账和桌面验收未完成。详见[变更记录](../changes/2026-11-12-library-processing-status-reconcile.md)。
- 2026-11-12 W-P4 迟到结果保护增量：UI 每篇文献修订号阻止旧批次在附件/书目事件后回写；旧轮次取消或失败清理不移除新轮次标记。删除后迟到保存由数据库拒绝，不重建孤儿状态。专项 27/27、类型检查和完整 `npm run check`（993/993）通过；React 事件交错与 Windows 桌面验收待补。详见[变更记录](../changes/2026-11-12-library-processing-status-race-guard.md)。
- 2026-11-12 KG-P1/L1a 共享存储首段：新增单写入者 `paperquay-knowledge.sqlite`，将旧图谱关系 JSON 事务迁入并保留回退源；新数据库加入备份快照，导入校验接受可选 knowledge DB，并兼容旧 JSON 包。同步建立 source/generation/unit/page/partition schema 基础，尚无其写入工作流。图谱/备份专项 22/22、生产备份源快照专项 1/1；`npm run check` 构建通过、全套 996/996；`git diff --check` 通过。备份命令最终加密包端到端、KG EvidenceSpan/审核/失效及 L1a 可恢复分卷发布仍待实现。详见[变更记录](../changes/2026-11-12-shared-knowledge-store-first-slice.md)。
- 最新完整检查：`npm run check`（`TEMP`/`TMP`=`.codex-tmp/l1a-artifact-check`）生产构建通过，完整自动化测试 999/999、0 失败，退出码 0；覆盖 artifact manifest 登记与被篡改时拒绝发布。构建有既有大 chunk／dynamic-import 警告；`git diff --check` 及两份后端文件 `node --check` 通过。笔记测试清理器对部分隔离目录输出 `EPERM` 并跳过清理，不影响测试结果。
- 下一步：先落实持久 partition staging 与恢复账本（含 artifact hash、远端任务状态、cancel/crash recovery），然后推进 KG-P1 EvidenceSpan、审核与 sourceVersion 失效闭环；继续工作区 P5/P6/P7 和长文档 L1b/L2/L3。P0-T 与 P0-F 的 Windows 桌面/Explorer 实测因 Electron 本机 runtime 异常仍待补；L0 表格质量闸门仍未通过，不把当前阶段标为完整交付。

## 2026-11-12 增量：generation 历史定位与阅读器入口

| 工作包 | 依赖 | 状态 | 本轮验证／阻塞 | 下一步 |
| --- | --- | --- | --- | --- |
| W-P0-F | W-P0；共享来源身份和 locator；供 KG/L1 面板复用 | 进行中 | generation manifest 当前/历史路径已进入共享 locator；逐文件大小与 SHA-256 校验，历史缺失不会回退新版；阅读器工具菜单已接入同一位置弹窗并在打开时冻结 paper ID。locator、KG、解析生命周期专项 17/17；本轮全量 `npm run check` 构建通过、测试 1000/1000；Electron/Explorer 实测仍待验证 | 再核对关联解析角色与老缓存版本语义；补图谱证据和长文档章节入口；Electron 恢复后完成实桌交互 |
| KG-P1 | KG-P0、共享 knowledge store、W-P0-F | 进行中 | EvidenceSpan/来源版本/审核事件有共享 SQLite 持久底座，精确 quote 校验、source change stale 与删除 missing 快照有专项覆盖 16/16 | 接入实际来源解析与文件 locator，增加候选 Claim/Relation、审核状态投影、排除/替换事件、备份恢复及证据 UI 验收 |
| W-P0-F / KG-P1 | 共享来源版本与 generation manifest | 进行中 | EvidenceSpan ID 可限定共享位置列表/reveal 到其来源版本的 `parseGeneration`；历史 artifact missing 不会回退新版。定位/evidence 专项 5/5；最新完整检查 1012/1012。图谱/章节尚未接入真实 evidence ID | 图谱/章节 UI 传递实际 evidence ID，完成候选审阅闭环与 Windows Explorer 验收 |
| LD-L1a | LD-L0 与共享存储/来源契约 | 进行中 | 已有持久 job ID、generation manifest、兼容缓存 journal、逐卷 staging/manifest 和重启复用；本次隔离 TEMP `npm run check` 1004/1004 | 应用启动恢复入口、取消/迟到发布保护、历史引用保留、备份应用往返、真实服务与资源验收 |
| LD-L0 | 当前解析基线和工程手册样本 | 进行中 | 本轮未新增样本质量、内存或磁盘测量；复杂表格质量闸门仍未通过 | 验证本地结构化解析或记录真实服务验证所需外部条件 |
| LD-L1b | L1a generation + shared knowledge store | 进行中 | 章节/节 revision、逐页 mapping revision 与物理/印刷标签分开持久化；Paddle 解析章节候选与映射在 current 发布事务内写入。只读查询按 active sourceVersion fail closed。最新完整检查 1012/1012 | 接目录修订、阅读器跳转及章节 EvidenceSpan；覆盖单章索引和恢复验收 |

本轮 UI 最后一次将阅读器弹窗状态从布尔量改为冻结的 `{paperId,title}` 后，重新执行 `npm run build`（2617 modules，成功）与 `git diff --check`（成功）。全量 `npm run check` 的测试清理器仍报告隔离 fixture `EPERM` 并跳过临时目录清理，未影响断言及退出码。

### L1a 恢复账本增量：持久远端任务 ID（2026-11-12）

- **契约/依赖：** L1a 继续使用唯一 `paperquay-knowledge.sqlite` writer 和 `parse_partitions`。新增 `remote_job_id` 列及按 generation 读取有序分卷记录的 store API；提交成功后在该分卷仍为 running 时立即保存任务 ID，来源版本失效或分卷不处于运行态时拒绝写入。既有 knowledge DB 使用幂等 schema 升级。
- **状态：** 持久身份首段完成；完整恢复仍进行中。
- **证据：** `node --test tests/paddleOcrLifecycle.test.ts tests/backupKnowledgeStore.test.mjs` 6/6；覆盖受控服务返回后关闭并重开 knowledge store 仍能读取 job ID、旧 schema 两次启动升级幂等、generation 发布和篡改保护。`node --check` 两个后端文件、`git diff --check` 通过。上一完整 `npm run check` 为 1000/1000；此新增增量后全量检查待重跑。
- **限制/阻塞：** 服务端受理与本地持久化之间仍有不可消除的提交窗口；本次不恢复远端 poll/download，也未实现 attempt 独立 staging、取消/崩溃恢复、产物引用保护。无真实 Paddle 服务调用。
- **下一步：** 定义可重放 attempt manifest 与隔离 staging，加入按 job ID 查询/恢复入口；取消或来源版本变化后禁止 current 发布。保持旧 current 直到校验并提交成功。

- L1a `remote_job_id` schema、写入回调和重启读取增量合并后，重新执行完整 `npm run check`（`TEMP`/`TMP`=`.codex-tmp/nov12-jobid-check`）：生产构建通过，测试 1001/1001、0 失败。笔记测试清理器报告隔离 fixture `EPERM` 并跳过清理，但退出码为 0。该结果覆盖本轮所有代码改动；后续若有新改动需再增量验证。

### L1a 增量：generation 独立 staging 与兼容缓存发布（2026-11-12）

- **状态/依赖：** 持久 partition/generation 基础、共享知识库和 sourceVersion 校验已存在；本次推进独立产物 staging 与旧 reader cache 兼容发布。L1a 仍进行中。
- **实现：** generation 产物目录位于 MinerU cache root 下 `.document-generations/<source-hash>/<generation-id>/`。新 manifest 登记此目录；兼容缓存只在完整性核验后替换。替换备份按 generation 命名，current 切换失败时删除本次写入并恢复本次备份；成功仅移除本 attempt 自己的备份。未知/遗留 `.bak-*` 不被本路径清理。
- **证据：** 相关 lifecycle/runtime/backup 专项 11/11；覆盖独立 staging 路径、旧 generation 原 artifact 不变、兼容缓存失败回滚、过期备份 sentinel 保留、远端 ID 重启后仍在。最新完整 `npm run check` 正在执行；构建已通过（2617 modules），等待全套测试最终退出。
- **边界：** 外部 Paddle 未调用。当前可验证的是进程内 staging 失败和 DB current 切换失败回滚；文件替换期间突然断电/进程终止后的启动恢复账本尚未实现，因此 L1a 崩溃恢复闸门未通过。远端 poll/download resume、取消恢复、旧产物引用计数/GC 也未完成。
- **下一步：** 以 durable cache-publication journal 连接 generation 状态与兼容目录 swap，启动时按 DB current 状态恢复/完成；再实现按远端 job ID 恢复 polling/download，覆盖取消、旧 sourceVersion 和备份往返。

### L1a journal 恢复验证更新（2026-11-12）

- 已实现：持久 cache-publication journal 在兼容文件每次移动/复制前记录意图。解析启动时根据共享 SQLite 中 source/current generation 决策：未提交就删除本次写入并恢复本次备份；已提交就保留新缓存并清理本次备份。恢复仅处理 journal 明确登记的文件，不触碰无主历史备份。
- **验证：** `node --test tests/paddleOcrLifecycle.test.ts tests/backupKnowledgeStore.test.mjs` 7/7；覆盖模拟进程中断后的 current 前回滚/current 后清理。隔离 TEMP 下完整 `npm run check` 构建通过、测试 1002/1002、0 失败；测试 cleanup 报隔离目录 `EPERM` 并跳过清理但退出码为 0。`node --check electron/backend/paddleOcrCommands.cjs`、`git diff --check` 通过。
- **仍未完成：** 远端 job 自动轮询/下载、取消恢复、逐卷 staging 复用、旧 generation 引用保护和清理、备份往返验证以及真实 Paddle 服务验证。未完成项继续阻止 L1a 闸门通过。
- **下一步：** 实现远端 job 恢复调度与取消对账；之后将每卷校验 staging、备份恢复和被引用 artifact 保留串联成同一失败恢复验收。

### L1a 显式重试续接远端 job（2026-11-12）

- 对同一文献重新发起解析时，knowledge store 会查找来源版本仍匹配的 building generation，并要求分卷数、物理页边界和 `sourceVersion:model:start:end` 输入哈希完全一致。分卷账本有远端 job ID 时，解析复用该 ID 继续轮询和下载，不重新提交；若上次已完成远端任务但进程在整代发布前中断，也会重读同一 job 结果重建本地分卷产物。
- 可恢复状态只在 SQLite 仍为 building 且 source version 仍匹配时复用；已发布、已失败或来源版本变化的 generation 不被重新打开。远端请求仍使用用户本次解析请求提供的 token，token 不写入共享知识库。
- **验证：** `node --test tests/paddleOcrLifecycle.test.ts tests/backupKnowledgeStore.test.mjs tests/knowledgeGraphCommands.test.mjs`：17/17。新增测试关闭并重开 SQLite 后重复发起解析，断言只 GET 已存 job ID、不发生 POST、结果完整发布为 current。此全量测试增量后的 `npm run check` 待跑。
- **边界：** 这是显式重新解析时的续接，不是应用启动时后台自动恢复；需用户/阅读器再次触发该文献解析。远端受理后、本地保存 job ID 前崩溃仍可能形成无法识别的提交窗口；真实服务的 job 可查询时长/结果保留期未实测。取消、逐卷 artifact staging 与备份往返仍未完成。

- **完整验证补充：** 上述代码增量后的 `npm run check`（`TEMP`/`TMP`=`.codex-tmp/nov12-job-resume-check`）已完成，生产构建通过、全套自动化测试 1003/1003、退出码 0；`node --check`（两个后端文件）与 `git diff --check` 通过。测试 cleanup 对隔离目录报告 `EPERM` 并跳过清理，不影响退出码。Electron `--version` 仍以 `-2147483645` 失败；已有 1420 端口打开的本地页面呈空白，因此桌面/浏览器视觉验收未通过或无法完成，仍待运行时故障修复后实测。

### L1a 持久分卷 staging 与重启复用（2026-11-12）

- `parse_partitions` 幂等增加 `staged_manifest`，逐卷记录稳定目录、文件路径/大小/SHA-256、物理页数和块数。manifest 登记成功后才进入 complete；若进程在两次写入之间退出，重试会校验 staging 后补齐状态。
- 同一 sourceVersion/model/partition 的显式重试先校验持久产物；有效卷直接进入合并和发布，不访问远端。损坏/缺失的登记 staging 会在 source/generation 管理目录边界内删除并重建。解析或 current 发布失败保留 building generation 供显式续跑。
- **验证：** lifecycle/knowledge backup 专项 8/8；隔离 TEMP 下完整 `npm run check` 构建通过、测试 1004/1004。新增集成回归在 SQLite 关闭重开后验证 staging 复用、零新增 fetch、最终 current 发布；现有篡改回归验证坏哈希拒绝并保留旧 current。日志中出现 MCP 隔离 fixture 清理 `EPERM`，测试进程退出码仍为 0。详见[变更记录](../changes/2026-11-12-long-document-partition-staging-recovery.md)。
- **仍未完成：** 应用启动恢复/继续 UI、取消与来源替换竞态的端到端验收、历史 artifact 引用保护/清理、可选的大型 artifact bytes 备份恢复、真实 Paddle 及大文档资源验证；L1a 不通过总闸门。L0 表格质量仍待解决，桌面验收仍受 Electron runtime 异常阻塞。

### KG-P1 EvidenceSpan 持久底座（2026-11-12）

- 新增共享来源版本、原文 EvidenceSpan 和人工审核事件表。来源 version/generation 改变时旧 evidence 保留但不再标 current；删除来源行后历史 quote/审核保留并返回 missing。
- Evidence 写入要求 caller 提供原始 block text，服务校验 quote 与偏移逐字吻合并生成 SHA-256；所有写入再次比较当前来源版本，拒绝迟到输出。测试覆盖 SQLite 关闭重开、伪造 quote、替换版本和来源删除。
- **验证：** 图谱/evidence/备份专项 16/16。完整 `npm run check` 待该 schema 增量后运行。未接入 PDF/Markdown 实际提取、P0-F locator、候选/关系审核投影或 UI，因此 KG-P1 保持进行中。实现边界见[变更记录](../changes/2026-11-12-knowledge-graph-evidence-foundation.md)。

### 联合验证与 EvidenceSpan 精确文件定位（2026-11-12）

- Windows publication journal 的原子 rename 对 `EPERM`、`EACCES`、`EBUSY` 增加最多 5 次递增间隔重试；仅在 Windows 上处理这些共享锁错误。
- journal rename 增量后的完整检查，以及 EvidenceSpan locator 增量后的最新完整检查，生产构建均通过，`npm run check` 当前结果 1005/1005、退出码 0。专项 `node --test tests/paddleOcrLifecycle.test.ts tests/knowledgeStoreEvidence.test.mjs tests/backupPackage.test.ts` 14/14；测试清理对隔离 fixture 仍报告 `EPERM` 并跳过目录删除。
- EvidenceSpan 现在可通过现有文件位置 IPC/service 提供证据限定目录：查询源版本登记的 `parseGeneration`，只验证该 generation 的 artifact manifest；sourceVersion 或文献身份不匹配时不返回可打开位置，历史文件缺失时返回 missing，reveal 复核同一 evidence ID 后才调用 shell。
- 定位集成与 EvidenceSpan 专项 `node --test tests/literatureFileLocations.test.mjs tests/knowledgeStoreEvidence.test.mjs` 5/5；其后完整 `npm run check` 已通过，测试 1005/1005。
- 详见[EvidenceSpan generation 定位变更记录](../changes/2026-11-12-evidence-generation-locator.md)。W-P0-F / KG-P1 仍进行中：图谱与长文档面板尚未传入实际证据 ID，候选 Claim/Relation 审核闭环也未完成。

## 联合阶段验证更新（2026-11-12，L1b 章节候选与原子发布）

- Paddle generation 现在从 manifest 管理的 `content_list_v2.json` 按 `text_level` 与页容器生成持久章节候选；支持扁平、分页数组和页字典。没有可靠标题时写入 page-only 根单元，所有印刷页保持 unknown。
- 章节树与逐页映射在发布 generation 同一事务中完成，校验来源版本、页覆盖和单元页范围后才切换 current。受控 lifecycle 测试证明非法映射拒绝新版本且保留旧 current。只读 IPC 仅返回仍匹配 active source version 的 current generation。
- `node --test tests/documentOutline.test.mjs tests/paddleOcrLifecycle.test.ts tests/knowledgeStoreStructure.test.mjs` 11/11；结构查询/图谱专项 `node --test tests/documentStructureCommands.test.mjs tests/knowledgeGraphCommands.test.mjs` 11/11；最终隔离 TEMP `npm run check` 构建通过、1012/1012，退出码 0；`EPERM` fixture 清理提示未影响测试。
- 尚未接入目录修订 UI、读者章节跳转、EvidenceSpan 页映射、单章索引和覆盖恢复；没有调用真实 Paddle 服务或测量代表性大文档质量、耗时、内存和磁盘。P0-T 双主题桌面截图与 P0-F Windows Explorer 实测继续待 Electron runtime 可用后验证。

## 桌面验收启动复核（2026-11-12）

- 独立端口复核发现前次“Electron 启动后 renderer connection reset”不能单独归因 Electron：本轮隔离 profile 放在仓库 `.codex-tmp` 内时，Vite 递归监听 Chromium 正在使用的 `Cookies`/`Cookies-journal`，以 Windows `EBUSY` 崩溃。前次页面错误包含本轮测试配置造成的监听冲突，不能继续作为 Electron 崩溃证据。
- `node_modules/.bin/electron.cmd --version` 在无参数情形仍返回 `-2147483645`。改用 `--enable-logging=stderr --no-sandbox --disable-gpu` 可创建标题为 PaperQuay 的窗口，但该次窗口载入时 Vite 已退出；将 profile 移到仓库外后 Electron 显示 Error 窗口，尚未获得可交互应用或计算样式。桌面启动链需继续以稳定运行的独立 Vite 与隔离 profile 复测；不能把无窗口/错误窗口记录为视觉验收。
- 本轮未操作现有 Explorer、Zotero 或任何个人文库；没有产生主题截图、P0-F Explorer 选中文件证据、嵌入/浮动窗口或 125%/150% 缩放验收。P0-T/P0-F 状态保持进行中，禁止提升为验收通过。
- 下一步：用仓库外且不存在被 Vite 递归监听风险的独立 profile，确保 1437 开发服务在 Electron 整个运行期间保持存活；从错误窗口/renderer 日志取出具体失败信息。启动问题解决后完成 P0-T computed style 与截图，再以隔离附件 fixture 完成 P0-F shell 验收，然后继续 L1b/L2、KG-P1 与 W-P6/P7。

## 0.4.26 阶段发布准备（2026-11-12）

- 版本由 `0.4.25` 提升至 `0.4.26`。在该版本源码树上运行 `npm run check`：生产构建通过，完整测试 1014/1014，退出码 0；隔离测试 fixture 清理有 `EPERM` 提示并跳过清理。
- `npm run electron:build` 成功生成 Windows x64 NSIS 安装器 `release/PaperQuay-0.4.26-win-x64.exe`（122,273,896 bytes，SHA-256 `659F9DFDD5DE38D127EA62B4ED0226D19DD8140D1A0F883F6F9F965C8D4E7EAB`）；Vite 有既有 Browserslist、动态导入及大 bundle 警告。
- 覆盖当前安装版失败：NSIS 报“PaperQuay 无法关闭”，观察到同一安装目录的无窗口 MCP server 子进程由桌面宿主自动重启。没有删除数据或改动个人文库。安装版 computed styles、主题截图、缩放、窗口形态、会话和 Explorer 验收保持待验证。
- 用户请求直接发布迭代版。提交后推送 `app-v0.4.26` 将触发 `.github/workflows/release.yml` 的 Windows x64 构建和正式发布；该远端工作流本台账更新时尚未触发。
- 三份计划已将最新自动化结果和安装版边界补入顶部进度记录。整体目标仍在实施：W-P0-T/P0-F 桌面闸门、W-P1—P7、KG-P1/P2、LD-L0/L1a/L1b/L2/L3 均不能因该阶段发布标记完成。发布说明和本次构建记录见[0.4.26 变更记录](../changes/2026-11-12-v0.4.26-incremental-release.md)。
