<h1 align="center">PaperQuay</h1>

<p align="center">
  中文 | <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <strong>开源 AI 论文工作台，覆盖 PDF 阅读、全文翻译、结构化概览、内联笔记、Zotero 导入、Agent 工作流和本地 RAG。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.39-2563eb?style=flat-square" alt="Version v0.1.39">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-4b5563?style=flat-square" alt="Windows macOS Linux">
  <img src="https://img.shields.io/badge/built%20with-Electron-47848f?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-0f766e?style=flat-square" alt="React TypeScript">
  <img src="https://img.shields.io/badge/storage-local%20SQLite-111827?style=flat-square" alt="本地 SQLite 存储">
  <img src="https://img.shields.io/badge/editor-Tiptap-0d9488?style=flat-square" alt="Tiptap editor">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

<p align="center">
  <a href="#快速导航">快速导航</a> |
  <a href="#paperquay---保持阅读心流的开源-ai-论文工作台">为什么选择 PaperQuay</a> |
  <a href="#已完成功能">当前功能</a> |
  <a href="#第一次使用流程">快速开始</a> |
  <a href="#本地开发">本地开发</a>
</p>

> 💡 **项目说明与二次开发背景**：
> 本仓库是基于上游官方开源项目 [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay) 进行二次开发与功能增强的个人 Fork 版本（由 [@Dongyurocket](https://github.com/Dongyurocket) 维护，开源许可沿用 `AGPL-3.0-only`）。
> 在保持与上游主干持续同步演进的同时，本项目重点针对**科技文献精细排版清洗、PDF 原始切片（BBox Crop）对照、AI 大模型区块级重构、Zotero 本地库精细化选择性同步、MCP 知识库标准服务与外部 Agent 深度协同**等科研场景进行了深度定制与功能扩展。二次开发、上游同步、本地构建和更新流程详见 [开发手册](./docs/DEVELOPMENT.zh-CN.md)。

<p align="center">
  <img src="./docs/assets/readme-hero.svg" alt="PaperQuay feature overview" width="920">
</p>

---

## 快速导航

<p>
  <a href="#paperquay---保持阅读心流的开源-ai-论文工作台">问题与定位</a> |
  <a href="#近期更新">近期更新</a> |
  <a href="#paperquay-有什么不同">差异点</a> |
  <a href="#核心工作流">核心工作流</a> |
  <a href="#已完成功能">已完成功能</a> |
  <a href="#技术架构">技术架构</a> |
  <a href="#zotero-兼容">Zotero 兼容</a> |
  <a href="#待做计划">待做计划</a>
</p>

---

## 近期更新

### v0.1.39 - Zotero 本地文献库选择性同步与 MCP 工具链深度联动

- **按需选择性同步**：打破过去只能整体无差别全量导入的限制，支持按分类树精准浏览、多字段条件模糊检索（标题、作者、年份、DOI），并可按指定文献条目挑选同步入库。
- **PaperQuay MCP 服务端扩展**：新增 4 个标准 MCP 工具（`zotero_list_collections`、`zotero_search_items`、`zotero_preview_sync`、`paperquay_sync_from_zotero`），供外部 Agent 免侵入完成探测、检索、差量比对与安全入库。
- **高可靠入库与防重机制**：严格执行 DOI 精准匹配、标题标准化比对与 PDF SHA-256 内容哈希校验三层防重；深度解析补全作者列表、出版物、DOI、摘要等学术元数据。
- **自动化协作联动**：发布专属 `paperquay-zotero-sync` 技能，确立「意图解析 ➔ 检索预检 ➔ 差量清单确认 ➔ 批准后精准入库」的高可靠人机交互 SOP。

### v0.1.38 - 首字下沉与术语表自动修复 & AI 大模型区块级重构

- **AI 大模型区块级重析重构**：在 BlockViewer 结构块操作栏（「✨ AI 重析」）和右键菜单中支持对任意识别不满意的区块调用大模型进行二次重构，提供「智能排版纠错」、「表格/术语表结构化」、「数学公式提取」三种模式，具备负向约束与双层防御性清洗，输出纯净学术 Markdown 并支持实时对比与一键撤销还原。
- **首字下沉（Drop Cap）排版修复**：自动规约学术论文段首大号下沉字母导致的断裂与伪上标缺陷（如 `U<sup>RBAN ...</sup>` 还原为 `Urban`），彻底消除异常留白与错位换行。
- **无框术语表（Nomenclature）自动重构**：智能解耦科技论文变量符号与描述之间的字符粘连（如 `Bnumber` $\to$ `$B$` 与 `number`），自动重构成两列排版优雅的 Markdown 变量定义表，数学符号自动以 KaTeX 矢量公式渲染。

### v0.1.37 - 科技文献交叉引用误判伪上标与标点粘连修复

- **交叉引用误判清洗**：自动规约版面模型在紧随标点的科技文献交叉引用实体（`Table 8,`、`Fig. 2,`、`Eq. 3,`、`Section 4` 等）上误触发的伪上标，还原标准正文标号。
- **标点空格自动补全**：自动修复去除伪上标后遗留的逗号与后续单词粘连缺失空格问题（如 `Table 8,while` 自动修正为 `Table 8, while`），在渲染、全文检索与 RAG 切片链路全局生效。

### v0.1.36 - PDF 原始区域切片（BBox Crop）回退机制与公式兜底

- **一键原 PDF 切片对照**：BlockViewer 结构块（段落、公式、算法、表格等）支持在识别排版与原版 PDF 高保真矢量切片之间一键自由切换，方便核对原始排版与细微常数。
- **公式解析失败原图兜底**：当公式语法错误导致 KaTeX 无法解析时，错误卡片中直接内联展开原 PDF 高清矢量切片，保障公式核对准确无误、科研阅读流程不中断。
- **高清离屏渲染与缓存**：基于 PDF.js 实现 2.0x Retina 矢量离屏裁剪与轻量 LRU 内存缓存，小字号上下标清晰可见。

### v0.1.35 - 连字伪上标清洗 & 正规学术上标优雅渲染

- **连字伪上标自动清洗**：彻底消除 MinerU 解析中因西文连字（`fi`、`fl`、`ff` 等）误判产生的 `<sup>fi</sup>` 等伪上标乱码，自动还原完整英文词汇。
- **正规学术上下标渲染**：自研零依赖 `remarkSuperscriptPlugin` 插件，完整支持 `<sup>`/`<sub>` 标签的语义排版，解决单位（如 $\text{kg/m}^2$）、引用标号（如 $^{[1-3]}$）乱码或裸露 HTML 标签问题。
- **公式排版防撞保护**：行内公式检测增加 HTML 标签保护，消除公式定界符相邻拼接导致的粘连语法报错，优化算法块多行排版层次。

### 历史核心里程碑（v0.1.32 - v0.1.34）

- **v0.1.34 可追溯的 AI 笔记润色**：Tiptap 笔记编辑器支持仅优化文字、笔记关联文献或本地知识库三档范围润色，严格约束证据锚点，防止模型伪造引用与位置。
- **v0.1.33 深度中文文献支持**：中文文献免翻译自动直填、trigram 中文全文检索、MinerU 解析后后台自动索引入库、LLM 首页元数据智能兜底。
- **v0.1.32 MCP 知识库服务 & 译文集中管理**：内置独立标准 MCP stdio 知识库服务，提供给外部 Agent 检索论文、RAG 切片与笔记；支持译文 PDF 统一集中存放与安全迁移；扩展支持书籍、学位论文、研究报告等学术类型与引用字段。

*详细版本发布记录与历史变更见 [更新日志](./CHANGELOG.md)。*

---

## PaperQuay - 保持阅读心流的开源 AI 论文工作台

**PaperQuay 不只是 PDF 阅读器、AI 总结工具，也不是 Zotero 的附属工具。** 它是一款本地优先、开源免费的桌面端 AI 论文工作台，面向研究生、科研工作者和论文阅读重度用户，目标是在同一个应用中完成论文导入、PDF 阅读、AI 翻译、论文概览、内联阅读笔记、标签管理、Zotero 文献库导入、Agent 文献整理和本地 RAG 知识库构建。

传统论文阅读往往需要在 Zotero、PDF 阅读器、翻译工具、ChatGPT 和笔记软件之间频繁切换。PaperQuay 希望把导入、阅读、理解、翻译、批注、笔记、整理和知识库构建合并到一个连续的桌面端流程中，同时保留 Zotero 兼容能力，但不把 Zotero 作为必要依赖。

技术上，PaperQuay 主要基于 Electron + React + TypeScript/Vite 构建跨平台桌面端应用。React 渲染层负责文献库、PDF 阅读器、富文本笔记、Agent 工作区和设置界面；Electron 主进程与本地 Node.js 后端模块负责文件系统访问、IPC 通信、Zotero 导入、SQLite 持久化、应用更新和跨平台打包。PDF 阅读与渲染主要基于 PDF.js，富文本笔记基于 Tiptap/ProseMirror，本地数据使用 SQLite/sql.js 及 sqlite-vec 存储文献、笔记、阅读记录和 RAG 索引；AI 能力通过 OpenAI-compatible API 接入，用于论文概览、全文/划词翻译、Agent 工具调用和 RAG 检索增强问答。

| 科研工作流痛点 | 传统工具 | PaperQuay |
| -------------- | -------- | --------- |
| 翻译延迟打断阅读 | 通常需要划词后等待 API 返回 | 可提前翻译 MinerU 结构块，阅读时瞬间跳转到缓存译文 |
| 左右对照影响专注 | 两栏来回扫视，格式也难以完全保持 | 保留原始 PDF，需要时跳转到精确对应译文 |
| 纯中文文件丢失原文语境 | 原文用词、术语和学术表达被隐藏 | 原文、结构块、译文、笔记和概览保持关联 |
| 论文笔记容易脱离上下文 | 笔记放在独立应用里，PDF 位置和文献关系丢失 | 富文本笔记、标签、双向链接、文献引用和反向链接写入本地文献库 |
| 大量论文速读繁琐 | 反复上传 PDF 给大模型，再手动整理结果 | 在本地文献库中生成并保存结构化论文概览 |
| AI 模型选择受限 | 只能用内置模型或平台计费规则 | 支持自定义 OpenAI 兼容接口、模型和运行参数 |
| 大型文献库难维护 | 重命名、打标签、元数据和分类主要靠手动 | Agent 可辅助批量重命名、元数据补全、打标签和分类 |
| Zotero 迁移不方便 | 要么继续依赖 Zotero，要么手动重建 | 可选导入 Zotero 分类、标签和 PDF 附件 |

---

## PaperQuay 有什么不同

<p align="center">
  <img src="./docs/assets/show.gif" alt="PaperQuay workflow demo" width="1200">
</p>

<p align="center">
  <em>动态流程演示：从文库浏览、打开论文、查看结构化阅读，到进入 Agent 工作区，整个过程都在同一个桌面工作流内完成。</em>
</p>

### 块级瞬间跳转翻译

PaperQuay 使用更适合长时间论文阅读的翻译范式。它可以提前翻译并缓存 MinerU 解析出的结构块。之后阅读时，点击原文块即可快速跳转到对应译文，翻译不再必须发生在每次点击或划词之后。

### 基于 Tiptap 的笔记工作区

PaperQuay 内置独立的 Notes 工作区，编辑器基于 Tiptap。每篇笔记都会在本地保存 Tiptap JSON、渲染 HTML 和用于搜索的纯文本。编辑器支持标题、列表、任务列表、代码块、表格、图片、数学公式、高亮、链接、斜杠菜单式插入、文件夹、置顶、收藏、大纲、反向链接和本地自动保存。

笔记不是独立在文献库之外的孤岛。你可以用 `[[笔记]]` 连接想法，用 `#标签` 组织主题，用 `@paper` 引用文献，并通过这些内联引用在笔记和论文之间跳转，让阅读、摘录和后续整理保持在同一个研究工作流里。

### 论文速读概览页

PaperQuay 不只适合精读，也适合大批量速读筛选论文。在概览页中，每篇论文都可以直接展示由大模型生成的背景、研究问题、方法、实验设置、主要发现、结论和局限等信息。

### 阅读时间可视化

PaperQuay 会记录 PDF 不同位置的停留阅读时间，并在文献列表显示阅读热力预览，在文献详情面板显示独立的阅读时间图。你可以更直观地看到一篇论文哪些部分真正被读过、哪些部分还没有投入时间。

### 独立文献库，而不是只做导入

PaperQuay 可以独立建立本地文献库，支持 PDF 导入、默认文献存储文件夹、分类、标签、元数据编辑、搜索筛选、笔记和本地 SQLite 持久化。Zotero 仍然兼容，但只是可选导入来源。

### 面向文献管理的 Agent 操作

Agent 工作区不是普通聊天框，而是面向文献库操作设计。它可以辅助批量重命名、元数据补全、智能标签、标签清洗、自动分类和论文总结，并展示工具调用过程和执行结果，方便用户确认。

---

## 核心工作流

| 步骤 | 发生什么 |
| ---- | -------- |
| 1. 导入 PDF | 将 PDF 拖入软件，或从导入窗口选择文件。 |
| 2. 确认元数据 | 检查标题、作者、年份、期刊/会议、DOI、摘要、关键词和重复提示。 |
| 3. 整理文献库 | 创建分类，将论文拖入分类，添加标签并标记收藏。 |
| 4. MinerU 解析 | 将 PDF 转成结构化块，并建立页面区域关联。 |
| 5. 生成论文概览 | 保存可复用的论文速读结果，便于后续筛选和回顾。 |
| 6. 全文翻译 | 缓存翻译后的结构块，让阅读时可以瞬间切换原文与译文。 |
| 7. 阅读与批注 | 高亮、写字、添加笔记、跳转批注，并导出批注后的 PDF。 |
| 8. 查看阅读时间 | 通过阅读时间图和热力预览查看 PDF 不同位置的累计阅读投入。 |
| 9. 写笔记 | 创建 Tiptap 富文本笔记，用文件夹整理，用 `[[标题]]` 连接笔记，用 `#标签` 组织主题，并通过 `@paper` 跳转文献。 |
| 10. 使用 Agent | 让 Agent 对选中文献执行重命名、分类、打标签、补全元数据或总结。 |

---

## PaperQuay 截图

<p align="center">
  <img src="./docs/assets/main.png" alt="PaperQuay literature library workspace" width="1200">
</p>

<p align="center">
  <em>主文库界面：在同一个桌面视图中管理论文、分类、元数据、阅读进度、笔记和 AI 生成的概览。</em>
</p>

<p align="center">
  <img src="./docs/assets/agent.png" alt="PaperQuay agent workspace" width="1200">
</p>

<p align="center">
  <em>Agent 工作区：与论文助手对话、查看执行轨迹、审查工具调用，并在确认后执行批量文库操作。</em>
</p>

---

## 已完成功能

下面是当前桌面端已经落地的能力。

| 模块 | 已完成能力 |
| ---- | ---------- |
| 本地文献库 | 使用本地 SQLite 保存论文、作者、分类、标签、附件、笔记、批注、导入记录、设置和 RAG 索引，RAG 全文检索支持中文（trigram 分词），MinerU 解析后自动入库；文献列表支持多选与批量操作（删除、移动分类、收藏） |
| PDF 导入 | 支持文件选择器和拖拽导入，入库前进入导入确认窗口 |
| 文件管理 | 支持文献存储文件夹、复制/移动/保留原路径、命名规则、原始路径记录和本地私有文件管理 |
| 元数据 | 支持通过 DOI 或标题优先调用 OpenAlex 补全，可配置 OpenAlex API Key / mailto，Crossref 兜底；中文论文远程未命中时用 LLM 从首页文本智能提取，导入前可手动编辑 |
| 分类树 | 支持系统分类、自定义分类、子分类、折叠、右键菜单、拖拽排序、层级调整和收藏 |
| 文献详情 | 支持标题、作者、年份、期刊/会议、DOI、URL、摘要、关键词、标签、笔记、引用、收藏和阅读时间图 |
| 笔记工作区 | 支持独立 Tiptap 笔记工作区、文件夹、搜索、标签、置顶、收藏、大纲、反向链接和本地自动保存 |
| 笔记编辑器 | 支持富文本、标题、列表、任务列表、代码块、表格、图片、数学公式、高亮、链接、组件块和斜杠菜单式插入 |
| 内联笔记链接 | 支持 `[[笔记]]` 双向链接、`#标签`、`@paper` 文献引用、补全菜单，以及笔记和文献之间的内联跳转 |
| 阅读器与排版清洗 | 支持 PDF 阅读、MinerU 结构块视图、PDF 区域联动、阅读热力进度、阅读时间记录和批注工具；自动清洗连字与交叉引用伪上标，优雅渲染正规学术上下标，自动修复首字下沉（Drop Cap）与无框术语表（Nomenclature）重构 |
| 原切片与 AI 重析 | 支持 PDF 原始区域切片（BBox Crop）回退机制，公式解析失败自动切片兜底；支持对任意结构块调用大模型进行二次重析（排版纠错、表格/术语表结构化、数学公式提取，支持对比与撤销） |
| 翻译与译文管理 | 支持全文翻译、块级翻译缓存和划词翻译，模型使用 OpenAI 兼容接口；支持批量翻译文献标题；中文文献自动跳过翻译、中文标题直填入库；支持统一译文 PDF 集中存放与平滑迁移 |
| 引用导出 | 支持多选文献批量导出 Bib：合并为单个 .bib 或每篇一个文件，自动生成去重 citation key，支持期刊、书籍、学位论文、报告等标准条目类型 |
| 论文概览 | 支持背景、研究问题、方法、实验设置、主要发现、结论和局限等速读概览字段 |
| Agent 工作区 | 支持对话、执行轨迹、工具调用卡片、文献选择、元数据工具、重命名、打标签、分类和总结 |
| Zotero 导入与同步 | 支持从 `zotero.sqlite` 全量导入分类、标签和可用 PDF；新增支持基于分类树浏览、条件模糊检索、差量预检与三层防重校验的选择性精准同步 |
| MCP 知识库服务 | 内置标准 MCP stdio 服务（`bin/paperquay-mcp.cjs`），直连本地 SQLite 提供文献检索、详情、RAG 切片、笔记搜索与 Zotero 同步工具链，供外部 Agent 零侵入直连 |
| 备份 | 支持通过 WebDAV 备份和恢复文献库数据库、笔记数据库和本地 RAG SQLite 数据库 |
| 软件更新 | 支持应用内检查更新、Windows 和 Linux 自动更新流程，以及 macOS 打开发布页手动下载 |
| 知识图谱 | 支持文献、笔记、标签、分类和引用节点，语义相似边、Crossref 参考文献同步、共同作者关系、自定义与 AI 关系，fcose 力导向全局布局、局部同心圆视图和 PNG/JSON 导出 |
| 综述写作 | 支持大纲蓝图、分段并发写作、RAG 检索上下文、失败任务独立上报与续跑，以及 Word 导出（OMML 公式、中英文标题、参考文献和正文插图） |
| 主题 | 支持浅色和深色主题，面向桌面端长时间阅读优化 |

---

## 第一次使用流程

1. 打开设置，选择默认文献存储文件夹。
2. 通过拖拽或导入按钮添加 PDF。
3. 在导入确认窗口中检查或修改元数据。
4. PaperQuay 会复制 PDF 到文献库存储文件夹，并写入本地文献库。
5. 在左侧创建分类和子分类。
6. 将文献拖入分类，添加标签，标记收藏，然后打开阅读。
7. 打开 Notes 工作区，创建富文本笔记、连接相关想法，并把笔记和文献关联起来。
8. 如需 AI 功能，在设置中配置 OpenAI 兼容接口和模型。
9. 如需 MinerU 解析，在设置中配置 MinerU API key。
10. 如果已有 Zotero 文库，可以在设置中选择 Zotero 数据目录并导入分类和 PDF。

---

## 技术架构

PaperQuay 使用 Electron 作为桌面宿主。React 渲染进程通过 IPC 调用本地 Electron 后端，用于文件系统访问、本地持久化、Zotero 导入、PDF 处理和打包。

| 路径 | 职责 |
| ---- | ---- |
| `src/` | React + TypeScript 前端界面、功能模块、状态和服务层 |
| `src/features/literature/` | 本地文献库、导入流程、分类树和文献详情 |
| `src/features/reader/` | 阅读器外壳、联动阅读工作区、设置和 AI 阅读动作 |
| `src/features/pdf/` | PDF 渲染、覆盖层、批注表面和 PDF 交互 |
| `src/features/blocks/` | MinerU 块渲染和结构化内容视图 |
| `src/features/agent/` | Agent 对话界面、执行轨迹、工具卡片和文献库操作入口 |
| `src/features/notes/` | 基于 Tiptap 的笔记工作区、编辑器工具栏、自定义补全扩展、大纲和反向链接 |
| `src/stores/useNotesStore.ts` | 笔记、标签、当前笔记、自动保存和工作区错误状态管理 |
| `src/services/` | 前端到 Electron IPC commands 的调用封装 |
| `src/platform/electron/` | 渲染进程侧的命令、事件、窗口控制和文件拖放桥接封装 |
| `electron/` | Electron 主进程、preload 桥接、命令后端、打包辅助和本地持久化 |

笔记编辑器使用官方 Tiptap 包实现，并参考了上游仓库 [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) 的源码。本地的 `WikiLink`、`HashTag` 和 `PaperReference` 扩展沿用了官方 `Mention` 节点和 `@tiptap/suggestion` 插件的架构：由 Tiptap inline node 保存结构化属性，由 Suggestion 插件负责匹配、渲染、键盘导航和插入。编辑器的组件块也参考了 Tiptap 官方 React NodeView 示例：自定义块是通过 `ReactNodeViewRenderer` 渲染的真实 Tiptap 节点，并用 `NodeViewWrapper` 和 `NodeViewContent` 分离不可编辑控件和可编辑内容。

---

## 环境要求

- Node.js 18 或更高版本
- Windows、macOS 或 Linux

可选外部服务：

- MinerU API key：用于云端 PDF 结构解析。
- OpenAI 兼容 API key：用于论文概览、翻译、问答和 Agent。
- 网络连接：用于 OpenAlex 和 Crossref 元数据补全。
- 可选 OpenAlex Premium API key 和 `mailto` polite-pool 邮箱：用于更稳定的批量元数据查询。

---

## 本地开发

安装依赖：

```bash
npm install
```

启动桌面开发模式：

```bash
npm run dev
```

只构建前端：

```bash
npm run build
```

预览构建后的 Web 资源：

```bash
npm run preview
```

构建桌面安装包：

```bash
npm run electron:build
```

---

## Zotero 兼容与选择性同步

PaperQuay 可以读取包含 `zotero.sqlite` 的 Zotero 本地数据目录。导入与同步时会将 Zotero 数据库复制到临时只读工作文件中读取，完全不会修改 Zotero 原始数据库。

- **全量导入**：在设置中选择 Zotero 数据目录，一键将全部分类树、标签和可用本地 PDF 导入 PaperQuay。
- **选择性精准同步（二次开发增强）**：打破全量导入的限制，支持查看分类条目树，支持按关键词、作者、年份、DOI 等条件精确检索，并在导入前执行差量预检（区分就绪、已存在去重、缺少附件）。
- **外部 Agent 自动化协同**：内置的 MCP stdio 服务（`bin/paperquay-mcp.cjs`）封装了完整的 Zotero 检索、预检与同步工具，配合 Proma 等 Agent 技能可实现“自然语言指令 ➔ 预检确认 ➔ 事务入库”的全流程无缝协同。

Zotero 是 PaperQuay 的兼容来源之一，不是必要依赖。你可以完全不使用 Zotero，直接在 PaperQuay 中建立自己的文献库。

---

## 数据与隐私

PaperQuay 是本地优先。文献库、笔记和本地 RAG 索引保存在 SQLite 数据库，导入的 PDF 保存到你配置的文献存储文件夹中。

可选 WebDAV 备份会把本地文献库、笔记和 RAG 数据库上传到你配置的远端服务。API key、本地 PDF、解析产物和备份文件都不应该进入源码仓库。

不要提交本地数据、API key、PDF、解析结果、笔记数据库或备份文件。当前 `.gitignore` 已默认排除运行时目录、SQLite 数据库、旧版 JSON 文献库数据、API key 文件、构建产物、备份包和私人 PDF。

---

## 待做计划

下面这些是还没完全落地、或需要继续深化的方向；已经实现的笔记、阅读时间图、WebDAV 备份和软件更新能力已放在“当前功能”中。

- 从 PDF 首页提取更稳定的元数据。
- 增加 DOI / arXiv / Semantic Scholar 补全来源。
- 深化 PDF 区域、批注和独立笔记之间的双向绑定。
- 增加引用格式生成和导出。
- 增加文件夹监听和自动导入队列。
- 增加跨论文和笔记的 RAG 知识库问答。
- 支持一键生成综述、Word / LaTeX 草稿等研究写作能力。
- 完善签名后的 macOS 发布流程，让安装和更新检查更顺畅。
- 本地优先模型稳定后，再考虑可选云同步。

---

## 致谢

- **上游原项目**：感谢 [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay) 创造了如此优秀的本地优先 AI 论文工作台基础架构与丰富特性。
- **社区与灵感**：PaperQuay 的不少设计与打磨，也受到 [LinuxDo 社区](https://linux.do/) 讨论、反馈和想法的启发。
- **编辑器框架**：PaperQuay 的笔记工作区构建在 [Tiptap](https://github.com/ueberdosis/tiptap) 之上。感谢 Tiptap 维护者提供可扩展的编辑器框架与示例，支撑 PaperQuay 的笔记体验。

---

## 许可证

PaperQuay Community Edition 使用 `AGPL-3.0-only` 许可证。

如果你分发修改后的版本，或把修改后的版本作为网络服务提供给用户，需要保留许可证和版权声明，说明修改内容，并按 AGPL 要求提供对应源代码。闭源商业授权、商业支持或品牌名称使用许可需要与维护者另行协商。品牌使用说明见 [TRADEMARKS.md](./TRADEMARKS.md)。
