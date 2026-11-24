# 2026-11-25 - RAG 角标覆盖全库、过期索引暂存重建与侧栏问答静默丢弃

## 现象

1. 升级到 0.4.39 后，启动时已索引的文献在文献库显示「RAG 未索引」；打开再关闭后变为「已索引」。
2. 设置页「知识库索引管理」的统计偏少；「为未索引文献建立索引」经常提示没有候选。
3. 提问时部分文献会先重新向量化；角标仍显示「已索引」，用户无法预期。
4. 在侧栏提交问题后没有回答、也没有报错；消息留在会话里。
5. 重建索引会先删除旧索引，重建期间该文献不可检索；中途失败（如 embedding 余额不足）会连旧索引一起丢失。SQLite 删除后文件不缩小。

## 根因

- 0.4.38（`415ce9b`）为启动性能取消了全库 `WorkspaceItem` 构造，`allKnownItems` 只含已打开文献；文献库角标、统计和批量候选仍按它计算，未打开文献在角标表里没有条目，列表回落为 `none`。
- `1283d82` 将 MinerU 抽取器升级为 `mineru-chunks-v3`，`rag_indexes` 只记录签名、不记录抽取器版本；角标只看 `status='ready'`，无法区分「已索引」和「旧规则索引」。
- 新打开标签时，`DocumentReaderTab` 的 `effect_244` 先恢复历史到 zustand，父组件 `Reader` 的 effect 用渲染时的空会话快照判断「没有会话」，又写入一个初始会话覆盖恢复结果；`effect_245` 比较会话数组引用，永远不成立，`qaHistoryReadyWorkspaceRef` 保持空。`handleSubmitQa` 在 `isRequestCurrent()` 为 false 时直接 `return`，回答被静默丢弃，空占位也不显示。
- `ensurePreparedSourceIndexed` 在签名变化时走 `indexDocument` 直写路径：第一批写入前 `deleteDocumentSourceData` 删除旧分块和向量；失败时 `reportFailure` 再清空一次。
- `rag_vec_*` 使用 sqlite-vec 默认 `chunk_size=1024`，每个文献×来源分区至少分配 1024 个槽位；本机 300 个分区分配 7.18 GB，有效向量仅 3.64 GB。删除只释放分区内的槽位，文件层面需要 VACUUM。

## 修改

- **角标与统计（阶段 1）**：`ragBadgeByDocumentKey` 直接由 `rag_list_index_statuses` 全量结果分组生成，覆盖全库；设置页打开时按需加载全库文献条目与 MinerU 解析状态（路径探测分批执行），统计与批量候选改为全库口径。单篇索引在条目未加载时通过 `library_get_paper` 按需解析。
- **过期状态（阶段 2）**：`rag_indexes` 新增 `extractor_version`、`rebuild_error`、`rebuild_attempted_at`；mineru-markdown 写入抽取器版本。聚合状态新增 `stale`：ready 但版本不一致（含旧数据 NULL）或 embedding 模型不一致。文献库角标显示「RAG 待更新」，详情面板菜单改为「更新过期索引」。签名一致但版本为 NULL 时只补写版本号，不重新嵌入。
- **暂存重建（阶段 3）**：新增 `rag_index_staging` / `rag_index_staging_meta` 与 `prepareStagedRebuild`、`stageReusedChunks`、`stageEmbeddedChunks`、`commitStagedRebuild`、`failStagedRebuild`、`discardStagedRebuild`。新分块先写暂存；文本完全相同的分块直接复制旧向量；提交在单个事务里删除旧分块/向量、写入新数据、更新状态并清空暂存。签名或模型变化时暂存自动作废重来；中断可续跑；失败只记录 `rebuild_error`，旧索引保持 ready。启动清理孤儿暂存行。
- **懒重建（A）**：`resolveLocalRag` 在旧索引可用但签名/版本变化时，先用旧索引检索回答（状态栏提示「本轮使用旧版索引，新版索引后台更新中」），后台按暂存流程重建；同文献同来源并发重建去重。
- **批量更新（B）**：新增 `handleBatchRagIndex({ onlyStale: true })` 与设置页「更新过期索引」按钮，复用进度条、暂停、取消；遇到 HTTP 401/402/403 立即整体暂停，不把后续文献逐篇标失败。
- **整理存储（阶段 4/5）**：设置页新增「整理索引存储」。worker 内把每个维度向量表重建为 `chunk_size=128`（普通表暂存 → 删旧表 → 原名单建 → 导回，规避 vec0 不支持 RENAME 的问题），随后 `wal_checkpoint(TRUNCATE)` + `VACUUM`。新维度直接按 128 建表；已整理维度写入 meta 标记，不重复迁移。
- **侧栏问答（阶段 0）**：`Reader` 的无会话兜底只在标签 slice 已恢复（`workspaceId` 非空）时执行；`effect_245` 按 slice 的 `workspaceId` 判断恢复完成，不再比较会话数组引用；提交时若请求已失效，移除空占位并提示重新发送，不再静默丢弃。判定逻辑抽到 `readerQaSessionLifecycle.ts` 并有单测。

## 验证

- `npm run typecheck` 六个项目 0 诊断；`npm run lint` 0 error / 206 warning；`npm run build` 通过。
- `npm test` 1,500 项：1,491 通过、9 跳过、0 失败。新增 `tests/ragStagedRebuild.test.ts`（复用向量、原子切换、失败保留旧索引、暂存作废、存储整理）与 `tests/readerQaSessionLifecycle.test.ts`（恢复竞态守卫），并扩展 `tests/ragIndexStatus.test.ts` 的 stale 聚合与 `onlyStale` 候选。
- 本机只读排查：`paper_mufwwou2_5a014354` 两条索引均为 ready（133 / 94 分块），MinerU 与 PDF 文本签名与磁盘内容重算一致；189 条 mineru ready 中 184 条为 v2、2 条为 v3、3 条无法比对。
- 真实库副本验证（`VACUUM INTO` 快照 7,788,318,720 字节，2026-11-25）：
  - `createRagStore` 打开后新增列迁移完成，`listIndexStatuses` 返回 307 条，旧行 `extractorVersion` 为 null。
  - 「整理索引存储」把 221,893 条向量从 `chunk_size=1024` 迁移到 128：耗时约 830 秒，文件从 7.79 GB 降到 4.56 GB（-3.22 GB），`rag_indexes` 307、`rag_chunks` 221,893、向量行 221,893 全部保留，`freelist_count=0`。
  - 真实文献 `paper_mufwwou2_5a014354` 的暂存重建：133 个分块全部复用旧向量（43 ms），提交 159 ms，旧签名检索 0 条、新签名检索 5 条；随后一次不完整重建提交失败，索引保持 ready（133 分块）并记录 `rebuild_error`。
