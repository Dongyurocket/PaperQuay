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

- **AI Block Re-parse & Formatting**: In BlockViewer, select any unsatisfactory structured block and trigger "AI Re-parse" from either the block header toolbar or context menu. Choose any configured AI model to re-parse and fix broken OCR or layout.
- **Strict Anti-Filler Constraints & Defensive Sanitization**: Enforces strict zero-filler system prompts forbidding any greetings, conversational remarks, or markdown code fence wrappers. Automatically strips `<think>` tags, code fences, and introductory prefixes on both backend and client layers.
- **Automatic Drop Cap Artifact Sanitization**: Automatically fixes Drop Cap letters erroneously classified as superscripts (e.g. `U<sup>RBAN ...</sup>` -> `Urban ...`), restoring natural paragraph flow and line wrapping.
- **Automatic Nomenclature Table Reconstruction**: Automatically recovers collapsed and concatenated borderless symbol lists and Nomenclature sections, restoring missing delimiters, decoupling symbols from text, and reformatting them into clean Markdown tables with KaTeX math rendering.

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

- **不满意区块 AI 大模型重新识别**：BlockViewer 结构块在悬浮操作栏（「✨ AI 重析」）和右键菜单中支持对任意识别不满意的区块调用大模型进行二次重构与排版修复；支持下拉自由选择用户配置的任意大模型，并提供「智能排版纠错」、「表格/术语表结构化」、「数学公式提取」三种模式及补充指令输入。
- **无多余内容严格约束与双重防御剥离**：设计了极端严密的负向约束系统提示词（强制禁止任何问候、开场白、解释废话或代码块包裹），并在 Node.js 后端与渲染层配备双层防御性清洗机制，自动剔除思考标签（`<think>...</think>`）、外层代码块定界符与可能逃逸的前置/后置废话，确保输出 100% 纯净学术 Markdown。
- **首字下沉（Drop Cap）伪上标自动修复**：针对学术论文常见的首字下沉排版（如段首大号 `U` 跨两行高度导致右侧文本被判定为偏高上标 `U<sup>RBAN ...</sup>` 或 `U^{RBAN ...}`），自动规约并还原为标准大小写词汇（如 `Urban`），同时修复单字母与大写词干之间空格截断缺陷，消除异常留白与错位换行。
- **术语表（Nomenclature）无框表格自动重构**：彻底解决学术论文无框术语表被版面分析误判为普通文本段落、因“去除软换行”而压平坍缩为整团乱码的问题；智能解耦变量符号与描述之间的字符粘连（如 `Bnumber` $\to$ `$B$` 与 `number`、`C_Bbattery` $\to$ `$C_B$` 与 `battery`、`mmass` $\to$ `$m$` 与 `mass`、`cchord` $\to$ `$c$` 与 `chord`），自动将其重构为排版优雅的两列 Markdown 变量定义表，数学符号自动以 KaTeX 矢量公式呈现。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
