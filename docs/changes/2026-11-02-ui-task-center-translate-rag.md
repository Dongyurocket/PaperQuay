# 2026-11-02 - 翻译与 RAG 索引接入任务条（T6）

## 现象

右下角这句话和代码不一致：任务条在左下角（`left-4`），toast 在右下角。这次没有挪位置，避免挡住 toast。

翻译进度只在阅读器里。`useDocumentTranslation` 用 `setTranslationProgressCompleted` / `setTranslationProgressTotal` 存进度，再经 `PdfViewer` 传给工具栏。切到笔记后看不到。

RAG 只有状态事件 `paperquay:rag-index-status-updated`，detail 原来只有 `documentKey`。没有 n/m。索引过程中右下角（实际是左下角）任务条也不出现。

## 根因

`TaskCenter` 只订阅 `documentParseTasks`。翻译进度是阅读标签页里的 React state。`LiteraturePaperTaskState` 也只挂在当前阅读页，不能跨工作区。`ragIndexStatus.ts` 是纯函数，没有可订阅的任务表。

## 修改

1. 新增 `src/services/backgroundTasks.ts`。内存 `Map` 加监听，不写 localStorage。
   - `upsertBackgroundTask` / `finishBackgroundTask` / `failBackgroundTask`
   - `listBackgroundTasks` / `subscribeBackgroundTasks` / `clearFinishedBackgroundTasks`
   - `removeBackgroundTask`：取消或换文献时清掉运行中的任务，不发 toast
   - 翻译 id 是 `translate:` + 文献 key，RAG id 是 `rag:` + 文献 key。两种任务可以同时存在
   - 节流门：距上次写入 ≥ 200ms，或百分比变化 ≥ 2%，才写入。第一次强制写入
   - 成功在通知订阅者之后立刻从 Map 删除。失败保留 60 秒再删
   - RAG 用 `sourceType` 计数。同一文献的 mineru-markdown 和 pdf-text 都结束，才报一次完成。不写 `completed` / `total`
2. `src/ui/taskCenterEntries.ts` 把解析任务和后台任务合成一条列表，按 `updatedAt` 新的在前。有 `total` 才算出百分比，否则是不确定进度。
3. `TaskCenter` 订阅两个来源。每项有标签：解析、翻译、索引。翻译显示百分比。RAG 运行中显示「索引中」，不显示百分比。成功和失败各 toast 一次。进度更新不 toast。
4. 翻译接入在 `useDocumentTranslation.ts` 的 `publishTranslationProgress`（约第 171 行）。全文翻译和单块重译的 `onProgress` 都走它。工具栏原来的 `setTranslationProgressCompleted` 没改。
5. RAG 接入在 `ensurePreparedSourceIndexed`。真正开始写索引之前发出 `pending`（`localRag.ts` 约第 229 行）。结束时发 `ready` 或 `failed`，移出知识库发 `excluded`。成员变更仍只带 `documentKey`，不进入任务条。`TaskCenter` 在 `bindRagIndexBackgroundTasks`（约第 90 行）订阅这个事件。

已有、这次没有拿来当全局任务表的东西：

- `documentParseTasks`：解析任务继续用它，只在任务条里合并。
- `LiteraturePaperTaskState` / `updateLibraryOperation`：阅读页局部状态，切走就没了。
- `BatchProgressState`：批量索引用的本地进度，粒度是文献篇数，不是 chunk，也出不了阅读页。

后续：RAG 要显示 n/m，得由索引循环发出 chunk 进度。这次没做。

## 验证

- `npm run build` 通过。`TEMP` / `TMP` 指向 `.tmp-build` 时 `npm test` 为 878 pass / 0 fail。原有 869 项之外，新增 `tests/backgroundTasks.test.ts` 9 项。
- 节流单测日志：`translation throttle: 240 block updates over 9600ms -> 49 upserts`。49 次写入，240 次块更新。实机没有把渲染进程的 upsert 计数打出来，下面只记界面上看到的百分比。
- 实机使用 `release/local-ui-t6`，复制到 `%LOCALAPPDATA%\Temp\pq-t6` 后启动。启动前三个库的 SHA256 与备份一致。验收后文献库、笔记库哈希未变，RAG 库长度和修改时间仍是 2026-10-12 23:02:36，没有重写 8GB 文件。翻译新增的 `document-fc9ef7a3\translations\chinese.json` 已删除。

| 项 | 结果 |
| --- | --- |
| 阅读器里翻译，工具栏仍显示 `MinerU block translation progress` 和 `120/188` | 通过。截图 `reader-toolbar-and-taskbar-64.png` |
| 同一时刻任务条显示「翻译」和 64%（120/188 四舍五入） | 通过。同一张截图 |
| 切到笔记后任务条仍在，随后变为 74% | 通过。截图 `notes-taskbar-74.png` |
| 完成后任务条消失 | 通过。笔记页截图 `notes-taskbar-gone.png`。回到阅读器，状态栏是「翻译完成，已生成 188 段译文」，结构阅读显示「188 个译文块」 |
| 成功 toast | 未截到。toast 约 3.2 秒后关闭，任务条消失时画面上已经没有它。代码路径是 `finishBackgroundTask` 通知订阅者后删除任务，`TaskCenter` 只在 success/error 时 toast |
| RAG「索引中」 | 未实机触发。见下面 |

RAG 未触发的原因：只读查询 `rag_indexes`，270 条 `ready`，1 条 `pending`。这条 pending 是 `paper_muc9cuey_7a7cbe91` / 「宽速域变体飞机总体方案设计」/ pdf-text / 48/178。文献库 `papers` 里没有这个 id，也没有这个标题。文库搜索「宽速域变体飞机」结果为 0。已就绪的文献即使点「建立/重建 RAG 索引」也会在 `ensurePreparedSourceIndexed` 里直接返回，不会出现「索引中」。没有改 RAG 库来制造一条未完成索引。

可复现的手动步骤：

1. 在文库里找一篇仍在库中、且聚合状态不是 ready 的文献。
2. 右键「建立/重建 RAG 索引」，或走批量索引。
3. 立刻切到笔记或别的工作区。
4. 左下角应出现标签「索引」和「索引中」，没有百分比。
5. 索引成功后任务条去掉，并出现一次成功 toast。失败则保留约 60 秒，并出现一次失败 toast。

截图未入库，在 `.verification-20261102-t6/`。

上游 `git fetch upstream` 因本机没有 GitHub 凭据失败，没有并入上游提交。
