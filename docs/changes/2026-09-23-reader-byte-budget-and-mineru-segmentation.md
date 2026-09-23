# 全局内存预算按字节计量与解析文档分段渐进可用

## 现象

阅读器之前仅按标签页数量（最多 2 个）控制挂载，缺乏跨文档对象的字节级内存预算；PDF 切片图缓存硬编码为 80 条上限，而切片使用的 PDF.js 文档 Promise 从不淘汰也不释放；MinerU 解析结果在 Worker 中虽按 25 页分批 postMessage，但前端仍等待整篇接收完毕才一次性渲染，超长文献打开时正文和目录均需等待全文解析全部完成。

## 根因

1. 缺少内存体积估算层与统一的按字节 LRU 淘汰器，PDF.js 对象和 Base64 Data URL 无法按估计字节进行上限控制和生命周期销毁。
2. 缺乏引用所有权机制，无法在内存吃紧时安全区分“正在使用中”与“闲置可淘汰”的对象。
3. MinerU 解析结果未将元数据、章节目录索引与正文数据分离，阅读器左侧目录直接依赖完整的 `blocks` 结构块列表，必须等待整篇文档的 AST 全部转换并传输完毕后才能生成。

## 修改

### 任务一：全局内存预算按字节计量（方案 §3.4 第一条与第三条）
- **体积估算层**（`src/features/reader/readerResourceBudget.ts`）：
  - `estimatePdfDocumentBytes`：以 4 MB 为基础开销（包含 xref 表、catalog、字体及 Worker 握手等），每页保守按 128 KB 计入已缓存页及流式数据。
  - `estimateMineruParseBytes`：按块对象结构（384 字节）、UTF-16 文本长度（字符数 × 2）以及页对象基础开销（512 字节）估算解析数据。
  - `estimateDataUrlBytes` / `estimateThumbnailBytes`：提取 Base64 有效负载长度折算实际图像二进制字节（约 75%），并保守计入字符串内存。
- **统一按字节 LRU 淘汰器 `ByteBudgetLruCache`**：
  - 超出预算时按最久未使用顺序淘汰，并触发 `onEvict` 销毁回调。
  - 提供 `acquire` / `release` 引用借用与 `setPinned` 机制；在淘汰超额字节时，借用中或处于 Pin 状态的对象会被跳过保留，确保不会销毁正在使用的对象。
- **默认自证预算值**：
  - 全局阅读器总预算：`DEFAULT_READER_TOTAL_MEMORY_BUDGET_BYTES = 256 MB`。
  - PDF.js 文档对象预算：`DEFAULT_PDF_DOC_CACHE_BUDGET_BYTES = 96 MB`（可支撑 5-8 篇文献常驻而无需重复构建 PDF.js 实例）。
  - 切片图像缓存预算：`DEFAULT_CROP_CACHE_BUDGET_BYTES = 32 MB`。
- **改造 `pdfBlockCrop.ts`**：
  - 切片图缓存改用 `ByteBudgetLruCache<string>`，按图像字节自动淘汰。
  - PDF 文档缓存改用 `ByteBudgetLruCache`，裁剪执行期间通过 `acquire` 锁定文档，裁剪完成后释放；淘汰时通过 `releasePdfDocument` 与 `releasePdfLoadingTask` 执行 `destroy` 清理。
- **扩展 `chooseMountedReaderTabIds`**：
  - 保持现有签名和行为完全兼容；支持传入 `tabByteEstimates` 与 `maxTotalBytes`，在满足 2 个标签上限的同时对后台标签实行字节预算拦截。

### 任务二：超长解析文档分段与渐进可用（方案 §3.3 第四条）
- **数据结构与逻辑抽离**（`src/features/reader/mineruSegments.ts`）：
  - 定义 `MineruDocumentMetadata`（页数、块数、来源路径）、`MineruOutlineIndexItem`（仅含标题块的 `blockId`、`pageIndex`、层级和标题文字）与 `MineruPageSegment`（按 25 页批次分段）。
  - `splitMineruPagesIntoParts`：纯函数拆分，正文分段中校准跨批次的全局 `pageIndex` 与 `blockId`，标注分段终态。
- **目录不依赖全文渲染**（`src/features/pdf/pdfOutline.ts`、`PdfViewer.tsx`）：
  - 导出 `buildMineruOutlineFromIndex`，直接吃轻量章节索引生成层级目录树；
  - `PdfViewer` 增加 `mineruOutlineIndex` 支持，在无原生 PDF 目录时，章节索引到达立即显示完整目录，无需等待全文正文块。
- **Worker 流式传输与结构化克隆优化**（`mineruParse.worker.ts`、`mineruParseWorker.ts`）：
  - Worker 完成 JSON 解析后，第 0 步先发送轻量 `metadata` 与 `outlineIndex`，随后按 25 页一批分段发送正文，规避一次性结构化克隆超大对象图导致的主线程卡顿。
  - `mineruParseWorker.ts` 扩展 `onOutlineIndex`、`onSegment`、`onProgress` 渐进回调；主线程同步回退模式保持相同的回调触发顺序；
  - `parseMineruPagesOffThread` 与 `parseMineruDocumentOffThread` 在全部完成时 resolve 完整数组，保证 RAG 索引、解析缓存持久化等下游路径拿到的仍是完整集合。
- **阅读器界面渐进响应**（`DocumentReaderTab.tsx`、`ReaderWorkspace.tsx`）：
  - 收到章节索引立即展示目录；首个分段到达时立即渲染前 25 页正文；后续分段流式追加并在完成时触发最终同步。

### 与方案偏差说明
- **缩略图缓存**：方案提及“按估计字节占用管理 PDF、解析数据、裁剪图及缩略图”。经核查，`PdfViewer.tsx` 的缩略图已基于可见视口窗口化（仅生成当前页附近的少量缩略图），且跟随阅读标签组件的 React state 生命周期在卸载时自动回收，不存在跨文档常驻的全局 Map。因此未强行造全局缩略图缓存 Map，而在体积估算层统一提供 `estimateThumbnailBytes`，避免无用抽象。

## 验证

- `npm run check`（`tsc && vite build && npm test`）门禁全部通过。
- 既有 415 项测试全部通过无回归。
- 新增单元测试（测试总数达 423 项）：
  - `tests/readerResourceBudget.test.ts`：覆盖 PDF.js/MinerU/DataURL 的体积估算、LRU 超额淘汰顺序、引用借用保护不销毁正在使用对象、缩容自动淘汰、以及标签挂载字节预算拦截。
  - `tests/mineruSegments.test.ts`：覆盖元数据/章节索引/正文分段切分、全局 pageIndex/blockId 跨段连续性、目录不依赖正文先就绪、以及 Worker 渐进式流式回调与完整数据返回。
  - `tests/pdfOutline.test.ts`：覆盖 `buildMineruOutlineFromIndex` 直接构建多层级目录树。
