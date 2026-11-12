# Meta Knowledge Graph 与文献关系发现：源码事实、适用条件及 PaperQuay 集成建议

研究日期：2026-11-11。上游：[Seaual/meta-knowledge-graph](https://github.com/Seaual/meta-knowledge-graph)。

配套实施设计见 [PaperQuay 知识图谱与文献研究发现能力升级计划](../plans/2026-11-11-knowledge-graph-research-discovery-plan.md)。

**固定审计版本：[`9aee684925f8c7429bb3a693d571e174f2b85326`](https://github.com/Seaual/meta-knowledge-graph/commit/9aee684925f8c7429bb3a693d571e174f2b85326)**，提交时间 2026-06-24 14:38:39 +08:00。以下 `[Mxx]` 均为该 commit 的源码永久链接，不能用当前主分支内容替代。PaperQuay 集成基线为 `ba3b410f6eb2f53d2abaa7cccb5dba1c88aec019`（v0.4.20）。

方法：阅读英文 README、抽取器、数据模型、数据库 schema/兼容层/Repository、FastAPI 路由及服务、两套去重实现、两套 Neo4j 实现、引用网络及 Agent 工具；用 Semantic Scholar 官方 API 与 W3C 规范核对可复用的数据契约。本报告是静态源码研究，未启动上游服务、调用付费模型或测量抽取质量。后文标注“源码事实”“判断”“建议”，避免把实现存在、入口可达和科研有效性混为一谈。GraphRAG、HippoRAG、SciERC、SciREX、SciMON 的深入论文对照由主研究任务另行完成，本文件集中补齐上游实现事实。

## 1. 关键结论

1. **值得复用的是“先判断贡献边界，再抽取概念”的设计。** 两阶段提示词区分背景概念、定位用的 anchor path 与真实贡献子树，并记录 `proposed/improved/applied/analyzed`。它能帮助减少“论文提到某方法＝论文提出某方法”的混淆；实际精度仍需标注集验证。[M02][M03]
2. **现行模型不是固定三级概念体系，也不是完整的科学事实关系图谱。** 当前两阶段提示词有八类概念，树深度动态；主要持久关系为论文—概念、概念父子、论文引用。旧 `Keyword.level` 模型与旧单阶段提示词仍在仓库中，不能与现行 `Concept` 模型拼成一条已落地流水线。[M01][M02][M04][M05][M16]
3. **README 的“智能去重”需要按入口拆解。** 当前网页 `/dedup/scan` 走 `DedupService`，使用字符集合 Jaccard 与包含关系，没有调用 LLM；独立 `mkg/dedup/` 才包含 `SequenceMatcher → LLM 判定 → 合并执行器`。其中候选召回仍依赖同类别与字面相似度，不能据此认定跨语言或缩写同义词已被可靠召回。[M10–M14]
4. **研究点发现是带图结构上下文的假设生成。** 四种方法论写进同一个提示词；没有逐类候选检测器、形式化推理器或新颖性检验闭环。`novelty/difficulty/potential_impact` 是模型输出标签，不是验证结果。[M07–M09]
5. **当前研究点入口没有原文证据定位。** 输入只保留有限图结构及论文标题/关键词；虽准备了摘要字段，构造提示词时没有使用。两阶段抽取返回 `raw_response=""`，`research_questions=[]`。概念表也没有页码、块 ID 或证据 span。[M02][M04][M07][M08]
6. **存在影响运行可用性的静态缺陷。** 网页论文处理的 `_save_concepts` 最终只调用一个仅新增根概念的 `save_node`；递归收集器未被调用。网页去重的更新白名单又不允许其自身传入的进度字段。应借鉴机制并独立实现、验证，不宜把当前上游整个处理服务直接接入 PaperQuay。[M06][M11]

## 2. README 与当前实现的对应关系

| README 表述 | 固定版本的源码事实 | 对复用的含义 |
|---|---|---|
| Two-Stage Concept Extraction，8 categories | `extract()` 依次调用 `_stage1_summarize`、`_stage2_extract`；Stage 2 基于摘要 JSON，不重新读取全文。[M02] | 可以移植两阶段职责；摘要阶段遗漏会传播到建图阶段。 |
| Hierarchical concepts | 八类是 `field/direction/subdirection/task/dataset/method/finding/technique`；数据结构为递归 `children`，不是三张固定层级表。[M02–M05] | 类型和层级深度应分开；数据集、发现、方法未必具有严格上下位关系。 |
| Smart Deduplication：synonym、absorption、translation | 独立库模块有 LLM 判定与双语规则，但网页当前路由调用纯字面服务。[M10–M14] | 不应引用 README 证明网页已执行语义去重。 |
| Four methodologies / Research point badges | 服务组织邻域、调用一次 LLM、解析研究点；标签由同一生成过程给出。[M07–M09] | 适合启发性候选，不足以发布“已发现新颖研究空白”。 |
| Neo4j support 在 Roadmap 未勾选 | 当前已存在可由 `USE_NEO4J` 启用的 `Neo4jStore`、`Concept/HAS_SUB` 同步与优先读取。[M01][M17] | README 存在滞后；也不能把旧 `Neo4jGraph` 的全部功能算到当前存储层。 |
| 多 Agent 研究 | 当前 `create_deep_agent` 注册 paper QA、citation、research、deep research 四类 subagent；研究 subagent 调用 `analyze_research_points`。[M19] | 是工具编排与上下文管理机制，未额外提供新颖性证明。 |

## 3. 数据模型：三种对象层面，不是固定三级概念

### 3.1 现行 SQLite 模型

以下是源码事实：[M03–M05]

| 对象/表 | 关键字段与键 | 已表达的语义 | 缺少的证据能力 |
|---|---|---|---|
| `papers` | `doi` 主键；`arxiv_id`；标题/摘要/作者；S2 ID/引用计数等 | 文献身份与书目元数据 | `doi` 在部分入口实际是文件名或 `s2:<id>`，不能假定永远是真 DOI。[M18][M20] |
| `concepts` | `id` slug；`text/text_en/text_zh`；`category/paper_count/depth_cache` | 可跨论文复用的概念节点 | 无独立 mention、词义上下文、原文位置与别名审批记录。 |
| `paper_concepts` | 主键 `(paper_doi, concept_id)`；`confidence/source`；迁移加入 `is_anchor/contribution_role` | 论文关联概念，以及该论文对概念的贡献角色 | 同一论文对同一概念的多个证据 span 不能由该复合键单独表达。 |
| `concept_relations` | 主键 `(parent_id, child_id)`；`relation_type/strength` | 父子层级 | 一对端点只保留一行；没有逐论文来源、多个谓词或正反证据。 |
| `concept_extractions` | `paper_doi/concept_hierarchy/raw_llm_response` | 可保存整棵抽取树与响应 | 两阶段调用返回空 `raw_response`；网页处理入口也未调用保存抽取结果的方法。[M02][M06] |
| `paper_citations` | 引用与被引 ID、S2 ID、标题/年份、`is_internal`；端点对唯一 | 有向引用，包括库外论文 | 没有引用正文、引用意图、页码或引文出现位置。[M04][M15] |
| `research_sessions/research_findings` | 研究会话、发现、JSON sources 等 | 存储研究过程的基础设施 | 表存在不代表 `discover_research_points()` 已保存和核验来源；该函数直接返回结果。[M04][M07] |

`is_anchor` 在 MKG 中表示“概念定位路径上的背景节点”，**不表示 PaperQuay 的文献页码/块级证据锚点**。移植时建议命名为 `isContextConcept` 或 `conceptRole=context`，避免和阅读器 anchor 混用。[M02][M03]

### 3.2 当前分类、旧提示词与旧 Neo4j 模型

当前 Stage 2 的八类概念是一个学术组织启发式，而非形式化本体。它要求父类别严格高于子类别，并承认类别会随论文语境变化；模型解析器只做 JSON 解析与递归对象构造，没有执行这些层级约束。提示词中“先绘制 anchor chain”与最终“anchor 节点不得有 anchor 子节点”的表述也不一致，应在复用时改成可执行、无歧义的规则。[M02][M03]

同一文件还保留旧 `_build_extraction_prompt/_parse_response`，其中是 `field/direction/method/technique/detail` 的旧层级和 `research_questions` 输出示例；现行 `extract()` 不走这两个函数。旧示例中的研究问题不能作为当前两阶段实际抽取结果的证据。[M02]

另一个旧模块 `mkg/neo4j_graph.py` 使用 `KeywordNode(level, category)`、`Paper-HAS_KEYWORD→Keyword`、`Keyword-HAS_SUBKEYWORD→Keyword`。当前服务使用的是 `Neo4jStore` 的 `Concept-HAS_SUB→Concept`。仓库搜索发现旧类仍被 CLI 的 `export --neo4j` 使用；其 `find_gaps/find_connections` 的定义不能据此推断网页研究点服务会调用它们。[M16–M18]

### 3.3 关系方向与类型限制

SQLite `concept_relations` 的字段与调用方式是 `parent_id → child_id`，但默认字符串叫 `is_subconcept_of`，容易被误读成“source 是 target 的子概念”。当前 Neo4j 用 `parent-HAS_SUB→child`，网页图数据则投影为 `parent-child`。集成时应固定一种方向，例如 `child-subconcept_of→parent`，并在适配器显式换向。[M04][M05][M17][M21]

论文、任务、方法、数据集、发现不宜全部强制压进上下位树。例如 `method uses_dataset dataset`、`method evaluated_on task`、`finding supported_by experiment` 是类型不同的关系，不能仅凭树父子位置推出。MKG 当前没有从正文抽取这类任意带证据的科学关系三元组流水线。[M02–M05]

## 4. 概念与实体抽取的真实流水线

### 4.1 可复用机制

Stage 1 读取标题、至多 5 名作者、前 1000 字符摘要及前 50,000 字符正文，要求给出一句话摘要、研究语境、已有缺口、1–3 项贡献、方法/结果摘要、背景概念与新概念。Stage 2 接收 Stage 1 JSON，生成简短的 anchor path 和贡献子树，并设置 `proposed/improved/applied/analyzed`。`ConceptTree` 同时支持英文和中文名称，并优先用英文生成 slug。[M02][M03]

**适用条件：**正文解析质量足够、目标是整理论文贡献与概念导航、用户愿意审核概念归一。把“论文自称提出”记录为待审 assertion，比直接改成“历史上首次提出”可靠。Stage 1 提示词虽然要求点名最接近工作，但没有自动检索那些工作验证其比较。[M02]

Stage 2 有 `existing_concepts` 参数与复用已有概念名称的提示；现行网页 `ProcessService.process_paper()` 和 CLI `process` 调用 `extract(content)` 时均未传入它。因此“支持传入图谱上下文”和“默认处理会利用已有图谱避免重名”是不同事实。[M02][M06][M18]

### 4.2 持久化链路断点

当前网页链路为：

```text
/api/papers/process[-single/-batch]
  → ProcessService.process_paper
  → PDFParser.parse → 元数据增强 → extractor.extract
  → _save_concepts → 标记 processed
```

**源码事实：**`_save_concepts()` 定义了两个内部函数。`save_node()` 只调用 `db.concepts.add({text, category})`，没有递归、写 `paper_concepts` 或写关系。另一个 `collect_node()` 虽收集节点、关系及论文概念集合，却没有被入口调用；其子递归又调用 `save_node(child, ..., depth + 1)`，这里 `depth` 也不在该函数参数/局部作用域。实际末尾只调用 `save_node(hierarchy)`。所以即便模型返回完整树，此网页路径也不能据此认为整棵概念树和论文关联已经保存；`concepts_count` 来自另一次遍历内存树的计数。[M06]

**另一条已定义链路：**CLI 的 `graph.build_from_paper()` 调用兼容层 `build_concept_tree_from_paper()`，后者确实递归写概念、论文关联（含贡献角色）与父子关系；CLI 还保存抽取树。[M05][M18] 本报告没有实际执行该链路，不能据静态存在宣称 CLI 全流程已通过运行验收。

### 4.3 证据定位缺口

1. `ConceptTree` 没有 `paperId/pageIndex/blockId/charStart/charEnd/quote` 字段，`confidence` 是模型给定或默认的数字。[M03]
2. Stage 1 读截断全文，Stage 2 只读摘要；若贡献或限制出现在被截掉部分，后续阶段没有自动补读机制。[M02]
3. 两阶段 `extract()` 明确返回 `research_questions=[]`、`raw_response=""`。这不是“抽取出的研究问题尚未展示”，而是现行返回值没有提供它们。[M02]
4. JSON 解析只处理语法，未证明贡献归属、否定/条件范围、数值结果或首次提出等语义正确。相关 integration 测试的文件说明也明确使用 mock LLM；不能把这些测试当作实证抽取准确率。[M02][M22]

**建议：**在摘要阶段先输出“主张＋原文 span＋角色＋适用条件”，再由建图阶段引用这些 span；不允许第二阶段凭摘要重新制造证据。保存阶段 1/2 原始响应、模型标识、提示词版本、内容哈希、解析版本；没有原文位置的概念只作为候选，不赋予“已证实”状态。

## 5. 去重：必须区分现行网页服务与独立库模块

### 5.1 当前网页服务

`/api/concepts/dedup/scan` 和 `/dedup/execute` 注入 `DedupService`。[M10] 其扫描逻辑：[M11]

- 按 `category` 分组，同类内两两枚举。
- 完全相同或字符串包含直接成为候选；否则使用**字符集合 Jaccard**，阈值 `>0.7`。这不是 token embedding，也不是序列相似度。
- `_compute_confidence()` 对完全相同给 0.95；包含关系给 0.85 或 0.7；其他情况按字面规则给分。只为 `>=0.6` 的候选建建议。
- 每批 10 对是进度组织方式，没有模型判定步骤。`high_confidence_count` 统计阈值为 0.9，不能解读成模型概率或已自动执行合并。
- 目标节点按 `paper_count` 较大者选择；合并需要传入被选中的 `merge_ids`。

**静态运行阻断：**`_SCAN_COLUMNS` 不包含 `concepts_scanned` 和 `estimated_time`，但 `_run_scan()` 的批次更新与完成更新都会把这些键交给 `_update()`；后者对非白名单键抛 `ValueError`。非空批次会在第一次进度更新失败，空候选也会在完成更新失败。此版本不能把这条路由描述成已验证可运行的语义扫描服务。[M11]

**合并数据完整性问题：**服务的 `execute_merge()` 从 `concepts.get_papers()` 得到 `SELECT p.*` 的论文行，却读取 `p.get("paper_doi")`；正常该表主键名为 `doi`。之后它删除 source 关联，并直接相加两个计数，而非按目标的去重论文集合重算。该路径也没有调用独立 `MergeExecutor` 的循环检测和合并历史逻辑。[M04][M05][M11] 这是静态可见的数据契约不一致，未在真实数据库上复现。

### 5.2 独立 `mkg/dedup/` 模块

| 部件 | 实际实现 | 可借鉴部分与限制 |
|---|---|---|
| `CandidateGenerator` | 同类别内 `SequenceMatcher`，基础阈值 0.6；另有高相似 0.9 与文本包含预筛选。[M12] | 便宜召回与高成本判定分开；但字符差异大的翻译、缩写可能在进入 LLM 前就被漏掉。 |
| `MergeAnalyzer` | 提示词区分 synonym/absorption/bilingual，禁止上下位、平行和部分重叠误合并；Pydantic 验证响应，检查 pair/target ID。[M13] | “宁可不合并”及端点校验值得保留；未验证这些提示约束能否稳定执行。 |
| `ConceptDeduplicator.scan()` | 调 `generate_candidates()` 再交给 analyzer；该同步扫描没有使用 `generate_candidates_with_prefilter()`。[M14] | 预筛选函数存在，不等于扫描入口默认执行高相似快捷分支。 |
| `MergeExecutor` | 单事务迁移论文关联、合并父子关系、循环检测、删 source、写 `merge_history`。[M14] | 借鉴事务和审计轨迹；其关联迁移 SQL 只复制 confidence/source，没有复制较新的 `is_anchor/contribution_role`。 |

`CandidateGenerator.check_text_containment()` 将任意较短包含串视为可吸收，可能把“强化学习”和“多智能体强化学习”误判为等价；而 `MergeAnalyzer` 的提示词恰好禁止该例。这说明规则分支与语义分支不是天然一致的。[M12][M13]

**集成建议：**把 exact alias、近义、上下位、相关四种结果分开。字符包含只能生成候选；跨语言/缩写需别名词典或语义召回及上下文审核。合并应保留 mention、证据和历史 ID 重定向，能回放/撤销；不得用同一个未经校准的 `confidence` 同时表达词面相似、概念等价和人工确认。

## 6. 文献关系发现与共现的真实实现

### 6.1 引用网络

`build_citation_graph()` 对有 S2 ID 的论文分别获取至多 200 条参考文献与 200 条被引论文，用 S2 ID 映射到本地论文键；未在库内的节点保留外部 ID，设置 `is_internal=False`。`get_citation_graph_data()` 可以把外部源和目标也构造成节点。这一点比仅展示库内引用更适合文献扩展。[M15]

限制：

- S2 wrapper 只请求 `paperId/title/year/citationCount/authors`，返回时只保留论文对象，没有请求/保存 citation `contexts/intents/isInfluential`。[M20]
- 每篇刷新前先删除所有与该论文相连的旧引用，API 失败不恢复旧快照；在引用完整性重要时应改为成功抓取后原子替换。[M15]
- 图谱邻接表没有“抓取完成/被截断/缺正文/匹配不确定”的证据状态，因此无边不能解释成无引用或没有相关研究。[M04][M15]

### 6.2 共现与“研究空白”查询

**有代码，但属于旧模型：**`Neo4jGraph.find_connections()` 查找同一 `Paper` 通过 `HAS_KEYWORD` 连接的两个 `Keyword`，用 `k1.id < k2.id` 去掉反向重复，按 `count(p) >= 2` 排序，最多 20 对。`find_gaps()` 找 `level <= 2` 且子节点数量 `<=1` 的关键词，按论文数排序。[M16]

这不是经过统计显著性校正的关联发现，也不是文本关系抽取：没有控制概念流行度、文献长度、背景概念共现、时间或多重比较。旧 `level <=2` 只是在该查询中选取浅层节点，**不证明现行系统固定只有三级概念**。

固定版本的当前 `ResearchService` 和 `Neo4jStore` 没有调用这两个方法；研究服务取结构再拼提示词。可以复用“共享文献形成候选概念对”的思路，但应另行实现到当前模型，并把共现计数、支持论文及正文证据一起返回。[M07][M16][M17]

**适用条件：**同一论文集合内的主题导航、跨分支阅读候选。若要把它升级成科研关系，应在支持论文中查明 `uses/compares/improves/contradicts` 等语义；共现本身不蕴含因果、支持或方法可迁移。

## 7. 图谱推理、研究空白与新问题发现

### 7.1 研究点入口的确切调用链

```text
GET /api/concepts/{id}/research-points
  → ResearchService.discover_research_points
    → 父/子/兄弟/祖先/后代/叶子/关联论文
    → _build_research_prompt
    → llm.invoke（带重试）
    → _parse_research_points
    → 返回 research_points + analysis_context

Agent research-discoverer
  → analyze_research_points
  → 同一个 ResearchService.discover_research_points
```

路由、Agent 工具与 subagent 可直接对照：[M07–M09][M19]。因此网页与 Agent 共享假设生成服务，是值得保留的复用方式。

### 7.2 图结构上下文到底包含什么

| 内容 | 实际取法/上限 | 对输出的影响 |
|---|---|---|
| 兄弟概念 | 共享父节点，去重后前 10 个 | 未按目标相关性或覆盖度排序。 |
| 叶节点 | 扫所有概念，选无子节点者，排除焦点，前 15 个 | 没有计算图距离；提示词称“远端节点”不代表实际遥远。原概念列表按论文数排序，存在流行度偏置。[M05][M07] |
| 祖先 | 每次取当前节点所有父节点加入结果，但只沿第一个父节点继续；最后取前 5 个 | 多父图并未完整向上遍历，也不是排序好的完整根路径。 |
| 后代 | BFS，最多深度 5，结果取前 10 个 | 截断会改变对分支稀疏/密集的判断。 |
| 关联论文 | 取前 5 篇，构造标题、前 500 字符摘要、关键词 | 最终提示词只序列化标题与关键词，摘要被丢掉。 |
| `research_questions` | 提示词中该键的值实际来自 `p.get("keywords", [])` | 不能称为“论文已抽取研究问题”；是关键词被重命名。[M08] |

以上均来自 `[M07][M08]`，不是对模型内在能力的猜测。

### 7.3 四种方法论是什么、缺少什么

| 方法论 | 提示词中的启发 | 固定版本未完成的检验 | 在 PaperQuay 中合理的产物 |
|---|---|---|---|
| Gap filling | 两个应相关的分支没有连接 | 未计算“应相关”的预期、候选全集或已发表工作的覆盖率 | “当前库内待核验联系”，附分支、支持论文和待检索 query。 |
| Leaf extension | 把具体叶节点应用到其他分支 | 未确认叶子是技术而不是数据集/发现，也未验证兼容条件 | 明确方法、目标任务、约束条件的迁移假设。 |
| Bottleneck | 子节点多而兄弟少 | 未实现阈值/计数触发器，也未验证是否存在可测量性能瓶颈 | 需要实测与综述证据支持的瓶颈候选。 |
| Transfer | 成熟方法迁移到未解问题 | 未确认方法成熟、目标未解、输入/输出/假设相容 | 有最近邻工作对照、失败条件和最小实验的研究问题草稿。 |

四个类别在同一个提示词中请求生成 3–5 个方向，输出 `title/hypothesis/description/discovery_method/rationale/related_concepts/difficulty/novelty/potential_impact`。JSON 解析分支没有验证枚举、概念 ID、引文证据或研究点数量；`[:5]` 只在非 JSON 文本兜底分支执行。[M08]

### 7.4 不能据此宣称“推理完成”或“通过新颖性验证”

**源码事实：**此研究服务没有在输出研究点后执行外部检索、最近邻工作比较、去重排除、反例搜索或实验验证；`s2_client` 在另一个 `search_papers_by_concept()` 方法才参与检索。Agent 的推荐工具也只是按概念英文名或概念名调用 S2 搜索，不能保证每个研究点都经过查新。[M07][M19]

**判断：**图遍历与共现是结构运算；让 LLM 阅读结构并写理由是生成性推断。它们有探索价值，但没有逻辑规则的 soundness 保证，也没有证明知识库完整的机制。Neo4j `HAS_SUB` 存储本身不会赋予关系传递、矛盾检测或科研新颖性判断能力。

“论文报告的既有缺口”“当前个人文库没连接的关系”“截至某日期检索仍未找到的工作”是三种不同状态。只有最后一种包含外部检索范围的可审计说明，且仍应标记为候选新颖性，不能由无边或模型自评分直接升级为全球空白。

## 8. 可直接支撑改进的一手文档

本节选择已读取的官方规范，补齐上游缺口；不重复主任务正在进行的论文评述。

| 一手来源 | 可核实事实 | 对 MKG 的对照与适用条件 |
|---|---|---|
| [Semantic Scholar 官方 API 概览](https://www.semanticscholar.org/product/api)；[Graph API OpenAPI](https://api.semanticscholar.org/graph/v1/swagger.json)；[可读 API 文档](https://api.semanticscholar.org/api-docs/graph) | `/paper/{paper_id}/references` 与 `/citations` 支持分页和 `fields`；Citation/Reference schema 有 `contexts/intents/contextsWithIntent/isInfluential`。`next` 标明下一页，结果不应默认视为完整。 | MKG wrapper 未利用这些证据字段。[M20] 可把引用拓扑升级为附上下文的关系候选；字段缺失应记为 unknown，API 文本片段也不自动等于本地 PDF 页码。 |
| [W3C SKOS Reference §5、§8、§10](https://www.w3.org/TR/skos-reference/) | 区分 `prefLabel/altLabel`、`broader/narrower/related` 与 `exactMatch/closeMatch`。规范明确 `closeMatch` 不传递，`exactMatch` 具有传递性。 | 适合概念名、别名、上下位与跨词表映射的契约；可在 SQLite 实现相同区分，无须先迁移 RDF。不要把近义候选视为永久身份相等。 |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/) | 以 Entity、Activity、Agent 表达溯源，`wasDerivedFrom/used/wasGeneratedBy/wasAssociatedWith` 能串起来源与生成过程。 | 适合“原文块 → 模型抽取 → 候选主张 → 人工审核”过程。PROV 表达来源，不保证主张为真；应另存支持/反驳和审核结果。 |
| [W3C SHACL](https://www.w3.org/TR/shacl/) | 以 shapes 对 data graph 验证条件并输出验证结果，是结构验证规范。 | 可借鉴其“显式约束＋可报告违规”的机制，验证端点类型、字段必填与基数。若仍使用 SQLite/TS，先用等价程序约束；结构通过不等于语义蕴含或查新通过。 |

访问核验日期均为 2026-11-11；官方 API 为动态文档，其字段和配额需在实际集成时重新确认。

## 9. PaperQuay 集成建议

### 9.1 已确认的本地边界

以下采用主任务提供的本地源码与隔离测试审计结果，不再扩展本地调查，均以 PaperQuay `ba3b410` 为准：

- 外部 MCP 25 个工具没有 graph 工具；图谱三个只读工具属于内置 Agent。外部研究流程不能假定这些工具已经可调用。
- 后端抑制库外引用节点，只投影库内 `cites`；外部文献发现需要单独的数据层/候选队列。
- AI 关系建议最多 60 个节点，论文/笔记文本分别截到 1200/1000 字符；已有 paper pair 的任意边会抑制新增 AI 关系。这不足以支撑细粒度正文关系抽取，也可能阻止同一对论文上的多关系表达。
- 当前共享标签/分类缺边 loader 未传 `embeddingPairs`；函数支持该参数不能当作当前检索已用向量候选的证据。
- `rag_document_vectors` 标识只有 `document_key + dimension`，缺少 `model_key`，同维模型混用是集成前需要处理的风险。
- local graph 先构建全图再 BFS；前端/工具给了局部范围不等于后端只计算局部图。

本地源码永久链接供主任务复核：[图谱后端](https://github.com/Dongyurocket/PaperQuay/blob/ba3b410f6eb2f53d2abaa7cccb5dba1c88aec019/electron/backend/knowledgeGraphCommands.cjs)、[只读图查询](https://github.com/Dongyurocket/PaperQuay/blob/ba3b410f6eb2f53d2abaa7cccb5dba1c88aec019/src/services/agentGraphQuery.ts)、[图谱探索 loader](https://github.com/Dongyurocket/PaperQuay/blob/ba3b410f6eb2f53d2abaa7cccb5dba1c88aec019/src/services/agentGraphExplore.ts)。上游机制的评估不依赖把这些边界描述为已修复。

### 9.2 优先级与适用条件

| 优先级 | 建议机制 | 复用点 | 先决条件/验收 |
|---|---|---|---|
| P0 | 证据主张层 | 两阶段贡献边界抽取 | 每条 assertion 引用已保存原文块；保存否定、条件、抽取版本；点击能跳原文。不得以概念 anchor 冒充页码 anchor。 |
| P0 | 关系类型与状态分开 | 上游论文—概念及贡献角色 | 同一对端点允许多个谓词和多个证据；区分 observed/extracted/inferred/hypothesis、pending/accepted/rejected。模型分数与人工状态分开。 |
| P0 | 向量模型身份与索引完整性 | 关系候选召回的基础 | 模型、版本、维度、预处理一致才可比较；缺页/未索引/检索截断要出现在 coverage 中。 |
| P1 | 概念归一候选 | 别名＋语义判断＋事务合并 | 审核同义与上下位，覆盖缩写/翻译/同名异义；保存 mention 和旧 ID，避免误合并丢来源。 |
| P1 | 可解释候选路径 | 共享概念/文献共现＋引用外扩 | 每条推荐显示支持论文、路径及可用原文；库外论文保留身份与来源，不直接冒充已入库文献。 |
| P1 | 研究问题草稿 | 四种启发式作为生成模板 | 先计算/记录候选路径，再读两侧正文；产出明确问题、适用条件、最小实验与失败判据。 |
| P2 | 新颖性核验任务 | 补足上游没有的检索闭环 | 对每个问题保存查询、来源、时间、最近邻论文、差异表、反证与 unresolved 项；不使用模型自评分作查新结论。 |
| P2 | 更大规模图查询或 Neo4j 投影 | 上游可选图存储 | 先测局部查询成本、稳定身份/证据 schema，再决定是否迁移。图数据库不能替代证据和查新。 |

### 9.3 建议最小数据契约（设计提案，未实施）

```text
Concept(id, preferredLabels, aliases, kind, scope)
Mention(id, conceptId?, paperId, blockId, pageIndex?, span, quote, contentHash)
Assertion(id, subjectId, predicate, objectId,
          epistemicType, reviewStatus, conditions, polarity,
          extractionRunId, modelScore?)
AssertionEvidence(assertionId, mentionId, role=supports|contradicts|context)
ExtractionRun(id, modelKey, promptVersion, parserVersion, inputHash, createdAt)
ResearchQuestion(id, hypothesis, candidatePaths, assumptions,
                 closestWorks, noveltyStatus, verificationRunId)
VerificationRun(id, queries, providers, searchedAt, coverage, retrievedIds,
                comparison, counterevidence, unresolved)
```

身份沿用 PaperQuay 的内部 `paperId`，DOI/arXiv/S2 作为外部标识；概念不要以可变译名或短 slug 作为唯一事实身份。`predicate` 与证据角色分开：文献中的“supports”论述是待抽取的学术关系，而 `AssertionEvidence.role=supports` 描述证据是否支持这条 assertion。

建议先复用现有解析块和笔记概念页，只新增候选与证据存储；现有 Tiptap 正文及锚点继续由笔记系统管理。研究点先作为只读报告；需要写关系、改概念归一或写笔记时生成可审核计划。外部 MCP 能力应显式扩展协议，不在研究脚本中假定现有 graph 接口。

### 9.4 最小评估方案

这是后续实施建议，不是本次已得到的实验结果：

1. **抽取/归一：**选一个边界明确的主题，人工标注背景/贡献、实体、谓词、原文位置；包含缩写、双语、上下位、否定和条件句。分别评估贡献归属、关系准确率、证据定位准确率与错误合并率。
2. **关系发现：**对比当前标签/分类缺边、纯文本召回、概念共现与“类型关系＋原文证据”；在相同候选数量和模型预算下评估人工确认率、检索覆盖、延迟/成本，而非仅比较图上新增边数。
3. **新问题：**做时间切分或已知工作遮蔽，检验系统能否找到最近邻和否定“伪空白”；将 originality、可行性与证据充分性分别评分。单次时间切分不能完全排除模型预训练知识泄漏，报告模型版本与检索时间。
4. **溯源/失效：**更新 PDF 解析或模型时，检查旧 assertion 是否能检测输入版本变化；误合并可恢复，来源删除能标记相关主张 stale；每个研究建议能回溯到实际使用的证据和查询日志。

## 10. 审计证据索引（固定 commit permalink）

以下行号定位到本次读取的关键实现；无分支浮动链接。

- [M01 README：功能、八类概念与四类方法论](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/README.md#L39-L243)；[Roadmap 的 Neo4j 状态](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/README.md#L376-L407)。
- [M02 两阶段提示词、输入截断与 extract 返回值](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/concept_extractor.py#L9-L416)；[旧单阶段提示词与解析器](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/concept_extractor.py#L418-L708)。
- [M03 ConceptTree 与 LLMExtractedContent 数据类](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/pdf_models.py#L8-L144)。
- [M04 SQLite 核心 schema](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/database/schema.py#L15-L105)；[贡献角色迁移](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/database/schema.py#L198-L207)；[引用与研究会话 schema](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/database/schema.py#L343-L490)。
- [M05 ConceptRepository：创建、关系、取论文与抽取记录](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/repositories/concept_repo.py#L18-L473)；[兼容层递归建图](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/database/compat.py#L654-L727)。
- [M06 网页处理服务及未接通的持久化收集器](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/services/process_service.py#L19-L198)；[处理路由](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/routes/papers_process.py#L94-L137)。
- [M07 研究点上下文、遍历与模型调用](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/services/research_service.py#L25-L209)。
- [M08 研究点提示词、关键词改名及解析器](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/services/research_service.py#L212-L354)。
- [M09 研究点与论文搜索路由](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/routes/concepts_research.py#L15-L39)。
- [M10 当前去重路由调用 DedupService](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/routes/dedup.py#L10-L56)。
- [M11 当前网页去重扫描、字段白名单与合并](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/services/dedup_service.py#L17-L390)。
- [M12 独立字面候选生成与包含预筛选](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/dedup/candidate.py#L18-L165)。
- [M13 独立 LLM 合并判定及响应验证](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/dedup/analyzer.py#L30-L288)。
- [M14 独立去重协调器](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/dedup/deduplicator.py#L60-L145)；[事务合并、循环检测与历史](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/dedup/executor.py#L45-L226)。
- [M15 引用图构建、外部节点与刷新方式](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/citation_graph.py#L11-L312)。
- [M16 旧 Keyword/level 模型](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/neo4j_graph.py#L16-L43)；[旧 find_gaps/find_connections](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/neo4j_graph.py#L428-L456)。
- [M17 当前 Neo4j 启用条件](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/database/core.py#L203-L213)；[Concept/HAS_SUB 同步](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/neo4j_store.py#L55-L125)。
- [M18 CLI 抽取/建图/保存入口](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/cli.py#L100-L150)；[旧 Neo4j 导出入口](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/cli.py#L310-L329)。
- [M19 当前 DeepAgent 与 subagent 注册](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/agent/agent.py#L21-L71)；[研究 subagent](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/agent/skills/research.py#L1-L24)；[研究点工具及推荐工具](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/agent/tools.py#L294-L395)。
- [M20 S2 引用/参考文献字段选择](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/mkg/semantic_scholar.py#L631-L730)；[s2: 标识用作本地键的入口](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/routes/papers_process.py#L140-L165)。
- [M21 当前图数据路由的父子投影](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/backend/routes/graph.py#L40-L108)。
- [M22 两阶段 integration 测试的 mock 范围](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/tests/test_concept_extraction_integration.py#L1-L22)。
- [M23 MIT License](https://github.com/Seaual/meta-knowledge-graph/blob/9aee684925f8c7429bb3a693d571e174f2b85326/LICENSE#L1-L21)：可复用代码需保留版权与许可文本；本次未复制上游实现进入 PaperQuay。

## 11. 本次交付范围

本附件与[主计划](../plans/2026-11-11-knowledge-graph-research-discovery-plan.md)共同交付。上游克隆位于 PaperQuay 工作区之外，本轮未修改应用源码、配置或个人数据库。文中上游问题是固定版本的静态审计发现；尚未运行验证的结论已明确限定，不代表后续版本仍然如此。
