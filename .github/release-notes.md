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

- New: the Agent now runs a ReAct multi-turn tool loop — it can autonomously call read-only tools (library search, paper metadata, overview, RAG search, paper context, figure reading, memory) across multiple turns before answering; write operations still produce a reviewable plan; a legacy-mode toggle in Settings can temporarily restore the old pipeline.
- New: Agent messages include a collapsible execution trace showing each turn's tool calls, result previews, and timing.
- New: hybrid local RAG retrieval — FTS5 keyword search fused with vector search via RRF, greatly improving hits for proper nouns, model numbers, and acronyms; graceful fallback to vector-only when FTS5 is unavailable.
- New: long-session context compaction at user-turn boundaries with a structured progress summary; cross-session three-layer memory (trace log, topics, synthesis) stored as human-readable files under `agent-memory/`, manageable from Settings.
- New: run observability — every Agent run persists turns, tool calls, and token usage; the composer shows live run tokens and the session list shows per-session totals.
- New: session recovery after interruption (resume from the last completed turn) and message-level forking ("branch from here").
- New: comparative survey capability — a four-stage pipeline (rephrase, decompose, research, report) over selected papers with staged progress and cancellation.
- New: Agent vision context — figures/tables hit by RAG are compressed and attached to the model request (max 4 images / 8 MB per turn); enable "supports vision" on a model preset to turn it on.

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

- 新增：Agent 升级为 ReAct 多轮工具调用循环，可自主多轮调用只读工具（文库搜索、元数据、概览、RAG 检索、请求上下文、读图、读记忆）后综合回答；写操作仍生成计划走审批；设置页保留「旧版 Agent 模式」开关。
- 新增：Agent 消息附带可折叠执行轨迹，逐轮展示工具调用、结果摘要与耗时。
- 新增：本地 RAG 混合检索——FTS5 关键词通道与向量检索按 RRF 融合，显著改善专有名词、型号、缩写等查询命中；FTS5 不可用时自动降级为纯向量。
- 新增：长会话上下文在用户轮边界自动压缩为结构化进度摘要；跨会话三层记忆（trace 日志、主题、综合）以人类可读文件存于 `agent-memory/`，设置页可管理。
- 新增：运行可观测——每次 Agent 运行的轮次、工具调用与 token 用量落库；输入框旁实时显示本次运行 token，会话列表显示各会话总量。
- 新增：运行中断后可从最近完整轮次恢复；任意消息可「从此处分支」复制新会话。
- 新增：对比调研 Capability——对选中论文执行改写、分解、逐题检索、综合成文四阶段流水线，显示阶段进度，可取消续跑。
- 新增：Agent 视觉上下文——RAG 命中的论文图表压缩后随行人模型请求（单轮最多 4 张、共 8MB）；在模型 preset 上开启「支持视觉」即可启用。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
