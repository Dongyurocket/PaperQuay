# 2026-08-27 - 修复应用启动卡顿（图谱相似边阻塞主进程）

## 现象

应用打开后文献库长时间停留在加载状态，整体卡顿数秒，看似"在加载文献库"。

## 根因

实测后端文献库路径全是毫秒级（28 篇文献 load 2ms、`library_init` IPC 载荷约 138KB、打开 492MB RAG 库 36ms），真正元凶在知识图谱：

1. `App.tsx` 常驻挂载全部 5 个工作区（仅 `hidden` 控制显隐），`KnowledgeGraphWorkspace` 的 `loadGraph` effect 未按 `workspaceActive` 门控，启动即调用 `getKnowledgeGraph`，且默认 `mixed` 视角下 `related_by_embedding: true`。
2. 后端 `ragStore.listDocumentSimilarities` 每次调用都把**全部 chunk 向量**（实测 7550 条 × 4096 维 ≈ 120MB）读进主进程 JS 内存逐条 `Array.from` 解码再按文档平均，实测同步阻塞主进程 **6.4 秒**；期间所有 IPC（含 `library_init`）排队，文献库看起来"加载不动"。
3. 附带发现一个隐藏 bug：`node:sqlite` 下 sqlite-vec 的 embedding 列返回 float32 原始字节（`Uint8Array`，长度 = 维度 × 4），旧代码 `Array.from(row.embedding)` 得到字节数组，`embedding.length === dimension` 永不成立，向量全部被跳过——语义相似边**一直静默为空**。
4. 次要因素：`library_init` 每次启动都执行全库 DELETE + 重插（JSON→SQLite 迁移遗留）；文献库挂载后对每篇文献逐个发 `path_exists` IPC 检查 MinerU 产物（约 150+ 次往返）；MinerU 状态检查在 init 快照之外再全量拉取一次文献。

## 修改

- `src/features/graph/KnowledgeGraphWorkspace.tsx`：`loadGraph` effect 增加 `workspaceActive` 门控并加入依赖数组，隐藏挂载时不再构建图谱，激活工作区时才首次加载。
- `electron/backend/ragStore.cjs`：
  - 新增 `rag_document_vectors` 文档级平均向量缓存表；`indexDocument`/`reportFailure` 事务内增量维护；`openDatabase` 对旧库一次性回填（`rag_store_meta` 标记 `rag_document_vectors_v1`，只跑一次，约 4.6s）。
  - 新增 `decodeEmbeddingValue` 正确把 `Uint8Array` 字节视图解码为 `Float32Array`（修复相似边静默为空）。
  - `listDocumentSimilarities` 改为只读缓存表 + 文档级两两余弦；删除不再使用的 `averageVectors`。
- `electron/backend/libraryCommands.cjs`：`library_init` 移除每次启动的全库重写（`store.save`）。
- `electron/backend/fileCommands.cjs`：新增 `paths_exist` 批量路径存在性检查命令（上限 10000 条）。
- `src/services/desktop.ts`：新增 `localPathsExist` 批量封装（失败时按全部不存在降级）。
- `src/features/literature/LiteratureLibraryView.tsx`：
  - MinerU 状态检查改为汇总全部候选路径后**单次 `paths_exist` IPC**，并提前标记已检查文献防止并发重入，取消/失败时回滚标记并清除 checking 状态。
  - 新增 `allPapersSnapshotRef` 复用 `library_init` / `refreshAll` 的全量文献，MinerU 状态检查不再单独全量拉取。
- `src/services/libraryAgent.ts`：补上未提交 WIP 中缺失的 `loopResumeMessages` 解构（类型字段与用法已存在，仅缺绑定），否则 `tsc` 不通过。

## 验证

- 真实数据副本实测：`listDocumentSimilarities` 由 **6355ms → 3~5ms**，且正确返回 120 条相似边（修复前恒为 0）；一次性回填约 4.6s（仅升级后首次启动执行一次），之后 `createRagStore` 2ms。
- `npm run build` 通过（TypeScript + Vite）。
- `npm test` 238 项全部通过；额外手动运行 `node --test tests/libraryCommands.test.mjs tests/knowledgeGraphCommands.test.mjs` 6 项全部通过。
