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

- **Clean Cross-Reference Fake Superscripts**: Eliminates false superscript tags (`<sup>...</sup>` or Unicode superscripts) incorrectly applied to cross-reference numbers (e.g. `Table 8`, `Fig. 2`, `Eq. 3`) by MinerU/OCR layout models when followed by punctuation.
- **Restore Consecutive References & Missing Comma Spaces**: Supports consecutive cross-references (`Table 8 and 9`, `Figure 2, 3, and 4`) and automatically restores missing spaces after commas (e.g. `Table 8,while` -> `Table 8, while`).
- **Pipeline-Wide Correctness**: Cleans text across BlockViewer rendering, full-text search, RAG chunking, AI summary, and translation pipelines.

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

- **交叉引用误判伪上标智能清洗**：彻底解决 MinerU 与 OCR 版面分析模型在遇到紧随标点的交叉引用（如 `Table 8,`、`Fig. 2,`、`Eq. 3,`）时，因误触发文献引用先验而将正文编号错误打上 `<sup>` 的问题；覆盖科技文献常见的 Table、Figure、Equation、Section、Algorithm 等实体，自动将 `Table <sup>8</sup>` 或 Unicode 上标 `Table ⁸` 还原为标准正文编号 `Table 8`。
- **连续引用与标点空格自动修复**：支持串联交叉引用（如 `Table 8 and 9`、`Figure 2, 3, and 4`）的连续上标还原，并自动修复剥离上标后遗留的逗号与后续单词粘连缺失空格缺陷（如 `Table 8,while` 自动修正为 `Table 8, while`）。
- **全链路一致性保障**：清洗在结构块渲染、全文搜索、RAG 向量切片、AI 摘要与翻译主链路统一生效，保障学术阅读与知识检索质量。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
