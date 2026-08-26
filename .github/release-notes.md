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

- 文库页支持多选文献：Ctrl/Cmd 点选、Shift 范围选择或行首复选框；多选后列表顶部出现批量工具栏，支持批量删除、移动分类和收藏，详情面板切换为批量摘要视图。
- 批量标题翻译：按文库批量并发设置对多选文献逐篇调用翻译模型，中文标题直接写入文献信息，已有中文标题的文献自动跳过。
- 批量导出 Bib：多选文献可导出为合并的单个 .bib 文件或每篇一个 .bib 文件，自动生成去重 citation key，并按期刊/会议/预印本启发式推断条目类型。
- 思考强度新增“最高（max）”档；阅读器侧栏问答的思考强度选择器在窄宽度下不再消失。
- 设置页新增“测试 Embedding 连接”：成功显示向量维度与耗时，并在服务缺少 embeddings 端点时给出明确提示。
- 修复：文库预览中已生成的概览在打开文献时被重复生成——两侧此前使用不同的缓存键，现已统一并自动迁移旧缓存。
- 修复：本地 RAG 检索失败时 Agent 回答不再静默回退，现在会显示与侧栏问答一致的未命中提示。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
