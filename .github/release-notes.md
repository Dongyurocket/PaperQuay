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

- **Hybrid vector retrieval for the knowledge-base MCP server**: `search_knowledge_base` now vectorizes the query with your configured embedding API and fuses vector KNN results with FTS5 keyword results via reciprocal rank fusion — the same retrieval semantics as the in-app Agent. A new `mode` parameter (`auto`/`hybrid`/`keyword`) controls the behavior, responses report `retrievalMode` plus per-snippet `channels` (`vector`/`fts`), and any embedding failure degrades gracefully to keyword-only search with a `warning` instead of an error.
- **Manual RAG indexing with visible progress**: the Local RAG settings panel gains an index management card with indexed/pending/failed counts, batch actions to index unindexed papers or retry only failed ones (with progress bar, pause/resume, and cancel), a per-paper RAG status badge in the library list (indexed/indexing/not indexed/failed), and a “Build/Rebuild RAG Index” entry in the paper context menu. Manual triggers bypass the failure cooldown while keeping chunk-level incremental resume, so re-indexing never re-embeds already indexed chunks.

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

- **知识库 MCP 服务升级为向量混合检索**：`search_knowledge_base` 在配置了 Embedding API 时自动将查询向量化，与 FTS5 全文检索双通道召回并经 RRF 融合排序，与应用内 Agent 检索语义完全一致；新增 `mode` 参数（`auto`/`hybrid`/`keyword`），响应报告 `retrievalMode` 与每条结果的 `channels` 命中来源；embedding 异常时自动降级为关键词检索并返回 `warning`，不会报错中断。
- **RAG 手动索引触发与索引进度显示**：设置面板「本地 RAG 检索」新增索引管理卡片，提供已索引/待索引/失败统计与「为未索引文献建立索引」「仅重建失败索引」批量操作（带进度条、暂停/取消）；文献列表新增 RAG 状态角标（已索引/索引中/未索引/失败）；文献右键菜单新增「建立/重建 RAG 索引」。手动触发绕过失败冷却期且保留分块级断点续传，重建不会重复消耗已索引分块的 embedding 额度。

## 备注

- AI 特性需要在“设置”中配置你自己的兼容模型接口与 API 密钥。
- 发布产物由 GitHub Actions 自动构建生成。
