# 长篇书籍与报告：开源解析器调研

- 调研日期：2026-11-11（Asia/Shanghai）。
- 配套方案：[长篇书籍与报告处理及知识图谱联动计划](../plans/2026-11-11-long-document-knowledge-integration-plan.md)；它与[知识图谱与文献研究发现能力升级计划](../plans/2026-11-11-knowledge-graph-research-discovery-plan.md)共享来源、证据、存储与恢复工作。
- 本地基线：PaperQuay `ba3b410f6eb2f53d2abaa7cccb5dba1c88aec019`（v0.4.20）。本地行为以仓库源码为准，上游项目用于机制对照。
- 方法：固定并读取截至调研日期的上游仓库 commit、README/文档和许可证；本地测试及源码证据列在第 2 节。未安装解析器、下载模型权重、处理用户书籍或运行上游基准。公开项目宣传的准确率/速度未作为 PaperQuay 预测值。

## 1. 结论

PaperQuay 不缺一个“能把 PDF 变成 Markdown”的工具：项目已有 MinerU、PaddleOCR-VL 两条解析路径，也已有 PDF 分卷/合并、MinerU 结构块、目录及阅读器。长书短板主要是任务和知识组织层：物理分卷结果没有持久恢复账本；解析产物发布前缺少整本页覆盖校验；解析段落没有稳定、可修订的章节身份；Agent/检索的全文回退不能证明系统已经覆盖全书；章节参考文献、脚注与原文证据也缺完整作用域契约。

建议先加强现有主路径，再用新解析器做同样本盲评：

1. 将扫描/OCR/版面解析视为可替换 provider；将原文件版本、物理页、任务分卷、解析产物和校验状态视为 PaperQuay 自己的持久契约。
2. 每卷成功即可保存可校验产物及 provider job identity；仅所有预期页和必要资产满足发布规则时切换整本 manifest，否则保留可检索的 partial 范围。
3. 解析器产物先映射到页/块锚点，再归入真实章节树；树、叶子 chunk、摘要和 KG 命题不使用同一个 ID/边界。
4. Docling、MinerU 4.x、PP-StructureV3/PaddleOCR-VL、Marker 在同一批文本/扫描/报告样本上比较页级定位、表格脚注、公式、目录、资源及恢复集成成本。替换当前路径要以端到端收益为依据。
5. 代码许可、每个权重/模型卡、推理依赖、云服务条件和分发形态分开登记。上游主仓库许可证不自动覆盖权重或服务条款。

详细数据契约、阶段依赖、检索与 KG 联动见配套方案。解析器只把文献变为可追溯证据；不能单独发现学术关系或验证研究问题。

## 2. PaperQuay 当前实现核查

本节来自指定基线工作树的定向代码阅读，页数阈值描述当前应用策略，不外推为供应商长期承诺。

| 项目 | 已核实事实 | 对长篇任务的影响 |
| --- | --- | --- |
| MinerU 云端路径 | `mineruCommands.cjs` 对可读取页数 `>200` 的 PDF 以 150 页分卷，逐卷提交后合并；服务端超页报错也有提示。当前实现的页数策略是 PaperQuay 代码策略。 | 已有基础拆分，但没有观测到跨进程持久任务账本；本次调用中成功的远程卷可能在失败后重新处理。 |
| PaddleOCR-VL 路径 | `paddleOcrCommands.cjs` 设 `PADDLE_OCR_MAX_PAGES_PER_JOB=100`；同样复用拆分/合并。注释明确区分同步服务限制与未确定的异步任务限制。 | 首先按现有 provider 配置处理；不要把 100 页常量视为所有 Paddle 部署的能力上限。 |
| PDF 分卷 | `pdfSplitter.cjs` 会 `readFile` 完整源 PDF，再由 pdf-lib 读取/复制页面。 | 分卷降低单个远端任务规模，但不是内存流式拆分；更大的扫描文件仍需 RSS/磁盘实测。 |
| 远端结果 | MinerU 合并会调整显式 `page_idx` 并重命名冲突图片资源；个别解析异常以 warning 记录后继续。 | 需要在切换当前结果前另做 expected/actual 页覆盖、重复页、图像引用和分卷状态验证。 |
| 阅读器解析 | MinerU JSON 先完整解析为对象，再生成每 25 页 segments/outline；主线程收到并累计 pages。 | 不是磁盘级按页读取；单纯将解析放在 worker 不等于整本内存峰值已经解决。 |
| 索引与 Agent | 正文 RAG 有 source signature/generation 和 chunk 恢复状态；Agent 可按最多 1600 字符续读，但全文回退会加载 Markdown/JSON 或 PDF 文本。 | 可复用 RAG 架构与锚点；长文系统性任务需要按章节读取、覆盖账本和可续跑综合，不能把全文可加载当作全文已理解。 |

源码锚点：[pdfSplitter.cjs](../../electron/backend/pdfSplitter.cjs)、[mineruCommands.cjs](../../electron/backend/mineruCommands.cjs)、[paddleOcrCommands.cjs](../../electron/backend/paddleOcrCommands.cjs)、[mineruMerge.cjs](../../electron/backend/mineruMerge.cjs)、[mineruParse.worker.ts](../../src/features/reader/mineruParse.worker.ts)、[mineruParseWorker.ts](../../src/features/reader/mineruParseWorker.ts)、[mineruSegments.ts](../../src/features/reader/mineruSegments.ts)、[readerRag.ts](../../src/features/reader/readerRag.ts)、[agentTools.ts](../../src/services/agentTools.ts)。

本轮相关既有回归：

```powershell
node --test tests/mineruSplitMerge.test.ts tests/mineruSegments.test.ts tests/readerRagContext.test.ts tests/readerResourceBudget.test.ts tests/ragIndexStatus.test.ts
```

结果 26 项通过，0 失败。该测试范围未覆盖千页级真实样本质量、低内存硬件、进程崩溃后的远程任务恢复或跨章节研究问答。

## 3. 选取项目与固定版本

以下 commit 是用于本次核对的上游快照，不表示建议产品立刻升级到该版本。运行依赖、服务版本与许可需在实际候选版本再次确认。

| 项目 | 固定源码版本（2026-11-11） | 源码许可观察 | 主要对照用途 |
| --- | --- | --- | --- |
| [Docling](https://github.com/docling-project/docling/tree/77ae451be5f2e3f9befb81616be53cb350f3f9ae) | `77ae451be5f2e3f9befb81616be53cb350f3f9ae` | 仓库 MIT；README 明确单独查具体模型许可 | 文档对象/来源、OCR、表格和公式等结构输出；潜在本地解析 adapter |
| [MinerU](https://github.com/opendatalab/MinerU/tree/06c3481e9bf534e8d57a3f980e1f4c3cbd79f745) | `06c3481e9bf534e8d57a3f980e1f4c3cbd79f745` | Apache-2.0 加该快照 [LICENSE.md](https://github.com/opendatalab/MinerU/blob/06c3481e9bf534e8d57a3f980e1f4c3cbd79f745/LICENSE.md) 的附加阈值和服务署名条款；模型另查 | 现有路径基线；当前上游支持多解析 tier、Python/CLI/API 和多本地运行时 |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR/tree/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf) | `dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf` | 仓库 Apache-2.0；各模型权重/服务单独查 | PP-StructureV3 与 PaddleOCR-VL 结构解析和图文输出对照 |
| [Marker](https://github.com/datalab-to/marker/tree/de5bbc77671bb95cfbdb0c6656f53754b5d4e494) | `de5bbc77671bb95cfbdb0c6656f53754b5d4e494` | 该快照仓库代码 Apache-2.0；README 标出权重采用修改版 AI Pubs OpenRAIL-M 条款 | 可输出带页/块元数据的 Markdown、JSON、chunks，对照版面/公式/表格路径 |

Marker 的许可证信息在不同历史版本/二手资料间容易过时。本报告只陈述上述固定 commit 的 README 与 `LICENSE`：**不沿用将该快照代码称为 GPL 的旧结论**。Marker 权重条款与源码许可不同；是否适合商业分发仍需按实际使用的模型版本、条款及组织情境逐项核对。

## 4. 项目机制及边界

### 4.1 Docling

固定快照的官方 README 和 supported formats 文档描述：多格式输入；PDF 页布局、阅读顺序、表格、代码、公式、图像分类；扫描件 OCR；可导出 Markdown、HTML、DocLang 和结构 JSON。代码仓库 MIT，但文档明确要求分别检查各模型来源许可。

适合本项目作为本地解析/结构化输出的基准 adapter：纸面报告、扫描教材、结构化 JSON 中间格式都值得纳入对照。需要另验证：中文扫描/OCR效果；精确页、框和块锚点是否能够无损映射到 PaperQuay 阅读器；复杂章标题/目录能否稳定归纳成可纠正章节树；支持格式并不等于 EPUB/DOCX 在长篇分页和交叉引用上都达到目标；模型首次下载、CPU/RAM/显存占用、打包和升级路径。

来源：[固定版 README](https://github.com/docling-project/docling/blob/77ae451be5f2e3f9befb81616be53cb350f3f9ae/README.md)、[supported formats](https://github.com/docling-project/docling/blob/77ae451be5f2e3f9befb81616be53cb350f3f9ae/docs/usage/supported_formats.md)、[LICENSE](https://github.com/docling-project/docling/blob/77ae451be5f2e3f9befb81616be53cb350f3f9ae/LICENSE)。

### 4.2 MinerU

这是 PaperQuay 已在用的路径，上游仓库适合作为现有 provider 的功能和本地运行候选参照。固定版 quick start 描述 PDF/原生文档/批处理的 CLI 路径及多种解析 tier；首次模型驱动解析可能下载权重；显式 text mode 只取文本层，不会替扫描页补 OCR。Docker quick start 指向 NVIDIA/Linux GPU 等附加环境约束，而仓库另有 ONNX/llama.cpp/Torch 等运行选择。远程解析服务、上游 CLI 和 PaperQuay 当前调用 API 并非同一部署契约，不能由上游能力推断现有云 API 可以无损替换。

固定版 `LICENSE.md` 写明 Apache-2.0 并附加条款：超过特定关联企业 MAU 或月收入门槛需单独商业许可；基于 MinerU 向第三方提供在线服务时需显著标示使用 MinerU。若采用本地运行、打包或在线服务，应由负责人按实际产品形态核对这些条件及模型资产许可。

来源：[固定版 README](https://github.com/opendatalab/MinerU/blob/06c3481e9bf534e8d57a3f980e1f4c3cbd79f745/README.md)、[quick start](https://github.com/opendatalab/MinerU/blob/06c3481e9bf534e8d57a3f980e1f4c3cbd79f745/docs/en/quick_start/index.md)、[Docker deployment](https://github.com/opendatalab/MinerU/blob/06c3481e9bf534e8d57a3f980e1f4c3cbd79f745/docs/en/quick_start/docker_deployment.md)、[LICENSE.md](https://github.com/opendatalab/MinerU/blob/06c3481e9bf534e8d57a3f980e1f4c3cbd79f745/LICENSE.md)。

### 4.3 PaddleOCR / PP-StructureV3

PaddleOCR 仓库的主要技术栈包含 OCR 组件、PP-StructureV3 文档结构解析与 PaddleOCR-VL 文档视觉语言模型。固定版 README 描述 JSON/Markdown 输出；PP-StructureV3 提供更细的坐标信息，PaddleOCR-VL 则覆盖文档文字、表格、公式等内容。PaperQuay 当前分支调用 PaddleOCR-VL 云服务并使用 100 页/任务的应用配置；这不能与自部署 PP-StructureV3 的吞吐、API 限制或模型授权混为一谈。

适合作为现有第二 provider 的质量基准，并可评估可离线运行路线。需测试页块坐标与原 PDF、跨页表格和脚注的关系、章节/书签处理以及 Python/Paddle 依赖、模型大小和硬件矩阵。仓库 Apache-2.0 只说明代码仓库许可；拟采用的 OCR、布局、公式和视觉模型应分别记录模型卡与权重许可证，不能用 README 的模型效果宣传替代许可/质量审查。

来源：[固定版 README](https://github.com/PaddlePaddle/PaddleOCR/blob/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/README.md)、[quick start](https://github.com/PaddlePaddle/PaddleOCR/blob/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/docs/quick_start.en.md)、[LICENSE](https://github.com/PaddlePaddle/PaddleOCR/blob/dab3fe35379033fdcb2d0e9572fac0b36c9a9ebf/LICENSE)、[PP-StructureV3 官方文档](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PP-StructureV3.html)。

### 4.4 Marker

固定版 Marker 能输出 Markdown、JSON、HTML 和可供 RAG 处理的 chunk 列表；JSON 结构含 page/block 与 bounding box 元数据。README 区分源码 Apache-2.0 与修改版 OpenRAIL-M 模型权重条款，并指出更高准确度模式可能使用 LLM；纯本地路线也要分别考虑权重下载、推理服务、GPU/CPU 和格式能力。README 的公开 benchmark 为项目自报，不能据此直接断定它优于本项目当前 MinerU/PaddleOCR 路线。

建议只作为抽样对照，不作为默认依赖。质量测试应分离“无 LLM 纯解析”和“启用 LLM 辅助”两种配置；否则解析质量、外部模型质量、数据传输和每页成本混在一起。当前没有完成其完整部署链、取消/续跑、页范围以及长书内存验证，均列为试点实测项。

来源：[固定版 README](https://github.com/datalab-to/marker/blob/de5bbc77671bb95cfbdb0c6656f53754b5d4e494/README.md)、[LICENSE](https://github.com/datalab-to/marker/blob/de5bbc77671bb95cfbdb0c6656f53754b5d4e494/LICENSE)。

## 5. 选型比较

| 维度 | 现有 MinerU API / PaddleOCR-VL | Docling | MinerU 本地候选 | Marker | 架构决策 |
| --- | --- | --- | --- | --- | --- |
| 改造成本 | 最低；已有 provider、缓存和统一阅读器契约 | 中高；增加 Python 服务/sidecar 或跨语言桥接和模型分发 | 高；与 API 集成不同，需要部署、硬件诊断和版本固定 | 中高；需要 Python/模型服务及权重许可决策 | 先补应用侧任务账本/manifest，provider 可替换 |
| 书籍结构 | 已有 MinerU outline 与页块；需实测完整目录质量 | 文档树/输出结构较强，作者目录提取仍需评测 | tier 能力不同，长文须明确页级范围/locator 测试 | JSON 块结构可检视；不能当作可信目录即用 | 作者树从目录/书签/标题多信号恢复并允许修订 |
| 扫描、表格、公式 | 云端质量和输出已接入；实际模型版本受 API 服务 | OCR/版面/表格等由可选模型及 pipeline 提供 | OCR/布局/公式能力强，资源与模型由本地部署承担 | 可通过模型辅助增强；不同模式成本不同 | 按同样本分文档类型评分，保留表格脚注与坐标 |
| 长任务恢复 | 当前 app 级账本待补；云 job 可能有任务 ID | 须自行编排/持久化分卷；不假设 parser 内有业务 resume | 服务部署特性不替代 PaperQuay manifest | 同样须应用层处理卷、状态和原子发布 | 任务状态与解析器解耦；每卷幂等可恢复 |
| 资源/隐私 | 文档会发到已配置服务 | 可本地化，模型文件/RAM/磁盘要实测 | 可本地，但需选运行时和硬件，初始下载模型 | 可本地但模型/VLM 服务资源不同 | 由用户明确远端/本地路径并显示范围和预算 |
| 许可 | PaperQuay 使用的服务/模型条款需核对 | 源码 MIT，所用模型逐个核对 | Apache-2.0 加附加商业/服务条款，模型逐个核对 | 代码 Apache-2.0，模型 OpenRAIL-M | SBOM/模型清单绑定具体版本，不使用仓库 badge 代替审查 |

此表是候选比较，不构成对某个解析器通用优劣排名。扫描图书、数字化教材、年度统计报告与技术手册可能得出不同结论。

## 6. 推荐集成边界

将候选解析器适配成内部接口，而不让其目录、持久格式、向量库或 Agent 工作流成为新的事实源。概念契约示例：

```ts
type ParseRequest = {
  sourceVersionId: string;
  fileHash: string;
  pageRanges?: Array<{ startPageIndex: number; endPageIndexExclusive: number }>;
  profile: string;
  idempotencyKey: string;
};

type ParsedPage = {
  physicalPageIndex: number;
  printedLabel?: string;
  blocks: Array<{
    blockId: string;
    kind: string;
    text?: string;
    bbox?: [number, number, number, number];
    assetRef?: string;
    sourceRoleHint?: string;
  }>;
};

type ParsePartitionResult = {
  provider: string;
  providerVersion: string;
  requestKey: string;
  pages: ParsedPage[];
  artifacts: Array<{ kind: string; relativePath: string; sha256: string }>;
  diagnostics: Array<{ code: string; pageIndex?: number; message: string }>;
};
```

此类型是设计草案，不等于声称所有 provider 能返回这些字段。适配层应显式表示 unknown/null；不能为了满足 schema 静默编造标题、印刷页码、表格坐标或成功状态。必要时把解析产物追加到版本目录，知识库保存稳定身份、hash、状态及 artifact ref。

建议处理流程：

1. **体检**：读文件 hash/页数/书签/文本层覆盖，对开头中段末尾及目录、图表密集页分层抽样；将页码统一映射到 0 基物理页，保留印刷页码快照。
2. **路由**：数字文本先试低成本提取；复杂双栏/公式/表格页调用结构解析；扫描页按语言、倾斜/旋转和图像质量决定 OCR；混合文件按页保存来源 provider，不重复索引同一页面。
3. **分卷**：页数、字节和 provider 限制作为 versioned capabilities；按稳定 key (`fileHash + pageSet + provider + profile + version`) 建立持久卷记录。API 返回 job id 即保存，产物下载并校验后再标 verified。
4. **合并检查**：比较预期页集与产物页集，处理缺页/重页、边界续页、资产引用、页索引偏移。未达完整标准只发布 partial manifest，并精确标注 available scope。
5. **结构映射**：先保留 parser outline 为候选；融合 PDF bookmarks、TOC 页码、标题块/字号和人工修订形成 DocumentUnit。每个章节范围可落到物理页与 block 边界，支持同页多节。
6. **发布**：新 manifest 原子成为 current；检索、摘要和 KG 绑定 source/manifest/unit revision。晚到任务只有 generation 仍有效时才能发布；人工结构和问题卡留在持久知识库，不跟缓存清理。

具体字段、SQLite/worker 共享方式、独立版本、单位级索引与摘要、与 KG 的 SourceVersion/EvidenceSpan 关系，参见配套方案第 5—12 节。

## 7. 试点如何公平比较

### 7.1 样本与金标准

建议首批 8—12 个有使用许可的文件，包括：数字文本教材、300—1000+ 页文本书、无书签扫描本、中英文混排报告、旋转/双页扫描、跨页表格/脚注、罗马数字前置页、多个附录、同书不同版次、较短论文回归。测试文件要先 hash 固定并说明是否发送到外部服务。

挑选约 60—100 个金标准问题/证据集合，按页段、文档类型和难例分层：页级精准定位、章节边界、数字和单位、表头/脚注、公式周边定义、附录限制、目录偏移、无答案/解析错误。问题及正确物理页、block/证据 span 人工复核。相同书籍版本不能跨开发/保留切分造成泄漏。

### 7.2 对照配置

在相同文件子集及范围下记录：

- P0：当前 MinerU API 与当前 PaddleOCR-VL 路径；保留 provider、服务日期、参数、原始导出和费用。
- P1：Docling 选定版本与明确模型/硬件 profile；先记录默认 local pipeline，再单独测试 VLM/OCR增强选项。
- P2：MinerU 本地固定版本，至少分开 text-only、扫描 OCR、质量增强 tier，不与云 API 混在单一分数。
- P3：Marker 固定版本，分纯解析与 LLM 辅助模式；记录每次调用模型和用量。

所有报告都按“解析、目录树、检索/证据定位”分三层。解析器文本质量较好不代表它产生的章节树、跨章回答或研究发现也更好。

### 7.3 指标

| 层 | 指标 | 报告要求 |
| --- | --- | --- |
| 完整性 | 页覆盖、丢页/重复页、空页分类、资产缺失率 | 分子/分母和状态原因；不以输出文件存在视为完成 |
| 文本 | OCR CER/WER 或人工语义可用度、公式/单位保持 | 与数字文本和扫描分别报告；项目宣传分不可代替同域样本 |
| 结构 | 标题层级/章节边界、目录映射正确、阅读顺序、引用定位 | 对每种文档类型分别评价；结构低置信时允许回退全文 |
| 表格 | 表头/行列/单位/脚注一致、跨页续表匹配 | 数值指标需人工逐单元对照，保留源坐标 |
| 研究证据 | Evidence Recall@k、支持 span 完整性、页跳转准确 | 由同一检索器对比，不把解析文本质量与 RAG 算法混测 |
| 长任务 | 前/中/末卷失败、重启、重试、取消、迟到完成和幂等 | 检查重复远端提交、任务费用、current manifest 和 partial 行为 |
| 资源 | 冷启动、运行时间、峰值 RSS、CPU/GPU/显存、临时磁盘 | 按硬件、版本与页数报告，注明模型预热和并发 |
| 隐私/成本 | 本地或远端、传输量、每页/每卷/每书费用、重复处理率 | OCR、VLM、摘要、重试分项，不以单个平均遮盖高成本难例 |

验证重点是“同一原文页能被检索命中、定位并返回准确证据”，随后才选择减少人工修订成本的结构方案。长上下文 benchmark 可补压力测试，不能代替章节、表脚注和页码金标准。

## 8. 实施建议

1. **先建立当前基线**：复用现有 MinerU 和 PaddleOCR 样本，收集失败、页覆盖、结构质量、内存和重试情况；固定实际服务版本及远端配置。
2. **并行最小 parser bake-off**：只挑少量代表页/完整两本书各一份，用 Docling、MinerU local、Marker 对照。若装载依赖或模型成本过高，先用供应商容器/独立机器隔离，不把实验环境并进 Electron 安装包。
3. **优先实现 provider-independent 长任务层**：持久分卷记录、原文件及产物 hash、重启续跑、取消、覆盖校验、manifest revision 和 partial 范围。它对所有 provider 都有收益。
4. **实现章节/证据身份**：解析输出按 page/block anchor 进入真实结构树，人工可修目录/边界；索引、摘要、命题以稳定 unit/revision 为输入，不以分卷号作为知识单位。
5. **按质量差距再做本地替换**：仅当隐私、费用、离线可用或证据质量的试点结果支持时，评估自带 Python sidecar、模型下载/更新、签名、资源管理和许可维护成本。
6. **把章级证据交给 KG**：先分来源角色并留下引用 span；书中二手转述不可自动升为原始观测，摘要不能取代叶子证据；KG 的查新/问题卡流程使用同一 unit revision。

升级阶段和范围以[配套联动计划](../plans/2026-11-11-long-document-knowledge-integration-plan.md)的 L0—L4 为准。解析器比较属于 L0 的决策证据，不应阻塞现有解析管线的可靠恢复改造。

## 9. 开源代码、模型与服务许可清单

| 候选 | 需保留记录 | 本次看到的待核对点 |
| --- | --- | --- |
| Docling | repo commit、Python/package 依赖、每个模型仓库 revision 与权重许可 | MIT 代码不代表关联 OCR/VLM 模型采用 MIT |
| MinerU | repo commit、附加许可证、CLI/API/服务部署形态、所有模型权重与字体/资产 | 固定版有特定规模门槛和在线服务署名条款 |
| PaddleOCR | repo commit、具体 pipeline、每个 OCR/layout/table/formula/VL 模型卡 | Apache-2 仓库许可不能概括模型和 API 条款 |
| Marker | repo commit、当前代码许可证、权重/推理服务模型、LLM provider 与云选项 | 本次固定版代码 Apache-2.0、README 报告权重 modified OpenRAIL-M；历史版本可能不同 |

制作发行物前把锁定文件/镜像 digest、依赖 SBOM、模型卡 URL/commit、license 文件 hash、用途与是否联网汇总到候选记录；不自动下载或随安装包再分发未审查模型。对商业服务、第三方在线使用和派生分发分别检查条款。

## 10. 调研边界

- 上游 commit 选在 2026-11-11 附近做现状切片，版本会快速变化；实施前再读目标 release/tag 的代码、model card 和服务文档。
- 没有下载/运行任何候选的权重，本文不提供速度、内存、准确率或价格实测结论。
- 不把 MinerU 项目的自带指南或其他上游宣传语视为中立评测；只把官方功能/许可声明作为待验证假设。
- 未审计每个传递依赖、数据集训练来源及云服务条款全文；如进入发行评审，按具体固定版本和商业形态逐项审查。
- 本文没有提交应用代码改造；已通过的 26 项现有回归只说明当前覆盖到的窄范围。
