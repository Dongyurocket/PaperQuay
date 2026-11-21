<h1 align="center">PaperQuay</h1>

<p align="center">
  中文 | <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <strong>开源 AI 论文工作台，覆盖 PDF 阅读、全文翻译、结构化概览、内联笔记、Zotero 导入、外部 Agent 接入和本地 RAG。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.4.36-2563eb?style=flat-square" alt="Version v0.4.36">
  <img src="https://img.shields.io/badge/maintained-Windows%20x64-4b5563?style=flat-square" alt="Maintained: Windows x64">
  <img src="https://img.shields.io/badge/built%20with-Electron-47848f?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TypeScript-0f766e?style=flat-square" alt="React TypeScript">
  <img src="https://img.shields.io/badge/storage-local%20SQLite-111827?style=flat-square" alt="本地 SQLite 存储">
  <img src="https://img.shields.io/badge/editor-Tiptap-0d9488?style=flat-square" alt="Tiptap editor">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-b91c1c?style=flat-square" alt="AGPL-3.0-only">
</p>

<p align="center">
  <a href="./docs/USER_MANUAL.zh-CN.md">用户手册</a> |
  <a href="#近期更新">近期更新</a> |
  <a href="#功能概览">功能概览</a> |
  <a href="#下载与安装">下载与安装</a> |
  <a href="#mcp-与外部-agent">MCP</a> |
  <a href="#本地开发">本地开发</a> |
  <a href="./CHANGELOG.md">更新日志</a>
</p>

> **关于本仓库**：这是上游项目 [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay) 的个人 Fork，由 [@Dongyurocket](https://github.com/Dongyurocket) 维护，许可证沿用 `AGPL-3.0-only`。在跟进上游的同时，重点增强了排版清洗、PDF 原始切片（BBox Crop）对照、AI 区块重析、超长文献拆分与多 Key 轮换、本地 RAG 索引管理、知识库 MCP 混合检索（KNN + FTS5 + RRF）和 Zotero 选择性同步。二次开发、上游同步与构建流程见[开发手册](./docs/DEVELOPMENT.zh-CN.md)。

<p align="center">
  <img src="./docs/assets/readme-hero.svg" alt="PaperQuay feature overview" width="920">
</p>

---

## 这是什么

PaperQuay 是本地优先、开源免费的桌面端 AI 论文工作台，面向研究生、科研工作者和需要大量读论文的用户。导入、阅读、翻译、概览、批注、笔记、整理和知识库检索在同一个应用里完成。Zotero 可以作为导入来源，但不是必需依赖。

| 痛点 | 常见做法 | PaperQuay |
| ---- | -------- | --------- |
| 翻译打断阅读 | 划词后等待 API 返回 | 预先翻译并缓存 MinerU 结构块，点击原文即跳到译文 |
| 对照阅读分散注意力 | 两栏来回扫视，格式难保持 | 保留原始 PDF，需要时跳到对应译文 |
| 笔记脱离上下文 | 笔记在独立应用里，丢失 PDF 位置 | 笔记、标签、双链和文献引用存入本地文献库，可跳回原文 |
| 大批量速读费时 | 反复上传 PDF 给大模型 | 在文献库中生成并保存结构化概览 |
| 模型选择受限 | 只能用内置模型 | 支持任意 OpenAI 兼容接口、模型和参数 |
| 文献库难维护 | 重命名、打标签、分类靠手动 | 外部 Agent 经 MCP 批量补全元数据、打标签和分类，写操作可预览、可回读 |

<p align="center">
  <img src="./docs/assets/show.gif" alt="PaperQuay workflow demo" width="1200">
</p>

---

## 近期更新

- **v0.4.36**：文献库「译版 PDF」菜单和阅读器空状态新增「用 RetainPDF 生成译版」：调用本机 RetainPDF 完成整本翻译，自动下载并附加译版 PDF；进度进入全局任务条，重启后可续跑。
- **v0.4.35**：全文翻译的译文缓存写入更稳：应用数据目录和已批准的缓存目录直接放行，遇到 `EPERM` / `EBUSY` 等瞬时错误自动重试并退化为覆盖写入，译文已完整落盘时不再把任务误判为失败。
- **v0.4.34**：批量 MinerU 解析遇到抽取器签名变化的旧索引只跳过该篇，不再一次扫描就把整库排进重嵌入队列；重建留给打开文献、问答懒建或手动重建。
- **v0.4.33**：设置页文案对齐实际行为：Vault 同步只在手动操作或定时任务时执行，模型角色不再提 Agent，备份范围不再包含 Agent 记忆与历史。
- **v0.4.32**：只保留外部 Agent 接入，移除应用内独立 Agent 工作区、Agent 记忆和笔记 AI 润色；退役 PaddleOCR-VL，MinerU 的 OCR 重试成为唯一解析降级入口；MCP 写入改为带版本的记录级写入，新增 `preview_delete_papers` 与 `read_paper_figure`；阅读器问答支持当前文献 / 选定文献 / 全库三档范围。
- **v0.4.31**：移除综述写作工作区与图谱 AI 关系候选，跨文献归纳交由外部 Agent 的证据检索和 `synthesis` 笔记完成；阅读器问答可停止生成，MCP 新增只读 `get_note`。
- **v0.4.30**：阅读器顶栏压缩为一行，PDF 工具行改为单行并支持页码跳转和溢出菜单；新增沉浸阅读（`Ctrl+Shift+F`）；移除「收起状态栏」、底栏和新手引导；中文界面下 AI 概览小标题改为中文。
- **v0.4.29**：论文概览页重做，解析、翻译和生成概览收进「处理」菜单；概览分节显示，文件卡列出原始 PDF、译版 PDF 和 MinerU 结果。

完整记录见 [CHANGELOG.md](./CHANGELOG.md)，安装包见 [Releases](https://github.com/Dongyurocket/PaperQuay/releases)。

---

## 功能概览

| 模块 | 能力 |
| ---- | ---- |
| 本地文献库 | SQLite 保存论文、作者、分类、标签、附件、笔记、批注和设置；拖拽或选择导入 PDF，入库前确认元数据；复制 / 移动 / 保留原路径与命名规则；多选批量操作；组合筛选与排序 |
| 元数据 | 按 DOI 或标题优先查询 OpenAlex，Crossref 兜底；中文论文未命中时用 LLM 从首页提取；论文语言、引用键、作者单位与 ORCID；导出 BibTeX |
| 分类与标签 | 多级分类、拖拽排序、标签、收藏 |
| 文档解析 | MinerU 云端解析（多 API Key 轮换与故障切换，超长文档自动分卷与合并，非 OCR 失败时自动重试 OCR）；强制重新识别；解析缓存图片引用自愈 |
| 阅读器 | PDF 与结构块视图联动、批注、阅读热力与阅读时间图、长文档窗口化渲染、沉浸模式；排版清洗（连字、伪上标、首字下沉、术语表）；BBox 原始切片兜底与单块 AI 重析 |
| 翻译 | 全文翻译与块级缓存、划词翻译、批量翻译标题；中文文献跳过翻译；译版 PDF 附加与语言设置 |
| 论文概览 | 背景、问题、方法、实验、发现、结论、局限分节保存，打开即读缓存 |
| 阅读器问答 | 基于本地 RAG 证据回答，检索范围可选当前文献 / 选定文献 / 全库；引用带文献、页码与证据类型；可停止生成并存为笔记 |
| 笔记 | Tiptap 富文本；8 种页面类型与 11 个模板；`[[双链]]`、`#标签`、`@paper` 文献引用并跳回原文；摘录卡；GB/T 7714 / APA 7 / IEEE 引用样式；笔记图谱与体检；Obsidian 兼容的 Markdown vault 双向同步。规范见 [notes-charter.md](./docs/notes-charter.md) |
| 本地 RAG | 向量 KNN + FTS5 BM25 + RRF 混合检索；索引管理面板（统计、批量建立、暂停 / 继续 / 取消）；文献列表状态角标；单篇可移出知识库 |
| 知识图谱 | 文献、笔记、标签、分类和引用节点；语义相似、参考文献、共同作者与自定义关系；PNG / JSON 导出 |
| Zotero | 读取 `zotero.sqlite` 的临时副本，不改原库；全量导入，或按分类和条件检索、预检后选择性同步 |
| 备份 | 密码保护的 `.pqbackup` 单文件导出与导入，导入后重启替换并保留回滚点 |
| 其他 | 浅色 / 深色主题；命令面板（`Ctrl+K`）；应用内检查更新与 Windows 安装包自动更新 |

各功能的操作说明见[用户手册](./docs/USER_MANUAL.zh-CN.md)。

<p align="center">
  <img src="./docs/assets/main.png" alt="PaperQuay literature library workspace" width="1200">
</p>

---

## 下载与安装

从 [GitHub Releases](https://github.com/Dongyurocket/PaperQuay/releases) 下载 Windows x64 `.exe` 安装包。

自 0.4.24 起只发布、维护和测试 Windows x64。macOS、Linux 等平台可从源码自行打包，作者不维护也不测试；历史版本的其他平台安装包仍保留在 Releases 中。

## 快速开始

1. 在「设置」中配置 OpenAI 兼容接口（Base URL、API Key、模型）。翻译、概览和问答都需要它。
2. 设置文献存储目录和导入模式。
3. 填写 MinerU API Token，用于结构化解析；需要本地 RAG 时再配置 Embedding。
4. 拖入 PDF，确认元数据后入库，然后建分类、打标签、打开阅读。
5. 已有 Zotero 文库时，可在设置中选择 Zotero 数据目录导入。

完整的配置顺序和每项设置的作用见[用户手册 1.2 节](./docs/USER_MANUAL.zh-CN.md#12-首次启动建议按顺序配置)。

可选外部服务：MinerU（结构解析）、OpenAI 兼容 API（概览、翻译、问答）、Embedding API（RAG 与笔记语义检索）、OpenAlex / Crossref（元数据，需联网；可选配置 OpenAlex API Key 与 `mailto`）。

---

## MCP 与外部 Agent

PaperQuay 内置标准 MCP stdio 服务，外部 Agent 可直接读取本地 SQLite，共 28 个工具：

- **只读检索**：`search_papers`、`get_paper_details`、`search_knowledge_base`（`auto` / `hybrid` / `keyword` 三种模式）、`read_paper_content`、`read_paper_figure`、`search_notes`、`get_note`、`list_note_tags`、`list_note_folders`、`list_categories`、`preview_delete_papers`
- **Zotero 同步**：`zotero_list_collections`、`zotero_search_items`、`zotero_preview_sync`、`paperquay_sync_from_zotero`
- **文库写入**：`import_pdfs`、`manage_category`、`set_paper_categories`、`update_paper`、`delete_papers`、`attach_translated_pdf`、`remove_translated_pdf`
- **笔记维护**：`create_note`、`update_note`、`delete_note`、`create_note_folder`、`rename_note_folder`、`delete_note_folder`

写工具在检测到桌面端运行时默认拒绝写入；传 `allowWhileAppRunning: true` 表示受检并行写，必须携带读取到的版本，冲突会拒绝而不是静默覆盖；设置 `PAPERQUAY_MCP_WRITE=off` 可全局只读，`PAPERQUAY_MCP_EMBEDDING=off` 可禁用向量检索的网络请求。

**接入方式**：安装版在「设置 → MCP 服务」复制 Proma / Claude / Codex 配置片段即可。安装版用 `PaperQuay.exe` 加 `ELECTRON_RUN_AS_NODE=1` 运行 `resources/paperquay-mcp/server.cjs`，不需要另装 Node.js；开发模式用 `node bin/paperquay-mcp.cjs`。

仓库 [`skills/`](./skills) 提供四个配套 Agent Skill：`paperquay-knowledge-search`（证据检索）、`paperquay-notes`（笔记维护）、`paperquay-zotero-sync`（预检后同步）、`paperquay-library-manage`（文库写入）。

工具参数、客户端配置、数据目录和检索模式详见 [MCP 接入指南](./docs/MCP_AGENT_INTEGRATION.md)。

---

## 技术架构

Electron 主进程负责文件系统、IPC、SQLite 持久化、Zotero 导入、更新和打包；React 渲染进程负责界面。PDF 渲染用 PDF.js，笔记编辑器用 Tiptap / ProseMirror，数据存储用 SQLite（sql.js）与 sqlite-vec，AI 能力通过 OpenAI 兼容 API 接入。

| 路径 | 职责 |
| ---- | ---- |
| `src/features/literature/` | 文献库、导入、分类树、文献详情 |
| `src/features/reader/` | 阅读器、联动阅读、概览与 AI 阅读操作 |
| `src/features/pdf/` | PDF 渲染、覆盖层与批注 |
| `src/features/blocks/` | MinerU 结构块渲染 |
| `src/features/notes/` | Tiptap 笔记工作区与扩展 |
| `src/services/`、`src/platform/electron/` | 渲染进程到 Electron IPC 的封装 |
| `electron/` | 主进程、preload 与后端命令（`electron/backend/`） |
| `bin/paperquay-mcp.cjs`、`electron/mcp/` | MCP 服务 |
| `skills/` | 配套 Agent Skills |
| `tests/` | 自动化测试 |

笔记编辑器的 `WikiLink`、`HashTag`、`PaperReference` 扩展沿用 Tiptap 官方 `Mention` 节点与 `@tiptap/suggestion` 的架构，组件块参考官方 React NodeView 示例实现。

---

## 本地开发

环境：Node.js 22.18 或更高（CI 使用 Node.js 24）。

```bash
npm ci                   # 安装依赖
npm run dev              # 启动桌面开发模式
npm run build            # 类型检查并构建前端
npm test                 # 运行测试
npm run electron:build   # 构建桌面安装包
```

上游同步、发布流程和文档约定见[开发手册](./docs/DEVELOPMENT.zh-CN.md)、[UPSTREAM.md](./docs/UPSTREAM.md) 和 [RELEASE.md](./docs/RELEASE.md)；贡献方式见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 数据与隐私

PaperQuay 本地优先。文献库、笔记和 RAG 索引存放在本地 SQLite 数据库中，PDF 存放在你配置的文献存储目录中。AI 与 Embedding 请求发往你自己配置的接口。

`.pqbackup` 完整迁移包包含配置与 API Key、三个数据库、文献库引用的 PDF、知识图谱关系、阅读状态与批注、笔记 vault 和 MinerU / 翻译 / 摘要缓存；日常备份不含 RAG 数据库和 MinerU 缓存，体积更小。忘记密码后无法恢复。新版不读取旧 WebDAV 备份，需要时先用 0.4.18 或更早版本恢复到本机再升级。

不要把本地数据、API Key、PDF、解析结果、数据库或备份包提交到代码仓库。安全问题请按 [SECURITY.md](./SECURITY.md) 报告。

---

## 待做计划

- **元数据补全**：在 OpenAlex / Crossref 之外接入 arXiv 与 Semantic Scholar，支持用 arXiv ID 或标题检索；预印本与正式版同时命中时提示合并。
- **无文字层的首页识别**：现有首页提取依赖 PDF 文字层，扫描件会回落到空结果；计划增加对扫描封面页的 OCR 识别，并在候选冲突时把依据交给用户确认。
- **批注与笔记双向定位**：目前笔记能跳到 PDF 锚点，反向还不能查。计划让 PDF 批注列出引用它的笔记，摘录卡也能定位到具体批注而不只是页码。
- **导入自动化**：监听指定文件夹，新 PDF 自动入库；失败项进入可重试队列并保留原因。
- **写作衔接**：提供 Markdown / LaTeX 草稿导出（含引用键与 BibTeX），成稿交给外部 Agent 或本地 LaTeX 流程，不在应用内重建综述写作工作区。
- **可选云同步**：本地优先模型稳定后，再评估端到端加密的可选同步；默认仍只存本机。

---

## 致谢

- **上游项目**：感谢 [WangQrkkk/PaperQuay](https://github.com/WangQrkkk/PaperQuay) 提供本地优先 AI 论文工作台的基础架构与功能。
- **社区**：不少设计与打磨受到 [LinuxDo 社区](https://linux.do/) 讨论和反馈的启发。
- **编辑器框架**：笔记工作区基于 [Tiptap](https://github.com/ueberdosis/tiptap)，感谢其维护者提供的编辑器框架与示例。

---

## 许可证

PaperQuay Community Edition 使用 `AGPL-3.0-only` 许可证。

如果你分发修改后的版本，或把修改后的版本作为网络服务提供给用户，需要保留许可证和版权声明，说明修改内容，并按 AGPL 要求提供对应源代码。闭源商业授权、商业支持或品牌名称使用许可需要与维护者另行协商。品牌使用说明见 [TRADEMARKS.md](./TRADEMARKS.md)。
