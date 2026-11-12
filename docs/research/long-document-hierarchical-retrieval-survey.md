# 长篇书籍与报告：层级检索开源机制调研

- 调研日期：2026-11-11。
- 配套设计：[长篇书籍与报告处理及知识图谱联动计划](../plans/2026-11-11-long-document-knowledge-integration-plan.md)。
- 本地基线：PaperQuay `ba3b410f6eb2f53d2abaa7cccb5dba1c88aec019`。
- 方法：联网读取官方仓库和论文摘要，在工作区外浅克隆 PageIndex、RAPTOR、late-chunking 并审阅关键源码；没有安装依赖、运行上游模型或测量真实文库质量。解析器另见[独立调研](long-document-parsing-open-source-survey.md)。

## 1. 结论

长文档问题至少包含三层：能否正确解析并定位，能否找到相关章节与细节，能否综合远距离信息。目录树、递归摘要、上下文感知向量分别解决其中一部分，没有一种结构能代替其他两层。

推荐先实现可追溯的文档结构树与父子检索，复用现有 FTS/向量；再按需增加章节摘要和图谱路径。PageIndex 与 RAPTOR 适合做机制和对照基线，暂不把任一 Python SDK 作为桌面程序的必要运行时。Late chunking 是后续可选向量实验，不是直接对当前任意 Embedding API 增加一个参数。

## 2. PageIndex：章节定位优先，注意当前版本变化

固定版本：[`2ac8694bf8fe89a3840dda9bdb88db5119b77fc4`](https://github.com/VectifyAI/PageIndex/commit/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4)，提交日期 2026-11-05。

| 核实内容 | 源码事实与一手链接 | 对 PaperQuay 的意义 |
| --- | --- | --- |
| 当前默认索引 | SDK 本地 `mode=None` 转为 `flash`；旧版 LLM 目录流程仍作为 standard 分支保留。[local_api.py](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/local_api.py#L116-L193) | 不能继续把“先用 LLM 读前 20 页找目录”说成整个当前项目的唯一流程。 |
| Flash 原始树 | 版面统计、标题检测、可选 PDF bookmarks 形成结构；原始树可通过 `summary=False, optimize=False` 在无 LLM 情况下生成。[Flash 文档](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/flash/README.md)，[编排源码](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/flash/main.py#L124-L178) | 先用确定性信息恢复结构，低质量处再做模型辅助，能减少全书付费处理。 |
| 默认不等于零模型成本 | Flash 默认 summaries 与 full optimize，含模型摘要及展开；需要显式关闭才是无模型建树。[api.py](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/flash/api.py#L188-L216) | 评测要分别统计 raw/merge/full 模式，不能把纯版面耗时当成完整索引成本。 |
| 树节点 | title、node_id、start_index/end_index、summary、children；页范围为 1 基闭区间。[Flash 输出契约](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/flash/README.md) | 接入时转换为 PaperQuay 的 0 基页序；同页多节仍需 block 级边界。 |
| 结构失败状态 | `toc_source=detected/bookmarks/hybrid/pages/unreadable`；纯页列表超过 10 节点时本地客户端/CLI 拒绝，扫描无可读文本不是正常树输入。[api.py](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/flash/api.py#L171-L193) | 应保存结构来源和质量，允许在 PaperQuay 中降级页级检索；不能伪造章节。 |
| 页面文本与树解析器不同 | 本地文本通过 PyPDF2 全页抽取，Flash 用另一解析路径；保存前检查页界。[local_api.py](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/local_api.py#L214-L277) | 页码合法只证明不越界，不证明两套文本的 block/偏移相同。已有 MinerU anchors 应继续作为权威定位。 |
| 查询工具 | 提供结构获取和页内容读取，长文档优先获取结构，结构有分页，页请求有界。[agent_tools.py](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/pageindex/agent_tools.py#L850-L1126) | 借鉴“先目录—再章节—再原文”的工具设计，替代大量按字符续读。 |
| 本地与云区别 | 官方 README 将本地模式限定为文本型 PDF、页级引用；扫描/图像理解、块级云引用和文件级 corpus tree 等标为 Cloud 能力。[README](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/README.md) | 不把 Cloud 页面功能归入开源本地已具备能力。 |

判断：PageIndex 特别适合作为有目录技术手册、年报、教材的导航基线。错误标题、目录页码偏移、同页多节和无目录扫描本会削弱树路由；首轮只走一条分支也可能漏掉相关附录。因此主方案同时保留全文检索和交叉引用扩展，树路由不形成硬过滤。

该固定版本为 [MIT](https://github.com/VectifyAI/PageIndex/blob/2ac8694bf8fe89a3840dda9bdb88db5119b77fc4/LICENSE)。本次未验证其 README 自报的速度、费用和金融问答准确率，也不把这些数值作为 PaperQuay 指标。

## 3. RAPTOR：语义摘要层不等于作者目录

固定版本：[`7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767`](https://github.com/parthsarthi03/raptor/commit/7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767)，提交日期 2024-09-03；[原始论文](https://arxiv.org/abs/2401.18059)。

源码核实：

- [cluster_utils.py](https://github.com/parthsarthi03/raptor/blob/7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767/raptor/cluster_utils.py)：UMAP 降维和 GMM 软聚类，同一输入可以归入多个组；过长 cluster 会再次分组。
- [cluster_tree_builder.py](https://github.com/parthsarthi03/raptor/blob/7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767/raptor/cluster_tree_builder.py#L65-L151)：对每个 cluster 摘要，再将摘要作为下一层节点继续构建，父节点保存孩子索引。
- [tree_retriever.py](https://github.com/parthsarthi03/raptor/blob/7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767/raptor/tree_retriever.py#L158-L245)：支持扁平化所有层一起召回，以及逐层检索；不是只查最高层摘要。
- [tree_structures.py](https://github.com/parthsarthi03/raptor/blob/7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767/raptor/tree_structures.py)：Node 只有 text/index/children/embeddings，未原生包含 PaperQuay 的 paperId/sourceVersion/page/block/span。
- [RetrievalAugmentation.py](https://github.com/parthsarthi03/raptor/blob/7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767/raptor/RetrievalAugmentation.py#L204-L220)：`add_documents` 重建 tree，所提示的 `add_to_existing` 调用被注释；不能据函数名认为已支持生产级增量更新。保存用 pickle，不能原样当作用户可交换的安全存储协议。
- 仓库为 [MIT](https://github.com/parthsarthi03/raptor/blob/7da1d48a7e1d7dec61a63c9d9aae84e2dfaa5767/LICENSE.txt)。默认模型、Python 依赖和持久化协议需要适配，不宜整套嵌入桌面。

适用：跨章主题线索、全书范围概览、把远距离相关片段组织成可查询摘要。限制：摘要会丢条件和反例，聚类主题可与真实章节完全不同；软聚类还可能重复使用同一原文。PaperQuay 应分别保存 `outlineParent` 和 `summaryMembership`，叶子证据去重，摘要只作导航材料，命题验证下钻到原文。

## 4. 父子检索：先小块命中，再有界补全语境

一手源码：LlamaIndex 固定提交 [`18088d8f070c9212ac4a941b13f759bf417e3031`](https://github.com/run-llama/llama_index/commit/18088d8f070c9212ac4a941b13f759bf417e3031)。

- [HierarchicalNodeParser](https://github.com/run-llama/llama_index/blob/18088d8f070c9212ac4a941b13f759bf417e3031/llama-index-core/llama_index/core/node_parser/relational/hierarchical.py)：默认递归 chunk sizes 为 2048/512/128，并保存父子关系。这是大小分层，不是自动识别真实章节语义。
- [AutoMergingRetriever](https://github.com/run-llama/llama_index/blob/18088d8f070c9212ac4a941b13f759bf417e3031/llama-index-core/llama_index/core/retrievers/auto_merging_retriever.py)：先取向量命中，若同父命中的子节点比例超过默认 0.5，则替换为父上下文，并补中间相邻节点。

适用：段落包含代词、表格前后解释或章节局部条件时，用父范围增强可读性。原样套用的局限：父节点可能长达整章，按子节点数量的比例不等于 token 预算，也不保证支持当前问题。建议在 TS 中实现“真实章节/子节 + token 有界窗口”，保留 leaf anchors，超过预算时先子节再拆分；不要为了引入一个检索策略而迁入整套框架。

## 5. Late chunking：需要 token 级上下文表示

固定版本：[`1d3bb02bf091becd0771455e4e7959463935e26c`](https://github.com/jina-ai/late-chunking/commit/1d3bb02bf091becd0771455e4e7959463935e26c)，提交日期 2024-12-23；[原始论文](https://arxiv.org/abs/2409.04701)。

机制：先在模型上下文范围内编码长文本，随后对 token 表示按小块 pooling，而不是先把小块分别送入模型。[README](https://github.com/jina-ai/late-chunking/blob/1d3bb02bf091becd0771455e4e7959463935e26c/README.md)、[pooling 实现](https://github.com/jina-ai/late-chunking/blob/1d3bb02bf091becd0771455e4e7959463935e26c/chunked_pooling/__init__.py)。

关键限制：

1. 需要 token 表示和精确 offset mapping，普通只返回每段单向量的 `/embeddings` 服务不一定暴露这些能力。[模型 wrapper](https://github.com/jina-ai/late-chunking/blob/1d3bb02bf091becd0771455e4e7959463935e26c/chunked_pooling/wrappers.py)
2. 模型仍有上下文上限。源码中的 long late chunking 用带重叠的编码窗口，不能把一千页视为单次全局 attention。[mteb_chunked_eval.py](https://github.com/jina-ai/late-chunking/blob/1d3bb02bf091becd0771455e4e7959463935e26c/chunked_pooling/mteb_chunked_eval.py#L128-L159)
3. 代码仓库是 [Apache-2.0](https://github.com/jina-ai/late-chunking/blob/1d3bb02bf091becd0771455e4e7959463935e26c/LICENSE)，但模型权重许可单独判断。例如调研时 [jina-embeddings-v3 官方模型卡](https://huggingface.co/jinaai/jina-embeddings-v3)声明 CC-BY-NC-4.0，不能把代码许可当成该权重的商用许可。
4. 带上下文的向量可改善“它/该方法”类召回，但最终答案仍须引用原文；向量不自动解释完整跨章依赖。

结论：列入选配实验。首版用标题路径、必要局部语境和父子扩展改善切块；向量 `representationKind/contextWindow/modelKey` 分开，使用相同模型和预算做对照后再决定是否落地。

## 6. 论文和评测给出的边界

| 一手来源 | 能支持的判断 | 不能外推的结论 |
| --- | --- | --- |
| [LongRAG](https://arxiv.org/abs/2406.15319) | 适当增大检索单元、利用较长 reader，可以减少细碎切块造成的上下文损失 | Wikipedia/论文任务的结果不能证明 1000 页教材应一次读完整章或整本。 |
| [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/) | 所测模型对长上下文的位置敏感，提示必须做证据位置分层测试 | 2024 年结果不能直接当作 2026 年每个模型的既定退化幅度。 |
| [QASPER](https://aclanthology.org/2021.naacl-main.365/) | 全文问答同时评估答案和支持证据，适合借鉴证据标注方式 | NLP 论文问题集不覆盖千页书、中文目录、报告表格和断点恢复。 |
| [LongBench v2](https://github.com/THUDM/LongBench)，[论文](https://arxiv.org/abs/2412.15204) | 包含更长上下文和多类真实任务，可补充长距离理解压力测试 | 选择题准确率不等于原文定位质量、章节归属或知识图谱关系正确率。 |

建议自建书籍/报告小型保留集：开头/中间/末尾事实，跨章条件，附录例外，表格脚注，无答案，错误目录，同名缩写与不同版本。复用公开集时核对数据许可，按文档族拆分；不把同一版本相邻章节分散到开发集和测试集。

## 7. 对主计划的具体输入

1. 作者章节树、语义摘要 DAG、知识图谱是三种独立结构，共享原文身份与证据，分别用于导航、召回和科研关系。
2. 检索至少保留 leaf 全文通道，树路由是增量通道；根目录选错或无目录时仍可回退。
3. 摘要命中必须解析到原文叶子，概括只记录实际覆盖的单元；没有处理的附录不能写“全书未提及”。
4. 持久化索引、抽取和摘要应支持单元级复用、版本失效、取消/重启，并按实际 token 计费；上游研究原型不能替代这些工程契约。
5. 长文档的章节不能当多篇独立论文计票，教材转述不能直接归入原创贡献，报告目标/建议不能直接当实验事实。

本文件的结论是源码及论文机制对照，不包含运行上游后的准确率、成本、性能或本地大文档验收结果。
