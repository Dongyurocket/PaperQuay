# 新会话提示词：补完 P3 剩余两项

在 `C:\Users\yusen\.proma\agent-workspaces\paperquery\workspace-files`（PaperQuay：Electron + React 桌面 AI 论文工作台）继续执行性能方案的最后两项。

## 背景

仓库里有一份方案文档：`docs/plans/2026-09-23-performance-reader-outline-and-rag-context.md`。它的 P0、P1、P2 已全部落地，P3 大部分落地。代码在分支 `feat/perf-reader-outline-rag-context` 上，HEAD 是 `cfb1ac6`（同分支另有 `5669585`、`8d30424`、`ab3a9f1`、`cdb221d`）。基线状态：`npx tsc --noEmit` 通过，`npm test` 415/415。

P3 还有两条当初刻意收窄了，现在把它们补完。动手前先读方案对应小节，并核对下面的行号（可能有偏移）。开工前先跑一次 `npm run check` 确认基线。

## 任务一：全局内存预算按字节计量（方案 §3.4 第一条）

方案原文：**设定全局缓存预算，按估计字节占用管理 PDF、解析数据、裁剪图及缩略图。**

现状：

- `src/features/reader/readerResourceBudget.ts` 只有 `READER_MOUNTED_TAB_LIMIT = 2` 与 `chooseMountedReaderTabIds({ readerTabIds, activeTabId, recentTabIds, busyTabIds })`，是按标签数量限制，不是按字节。
- `src/features/pdf/pdfBlockCrop.ts:14` 的 `cropDataUrlCache = new Map<string, string>()` 存 data URL 字符串；`:15` 的 `pdfDocPromiseCache = new Map<string, Promise<any>>()` 存 pdf.js 文档对象；`:122` 的淘汰写死 `if (cropDataUrlCache.size > 80)`，按条数，且 `pdfDocPromiseCache` 从不淘汰。
- `src/features/reader/Reader.tsx` 用 `recentReaderTabIds` 与 `mountedReaderTabIds` 决定哪些阅读标签挂载。

要做：

1. 加体积估算层：PDF.js 文档对象（按页数与已缓存页数据估）、解析数据（`mineruPages` / `flatBlocks`，按文本长度与块数估）、裁剪图（data URL 长度换算字节）、缩略图（同上）。保守量级即可，能区分大小就够，不要求精确。
2. 加统一的按字节预算缓存淘汰器，各缓存注册进去，超预算按最近使用顺序淘汰，并释放资源：PDF 文档对象要调 `destroy` 或等价清理，裁剪图与缩略图只丢引用。
3. 把 `readerResourceBudget.ts` 扩成同时管字节预算与标签挂载。保留现有导出函数签名兼容，或同步改调用方。
4. 淘汰要能取消相关异步任务，不要把别人正在用的对象销毁掉（方案 §3.4 第三条要求明确引用所有权）。

注意：方案没有规定预算数值，选一个能自证的默认值并写进变更记录。不要为了让测试通过把预算设成永远不触发。

## 任务二：超长解析文档分段（方案 §3.3 第四条）

方案原文：**超长解析文档拆为元数据、章节索引和正文分段，目录不依赖全文渲染。**

现状：

- `src/features/reader/mineruParse.worker.ts` 在 Worker 里一次性 `parseMineruPages(整个 JSON)`，然后按 `MINERU_PARSE_PAGE_BATCH`（25 页）分批 `postMessage`，最后发 `{ done: true }`。
- `src/features/reader/mineruParseWorker.ts:14` 的 `pending` Map 里每个请求累加 `pages: MineruPage[]`；`:57` 收一批 push 一批；`:61` 只有 `done: true` 才 resolve 整个数组。所以界面仍要等整篇解析完才拿到数据。
- `src/features/reader/mineruSegments.ts` 有 `MINERU_PARSE_PAGE_BATCH = 25` 与 `sliceMineruPages`。
- `src/features/reader/DocumentReaderTab.tsx:400-401` 是 `mineruPages` / `flatBlocks` 状态；`applyMineruPages` 在 `:917`；调用点在 `:997`、`:1301`、`:1333`、`:1374`、`:1560`、`:1765`。
- 目录走 `src/features/pdf/PdfViewer.tsx:507` 与 `:560` 的 `buildMineruOutline(blocks)`，吃的是完整块列表，所以目录也要等整篇。

要做：

1. 把解析结果按「元数据 / 章节索引 / 正文分段」分离。元数据至少含页数、块数、来源路径；章节索引是从标题块抽出的层级 + 页码 + `blockId`；正文分段按页或块段。
2. 让分段渐进可用：解析出的前若干页能立刻渲染，目录在章节索引到位时就能用，不等正文全部到齐。方案验收要求是「目录不依赖全文渲染」。
3. 改 `mineruParseWorker.ts` 的接口，从「返回完整数组」改成能分批回调或返回异步迭代。同步改 `DocumentReaderTab` 的调用点，保证需要完整数据的路径（写解析缓存、重建 RAG）仍拿到完整集合。
4. 评估结构化克隆成本：方案要求传输大结果时逐步采用按页或按块段传输，不要一次把整篇塞过一个 `postMessage`。

## 约束

- 不要回退已有行为：目录、缩略图、批注、双栏联动、翻译、笔记锚点、RAG 问答都要保持可用。
- 阅读器 RAG 相关逻辑（`src/features/reader/readerRag.ts`、`src/services/localRag.ts`）已在用完整 `mineruBlocks`，改动时要保证它们拿到的仍是完整集合。
- 性能日志受 `PAPERQUAY_PERF=1` 或 `localStorage` 的 `pq.perf === '1'` 控制，新增埋点走这两个开关。
- `pdfBlockCrop.ts` 的缓存键包含 `sourceKey`、`blockId`、`pageIndex`、`bbox`、`scale`，淘汰时不要跨来源误删。
- 不要动 `scripts/` 目录下未跟踪的脚本。
- 单篇文献写入用 UPSERT，不要用 `INSERT OR REPLACE`（外键是 `ON DELETE CASCADE`，replace 会连带删掉参考文献）。

## 仓库约定（AGENTS.md）

- 功能和修复用 `feat/*` 或 `fix/*` 分支；门禁是 `npm run check`（`npm run build` + `npm test`）。
- 测试是 `node --test tests/*.test.ts`。Node ESM 类型剥离有两条硬规则：`.ts` 值导入必须带 `.ts` 后缀；`.tsx` 导入不能带后缀（rolldown 解析不了）。
- 用户可感知的变更写 `docs/changes/` 记录，格式参照 `docs/changes/2026-09-23-rag-worker-and-reader-budget.md`。
- 提交信息用中文，正文按「现象 / 根因 / 修改 / 验证」组织，feat 提交带 scope。
- 不要提交 API key、PDF、解析产物、SQLite 数据库和 `dist/`。

## 交付

1. 两项都实现，并各自补测试：字节预算测估算函数、淘汰顺序、释放回调、预算耗尽后的行为；分段测切分正确、章节索引完整、渐进可用（前段先到不阻塞目录）、原有完整数据路径不变。纯逻辑优先抽成能在 `node --test` 下直接跑的模块，不要只在组件里验证。
2. 跑 `npm run check`，确保 415 个既有测试不回归。
3. 写变更记录到 `docs/changes/`，写清方案原文要求、实际做法，以及任何仍然收窄的地方。
4. 如果方案这两条不该完全照做（例如缩略图其实没有缓存可管），说明理由并把偏差写进变更记录，不要为了对齐方案硬造无用抽象。

先读方案 §3.3、§3.4 两节和上面列出的文件，再动手。有疑问先问，不要猜方案意图。
