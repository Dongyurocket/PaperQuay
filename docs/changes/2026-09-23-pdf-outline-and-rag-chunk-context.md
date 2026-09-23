# 2026-09-23 - PDF 目录侧栏与 RAG 切片上下文（P1）

对应方案：`docs/plans/2026-09-23-performance-reader-outline-and-rag-context.md` 的 P1 阶段（P1-1 目录、P1-2 上下文最小版本）。

## 现象

- PDF 阅读器只有缩略图侧栏，无目录；有书签的 PDF 无法按章节跳转，MinerU 解析出的标题层级也未被利用。
- RAG 问答命中只把单切片正文发给模型，命中点位于段落中段时上下文残缺；用户也无法查看某个引用切片的前后文。
- 问答结果中的"上下文补充段"（标题章节扩展）与直接命中混在同一列表里，无法区分来源角色。

## 根因

- PDF 查看器未调用 pdf.js `getOutline()`，也没有目录面板与跳转/返回机制。
- `ragStore` 只有向量检索接口，没有基于 `chunkIndex` 阅读顺序的邻接切片查询；QA 装配（`buildRagContextText`）只做标题章节扩展，不做前后邻接扩展，也没有预算约束。
- 引用类型缺少 `chunkId`，无法从问答引用反查切片邻接。

## 修改

### P1-1 PDF 目录侧栏

- 新增 `src/features/pdf/pdfOutline.ts`：原生 outline 规范化（`normalizePdfOutline`）、MinerU 标题块回退（`buildMineruOutline`，`text_level` 定层级）、`flattenOutline` / `filterOutline` / `findActiveOutlineId` / `collectOutlineIds`。
- 新增 `src/features/pdf/PdfOutlinePanel.tsx`：目录面板，支持搜索、折叠、跳转后返回（栈上限 50）、当前位置高亮。
- `PdfViewer.tsx`：侧栏 tab（缩略图/目录）持久化（`paperquay-pdf-sidebar-tab-v1`），折叠集按 sourceSignature 存储；复用 `PDFLinkService` 执行 `goToDestination`；原生目录 pageIndex 分批（25 条）懒解析，不一次遍历全部目标；无原生书签时回退 MinerU 标题块目录。
- `PdfThumbnailSidebar.tsx` 支持目录模式宽度与自定义内容；`ReaderWorkspace` 接 `onOutlineNavigateBlock` 联动结构化正文定位。

### P1-2 RAG 切片上下文

- `electron/backend/ragStore.cjs`：新增 `getChunkContext(request)`——ready 门禁（索引非 ready → `not-ready`，不把缺失误报为无前后文）、chunkId 未命中 → `not-found`；before/after 默认各 1、上限 8；基于 `idx(document_key, source_type, chunk_index)` 的范围查询；`hasMoreBefore/hasMoreAfter` 边界判定；`sectionPath` 显式降级 null（P3 再补）。`aiCommands.cjs` 注册 `rag_get_chunk_context` IPC。
- `src/types/reader.ts`：`RagChunkContextSlice/Status/Response`；`RagRetrievalResult` 增加 `retrievalRole?` / `expandedFrom?`；`DocumentChatCitation` 增加 `chunkId?`。
- `readerRag.ts`：`buildRagContextText` 对非标题命中做前后邻接扩展（同文档、同来源、按 chunkIndex 阅读顺序拼接）；token 估算（CJK≈1 token/字、其余≈1/3），单目标窗口预算 1500 tokens、单次问答补充预算 6000 tokens；标题命中维持章节扩展；所有补充段标 `retrievalRole:'context'` + `expandedFrom` 追加在直接命中之后，不冒充独立命中、不改变原始排序。
- 新增 `src/features/reader/RagChunkContextPreview.tsx`：「查看上下文」预览面板——前文/命中/后文切片（命中高亮）、页码徽标、每段「定位」入口、「更多前文/更多后文」按 `hasMore*` 追加；仅本地预览，不调用模型、不外发正文（方案 §5.1）。
- 问答引用 chip 增加「上下文」入口（有 `chunkId` 时），chip 行对 markdown/HTML 两种渲染模式统一展示；入口经 `assistantSidebarChat → AssistantSidebar → ReaderWorkspace/readerAssistantSidebarProps → DocumentReaderTab` 透传，预览面板中定位复用 `activateBlock` 双侧联动。
- `agentVision.matchRagVisionCandidates` 跳过 `retrievalRole:'context'` 补充段：邻接切片的图不伪装成检索命中参与图片候选匹配，保持既有行为。

### 方案修正

- §5.7 最小版本约定 `sectionPath` 缺字段时显式降级 null，已在响应中落实；P2（SQL 分页/全选/Worker）与 P3（代次/章节字段）不在本次范围。

## 验证

- `npm run check`（构建 + 测试）通过；`node --test tests/*.test.ts` 401/401。
- 新增 `tests/pdfOutline.test.ts` 7 例（规范化/回退/过滤/定位）；`tests/ragStore.test.ts` +2 例（邻接排序与 hasMore 边界、not-ready/not-found 与跨文献同 chunkId 来源隔离）；`tests/readerRagContext.test.ts` 4 例（前后邻接阅读顺序、单目标预算跳过超大邻片、问答总预算封顶、标题命中扩展标记）。
- 测试修正：Node ESM 测试要求 src 内 value import 带 `.ts` 后缀（`.tsx` 模块不带，rolldown 构建不解析 `.tsx` 后缀导入）；`rag_chunks` 同文档同来源 chunkId 唯一，测试数据共用 chunkId 会坍缩导致索引停 pending。

## 后续

- P2：文库 SQL 分页、多选全选与跨分页批量管理、RAG 执行隔离、分批迁移、解析 Worker。
- P3：章节/偏移/代次模型（补 `sectionPath`）、共享上下文服务推广、多标签休眠与全局预算。
