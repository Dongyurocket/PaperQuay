# 2026-09-13 MinerU 状态卡检测中 / RAG 重建索引不动点修复计划

## 背景与证据

两个问题均已在本机真实数据上复现并定位根因：

### 问题 1：文献库启动后全部文献卡在“MinerU 检测中”

- `electron/backend/fileCommands.cjs` 的 `paths_exist` 返回 `paths.map((c) => pathExists(c))`，其中 `pathExists` 是 async 函数，因此实际返回的是 **Promise 数组**。
- Electron `ipcMain.handle` 的结果需要可结构化克隆；Promise 数组无法序列化，渲染层 `ipcRenderer.invoke` 永远等不到响应（既不 resolve 也不 reject）。
- `LiteratureLibraryView.refreshMineruStatusesForPapers` 在调用前已把文献标记为 `checkingMineru: true`，`await localPathsExist(...)` 永久悬挂后没有任何路径清除该状态，于是全部文献永久显示“MinerU 检测中”。
- 该 bug 自 `22c19b5`（批量 paths_exist IPC 引入）起存在。

### 问题 2：RAG 索引失败/未建立时，点击“建立/重建索引”无法成功

本机 `paperquay-rag.sqlite` 中有 7 篇文献处于 `pending`（部分索引），3 篇历史 `failed`。以 `paper_mtst6k1y_df4f34f6`（565 chunks）为例实测：

- DB 实际只有 552 行 chunk（缺失 chunkIndex 0–12），`indexed_chunk_count=552`，`total_chunk_count=565`。
- `ensurePreparedSourceIndexed` 的续跑逻辑是 **按位置切片**：`remainingChunks = chunks.slice(alreadyIndexedCount)` → 只会重发 chunkIndex 552–564 的 13 个 chunk，而这 13 个 chunkId 在 DB 中全部已存在。
- 结果：upsert 不产生新行 → `countChunks` 永远为 552 < 565 → 状态永远停在 `pending`；同时函数返回 `outcome: 'ready'`，UI 提示“索引完成”但角标不变。**每次点击都收敛到同一个不动点，永远无法成功。**
- 此外 `handleIndexPaperRag` 只有 `try/finally` 没有 `catch`：`indexOneItem` 抛出的异常（如状态查询 IPC 失败、失败状态写回失败）会成为未处理拒绝，界面没有任何错误反馈。

## 修改方案

1. `electron/backend/fileCommands.cjs`：`paths_exist` 改为 `await Promise.all(...)`，返回真实布尔数组。
2. `src/features/literature/LiteratureLibraryView.tsx`：取消分支在回滚 `checkedMineruPaperIdsRef` 的同时清除这些文献的 `checkingMineru` 状态，保证所有退出路径状态收敛。
3. RAG 续跑改为按 chunkId 差集计算缺口：
   - `electron/backend/ragStore.cjs`：新增 `listIndexedChunkIds`（查询某文档某来源已入库的 chunkId）与 `finalizeDocumentIndex`（按期望 chunkId 集清理陈旧行、重算计数并把状态收敛为 ready/pending）。
   - `electron/backend/aiCommands.cjs`：新增 `rag_list_indexed_chunk_ids`、`rag_finalize_document_index` 两个命令。
   - `src/services/rag.ts`：新增 `ragListIndexedChunkIds`、`ragFinalizeDocumentIndex` 服务封装。
   - `src/services/localRag.ts`：`ensurePreparedSourceIndexed` 在 signature+模型匹配且有既有进度时改用 chunkId 差集计算 `remainingChunks`；索引循环成功后调用 finalize 自愈；`remainingChunks` 为空但状态非 ready 时也通过 finalize 收敛。
4. 错误可见性：
   - `useReaderRagIndexActions.handleIndexPaperRag` 增加 `catch`，把异常写入状态栏。
   - 批量循环记录首个失败错误，汇总消息中附带。
5. 测试：
   - `tests/ragStore.test.ts`：`listIndexedChunkIds`、`finalizeDocumentIndex`（含陈旧行清理与 ready 收敛）、断续 upsert 后 finalize。
   - 新增 `tests/fileCommands.test.mjs`：`paths_exist` 返回布尔数组且与磁盘事实一致。

## 验证

- `npm run build`
- `npm test`（至少覆盖 ragStore 与 fileCommands 相关测试）
- 修复后用户侧操作：设置中点“为未索引文献建立索引”，7 篇 pending 文献会自动补齐缺失 chunk 并转为 ready；历史 3 篇 failed（Embedding 404，旧配置遗留）可用“仅重建失败索引”重试。
