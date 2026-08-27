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

- Fixed: startup no longer stalls for seconds — the knowledge graph is now built only when its workspace is first opened, and semantic similarity edges are computed from a cached per-document vector table instead of decoding every chunk embedding on the main process (measured 6.4s → a few milliseconds; existing databases are backfilled once on first launch).
- Fixed: a hidden bug where semantic similarity edges were silently always empty — sqlite-vec returns float32 raw bytes under node:sqlite, and the old decoder never matched; embeddings are now decoded correctly.
- Fixed: startup no longer rewrites the whole library on every launch; MinerU artifact checks now use a single batched IPC instead of one call per paper.
- New: interrupted Agent runs restore recovered content (including full tool-call arguments) into the composer for you to confirm and send, instead of re-running automatically without confirmation; declined recoveries are clearly marked aborted.
- Fixed: comparative-survey capability token usage is now counted in run totals without double-counting.
- Improved: Agent backend hardening — per-turn limits of 80 messages / 800k characters / 4 images / 8 MB; backend Agent turns are cancellable; streamed token usage is merged correctly; request timeout and manual cancellation signals compose properly.
- Improved: Agent memory trace size limits are enforced by bytes instead of characters, and the "organize memory" button now uses a distinct BrainCog icon.

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

- 修复：应用启动不再卡顿数秒——知识图谱改为切换到图谱工作区时才首次构建；语义相似边不再全量解码 chunk 向量（实测阻塞主进程 6.4 秒），改用文档级平均向量缓存表，计算降至毫秒级；旧库首次启动一次性回填缓存（仅一次）。
- 修复：语义相似边一直静默为空的隐藏 bug——sqlite-vec 在 node:sqlite 下返回 float32 原始字节，旧解码逻辑永不成立，现已正确解码。
- 修复：启动不再每次全库重写文献；MinerU 产物状态检查改为单次批量 IPC，不再逐篇调用。
- 新增：Agent 中断恢复改为把恢复内容（含完整工具调用参数）回填到输入框，确认发送后继续，不再未经确认自动重跑；放弃恢复时明确标记为已取消。
- 修复：对比调研 Capability 的 token 用量计入运行总量且不再重复计数。
- 优化：Agent 后端加固——单轮限制 80 条消息 / 80 万字符 / 4 张图片 / 8MB；后端 Agent 轮次支持取消；流式 token 用量正确合并；超时与手动取消信号正确组合。
- 优化：Agent 记忆 trace 大小限制按字节执行；「整理 Agent 记忆」按钮改用 BrainCog 图标，与思考强度选择器区分。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
