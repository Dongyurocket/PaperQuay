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

- Review Word export now supports editable OMML formulas, missing-figure fallbacks, localized section titles, 480-twip paragraph indentation, richer references, and inline figure placement from model output.
- Review writing is more resilient: failed writing tasks no longer stop the whole queue, and more retrieved papers can contribute detailed RAG context.
- Knowledge graph workflows now support synced Crossref reference data, citation edges for papers already in the library, co-author relations, clearer edge legends, graph export, searchable relation targets, and direct node interactions.
- MinerU parsing can use a configurable API base URL, so local MinerU deployments can be used while the official endpoint remains the default.
- Library storage folder changes now migrate the existing storage structure and attachment paths into the new location.
- Reader and notes workflows now include selection-translation highlighting, a resizable library navigation sidebar, paper-list sorting, and safer note external-update detection after local saves.

## Notes

- AI features require your own compatible model endpoint and API key in Settings.
- MinerU parsing requires a MinerU API key unless you are using already parsed local cache data or a compatible local MinerU deployment.
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

- 综述 Word 导出支持可编辑 OMML 公式、缺失图片容错、本地化节标题、480 twip 首行缩进、更完整参考文献信息，以及根据模型输出在正文中插图。
- 综述生成更稳健：单个写作任务失败不会中止整个队列，更多检索论文可参与深度 RAG 上下文。
- 知识图谱支持同步 Crossref 参考文献数据，只为文库内论文生成引用关系，并补充共同作者关系、边颜色图例、图谱导出、关系目标搜索和节点右键交互。
- MinerU 解析支持配置 API Base URL，便于使用本地部署的 MinerU；未配置时仍默认使用官方地址。
- 修改默认文献存储目录时，会迁移已有目录结构和附件路径到新位置。
- 阅读与笔记流程新增划词翻译高亮、本地文库导航栏拖动调整宽度、文献列表排序，并修复本地保存后误提示外部更新的问题。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- MinerU 解析需要有效的 MinerU API Key，除非你使用已经解析好的本地缓存或兼容的本地 MinerU 服务。
- Release 资源由 GitHub Actions 自动生成。
