# RAG 角标、过期索引重建与侧栏问答无回复修复计划

- 日期：2026-11-25
- 状态：**已实施（0.4.40，2026-11-25）**。阶段 0–5 全部完成；变更记录见 [2026-11-25 RAG 角标、过期索引暂存重建与问答静默丢弃](../changes/2026-11-25-rag-stale-rebuild-and-qa-silent-drop.md)。
- 代码基线：`main` `0dc2f38`（0.4.39）
- 关联：[2026-11-22 公式检索修复](2026-11-22-reader-rag-formula-retrieval-fix.md)（引入 `mineru-chunks-v3`）、[审计剩余清单](2026-11-23-audit-remaining.md)（第 4–12R 批 `415ce9b`）
- 用户决定：过期索引同时支持 A（打开/提问时懒重建）与 B（批量更新）；重建后旧索引不保留；整理存储手动触发；懒重建期间先用旧索引回答。

## 1. 现象与根因

| # | 现象 | 根因 | 证据 |
| --- | --- | --- | --- |
| P1 | 启动后已索引文献显示「RAG 未索引」，打开再关闭后变「已索引」 | `415ce9b` 起 `allKnownItems` 只含已打开文献，角标表 `ragBadgeByDocumentKey` 仍按 `allKnownItems` 生成；未打开文献无条目，列表回落 `'none'` | `Reader.tsx:328`、`useReaderRagIndexActions.ts:117-141`、`LiteraturePaperList.tsx:653-658`；库中该文献两条来源均 `ready` |
| P1' | 设置页「知识库索引管理」统计偏少；「为未索引文献建立索引」常提示无候选 | 同上，`summarizeRagIndexOverview` / `selectRagIndexCandidates` 也只遍历 `allKnownItems` | `useReaderRagIndexActions.ts:143-197` |
| P2 | 提问时其他文献会先重新索引 | `1283d82` 把 `MINERU_RAG_EXTRACTOR_VERSION` 升到 v3，签名变化触发懒重建（设计如此）；角标只看 `status` 不看签名，批量入口跳过签名不一致项 | 189 条 ready 的 MinerU 索引：v2 184、v3 2、其他 3 |
| P3 | 打开文献后在侧栏提问，没有回复也没有报错（本文献索引完好） | **根因假设**：新开标签时子组件 `effect_244` 先把恢复的会话写入 store，父组件 `Reader.tsx:267` 的 effect 用渲染时的空 `readerQaSessions` 再写一个新会话覆盖；`effect_245` 因 `qaSessions !== expected.qaSessions` 永不确认，`qaHistoryReadyWorkspaceRef` 停在 `''`。之后 `isRequestCurrent()` 恒为 false，`handleSubmitQa` 在 `useReaderQa.ts:634` 静默 `return` | `useReaderQa.ts:587-594,634,767-830`、`Reader.tsx:264-282`、`DocumentReaderTab.tsx:117-118` |
| P4 | 重建会删旧数据，但不释放磁盘，失败时丢失整篇索引 | `indexDocument` 签名变化时在第一批就 `deleteDocumentSourceData`；重建期间该文献无可用索引；中途失败 `reportFailure` 再清空，例如已有 7 条 `HTTP 402` 余额不足。SQLite `auto_vacuum=0`，删除只进空闲页 | `indexing.cjs:516-546,623-650`；库 8.6 GB，空闲页 202,584 × 4 KB ≈ 0.83 GB |

P3 的附带影响：`saveCurrentPaperHistory` 也要求 `qaHistoryReadyWorkspaceRef` 就绪（`useReaderDocument.ts:271`），所以这类标签的问答历史和阅读位置都不会保存。阶段 0 先用测试复现，确认后再改。

## 2. 目标与非目标

目标：
- 角标、统计、批量候选覆盖全库，且不恢复启动时构造全库 `WorkspaceItem`。
- 过期索引有独立状态「RAG 待更新」，可懒重建，也可批量更新。
- 重建期间旧索引仍可检索；新索引完整写入后原子切换，并立即删除旧数据；失败时保留旧索引。
- 提供「整理索引存储」，把删除后的空闲页还给磁盘。
- 侧栏提问必定有结果：回答、错误提示二选一，不再静默丢弃。

非目标：不改分块算法本身，不改 embedding 服务配置，不迁移 pdf-text 签名规则。

## 3. 排查补充数据（2026-11-25 只读测得）

- 向量表 `rag_vec_4096_vector_chunks00` 占 7.18 GB，实际有效向量 221,893 个 × 16 KB ≈ 3.64 GB。sqlite-vec 0.1.9 默认 `chunk_size=1024`，每个分区（文献 × 来源，共 300 个）按 1024 槽位整块分配，小文献浪费最多。
- 实验：分区内删光再插入会释放旧 chunk 块；只删一部分时块仍占用，槽位可复用。文件层面需要 `VACUUM` 才会缩小。
- 向量只由分块文本和模型决定（`rag_embed_chunks` 只发送 `text`）。抽样 60 篇 v2 文献，v3 共 7,318 个分块，其中 4,992 个（68%）的文本与旧分块完全一致，可以直接复用旧向量，不调用 embedding。
- 7 条 `failed` 的错误都是 SiliconFlow `HTTP 402`（余额不足）。批量更新必须在第一次 402/401 时整体暂停，不能逐篇标失败。

## 4. 方案

### 阶段 0：侧栏问答无回复（P3，最先做）

1. 先写复现测试：模拟新开标签，`effect_244` 恢复历史后父组件写入空会话，断言 `qaHistoryReadyWorkspaceRef` 未就绪、提交被静默丢弃。复现不了就停下，换方向排查，不按假设改代码。
2. `Reader.tsx:264-282` 的「无会话时建初始会话」只在该标签 slice 已完成恢复（`workspaceId` 非空）时执行；`restorePaperQaHistory` 已保证至少一个会话，这一步多数情况下可以删掉。
3. `effect_245` 的就绪判定改为比较 store slice 的 `workspaceId`，不再依赖 `qaSessions` 引用相等；zustand 写入是同步的，恢复后即可确认。
4. `handleSubmitQa` 在 `!isRequestCurrent()` 且未被用户中止时，移除占位消息并显示「会话已切换，请重新发送」，不再静默 `return`。
5. 回归：问答历史与阅读位置能保存（`saveCurrentPaperHistory` 依赖同一个 ref）。

### 阶段 1：角标、统计、批量候选覆盖全库（P1）

1. 角标直接由 `rag_list_index_statuses` 全量结果分组生成，不再遍历 `allKnownItems`；排除态仍由列表按 `paper.ragEnabled` 处理。
2. 统计与批量候选改用轻量候选列表：新增 IPC `library_list_rag_candidates`，只返回 `id / title / ragEnabled / mineruParsed`，不构造 `WorkspaceItem`。如果现有 `libraryPaperStatuses` 已覆盖全库，就直接复用。
3. 批量索引执行到某篇时，再用 `getLibraryPaper` + `createNativeLibraryWorkspaceItem` 按需构造条目，保持 `415ce9b` 的启动优化。
4. 「检查内容/索引管理」面板显示全库口径，数字与文献库角标一致。

### 阶段 2：过期状态「RAG 待更新」（P2）

1. `rag_indexes` 新增列 `extractor_version TEXT`（`ALTER TABLE ADD COLUMN`，旧行为 NULL）。`indexDocument` 写入请求里的版本；mineru-markdown 来源取 `MINERU_RAG_EXTRACTOR_VERSION`，pdf-text 不设版本。
2. 聚合状态新增 `stale`：mineru-markdown 行 `status='ready'` 且 `extractor_version` 不等于当前版本（含 NULL）。`failed` 优先级仍最高。
3. 角标「RAG 待更新」用警示色；统计面板增加「待更新 N 篇」。
4. NULL 不额外做扫描：已经是 v3 的 2 篇在更新时全部复用旧向量，embedding 调用为 0，只补写版本号。`ensurePreparedSourceIndexed` 的 ready 快速路径遇到签名一致、版本为 NULL 时也顺手补写。

### 阶段 3：暂存重建 + 原子切换 + 删除旧索引（P4，A 与 B 共用）

重建流程（新增 `rebuildDocumentIndex`，签名变化与手动「重建索引」都走这里）：

1. **暂存**：新建表 `rag_index_staging(document_key, source_type, source_signature, embedding_model_key, extractor_version, chunk_id, chunk_index, page_index, block_id, text, section_*, embedding BLOB, PRIMARY KEY(document_key, source_type, chunk_id))`。新分块写这里，不进 `rag_chunks` / 向量表，所以重建期间旧索引照常检索。
2. **复用向量**：同一文献同一来源、`embedding_model_key` 相同、`text` 完全相同的旧分块，直接从向量表读出 embedding 写入暂存；只把剩下的分块送 embedding。抽样估计约 68% 免调用。
3. **断点续传**：暂存行按 `source_signature + model` 区分；中断后再次重建只补缺的 chunk_id。签名或模型变了就清空该文献的暂存行重来。
4. **原子切换**（单个事务）：删除该来源全部旧 `rag_chunks` 与向量行，再把暂存行插入 `rag_chunks` 和向量表，`rag_indexes` 写 `ready` + 新签名 + 当前 `extractor_version`，删除暂存行，`rebuildDocumentVectors`。分区先删光后重插，旧向量块随之释放（已实验验证）。旧数据不保留。
5. **失败**：embedding 失败或 402 时不动旧索引，状态仍是 `ready`（角标仍为「待更新」），错误写入新列 `rebuild_error`，供悬浮提示显示；暂存行保留，下次续传。只有首次建立（没有旧索引）时才沿用现有的 `reportFailure`。
6. **清理**：启动时删除签名已不等于对应 `rag_indexes` 行、或文献已被删除的孤儿暂存行。`removeDocumentIndex` 同时删暂存行。

**A：打开/提问时懒重建**
- `resolveLocalRag` 遇到「待更新」来源时，用旧索引立即检索并回答，同时在后台调用 `rebuildDocumentIndex`（复用 `syncIndexing: false` 分支），不阻塞提问。状态栏提示「本次使用旧版索引，后台更新中」。
- 首次建立（无旧索引）保持现在的同步行为。
- 同一文献同时只允许一个重建任务，用内存锁按 `documentKey::sourceType` 去重。

**B：批量「更新过期索引」**
- 入口：设置页「知识库索引管理」与文献库批量菜单。候选为全部「待更新」文献（阶段 1 的全库口径）。
- 开始前弹窗显示篇数、预计需要调用 embedding 的分块数上限，以及复用率说明。
- 逐篇串行执行，复用现有进度条、暂停、取消。遇到 HTTP 401/402/403 立即整体暂停并提示检查余额或 Key，不把后续文献逐篇标失败。
- 完成后提示「已删除旧索引 N 篇；可整理存储释放约 X GB」，X 由 `PRAGMA freelist_count × page_size` 计算。

### 阶段 4：整理索引存储（释放磁盘）

- 设置页新增「整理索引存储」按钮，在 RAG worker 内执行 `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM`，期间其他 RAG 调用排队；需要 `LONG_RUNNING_METHODS` 超时（10 分钟），超过就改为不限时并显示进度文案。
- 执行前检查磁盘剩余空间不少于数据库大小 × 1.1，并提示「需要几分钟，期间无法检索」。
- 不默认开启 `auto_vacuum`：它需要一次完整 VACUUM 才能生效，还会让频繁小删除产生碎片。

### 阶段 5（可选，需单独确认）：缩小向量块

- 现在 7.18 GB 的向量表里约 3.5 GB 是空槽，原因是 `chunk_size=1024` 对小文献按 1024 整块分配。改成 `chunk_size=128` 预计能把向量表降到 3.7–3.9 GB。
- 做法：新建 `rag_vec_4096_v2(chunk_size=128)`，逐文献拷贝向量，原子换名，然后 VACUUM。需要约等于库大小的临时空间，耗时较长。
- 风险：要改 `ensureVectorTable` 的建表语句和维度注册；查询性能需要基准对比。建议等阶段 3 完成、确认重建稳定后再决定。

## 5. 测试与验收

自动化（`npm test` 新增）：
- 阶段 0：标签恢复竞态复现用例；提交被判定为过期时显示错误、不留空占位。
- 阶段 1：未打开文献的角标来自状态列表；统计与候选按全库计算。
- 阶段 2：`extractor_version` 迁移、NULL 视为 stale、聚合优先级。
- 阶段 3：暂存期间检索返回旧分块；切换后旧 chunk、向量、暂存行数为 0；复用向量不触发 embedding（mock 计数）；失败保留旧索引；中断续传；孤儿暂存清理。
- 阶段 4：VACUUM 后 `freelist_count = 0`。

实机（本机库副本，不在原库上试）：
- 先完整备份 `%APPDATA%\PaperQuay\PaperQuay` 下的三个 `paperquay-rag.sqlite*` 文件。App 目前没有切换 RAG 库路径的开关；如果需要隔离验证，先在阶段 3 补一个仅开发模式生效的 `--user-data-dir` 启动参数，再用副本测试。
- 启动后不打开任何文献，角标与 DB 状态逐篇一致（脚本比对）。
- 打开 AAM Tiltrotor，在侧栏提问能回答；再开第二篇、切回第一篇提问仍能回答。
- 对 5 篇 v2 文献批量更新：记录 embedding 调用数、更新前后分块数与磁盘大小；整理存储后文件缩小。

命令：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`。

## 6. 风险与回退

- 原子切换事务在大文献上可能持续数秒（最大约 1.8 万分块）。切换在 RAG worker 中执行，不阻塞 UI；检索请求会排队等待。
- 暂存表会临时占用空间（约等于在途文献的新分块数 × 16 KB），批量是串行的，同时只存在一篇。
- 回退：`extractor_version` 与暂存表都是新增结构，旧版本会忽略；降级不需要迁移。
- `.pqbackup` 备份：暂存表随库一起快照；导入后启动清理会删除孤儿行，不影响恢复。

## 7. 实施结果（0.4.40）

- 阶段 0：`readerQaSessionLifecycle.ts` 固定恢复/可写初始会话的判定；`effect_245` 按 workspaceId 判断恢复落地；提交失效时移除占位并提示重新发送。
- 阶段 1：角标由状态列表全量生成；设置页打开时按需加载全库文献与 MinerU 解析状态；单篇索引按需解析文献条目。
- 阶段 2：`rag_indexes` 新增 `extractor_version` / `rebuild_error` / `rebuild_attempted_at`；聚合状态新增 `stale`；角标「RAG 待更新」。
- 阶段 3：暂存表 + 复用旧向量 + 原子切换 + 断点续传 + 孤儿清理；`ensurePreparedSourceIndexed` 对 ready 旧索引改走暂存重建；`resolveLocalRag` 先用旧索引回答并在后台重建；批量「更新过期索引」遇 401/402/403 立即停止。
- 阶段 4：设置页「整理索引存储」执行向量表重建（`chunk_size=128`）与 `VACUUM`。
- 阶段 5：与阶段 4 合并实施；新维度直接按 128 建表，已整理维度写 meta 标记避免重复迁移。

## 8. 已确认的决定

1. 阶段 5（缩小向量块）纳入本轮，与「整理索引存储」一起执行。
2. 整理存储为手动按钮；批量更新结束只提示可回收空间。
3. 懒重建期间先用旧索引回答，状态栏明确提示。
