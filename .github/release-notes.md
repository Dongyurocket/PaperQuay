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

- Bilingual paper titles: papers can carry a Chinese title alongside the original. Edit it manually or generate it with your translation model, and switch the library between bilingual, Chinese-only, and original-only display modes. Chinese titles are searchable.
- Translated PDF attachments and PDF compare reading: attach a retainpdf-translated PDF to a local library paper and read it side by side with the original, with bidirectional page-by-page scroll sync that can be toggled off. Attach, replace, or remove the translated copy from either the library details panel or the reader itself.
- Translated PDFs are included in WebDAV backups, and restores across devices or data directories now fix up attachment paths so the translated copy stays openable.

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

- 文献支持中英双语标题：可手工编辑中文标题，或用翻译模型一键生成；文献库支持“中英 / 中文 / 原文”三种显示模式，中文标题可搜索。
- 支持为本地文献附加 retainpdf 翻译版 PDF，阅读器新增“PDF 对照”模式：左侧原版、右侧翻译版，按页码双向同步滚动，可随时关闭；文献库详情和阅读器内均可附加、替换、移除。
- 翻译版 PDF 随 WebDAV 备份上传；跨设备或跨数据目录恢复时自动修正附件路径，保证恢复后可直接打开。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
