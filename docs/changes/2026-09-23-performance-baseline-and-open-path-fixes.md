# 2026-09-23 - 性能基线测量与打开路径直接修复（P0）

对应方案：`docs/plans/2026-09-23-performance-reader-outline-and-rag-context.md` 的 P0 阶段。

## 现象

- 打开有 MinerU 缓存的文献时，缓存 manifest 的 PDF 路径校验会完整读取整份 PDF 字节，大文献每次打开都全量读盘，且读取的字节未被后续复用。
- 配置了远程 PDF 下载目录时，远程文献打开前已完成阻塞式下载，但阅读来源仍是远程 URL，PDF 查看器与文本提取各自再次请求远程地址，同一份文件被重复获取。
- 启动、打开文献等关键路径没有统一计时手段，性能改造缺少可复现的前后对比依据。
- 大库（千级文献）进入文库页时，MinerU 解析状态对全库一次性批量检查，首屏状态就绪受全库规模影响。

## 根因

- `documentReaderCache.resolveSavedPdfPath` 用 `loadPdfBinary` 的整份读取作为"文件还在"的隐式校验。
- `DocumentReaderTab.openWorkspaceDocument` 下载成功后没有切换阅读来源，`resolvedSource` 保持远程 URL。
- 主进程与渲染进程均无性能埋点。
- `LiteratureLibraryView.refreshMineruStatusesForPapers` 一次 IPC 检查全部候选路径，未区分可见项与后台项。

## 修改

- 新增 `electron/perfTrace.cjs` 与 `src/utils/perfTrace.ts`：主进程用 `PAPERQUAY_PERF=1`、渲染进程用 localStorage `pq.perf=1` 开启 `[paperquay:perf]` 计时日志；默认仅有 Map 写入开销。
  - 启动：backend 各 store 初始化耗时、app ready → 窗口创建 → ready-to-show。
  - 打开：`reader:open-start` → `reader:open-source-resolved`，PDF `document-load-start` → 首个 `pagerendered`（`loading=false` 早于实际绘制，不作指标）。
- `resolveSavedPdfPath` 改为存在性检查（`pathExists`），格式问题交给 PDF 加载错误路径；调用方改传 `localPathExists`。
- 远程 PDF 下载成功后统一从本地文件打开（`resolvedSource` 切为 local-path），文本提取与后续 MinerU 恢复同源复用本地文件。
- 解析状态检查分批（每批 400 篇，批次间让出事件循环），`refreshAll` 先检查当前列表页再后台补齐全库；单批失败仅回滚该批、允许重试。
- 文库列表行增加 `content-visibility: auto`（`.pq-paper-row`，`contain-intrinsic-size: auto 132px`），浏览器跳过视口外行的布局与绘制，DOM 完整保留，选择/键盘导航/滚动恢复不受影响。

## 验证

- `npx tsc` 类型检查通过。
- `node --test tests/*.test.ts`：388/388 通过（更新 `tests/documentReaderCache.test.ts` 两个用例为 pathExists API）。
- 基线测量数据待补充：在目标机器上用 `PAPERQUAY_PERF=1`（主进程）与 `pq.perf=1`（渲染进程）采集启动与打开耗时。

## 后续

- P1：阅读器目录（原生 outline + MinerU 标题回退）与 RAG 上下文切片查询。
- P2：文库 SQL 分页、多选全选、增量写入、RAG 执行隔离。
- 远程来源切换后，历史阅读记录键由 URL 变为本地下载路径，旧键记录不再命中（可接受，见方案 3.3）。
