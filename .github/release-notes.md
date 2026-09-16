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

- **Single-Query Native Global KNN in Knowledge Base MCP**: Refactored `knowledgeMcpService.cjs` to eliminate the previous 60-source fanout limitation (`MAX_VECTOR_FANOUT_SOURCES = 60`) and multi-query in-memory merging loop. Now executes a single SQL statement for global KNN vector similarity retrieval coupled with FTS5 BM25 keyword matching across all ready library indexes with RRF fusion, cutting query latency from tens of milliseconds down to single-digit milliseconds without truncation warnings.
- **Synchronized Skills & MCP Integration Guidelines**: Upgraded `paperquay-knowledge-search` to version 1.1.0, steering Agent workflows toward direct global evidence querying without mandating prior metadata lookup. Synchronized the latest skill and documentation across all connected Proma workspaces.

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

- **知识库 MCP 服务重构为原生单次全局 KNN 检索**：`knowledgeMcpService.cjs` 彻底移除了原先 60 篇来源硬截断限制与基于 Node.js 内存循环的 60 次串行 SQL 查询；全面升级为单条 SQL 跨全库已就绪索引执行原生全局 KNN 向量相似度检索与 FTS5 BM25 融合召回，耗时由几十毫秒压缩至数毫秒，彻底消除了大规模知识库检索时的来源截断风险与 `truncated` 警告。
- **知识库检索相关 Skills 与集成文档全面对齐**：更新 `paperquay-knowledge-search` Skill 至 1.1.0，优化 Agent 问答工作流引导（泛化学术概念与方法问题可直接发起全库正文检索，无需强迫前置检索元数据）；向所有配置了 `paperquay` MCP 的 Proma 工作区同步最新版 Skill，并同步更新了各领域工作区中检索增强 Skill 的参数与能力说明。

## 使用提示

- AI 功能需要在「设置」中配置兼容的模型服务地址和 API 密钥。
- Release 安装包由 GitHub Actions 自动构建与发布。
