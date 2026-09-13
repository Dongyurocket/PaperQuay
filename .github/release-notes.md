# PaperQuay v{{VERSION}}

PaperQuay is an open-source AI paper workspace for literature management, PDF reading, paper overview generation, full-text translation, inline notes, Zotero import, Agent workflows, and local RAG.

## Downloads

Download the native installer for your operating system from the Assets section below.

| Platform | Recommended asset |
| --- | --- |
| Windows | `.exe` installer or `.msi` package |
| macOS | `.dmg` package for Apple Silicon or Intel |
| Linux | Electron desktop package such as `.AppImage`, `.deb`, or `.tar.gz` |

## Highlights

- **Fix MinerU detection hang on library launch**: The batch path existence check IPC `paths_exist` previously returned an array of unawaited Promises from an async helper. Electron's structured clone failed to serialize the Promise array, causing the renderer's `invoke` promise to hang forever and stranding all papers in the library list with a perpetual "MinerU Checking" badge. The backend now uses `Promise.all` to await all asynchronous checks and return concrete booleans, and the cancel branch rolls back checking state properly.
- **Fix RAG indexing fixed-point loop on interrupted documents**: The incremental indexing flow previously assumed chunks were indexed in exact sequential order using positional slicing (`chunks.slice(alreadyIndexedCount)`). When an interrupted document lacked low-index chunks, slicing repeatedly resent already-indexed chunks, preventing the database row count from ever reaching the total while erroneously reporting completion. The store and local RAG service now query existing `chunkId` sets to compute true gaps by set difference, automatically self-healing interrupted documents and pruning obsolete chunks via `finalizeDocumentIndex`.
- **Improve RAG error visibility**: Single-paper context menu indexing now captures errors and surfaces them in the status bar instead of failing silently, and batch indexing reports the first failure error in the completion summary.

## Notes

- AI features require your own compatible model endpoint and API key in Settings.
- Release assets are generated automatically by GitHub Actions.

---

# PaperQuay v{{VERSION}} 中文说明

PaperQuay 是一个开源 AI 论文工作台，覆盖文献管理、PDF 阅读、论文概览生成、全文翻译、内联笔记、Zotero 导入、Agent 工作流和本地 RAG。

## 下载说明

请在下方 Assets 区域选择与你的操作系统对应的安装包。

| 平台 | 推荐安装包 |
| --- | --- |
| Windows | `.exe` 安装包或 `.msi` 安装包 |
| macOS | Apple Silicon 或 Intel 对应的 `.dmg` 安装包 |
| Linux | `.AppImage`、`.deb` 或 `.tar.gz` 桌面安装包 |

## 本次更新

- **修复启动后文献库全部卡在「MinerU 检测中」**：后端批量检查 IPC `paths_exist` 此前因直接返回未等待的 Promise 数组导致 Electron 结构化克隆挂起，前端调用永久未响应并使全库文献停留于检测中。现已修复为 `Promise.all` 并完善了取消回滚。
- **修复 RAG 索引断续续跑陷入不动点死循环**：续跑逻辑由「位置切片」全面升级为「分块 ID 差集补齐」，精确挑出未入库分块重补并新增 `finalizeDocumentIndex` 自动收敛状态与清理历史陈旧分块，彻底解决中断文献重复点击无法收敛的问题。
- **增强 RAG 索引错误反馈**：单篇右键索引入口补充异常捕获，在底层异常时向状态栏给出明确反馈；批量索引记录首个失败原因并在总结中提示。

## 备注

- AI 特性需要在“设置”中配置你自己的兼容模型接口与 API 密钥。
- 发布产物由 GitHub Actions 自动构建生成。
