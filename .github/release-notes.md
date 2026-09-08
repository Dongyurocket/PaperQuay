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

- **Automatic Ligature & Fake Superscript Sanitization**: Automatically cleans up OCR artifacts such as `<sup>fi</sup>`, `<sup>fl</sup>`, `<sup>–</sup>`, and `<sup>’</sup>` caused by Latin typography ligatures in MinerU parsing results, restoring clean English words across reader views, full-text search, RAG indexing, and AI translation.
- **Native Academic Superscript & Subscript Rendering**: Introduced a dedicated Markdown superscript plugin that gracefully renders standard scientific superscripts and citations (such as $kg/m^2$ and $^{[1-3]}$) with fine-tuned typography rather than exposing raw HTML markup.
- **Formula Delimiter Collision & Multi-Line Layout Fix**: Resolved KaTeX parsing crashes and red error text caused by adjacent inline formulas accidentally colliding into invalid `$$` delimiters. Preserved multi-line layout and comment hierarchy for complex formula and algorithm blocks.

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

- **连字与伪上标自动清洗**：自动清理 MinerU 解析结果中因西文连字（`fi`、`fl`、`ff`、`ffi`、`ffl`）及连字符误判产生的 `<sup>fi</sup>`、`<sup>fl</sup>`、`<sup>–</sup>`、`<sup>’</sup>` 乱码，还原为正常单词与标点，彻底修复正文、全文搜索、RAG 向量切片及 AI 翻译中的词汇碎裂问题。
- **正规学术上标优雅渲染**：内置 Markdown 上标/下标插件，将单位（如 $kg/m^2$）、文献引用标号（如 $^{[1-3]}$）、作者注记等正确渲染为精细对齐的学术上标样式，不再露出 HTML 原始标签或误包装为畸形数学符号。
- **公式定界符防撞与多行排版优化**：修复相邻行内公式拼接粘连生成非法 `$$` 导致 KaTeX 语法错误整段变红的缺陷；优化算法与复杂推导公式块的换行分段展示，恢复清晰的层次排版。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
