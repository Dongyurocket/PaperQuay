# 笔记语义检索：向量 + FTS5 + RRF

## 现象

复审深入方向 3 尚未落地。笔记只能按字面检索，无法稳定召回用词不同但主题相关的提炼正文。MCP 已有 trigram FTS5，但内置 Agent 原来仍调用 `notes_list`。

## 方案原文要求

- 复用阅读器 Embedding 配置与 RAG 基础设施，不新增设置项或第四个数据库。
- 保存、导入、vault 回导后异步增量索引；软删除立即失效；提供手动重建。
- 内置 Agent 与 MCP 同时支持混合检索，保留多关键词 AND、过滤、稳定排序和 LIKE 兜底。
- 锚点、引用节点和原文快照属于证据，不作为向量语料。

## 实际修改

### 存储选址

选择复用 `paperquay-rag.sqlite`：现有 `rag_indexes` / `rag_chunks` / `rag_vec_*` 使用 `source_type='note'`，文档键为 `note:<noteId>`。笔记正文、FTS 与删除标记仍以 `paperquay-notes.sqlite` 为准。

| 维度 | notes 库增加向量表 | 复用 RAG 库（采用） |
| --- | --- | --- |
| 连接管理 | 需要在笔记库另建 sqlite-vec 写连接、扩展加载与生命周期；MCP 原只读连接不能写索引 | 沿用 ragStore 与独立 Worker 管理写入；MCP 查询仍只读打开两个库，不在检索时建索引 |
| WebDAV 备份 | 会随 notes 库备份，但混合正文与可重建向量数据 | 现有备份已上传 library、notes、rag 三库，无需改上传集合；恢复后以正文签名和模型键拒绝失配向量 |
| 迁移复杂度 | 需要复制向量表、状态、维度分表、清理与迁移逻辑 | 扩展既有 source 类型和命名空间即可，不新增数据库或表结构迁移；旧应用不支持 note 来源时不应写回该索引 |

同时为文献全库向量、FTS/LIKE 召回和文献相似关系缓存查询增加来源隔离，避免笔记进入文献结果。

### 查询分层与契约

- 内置链路为 `agentTools.search_notes → services/notes.searchNotes → notes_search IPC → noteCommands`。`noteStore` 负责 FTS/LIKE 与当前可见笔记集合；`noteCommands` 异步生成查询向量，将 KNN 委派 RAG Worker，最后在共享纯逻辑模块按 note ID 做 RRF。不让同步 noteStore 发起网络请求。
- MCP 保留原 `searchNotesKeyword` 作为关键词基线；有配置时通过异步 `embedQuery`（复用既有 mock 注入点）生成查询向量，在只读 RAG 连接查询，与 FTS 候选复用同一融合逻辑。不等待后台笔记索引队列。
- 向量先按当前笔记过滤范围选候选，只接受 `ready`、相同模型键与正文 SHA256 签名的索引。查询异步等待后再次核对可见性与正文签名，旧正文和软删除不会通过旧向量返回。
- MCP `paperId` 保持原来的 `paper_id OR linked_paper_id`；内置 IPC 保持原内置工具的 `paper_id` 精确过滤，`linkedPaperId` 独立过滤。两条路径都保留 `pageKind`，内置还支持 `type` / `tag`。
- 返回 `retrievalMode: 'hybrid' | 'keyword'`，每条笔记包含 `channels: ('vector' | 'fts' | 'like')[]`，混合结果包含 RRF `score` 与顶层 `embeddingModel`。同分向量按 ID 排序，融合复用现有 `rrfFuse`，不额外叠加未经校准的分数。
- `mode='keyword'` 不请求 Embedding。配置缺失/禁用、无匹配索引、接口异常或维度不匹配时使用原关键词路径并附 `warning`；无配置时不弹窗、不记录索引错误、不发网络请求。空查询仍列出关键词排序结果。
- FTS trigram 按空白分词并 AND 组合；任意 token 短于 3 字符、FTS 表缺失或异常仍使用四字段 LIKE。关键词排序保持置顶、更新时间、创建时间、ID。

### 增量索引与手动重建

- `noteStore` 在事务提交后通知索引队列，保存返回不等待 embedding。队列按笔记 ID 合并，执行前读取最新笔记；只有可检索正文签名/模型变化才重新嵌入，标签等元数据更新不重复消费 API。
- 桌面索引通过现有 RAG Worker 执行。MCP 写工具继续先执行现有写入护栏，提交后排队，由按数据目录复用的临时 Worker 索引，空闲后关闭。vault 新建与回导更新复用同一个 noteStore 写入口。
- 删除立即从查询候选集合失效，后台清除对应索引，即使此时没有 Embedding 配置也执行清理。正在执行的旧索引任务不影响查询端删除/签名校验。
- 笔记工作区工具栏增加“重建笔记语义索引”图标入口，显示排队、完成、失败与最后错误。重建枚举全部有效笔记，不受原 `listNotes` 的 5000 篇上限影响，强制刷新当前模型索引。
- 复用 `.settings/paperquay.config.json` 的阅读器配置与秘密字段，不新增配置。索引会将笔记标题和可编辑正文发送到用户配置的 Embedding 端点；检索发送查询文本。测试只使用临时库与 mock 密钥/本地端点。

### Chunk 策略

- 优先读取 Tiptap JSON 的可编辑正文；无 JSON 时读取纯文本/Markdown。整个排除 `noteAnchorBlock`、`noteAnchorLink`、`paperReference`，不读取 anchors/excerpt 等证据属性。
- 排除“原文快照”及英文同义标题下的内容，直到同级或更高标题；Markdown 回退也排除相同区段与锚点链接。
- 正文不超过 900 字符则整篇一条；长文先按标题划分，再优先按段落、句末、空白软断开。超长段落硬切，保留最多 120 字符重叠；各 chunk 带笔记标题，长章节的后续 chunk 保留章节标题。列表和表格保留块间边界。
- 沿用文献 `readerRag.ts` 的 900/120 参数、0.58 软断点阈值和切分优先级。该模块导入渲染层 MinerU/阅读器依赖，不能直接在打包后的 CJS Worker 中加载；本轮仅适配这段小型纯算法，未为复用而改造整条文献提取链。

## 收窄项与理由

- 不在启动或首次查询时批量回填旧笔记，避免未经手动触发的整库网络消费；已有笔记可通过重建入口补齐。模型切换后旧向量自动失效，保存或重建后恢复。
- 增量队列驻留内存，不是持久化任务系统。退出期间未完成的工作可通过手动重建恢复；未实现跨进程任务锁或自动重试调度。
- 为防已删除/越界笔记挤占 Top-K，向量检索对当前符合过滤条件的笔记逐个执行分区 KNN，每篇取最佳 chunk，再按距离排序并取候选。没有笔记数截断，但查询成本随符合条件的笔记数量增长；MCP 这部分 SQLite 查询在服务进程执行，尚未做超大笔记库性能压测。
- MCP `PAPERQUAY_MCP_EMBEDDING=off` 沿用既有“禁用查询向量化”的语义，不新增索引开关；无阅读器配置才整体关闭向量索引与查询。
- 未修改单篇文献元数据写入，不涉及 `INSERT OR REPLACE`；未修改个人 `scripts/`、真实数据库、PDF 或解析产物。

## 验证

- 开工基线：`npm run check` 通过，原有 511 项测试全绿。
- 新增 `tests/noteSemanticSearch.test.ts`：12 项定向测试通过，覆盖证据排除、分块、稳定 RRF、双通道、过滤、软删除、异步期间删除/修改、未配置降级、异常/模型/维度失配、保存增量、元数据去重、全量重建与失败反馈。
- 真实 Worker + 临时 SQLite + 本地 mock HTTP 集成测试通过：保存及更新进入索引，vault 导入进入索引，IPC 可语义召回。未访问真实 Embedding 服务。
- `npm run check` 通过：TypeScript + Vite 构建成功，523 项测试全部通过（原有 511 项 + 新增 12 项），0 失败、0 跳过。构建仍有既有动态导入和大 chunk 提示。

### 手工回归清单

- [ ] Electron 桌面点击重建入口与进度/失败反馈：未做。
- [ ] 桌面连续编辑保存、切换工作区及关闭窗口期间的 UI 状态：未做。
- [ ] 内置 Agent 与外部 MCP 客户端端到端交互：未做；仅验证服务/IPC 自动化调用。
- [ ] 真实 Embedding 服务、真实 vault 双应用编辑与 WebDAV 备份恢复：未做。
- [ ] 超大笔记库召回延迟、内存与重建压力：未做。

本次没有启动桌面端，不能将上述手工项目视为已验证；自动化测试使用隔离临时数据，不触碰个人知识库。
