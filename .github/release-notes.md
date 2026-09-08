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

- **Original PDF BBox Crop Fallback**: Added a "PDF Crop" button to BlockViewer cards and context menus. Readers can switch any structural block (paragraphs, formulas, algorithms, tables) between parsed Markdown and high-fidelity 2x vector crops from the original PDF at any time.
- **Instant Fallback for Formula Parse Failures**: When complex formulas encounter OCR errors or invalid LaTeX syntax, the error box automatically offers a "View PDF Crop" action to display the exact original PDF formula region inline, keeping reading uninterrupted.
- **Retina 2x Vector Offscreen Rendering & LRU Caching**: Offscreen canvas renders crisp 2x resolution slices using PDF.js with memory caching for instant toggling and an enlargeable modal preview.

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

- **PDF 原始区域切片（BBox Crop）回退机制**：BlockViewer 结构块（段落、公式、算法、表格等）右上角及右键菜单新增「原 PDF 切片」切换功能，可在识别排版与原版 PDF 矢量切片图之间随时一键互切，便于科研阅读中快速核对原文排版与微小常数。
- **公式解析失败原切片即时兜底**：当公式因 OCR 识别缺陷或语法错误导致 KaTeX 无法解析时，报错卡片右上角提供「查看原 PDF 切片」按钮，直接内联展示高清原图，推导核对 100% 准确不中断。
- **Retina 2x 高清离屏渲染与 LRU 缓存**：基于 PDF.js 实现 2.0x 高保真离屏裁剪，保证公式微小上下标和微小符号清晰可见，并支持点击放大预览。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
