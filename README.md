<h1 align="center">PaperQuay</h1>

<p align="center">
  中文 | <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <strong>开源 AI 论文工作台，覆盖 PDF 阅读、全文翻译、结构化概览、内联笔记、Zotero 导入、Agent 工作流和本地 RAG。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.3.5-2563eb?style=flat-square" alt="Version v0.3.5">
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
> 在保持与上游主干持续同步演进的同时，本项目重点针对**科技文献精细排版清洗、PDF 原始切片（BBox Crop）对照、AI 大模型区块级重构、超长文献全自动拆分与多 Key 轮换调度、本地 RAG 索引断点自愈与管理、知识库 MCP 向量混合检索（KNN+FTS5+RRF）以及 Zotero 本地库精细化选择性同步**等科研场景进行了深度定制与功能扩展。二次开发、上游同步、本地构建和更新流程详见 [开发手册](./docs/DEVELOPMENT.zh-CN.md)。

<p align="center">
  <img src="./docs/assets/readme-hero.svg" alt="PaperQuay feature overview" width="920">
</p>

---

## 快速导航

<p>
  <a href="./docs/USER_MANUAL.zh-CN.md">用户手册</a> |
  <a href="#paperquay---保持阅读心流的开源-ai-论文工作台">问题与定位</a> |
  <a href="#近期更新">近期更新</a> |
  <a href="#paperquay-有什么不同">差异点</a> |
  <a href="#核心工作流">核心工作流</a> |
  <a href="#已完成功能">已完成功能</a> |
  <a href="#mcp-服务与外部-agent-接入">MCP 服务</a> |
  <a href="#word-加载项office-桥">Word 加载项</a> |
  <a href="#agent-skills-编写与工作流协同">Skills 编写</a> |
  <a href="#技术架构">技术架构</a> |
  <a href="#zotero-兼容与选择性同步">Zotero 兼容</a> |
  <a href="#待做计划">待做计划</a>
</p>

---

## 近期更新

### v0.3.5 - 交叉引用与 GB 87 标点开关

- **正文引用与文献表建立 Word 交叉引用**：顺序编码制下 `[1]` 是原生 REF 域（指向文献表条目序号的书签），Ctrl+点击跳转、F9 可随 Word 更新域重算；可在加载项里关闭。「取消链接」会把域摊平成纯文本。
- **GB 7714-87 标点风格开关**：全角紧凑（默认）/ 半角带空格，随文档保存，切换自动刷新全文。

### v0.3.4 - 新增 GB 7714-87（CAJ-CD）引用样式

- Word 加载项新增「GB 7714-87 顺序编码制（CAJ-CD）」：西文作者姓全大写、名缩写不加缩写点（VASWANI A）；3 名以内全列、4 名以上前 3 名加「，等」/「，et al」；论文集析出用 [A]…[C] 两段式；出版信息全角标点。与上标选项兼容。

### v0.3.3 - Word 加载项可用性修复

- **参考文献表插到光标处**（此前固定追加到文末），光标在非空段落时自动另起新段；已存在表则原位刷新。
- **可只要条目列表**：新增「含标题行」开关，关闭后不再插入「参考文献」标题段，方便套用模板自带标题的文档。
- **上标引用**：新增「正文引用以上标形式插入」选项（仅顺序编码制），选择随文档保存，切换自动刷新全文。
- **控件不再带框**：插件插入的引用与文献表视觉上与普通文字完全一致（控件外观设为 Hidden），保留域身份，仍可刷新与取消链接。

### v0.3.2 - Word 加载项设置入口修复

- **设置里新增「Word 加载项（Office 桥）」分区**：0.3.0/0.3.1 中该分区被误挂在已废弃的旧版文库设置对话框里，界面中实际不可达；现在它位于 设置 → 文库与 Zotero → 底部，可复制连接信息、启停/重启桥、管理证书与页面源站。

### v0.3.1 - Word 加载项证书信任修复

- **修复证书信任「假成功」**：安装器与设置页「信任本地证书」此前只看 PowerShell 退出码，在系统安全提示里点「否」时仍误报「已导入」，Word 持续报证书错误；现在导入后回查证书存储区，失败会给出明确原因。若信任后 Word 仍报错，在设置页点「重启桥」（源站只在启动时读证书）。

### v0.3.0 - Word 加载项（Office 桥）

- **在 Word 里插入引用与参考文献表**：新增 Microsoft Word 的 Office.js 任务窗格加载项，正文引用以 ContentControl 域保存，文末参考文献表是一个可刷新的域；默认 GB/T 7714-2015 顺序编码制，可切 GB/T 7714-2015 著者-出版年 / APA 7 / IEEE；支持页码、前后缀、隐藏作者、取消链接，以及「某文献被哪些 Word 文档引用过」回写。
- **本地只读桥，数据不出本机**：PaperQuay 在 `127.0.0.1`（默认 23120）开一个带令牌的只读 HTTP 桥，加载项凭端口与令牌取文献和格式化结果；唯一写入路径是「本文引用过」记录，可单独关闭。
- **引用格式化收敛为唯一真源**：笔记工作区、Obsidian vault 导出、MCP 与 Word 加载项共用 `src/shared/citation/`，并顺带修正 GB/T 会议论文 `[C]//论文集名` 写法、补上专著/学位论文的**出版地**字段、西文作者按「姓 + 名首字母」输出。
- 安装、使用、接口契约与限制见 [docs/OFFICE_ADDIN.zh-CN.md](./docs/OFFICE_ADDIN.zh-CN.md)；仅支持 Microsoft Word，不含 WPS 与 LibreOffice。

### v0.2.1 - 表格行内公式修复与中文用户手册

- **修复 Markdown 表格内行内公式整表退化**：表格单元格里写裸 LaTeX（如 `仅 T_i`）时，行内公式补全的候选串会跨过 `|` 把相邻格内容一起吞下，补出的 `$` 分落两格，remark-math 不跨单元格配对，整行公式只剩字面 `$`。现在表格行按单元格分别补全，非表格中含 `|` 的表达式（`A = |x| < 1`、`P(A | B) = 0.5`）行为不变。
- **新增中文用户手册 [docs/USER_MANUAL.zh-CN.md](./docs/USER_MANUAL.zh-CN.md)**：从安装与首次启动、文献库与阅读器、笔记使用与维护、Agent 工作区、知识图谱、综述写作、本地 RAG，到 MCP 接入、数据备份与隐私、设置参考与排障，附快捷键与常见问题附录。

### v0.2.0 - 笔记系统重构

- **Agent 与 MCP 均可读写笔记**：内置 Agent 新增笔记工具与独立审批卡（增删改经 diff 审批后落库）；Knowledge MCP 对外暴露 `create_note` / `update_note` / `delete_note` / `list_note_tags` 与文件夹管理，复用同一道写护栏。
- **结构化笔记工作区**：文件夹树入库（重装不丢、可随 WebDAV 同步）、8 种页面类型与 11 个模板、笔记图谱与体检（孤立 / 断链 / 无标签 / 30 天未更新）、Markdown vault 双向同步（兼容 Obsidian，锚点 ID 往返不丢）。
- **学术化引用与摘录卡**：`paperReference` 内联节点按顺序渲染为 `[n]`，vault 导出附 GB/T 7714 参考文献；划词后「AI 提炼为摘录卡」两步 CoT 清洗 OCR 噪声再忠实改写，来源锚点可跳回 PDF 原位，支持跨页多段累加一卡多锚点。
- **清理**：移除旧版一次性 Agent 路径（约 800 行）与 `agentLegacyMode` 开关，多轮 ReAct 循环成为唯一路径。

### v0.1.51 - 笔记引用跳转定位修复

- **摘录卡片与参考文献位置可跳转**：修复笔记锚点的 `blockId` / `pageIndex` 在保存时被丢弃的问题，摘录卡片上的页码按钮（如 `P20`）与参考文献位置芯片现在会滚动到原文对应位置。
- **历史笔记免迁移**：位置从锚点 id（`…:mineru:page-20-block-3:0`）与页码标签逐级还原，旧笔记点击即生效。
- **跳转降级更稳**：精确块 → 同页正文块 → 整页高亮逐级回退；没有结构块的文献不再永久等待，确实无位置时才给出提示。

### v0.1.50 - 笔记参考文献、润色检索修复与长文档阅读窗口化

- **笔记参考文献**：工具栏、斜杠命令和 `@` 均可插入文献引用；点击打开对应论文，带页/块位置时可跳到原文。右侧栏与文末列表从笔记内容实时派生，不落库。
- **笔记 AI 润色检索修复**：同时查询裸 `paper.id` 与 `native-library:` 前缀键，证据按全局相关度取 top 8；embedding 维度不匹配或模型未返回引用时给出明确提示。润色范围默认改为「笔记关联文献」。
- **长文档阅读窗口化**：双栏阅读按视口窗口化结构块、缩略图与 PDF overlay 主机，卸载离屏 Markdown/KaTeX，关闭 PDF.js eager `getPage`，长篇学位论文与教材滚动不再随页数线性变卡。

### v0.1.49 - 知识库 MCP 文库写入与分类管理工具

- **MCP 工具扩展至 15 个**：新增 `import_pdfs`（批量导入 PDF，内容哈希查重，支持 copy/move/keep 与按名称自动建分类）、`list_categories`、`manage_category`（分类创建/重命名/移动/删除，含环检测与级联解绑）、`set_paper_categories`（批量分类归属，原子校验）、`update_paper`（元数据白名单更新）、`delete_papers`（可选同时删除文件），写入语义与桌面端完全一致。
- **写入安全护栏**：写工具执行前自动检测桌面应用运行状态，运行时显式拒绝（避免应用内存态保存静默覆盖外部写入），`allowWhileAppRunning: true` 可覆盖，`PAPERQUAY_MCP_WRITE=off` 可全局只读；Zotero 同步纳入同一护栏。
- **读取增强**：`search_papers` 支持 `categoryId` 分类过滤（含后代分类），`get_paper_details` 返回所属分类 ID。

### v0.1.48 - 正文渲染、PDF 图片重析与 OCR 状态修复

- **正文不再误变符号表**：保留普通段落和行内公式，不在渲染时自动重建符号表。
- **统一区块重析**：优先读取原 PDF 对应区域图片，OCR 文本作为辅助；显示实际切片与仅文本回退，支持预览、保存和恢复本地修复。
- **PaddleOCR 状态收敛**：后端维护文献级任务，结果落盘后完成；关闭标签页后仍可恢复进度，并对下载超时和过期回调作明确处理。

### v0.1.47 - 新增 PaddleOCR-VL 1.6 识别引擎、强制重新识别与解析图片引用自愈

- **PaddleOCR-VL 提交误判修复（v0.1.47 热修）**：异步 Jobs API 的错误信封实际使用 `code` / `msg`，此前按官方同步服务文档的 `errorCode` 判定，导致**提交成功也被判为失败**并丢弃 `jobId`，该引擎在 v0.1.46 中完全不可用。现改为以 `data.jobId` 是否存在判定成功，并输出含 HTTP 状态、真实 `code`/`msg`、`traceId` 与原始响应片段的可操作错误；同时容忍从百度控制台整段粘贴完整作业地址。

- **PaddleOCR-VL 1.6 结构识别引擎**：设置 →「文档解析」新增引擎选择器，可在 MinerU 与 PaddleOCR-VL 1.6（云端异步 Jobs API）之间切换，阅读器、文献库与批量解析三条链路统一生效。适配层把 PaddleOCR-VL 输出归一化为现有 MinerU 缓存契约，结构阅读、图片渲染、PDF↔块几何联动、翻译、RAG 与缓存自愈全部零改动复用；布局坐标与页尺寸映射为 `pdf` 坐标系 bbox，图注/表注并入紧邻视觉块，资产同时支持 Base64 与预签名 URL，超过 100 页自动切分合并。
- **强制重新识别（忽略缓存）**：阅读器工具栏与概览页新增「重新解析 / 重新识别」入口，文献库解析不再无条件复用已有结果；重新识别前备份译文、摘要与图片，成功后清理、失败则保留以便回退。
- **解析缓存图片引用自愈**：新增幂等自愈命令，把指向不存在文件的图片引用重新指向实际存在的分卷文件，无需重新上传 PDF 或消耗额度；打开文档时自动执行，设置页另提供全库扫描入口。
- **修复超页文档拆分合并后图片全部失效**：长文档（>200 页）自动拆分合并时，`content_list_v2.json` 的「页数组 + 每页块字典」结构未被识别，且资产路径实际位于嵌套的 `content.image_source.path` 而非块顶层，导致图片引用从未被改写 —— 图片被重命名为 `part_N_` 前缀、Markdown 也已同步，唯独结构化 JSON 仍是旧引用，界面因此大量出现「没有找到对应的图片资源」。现已按三种真实形状结构保持地改写任意深度的资源路径。全库对账：9 份超页文档共 2859 条失效引用全部恢复。

### v0.1.43 - 全量文献接入 RAG 索引池、断点续跑死循环自愈与超长论文深度兼容

- **全量文献接入 RAG 索引池与状态管理**：修复主页文献未纳入索引候选导致角标回退与统计归零问题，全量文库条目实时注入索引池并动态同步 MinerU 解析状态。
- **RAG 索引断续续跑不动点自愈**：重构续跑判定逻辑，以分块 ID 差集精准计算真实缺口并补齐，彻底消除低位分块缺失导致的固定点死循环；新增原子状态收敛与陈旧分块清理。
- **超长学位论文 MinerU 页面字典深度兼容**：超长论文（200~300+ 页）在 MinerU 多卷拆分合并后采用页面字典对象组织，新增解包支持，完整提取各页海量结构块与 RAG 向量切块。
- **孤儿失败记录自愈与错误透传**：自动清理主来源已就绪时的陈旧 `pdf-text:failed` 孤儿记录；单篇与批量索引提供结构化错误提示，彻底消除“点击无反应”感知。
- **文献库启动挂起修复**：修复底层批量文件检查异步 Promise 序列化挂起缺陷，消除全库文献启动时永久卡在“MinerU 检测中”问题。

### v0.1.42 - 知识库 MCP 向量混合检索（KNN+FTS5+RRF）与 RAG 索引进度管理

- **知识库 MCP 服务升级为向量混合检索**：标准 MCP 服务 `search_knowledge_base` 升级为基于嵌入向量的语义检索与 FTS5 全文检索双通道召回，采用 RRF（Reciprocal Rank Fusion）融合排序，检索语义与桌面端完全对齐；支持 `auto` / `hybrid` / `keyword` 三种检索模式及命中渠道（`channels`）追踪，具备自动降级与离线保护。
- **本地 RAG 知识库索引管理卡片**：设置面板新增索引管理控制台，直观呈现已索引 / 待索引 / 失败统计，支持一键「为未索引文献建立索引」与「仅重建失败索引」，配备动态进度条与暂停 / 继续 / 取消控制。
- **文库列表 RAG 状态徽章与右键强制重试**：文献列表新增 RAG 状态角标（已索引 / 索引中 / 未索引 / 失败）；文献右键菜单支持「建立/重建 RAG 索引」，单篇强制断点续传重试，不重复消耗 embedding 额度。

*历史版本演进（v0.1.32 - v0.1.45 包括多 Key 轮换、超大文件拆分合并、Zotero 选择性同步、BBox 原图切片、AI 区块重析等）详见 [CHANGELOG.md](./CHANGELOG.md)。*

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

PaperQuay 内置独立的 Notes 工作区，编辑器基于 Tiptap。每篇笔记都会在本地保存 Tiptap JSON、渲染 HTML 和用于搜索的纯文本。编辑器支持标题、列表、任务列表、代码块、表格、图片、数学公式、高亮、链接、斜杠菜单式插入、分类（文件夹，入库持久化）、置顶、收藏、大纲、反向链接、参考文献列表与手动保存（`Ctrl/Cmd + S`）。

笔记不是独立在文献库之外的孤岛。你可以用 `[[笔记]]` 连接想法，用 `#标签` 组织主题，用 `@paper` 引用文献并打开对应论文（带页码时可跳到原文位置），让阅读、摘录和后续整理保持在同一个研究工作流里。AI 润色默认检索笔记关联文献的本地知识库内容，并把可定位引用写回笔记。

v0.2.0 起，笔记系统补齐了一套可维护的知识组织能力：

- **页面类型与模板**：论文卡片、概念页、综述页、问答页、摘录卡、索引/日志/总览页共 8 类页面，对应 11 个内置模板，规则见 [`docs/notes-charter.md`](./docs/notes-charter.md)。
- **提炼式摘录卡**：划词后可用 AI 两步提炼成卡（锚点块保真 + 可自由改写的提炼正文 + 「我的想法」区），同一张卡可跨页多段累加来源锚点。
- **学术化引用**：内联引用按首次出现自动编号（`[n]`，同一文献同号，不写入文档数据），支持 GB/T 7714-2015 / APA 7 / IEEE 三种样式与可点击回原文的参考文献列表。
- **维护工具**：笔记图谱（按分类分组、双链连线、点击打开）、笔记体检（孤立/断链/无标题/无标签/陈旧）、内置 Agent 的笔记读写工具（写操作走审批计划卡）、MCP 外部 Agent 笔记工具，以及 Obsidian 兼容的 Markdown vault 双向同步。

完整的使用与维护说明见用户手册的笔记章节：[`docs/USER_MANUAL.zh-CN.md`](./docs/USER_MANUAL.zh-CN.md)。

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
| 本地文献库 | 使用本地 SQLite 保存论文、作者、分类、标签、附件、笔记、批注、导入记录、设置和 RAG 索引，全量文献接入 RAG 索引池与状态管理，文献列表支持多选与批量操作（删除、移动分类、收藏）；支持启动自愈清理孤儿失败记录与底层批量状态检查异步优化 |
| 本地 RAG 索引与知识库管理 | 支持向量 KNN + FTS5 BM25 + RRF 融合的混合检索与中文 trigram 分词；设置面板提供可视化「知识库索引管理」控制台（统计、批量强制索引、进度条、暂停/继续/取消）；文献列表提供实时 RAG 状态徽章（已索引/索引中/未索引/失败）；支持右键单篇断点续传重试，采用分块 ID 差集精准补齐缺口与陈旧分块自动收敛自愈 |
| MinerU 解析与超长文档引擎 | 支持云端结构化解析与 PDF 区域联动；支持 MinerU 多 API Key 录入、Round-Robin 均衡调度与自动故障切换（Failover）；支持超页大文件（>200页，长篇学位论文/专著）按 150 页安全余量自动无损切片分卷与本地精准多卷合并（页码校准、图片隔离命名空间映射、页面字典解包兼容）；修复跨页合并表格空壳分片隐藏与跳转 |
| PDF 导入 | 支持文件选择器和拖拽导入，入库前进入导入确认窗口 |
| 文件管理 | 支持文献存储文件夹、复制/移动/保留原路径、命名规则、原始路径记录和本地私有文件管理 |
| 元数据 | 支持通过 DOI 或标题优先调用 OpenAlex 补全，可配置 OpenAlex API Key / mailto，Crossref 兜底；中文论文远程未命中时用 LLM 从首页文本智能提取，导入前可手动编辑 |
| 分类树 | 支持系统分类、自定义分类、子分类、折叠、右键菜单、拖拽排序、层级调整和收藏 |
| 文献详情 | 支持标题、作者、年份、期刊/会议、DOI、URL、摘要、关键词、标签、笔记、引用、收藏和阅读时间图 |
| 笔记工作区 | 支持独立 Tiptap 笔记工作区、分类（入库持久化）、搜索、标签、置顶、收藏、大纲、反向链接、参考文献列表与手动保存（`Ctrl/Cmd + S`）；内置 11 个页面类型模板（论文卡片/概念页/综述页/问答页/摘录卡/索引/日志/总览），支持笔记图谱与体检（孤立/断链/无标题/无标签/陈旧） |
| 笔记编辑器 | 支持富文本、标题、列表、任务列表、代码块、表格、图片、数学公式、高亮、链接、组件块和斜杠菜单式插入；可从工具栏 / `@` / 斜杠命令插入参考文献，并生成或更新文末列表；内联引用自动编号（`[n]`），支持 GB/T 7714-2015 / APA 7 / IEEE 样式；AI 润色默认检索笔记关联文献 |
| 内联笔记链接 | 支持 `[[笔记]]` 双向链接、`#标签`、`@paper` 文献引用、补全菜单；点击引用打开对应论文，带页/块位置时可跳到原文 |
| 摘录与笔记维护 | 划词可一步「AI 提炼为摘录卡」（两步 CoT、锚点保真、提炼正文可改、多段跨页累加），或「加入当前笔记」插入摘录；内置 Agent 的 `search_notes`/`read_note`/`write_notes` 写操作走审批计划卡；MCP 提供笔记创建/更新/删除与分类维护工具；支持 Obsidian 兼容的 Markdown vault 双向同步 |
| 阅读器与排版清洗 | 支持 PDF 阅读、MinerU 结构块视图、PDF 区域联动、阅读热力进度、阅读时间记录和批注工具；长文档（学位论文/教材/报告）按视口窗口化结构块与缩略图，避免双栏滚动卡顿；自动清洗连字与交叉引用伪上标，优雅渲染正规学术上下标，自动修复首字下沉（Drop Cap）与无框术语表（Nomenclature）重构 |
| 原切片与 AI 重析 | 支持 PDF 原始区域切片（BBox Crop）回退机制，公式解析失败自动切片兜底；支持对任意结构块调用大模型进行二次重析（排版纠错、表格/术语表结构化、数学公式提取，支持对比与撤销） |
| 翻译与译文管理 | 支持全文翻译、块级翻译缓存和划词翻译，模型使用 OpenAI 兼容接口；支持批量翻译文献标题；中文文献自动跳过翻译、中文标题直填入库；支持统一译文 PDF 集中存放与平滑迁移 |
| 引用导出 | 支持多选文献批量导出 Bib：合并为单个 .bib 或每篇一个文件，自动生成去重 citation key，支持期刊、书籍、学位论文、报告等标准条目类型 |
| 论文概览 | 支持背景、研究问题、方法、实验设置、主要发现、结论和局限等速读概览字段 |
| Agent 工作区 | 支持对话、执行轨迹、工具调用卡片、文献选择、元数据工具、重命名、打标签、分类和总结 |
| Zotero 导入与同步 | 支持从 `zotero.sqlite` 全量导入分类、标签和可用 PDF；新增支持基于分类树浏览、条件模糊检索、差量预检与三层防重校验的选择性精准同步 |
| MCP 知识库服务 | 内置标准 MCP stdio 服务（`bin/paperquay-mcp.cjs`），直连本地 SQLite；`search_knowledge_base` 支持向量 KNN + FTS5 + RRF 混合检索（支持 auto/hybrid/keyword 模式与 channels 来源标记及自动降级）；提供完整的文献检索、详情、正文切片以及笔记检索与写入（创建/更新/软删除、标签与分类树维护）、Zotero 本地库浏览、检索、差量预检与选择性同步工具链，全部写工具带运行护栏 |
| 备份 | 支持通过 WebDAV 备份和恢复文献库数据库、笔记数据库和本地 RAG SQLite 数据库 |
| 软件更新 | 支持应用内检查更新、Windows 和 Linux 自动更新流程，以及 macOS 打开发布页手动下载 |
| 知识图谱 | 支持文献、笔记、标签、分类和引用节点，语义相似边、Crossref 参考文献同步、共同作者关系、自定义与 AI 关系，fcose 力导向全局布局、局部同心圆视图和 PNG/JSON 导出 |
| 综述写作 | 支持大纲蓝图、分段并发写作、RAG 检索上下文、失败任务独立上报与续跑，以及 Word 导出（OMML 公式、中英文标题、参考文献和正文插图） |
| Word 加载项 | 通过 Office.js 任务窗格在 Word 正文插入引用域、在文末生成参考文献表域，默认 GB/T 7714-2015 顺序编码制（可切著者-出版年 / APA 7 / IEEE），引用增删后一键刷新重排编号，支持页码/前后缀/隐藏作者、取消链接与「本文引用过」回写；加载项经本机 `127.0.0.1` 只读桥（Bearer 令牌）访问文献库，数据不出本机；仅 Microsoft Word（不含 WPS / LibreOffice），详见 [docs/OFFICE_ADDIN.zh-CN.md](./docs/OFFICE_ADDIN.zh-CN.md) |
| 主题 | 支持浅色和深色主题，面向桌面端长时间阅读优化 |

---

## Word 加载项（Office 桥）

写论文时不必再从笔记里手工抄参考文献：PaperQuay 提供一个 Microsoft Word 加载项（Office.js 任务窗格），在正文插入引用、在文末生成参考文献表，引用增删后一键刷新即可整篇重排编号。

- **默认国标**：GB/T 7714-2015 顺序编码制（同一文献同号、连续编号折叠为 `[1-3]`），可切换 GB/T 7714-2015 著者-出版年、APA 7、IEEE；样式保存在文档里，换机器打开仍保持。
- **引用是域不是死文本**：每条引用是一个 ContentControl 域（`pq:c|<citeId>`），文末表是单个 `pq:bib` 域，明细写在文档设置里；交付前可以用「取消链接」把域变成普通文字。
- **本机只读桥**：加载项运行在浏览器环境，不能直接读数据库，因此 PaperQuay 主进程在 `127.0.0.1`（默认 23120，Zotero 用 23119）开一个只读 HTTP 桥，用每次启动随机生成的 Bearer token 鉴权，发现文件写在 `<userData>/PaperQuay/paperquay-office-bridge.json`。CORS 只回显白名单来源，绝不使用 `*`。唯一写入路径是把「本文引用过」记录回文献库，默认开启、可在设置里关闭。
- **格式化真源唯一**：加载项不自己实现格式规则，而是复用 `src/shared/citation/`（笔记、vault 导出、MCP 与 Word 共用同一份实现），因此两侧的条目写法不会分叉。

安装（Windows 桌面版，侧载，不需要商店账号），两条路径：

- **exe 安装器（推荐）**：运行 `PaperQuay-OfficeAddin-Setup-<版本>.exe`（双击图形界面，或 `--silent` 静默 / `--uninstall` 卸载 / `--diagnose` 体检），自动完成证书、清单与侧载注册，只动当前用户、无需管理员权限；页面由运行中的 PaperQuay 本体托管。开发者可用 `npm run office-addin:installer` 自行编译（只依赖 Windows 自带的 .NET Framework csc）。
- **开发者脚本路径**：

```powershell
npm run build                # 含 build:citation，产出共享格式化产物
npm run office-addin:build   # 复制/校验加载项资源并生成图标
npm run office-addin:serve   # 起本地 HTTPS 服务（自签证书，--trust 可导入信任）
npm run office-addin:install # 侧载进 Word
```

然后在 Word 里打开「PaperQuay 引用」任务窗格，从 PaperQuay 设置 →「Word 加载项（Office 桥）」点「复制连接信息」，粘贴到加载项里连接即可。

完整说明（安装细节、接口契约、文档模型、已知限制与排障）见 [docs/OFFICE_ADDIN.zh-CN.md](./docs/OFFICE_ADDIN.zh-CN.md)。

---

## MCP 服务与外部 Agent 接入

PaperQuay 内置了基于标准 **Model Context Protocol (MCP)** 的独立服务（入口文件：`bin/paperquay-mcp.cjs`）。外部 AI Agent（如 Proma、Claude Desktop、Cursor、Pi Agent、Codex 等）可以通过 stdio 协议免侵入直连 PaperQuay 本地 SQLite 知识库，完成学术文献检索、带页码证据定位、与本地 Zotero 的精准选择性同步，以及带运行护栏的文库写入与分类管理（导入 PDF、更新元数据、调整分类、删除文献）。

### 核心特性

1. **完全免侵入且零服务依赖**：基于 Node.js 原生直连 SQLite 数据库，**无需 PaperQuay 桌面端保持运行**即可随时被外部 Agent 调用。
2. **并发安全与无锁访问**：SQLite 数据库开启 WAL 模式，外部 Agent 的只读检索与桌面端用户的读写操作完全互不阻塞、零锁冲突。
3. **向量 + 全文混合检索（KNN + FTS5 + RRF）**：当 PaperQuay 阅读器设置中配置了 Embedding API 时，`search_knowledge_base` 自动将查询向量化，在本地 `sqlite-vec` 向量索引与 FTS5 BM25 候选池间双通道召回，经倒数排名融合（RRF）输出高质量证据；配置缺失或网络异常时自动降级为关键词检索。
4. **精准到页码与结构块的学术证据链**：检索结果直接携带文献标题、1-based 绝对页码（`pageNumber`）、结构块 ID（`blockId`）及命中的检索通道（`channels: ['vector', 'fts']`），便于 Agent 输出严谨真实的学术引用。
5. **写入安全护栏**：写工具执行前自动检测 PaperQuay 桌面应用运行状态——检测到运行时显式拒绝写入（桌面端的内存态保存会整体覆盖外部写入），可传 `allowWhileAppRunning: true` 强制覆盖；设 `PAPERQUAY_MCP_WRITE=off` 可将服务切换为全局只读。

### 提供的 MCP 工具清单

服务内置 15 个标准 MCP 工具，涵盖知识库检索、Zotero 同步与文库写入管理三大领域：

#### 1. 知识库只读检索工具（5 项）
| 工具名称 | 功能说明 | 核心参数 | 返回关键字段 |
| :--- | :--- | :--- | :--- |
| `search_papers` | 检索文献库元数据 | `query`（关键词）、`tag`（标签）、`categoryId`（分类过滤，含后代分类）、`limit` | 文献 ID、中英文标题、作者、年份、DOI、标签 |
| `get_paper_details` | 获取单篇文献完整详情 | `paperId`（必填） | 完整学术元数据、摘要、AI 速读概览、用户笔记、文献类型、出版物、所属分类 ID |
| `search_knowledge_base` | **向量混合检索** RAG 证据切片 | `query`（必填）、`paperId`（可选）、`limit`、`mode`（`auto`/`hybrid`/`keyword`） | 文献标题、页码、段落文本、匹配分值、`retrievalMode`、`channels`（命中渠道标记） |
| `read_paper_content` | 分页读取文献 MinerU 结构化正文 | `paperId`（必填）、`pageIndex`（0-based 页码）、`limit` | 按页面或块顺序展开的纯文本与 Markdown 结构块 |
| `search_notes` | 检索用户的阅读笔记与摘录批注 | `query`、`paperId`、`limit` | 用户个人笔记内容、高亮批注与学术摘录 |

#### 2. Zotero 本地选择性同步工具（4 项）
| 工具名称 | 功能说明 | 核心参数 | 返回关键字段 |
| :--- | :--- | :--- | :--- |
| `zotero_list_collections` | 读取本地 Zotero 分类树及条目数 | `dataDir`（可选，默认自动探测） | 分类目录树（key、名称、父分类）、各分类条目数及探测到的数据目录 |
| `zotero_search_items` | 条件模糊检索待同步文献 | `query`、`collectionKey`、`limit`、`dataDir` | 候选条目列表、标题、作者、年份、DOI、是否有本地 PDF 附件 |
| `zotero_preview_sync` | **入库前差量比对与去重预检** | `itemKeys`、`collectionKey`、`dataDir` | 差量清单：`ready`（可同步）、`alreadyExists`（已存在去重）、`missingPdf`（缺本地 PDF） |
| `paperquay_sync_from_zotero` | **精准安全入库** | `itemKeys`、`collectionKey`、`targetCategoryId`、`createCollectionCategory` | 同步报告：成功篇数、跳过篇数、自动创建/关联的分类名称 |

#### 3. 文库写入与管理工具（6 项，带运行护栏）

以下工具会修改本地文库数据库，执行前自动检测桌面应用运行状态，检测到运行时**显式拒绝**（可传 `allowWhileAppRunning: true` 覆盖；`PAPERQUAY_MCP_WRITE=off` 可全局禁用写入）。

| 工具名称 | 功能说明 | 核心参数 | 返回关键字段 |
| :--- | :--- | :--- | :--- |
| `import_pdfs` | 批量导入本地 PDF（内容哈希查重） | `paths`（必填）、`metadata`（按路径键控）、`targetCategoryId` 或 `categoryName`、`importMode`（`copy`/`move`/`keep`） | `imported`/`duplicates`/`errors` 明细与汇总统计 |
| `list_categories` | 读取分类树及文献数（只读） | 无 | 分类列表（含系统分类、`parentId`、`paperCount` 含后代计数） |
| `manage_category` | 分类创建/重命名/移动/删除 | `action`、`categoryId`、`name`、`parentId` | 操作后的分类；删除级联子分类并解绑文献 |
| `set_paper_categories` | 批量调整文献分类归属 | `paperIds`、`add`/`remove` 或 `replace` | 每篇更新后的 `categoryIds`（失败整体拒绝） |
| `update_paper` | 更新文献元数据（白名单字段） | `paperId` + `title`/`authors`/`tags`/`isFavorite` 等 | 更新后的文献对象 |
| `delete_papers` | 批量删除文献 | `paperIds`、`deleteFiles`（默认 `false`） | 删除报告（`deletedFileCount`、`fileErrors`） |

### 向量混合检索与模式说明

`search_knowledge_base` 支持通过 `mode` 参数精确控制检索行为：
- `auto`（默认）：自动读取 PaperQuay 桌面端持久化的阅读器 Embedding 配置（`<数据目录>/.settings/paperquay.config.json`）。配置有效时自动走双通道向量混合检索；未配置或接口异常时自动降级为 FTS5 关键词检索。
- `hybrid`：显式指定向量混合检索。若环境未配置 Embedding 或维度不匹配，安全降级并在响应的 `warning` 字段详细告知原因，绝不抛出未捕获异常。
- `keyword`：强制纯 FTS5 关键词检索（并在特殊符号场景降级为模糊匹配），完全不发起任何网络请求，适合离线环境或精确检索专业型号、定理标号。

*隐私说明：混合检索仅会将用户的查询词发送给用户自己配置的 Embedding API（与桌面端一致）。若希望全局彻底禁用向量网络请求，可在环境中设置 `PAPERQUAY_MCP_EMBEDDING=off`。*

### 客户端接入配置指南

#### 1. Proma Agent
在 Proma 工作区设置或 `mcp.json` 中添加：
```json
{
  "servers": {
    "paperquay": {
      "type": "stdio",
      "command": "node",
      "args": ["<项目绝对路径>/bin/paperquay-mcp.cjs"],
      "enabled": true
    }
  }
}
```

#### 2. Claude Desktop / Claude Code
在 `claude_desktop_config.json` 的 `mcpServers` 节点下配置：
```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": ["<项目绝对路径>/bin/paperquay-mcp.cjs"]
    }
  }
}
```

#### 3. Cursor
在 `.cursor/mcp.json` 中配置：
```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": ["<项目绝对路径>/bin/paperquay-mcp.cjs"]
    }
  }
}
```

#### 4. Pi Coding Agent
在全局配置 `~/.pi/agent/mcp.json` 中配置：
```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": ["<项目绝对路径>/bin/paperquay-mcp.cjs"]
    }
  }
}
```

*提示：服务默认会自动识别各操作系统的 PaperQuay 数据目录（Windows `%APPDATA%/PaperQuay`、macOS `~/Library/Application Support/PaperQuay`、Linux `~/.config/PaperQuay`）。如需自定义，可传入命令行参数 `--data-dir="<路径>"` 或配置环境变量 `PAPERQUAY_DATA_DIR`。*

---

## Agent Skills 编写与工作流协同

单纯接入 MCP 工具只提供了基础的 API 调用能力。在实际学术科研中，为了让 Agent 具备专业的学术推理、事实证据核验以及安全的入库操作，需要通过 **Agent Skills** 将 MCP 的原子工具封装为严谨的标准作业程序（SOP）。

本项目已经沉淀并经过全面验证的两个官方专属 Skills 如下，可作为编写学术级协同 Skill 的标准范式：

### 官方 Skill 范式解析

#### 1. 文献检索与学术引用 Skill (`paperquay-knowledge-search`)
- **核心定位**：当用户询问“我库里哪篇论文讲了 XX”、“根据我的文献库总结 XX”、“某篇论文第 5 页讲了什么”时触发。
- **多阶工具调用链**：
  ```
  用户学术提问 ──> search_papers（元数据初筛获取 paperId）
               ──> search_knowledge_base（按 query 提取高相关切片，支持 paperId 限定）
               ──> read_paper_content（若需连续深读上下文时按 pageIndex 提取）
               ──> 严密学术回复（附带精确文献名、页码与结构块标注）
  ```
- **核心编写准则**：
  1. **混合结果解读约束**：指导 Agent 检查 `channels` 字段。若同时包含 `vector` 和 `fts`，代表语义与字面双重命中，可信度最高；若仅包含 `vector`，虽语义相关但需提防跑题；若包含 `warning`，在回复末尾客观提示降级原因。
  2. **绝对禁止无据臆测**：强制 Agent 必须依据切片 `snippet` 中真实存在的字句作答，凡引用处必须标注 `[序号] (《文献标题》, 第 P 页)`；检索无结果时如实告知，严禁大模型发挥幻觉。

#### 2. Zotero 选择性安全同步 Skill (`paperquay-zotero-sync`)
- **核心定位**：当用户提出“从 Zotero 同步 XX 分类”、“把今年 Diffusion 的几篇论文导入 PaperQuay”等需求时触发。
- **四步安全入库 SOP（严格禁止未预览直接写入）**：
  ```
  [1. 意图解析与检索] ──> 调用 zotero_list_collections 或 zotero_search_items 锁定候选条目
  [2. 差量比对预检]   ──> 调用 zotero_preview_sync 进行三层去重与 PDF 附件存在性检测
  [3. 结构化报告呈现] ──> 生成包含「✅就绪 / ⚠️已存在跳过 / ❌缺PDF」的清晰表格，征求用户确认
  [4. 批准后精准入库] ──> 用户显式确认后调用 paperquay_sync_from_zotero 写入本地数据库并反馈
  ```
- **核心编写准则**：
  1. **防御性只读拦截**：入库属于写操作，严禁在第一步检索后直接调用写入。必须向用户出具可读清单（包含拟同步论文名、年份、分类归属），得到明确授权后再触发写入。
  2. **生命周期衔接提示**：同步入库仅完成 PDF 文件与元数据入库；必须在回复中提示用户：若要对新文献进行正文级检索，需在桌面端打开文献以完成 MinerU 解析与 RAG 索引。

### 自定义学术 Skill 编写指南

如果你希望为团队或特定科研任务编写新的 Agent Skill（如“自动文献综述写作”、“论文创新点对比分析器”等），建议遵循以下三层结构创建 `skills/<your-skill-name>/SKILL.md`：

```markdown
---
name: your-skill-name
description: 描述触发时机与核心能力。必须清晰定义“何时触发”（正向关键词/典型提问）与“何时不触发”（负向边界），便于 Agent 路由器精确分发。
version: "1.0.0"
---

# 技能名称与概述

简要说明本 Skill 旨在解决的科研场景及预期交付标准。

## 一、工具选型与权限边界
- 明确本技能依赖的 PaperQuay MCP 工具集；
- 区分只读检索与持久化写入边界，写操作必须设置人机交互确认断点。

## 二、标准作业流程（SOP）
采用步骤式编排（Step 1 ➔ Step 2 ➔ Step 3），明确每一阶段输入、调用的工具参数及中间判定条件。

## 三、格式输出约束与防御性要求
- 引用规范：强制要求包含标题、作者、年份及绝对页码；
- 容错处理：当检索切片为空、Embedding 降级或文件缺失时的兜底应答策略。
```

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
