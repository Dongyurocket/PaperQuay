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

- Fixed: MinerU chart and figure blocks (for example Fig. 7/8 curve plots) now render as image blocks with their local snapshots, using `chart_caption` for captions.
- Fixed: tables without a MinerU caption no longer show escaped `<table>` HTML as caption text; caption extraction is now strict while the structured HTML table still renders normally.
- Fixed: full-text translation input no longer includes local image asset paths or table HTML; visual blocks without a caption or OCR text are skipped.
- Fixed: previously polluted cached translations starting with an `images/` asset path are dropped automatically and retranslated on the next run; no manual cache cleanup is required.

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

- 修复：结构阅读器不再漏显 MinerU 图表，`chart` / `figure` 块统一按图片块渲染，本地截图正常加载，图注取自 `chart_caption`。
- 修复：空图注表格不再把 `<table>` HTML 源码显示为文本；图注提取改为严格字段提取，无图注时不再回退到完整表格内容，结构化表格仍正常渲染。
- 修复：全文翻译输入不再混入本地图片路径与表格 HTML；结构性资源字段不再进入文本提取与 Markdown 回退，无图注且无 OCR 正文的视觉块不再提交翻译。
- 修复：历史翻译缓存中以 `images/` 资源路径开头的污染译文自动失效，下次全文翻译重新生成，无需手动清理缓存。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
