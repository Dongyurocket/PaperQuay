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

- **Traceable AI Note Polishing**: The rich-text note editor can now polish a selection or generate a structured revision of the full note. Results are previewed before they are applied, so the original note is never silently overwritten.
- **Scoped Knowledge-Base Evidence**: Choose language-only polishing, papers linked to the note, or the complete local knowledge base. Missing embeddings, unavailable indexes, and retrieval failures fall back to language-only polishing with a clear notice.
- **Clickable Source Locations**: Retrieved evidence is saved as existing paper anchors. A click opens the paper at the corresponding page or structural block. The model selects only server-issued evidence IDs and cannot fabricate source papers or locations.

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

- **可追溯的 AI 笔记润色**：富文本笔记编辑器支持润色选中文本，或生成整篇笔记的结构化版本。生成结果先预览，再由用户明确应用，原笔记不会被静默覆盖。
- **可限定范围的知识库证据**：可选择仅优化文字、仅使用笔记关联文献，或使用整个本地知识库。未配置 Embedding、索引缺失或检索失败时，会明确提示并降级为纯文本润色。
- **可点击的原文定位**：检索证据以现有文献锚点写入笔记；点击可打开对应论文并跳转到相关页码或结构块。模型只能选择服务器已提供的证据编号，不能伪造文献或位置。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
