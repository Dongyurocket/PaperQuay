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

- **Selective Zotero Library Synchronization**: Breaks through the limitation of bulk-only synchronization. Users and Agents can now selectively discover, search, preview diffs, and import specific collections or items from the local Zotero library into PaperQuay.
- **MCP Server Zotero Toolchain**: Extended the standard MCP server (`bin/paperquay-mcp.cjs`) with four specialized tools: `zotero_list_collections`, `zotero_search_items`, `zotero_preview_sync`, and `paperquay_sync_from_zotero`.
- **Pre-sync Diff & Triple Deduplication**: Automated pre-sync checking comparing against the PaperQuay SQLite library, precisely identifying `ready` (available with local PDF), `alreadyExists` (deduplicated by DOI, title, or SHA-256 content hash), and `missingPdf` items.
- **Dedicated Proma Agent Skill**: Ships with the `paperquay-zotero-sync` skill providing a standardized 4-stage ReAct workflow (Intent Resolution -> Pre-sync Diff -> User Confirmation -> Safe Ingestion).

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

- **Zotero 本地文献库选择性同步能力**：打破过去只能整体无差别全量同步的限制；底层支持按分类精准提取、多字段条件检索（标题、作者、年份、DOI）与按指定 itemKey 挑选入库。
- **PaperQuay MCP 服务端 Zotero 工具链扩展**：在标准 MCP 服务中扩展了 4 个新工具（`zotero_list_collections`、`zotero_search_items`、`zotero_preview_sync`、`paperquay_sync_from_zotero`），外部 Agent 现可免侵入直接调度 Zotero 数据并安全写入 PaperQuay。
- **同步前差量比对与三重去重保障**：在真正执行文件拷贝与入库前自动进行安全预检，严格基于 DOI、标题标准化及 PDF 内容 SHA-256 哈希进行查重，清晰区分为「待同步」、「已存在跳过」与「缺少本地 PDF」状态。
- **Proma 专属联动技能发布**：提供 `paperquay-zotero-sync` 专属技能，确立了「意图解析 ➔ 检索预检 ➔ Markdown 差量清单确认 ➔ 批准后精准入库」的高可靠人机交互 SOP，并在全工作区完成分发部署。

## 备注

- AI 特性需要在“设置”中配置你自己的兼容模型接口与 API 密钥。
- 发布产物由 GitHub Actions 自动构建生成。
