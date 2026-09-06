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

- **Knowledge Base MCP Server**: Standard Model Context Protocol (MCP) stdio service (`bin/paperquay-mcp.cjs` / `npm run mcp`) allowing external AI coding agents such as Proma, Pi, Codex, and Claude Code to search your literature and grounded RAG evidence chunks with citation locations (page numbers and block IDs). Built on native `node:sqlite` in read-only mode for zero-lock, conflict-free background access even when the desktop client is closed.
- **Unified Translated PDF Folder**: Organize and centralize retainpdf translated PDF attachments into a designated directory (defaults to `<storageDir>/translated-pdfs` or any custom folder). Supports seamless automatic migration and backwards compatibility with legacy library files.
- **Expanded Academic Item Types & Citation Metadata**: Comprehensive support for scholarly types beyond journal papers, including Books (`book`), Book Sections (`bookSection`), Theses/Dissertations (`thesis`), and Technical Reports (`report`). Adds structured citation fields: Publisher, Institution/University, Report Number, Volume, Issue, Pages, ISBN, and ISSN, complete with idempotent SQLite migration, interactive details editing, and authentic BibTeX generation (`@book`, `@techreport`, `@phdthesis`, `@incollection`).

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

- **知识库 MCP stdio 服务**：新增符合标准 Model Context Protocol (MCP) 的知识库服务（`bin/paperquay-mcp.cjs` / `npm run mcp`），让 Proma、Pi、Codex、Claude Code 等外部 Agent 能够直接检索本地论文库和 RAG 正文证据切片并获得精准页码与段落定位。基于 `node:sqlite` 原生只读模式直连数据库，无锁且无需桌面端持续运行即可独立使用。
- **译文 PDF 统一文件夹归档**：文库偏好设置支持配置统一译文 PDF 存放目录（默认保存在 `<storageDir>/translated-pdfs`，亦可自定义外部路径）。附加 retainpdf 对照 PDF 时自动复制到统一文件夹；更改存储目录时自动平滑迁移已有译文，安全策略防止误删外部文件，同时向下兼容旧版根目录文件。
- **学术元数据与常用引用扩展**：全面支持学术常用的非期刊文献类型，包括书籍（Book）、书籍章节（Book Section）、学位论文（Thesis / Dissertation）、研究报告（Report）、会议论文（Conference Paper）与预印本（Preprint）；新增出版社、高校/授予单位、报告号、卷号、期号、页码、ISBN、ISSN 等学术引用核心字段；SQLite 自动无损列迁移；详情面板支持动态表单与展示卡片；BibTeX 导出支持精准生成 `@book`、`@techreport`、`@phdthesis`、`@incollection` 条目。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
