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

- Per-paper AI conversations now survive app restarts. The active session and preset are restored, and tab switches or app shutdown flush pending history without replacing it with an empty session.
- Full-document translations now persist reliably across restarts, including when a custom MinerU cache directory is used. Cache writes are serialized and atomic, and storage failures are shown instead of being silently ignored.
- WebDAV backup is substantially more reliable: Nutstore-friendly request pacing, `Retry-After` handling, transient-error retries, streamed uploads, adaptive timeouts, detailed failed-object reporting, progress updates, and cleanup of temporary snapshots.
- Review Word export now supports editable OMML equations, localized Chinese/English headings, correct first-line indentation, richer references, missing-image fallbacks, and figures placed alongside relevant model-generated content.
- Review generation now keeps completed sections when another writing task fails, reports failed tasks individually, and processes the full queued workload before offering resume.

## Notes

- AI features require your own compatible model endpoint and API key in Settings.
- WebDAV has no universal cross-provider byte-range resume protocol. PaperQuay now streams files and retries at object level so interrupted jobs can continue without re-uploading completed objects on the next backup.
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

- 文献问答会话现在会按论文持久化保存，重启软件后可恢复当前会话、历史对话和预设；切换标签页或退出时会及时落盘，不再被空白“新对话”覆盖。
- 全文翻译结果可在重启后可靠恢复，包括使用自定义 MinerU 缓存目录的场景；缓存改为串行原子写入，读写失败会明确提示，不再静默丢失。
- WebDAV 备份可靠性显著提升：针对坚果云限制进行请求节流，支持 `Retry-After`、瞬时错误重试、流式上传、自适应超时、失败对象与服务端响应明细、进度反馈，以及异常后的临时快照清理。
- 综述 Word 导出支持可编辑 OMML 公式、中英文节标题、正确首行缩进、更完整的参考文献信息、缺图容错，并可把图片插入模型生成的相关正文位置。
- 综述生成任务不再因单项失败而中止队列；已完成章节会保留，失败任务会单独上报，全部排队任务处理后仍可继续生成。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- WebDAV 没有跨服务商统一的分块断点续传协议。本版本采用流式上传与对象级重试，后续备份可跳过已完成且未变化的对象。
- Release 资源由 GitHub Actions 自动生成。
