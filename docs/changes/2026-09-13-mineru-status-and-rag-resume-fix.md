# 2026-09-13 MinerU 状态卡检测中与 RAG 索引不动点修复

## 现象

1. 软件启动后，文献库全部文献卡在“MinerU 检测中”徽标，即使 MinerU 解析产物已完整存在于缓存目录，界面也无法自动刷新为“未解析”或“已解析”。
2. 本地 RAG 索引管理中，部分文献处于索引中断或失败状态；点击“为未索引文献建立索引”或右键“建立/重建 RAG 索引”提示“索引完成”，但状态角标依然停留在待索引/进行中，多次点击依然无法真正完成。此外，单篇索引若在上游抛出异常，按钮点击后没有任何反馈，表现为“点击无效”。

## 根因

### 1. `paths_exist` 批量 IPC 返回未等待的 Promise 数组导致渲染层悬挂

- `electron/backend/fileCommands.cjs` 的 `paths_exist` 实现使用了 `paths.map((c) => pathExists(c))`。
- 因为 `pathExists` 是 `async` 函数，该操作返回的是 `Promise<boolean>[]` 数组。
- Electron IPC 对 `ipcMain.handle` 的返回值进行结构化克隆（V8 ValueSerializer）；Promise 属于不可克隆对象，导致主进程发送响应失败，渲染层 `ipcRenderer.invoke` 永远得不到应答，调用处的 `await localPathsExist(...)` 永久悬挂。
- `LiteratureLibraryView` 在调用 IPC 前已将文献状态置为 `checkingMineru: true`，由于 await 永久不 settle，没有任何代码路径可以把状态更新或清除，文献库所有项永久显示“MinerU 检测中”。
- 取消分支中仅删除了 `checkedMineruPaperIdsRef` 标记，未同步清除已写入的 `checkingMineru` 状态，存在潜在残留风险。

### 2. RAG 续跑索引采用“位置切片”产生不动点死循环

- 在本机真实 RAG 数据库排查发现，存在 7 篇中断的 `pending` 文献（如 `paper_mtst6k1y_df4f34f6`：总计 565 chunks，实际数据库中仅有 552 行，缺失 chunkIndex 0–12 的低位块）。
- `localRag.ts:ensurePreparedSourceIndexed` 此前的续跑逻辑假设前 N 个 chunk 已入库，采用位置切片：
  ```ts
  remainingChunks = input.chunks.slice(alreadyIndexedCount); // slice(552)
  ```
- 针对低位 chunk 缺失的历史中断数据，`slice(552)` 截取出的 13 个 chunk 在数据库中全部已存在（命中 update 分支），数据库 row 计数依然是 552 < 565，状态无法晋升为 `ready`；但批处理循环未抛错，函数直接返回 `outcome: 'ready'`。
- 每次点击“建立索引”都再次重发已被索引的末尾 chunk，缺失的低位 chunk 永远不会被重算与重发，进入固定点死循环。
- `useReaderRagIndexActions.handleIndexPaperRag` 缺少 `catch` 块，状态查询等 IPC 抛错时成为未捕获异常，界面没有提示信息。

## 修改

1. **`electron/backend/fileCommands.cjs`**：
   - `paths_exist` 用 `Promise.all(...)` 等待所有文件检查异步结果，确保 IPC 序列化返回真正的 `boolean[]`。
2. **`src/features/literature/LiteratureLibraryView.tsx`**：
   - `refreshMineruStatusesForPapers` 的 `shouldCancel()` 分支在回滚 `checkedMineruPaperIdsRef` 的同时清除已标记的 `checkingMineru: false`，确保任何退出分支状态收敛。
3. **`electron/backend/ragStore.cjs`**：
   - 新增 `listIndexedChunkIds({ documentKey, sourceType })`，供前端按 chunkId 差集精准识别未入库 chunk。
   - 新增 `finalizeDocumentIndex(...)`，按当前期望 chunkId 集合清理历史陈旧行、重算真实行数并原子收敛状态（ready / pending）。
4. **`electron/backend/aiCommands.cjs`**：
   - 注册 `rag_list_indexed_chunk_ids` 与 `rag_finalize_document_index` IPC 命令。
5. **`src/types/reader.ts` & `src/services/rag.ts`**：
   - 增加请求类型及 `ragListIndexedChunkIds`、`ragFinalizeDocumentIndex` 客户端调用封装。
6. **`src/services/localRag.ts`**：
   - `ensurePreparedSourceIndexed` 废除单纯的 `input.chunks.slice(alreadyIndexedCount)` 位置续跑，改为查询已入库 `chunkId` 集合并按差集提取 `remainingChunks`。
   - 缺口补齐或无新增分块但状态未收敛时，调用 `ragFinalizeDocumentIndex` 自愈。
   - 失败状态写回 `ragReportDocumentIndexFailure` 增加 try/catch 兜底，防止次要故障覆盖原始错误。
7. **`src/features/reader/useReaderRagIndexActions.ts`**：
   - `handleIndexPaperRag` 增加 `catch` 块，将异常透传至状态栏展示，解决“点击无反应”问题。
   - 批量索引记录首个失败原因并在完成后追加提示。
8. **测试**：
   - 新增 `tests/fileCommands.test.ts`：验证 `paths_exist` 返回真实布尔值且类型正确。
   - 扩充 `tests/ragStore.test.ts`：增加 chunkId 差集续跑补齐不动点、陈旧分块清理以及签名不匹配保护测试。

## 验证

- `npm run build`：TypeScript 编译与 Vite 生产打包 100% 成功通过。
- `npm test`：运行 `tests/*.test.ts` 全部 297 项测试（含新增的 4 项），耗时 1.16 秒，全部 pass。
- 本地真实数据仿真验证：复制真实 `paperquay-rag.sqlite` 数据库中 552/565 pending 的文献数据，经新差集逻辑成功提取缺失的 13 个低位分块并入库，调用 `finalizeDocumentIndex` 后状态顺利收敛为 `ready 565/565`。
