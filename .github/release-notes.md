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

- **Chinese Literature Support**: Chinese papers no longer waste translation calls — full-text translation is skipped automatically when the document is Chinese-dominant and the target language is Chinese, and Chinese titles are adopted as-is instead of being machine-translated. Japanese text (kana) is excluded from detection to avoid false positives.
- **Chinese Full-Text Search in Local RAG**: The FTS5 tokenizer migrated from unicode61 to trigram, enabling substring keyword matching for Chinese content in the local knowledge base (previously an entire Chinese paragraph was treated as a single token, making Chinese search completely ineffective). Existing databases are rebuilt automatically on launch; English retrieval degrades gracefully to substring matching with even better recall.
- **Auto-Indexing After Parsing**: Once MinerU parsing completes (single paper or batch, fresh parse or cached result), the paper's markdown source is indexed into the local RAG knowledge base in the background — papers become searchable without opening the reader first. Silently skipped when local RAG or the embedding service is not configured.
- **AI Metadata Enrichment for Chinese Papers**: Crossref/OpenAlex have limited coverage of Chinese literature. A new LLM fallback extracts title, authors, year, journal, DOI, abstract, keywords, volume, issue, pages, and ISSN from the paper's first page, reusing the Paper Overview model preset. Available in the import dialog (manual auto-fill), bulk metadata enrichment, and the per-paper metadata dialog whenever remote lookups miss; English papers never trigger the model call.

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

- **中文文献支持**：中文文献免翻译——检测到正文以中文为主且目标语言为中文时自动跳过全文翻译；中文标题直接采用原标题作为中文标题，不再占用翻译接口；语言检测排除日文假名，避免日文文献误入中文流程。
- **中文全文检索**：本地 RAG 知识库的全文检索分词器从 unicode61 迁移到 trigram，中文关键词可按子串命中正文切片（旧版把整段中文当成单个词，中文检索完全失效）；旧版数据库启动时自动重建索引，环境不支持时安全回退；英文检索在 trigram 下退化为子串匹配，召回能力更高。
- **解析后自动入库**：MinerU 解析完成（单篇/批量、新解析/缓存复用）后，自动将文献的 markdown 源后台纳入本地 RAG 索引，文献无需打开阅读器即可被知识库检索；未启用本地 RAG 或未配置 Embedding 服务时静默跳过。
- **中文文献元数据智能补全**：Crossref/OpenAlex 对中文论文覆盖有限，新增 LLM 兑底提取——从文献首页文本抽取标题、作者、年份、期刊、DOI、摘要、关键词、卷号、期号、页码、ISSN 等字段，复用「论文概览」模型预设；导入对话框（手动点「自动补全」时）、批量「解析元数据」与单篇「解析元数据」对话框均在远程检索未命中时自动兑底，英文文献不会触发模型调用。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
