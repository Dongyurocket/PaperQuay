# 2026-09-06 - 译文 PDF 统一目录归档、知识库 MCP 外部 Agent 接入与学术元数据扩展

## 现象与需求

1. **译文 PDF 统一文件夹管理**：原本附加的翻译版 PDF 与原版论文混放在文献库根目录，缺少统一集中的子目录管理，用户期望能够统一复制到专有文件夹集中维护。
2. **知识库外部 Agent 接入**：Proma、Pi、Codex 等外部编码或调研 Agent 无法直接访问 PaperQuay 的本地 RAG 知识库与文献数据进行检索、问答和事实引用。
3. **完善学术元数据与常用引用支持**：文献类型仅有默认论文，缺乏书籍（Book）、报告（Report）、学位论文（Thesis/Dissertation）等学术常用文献分类，且缺少出版社、授予机构、卷号、期号、页码、报告编号、ISBN 等学术引用标准字段，导出 BibTeX 时无法生成精准的条目类型（如 `@book`, `@techreport`, `@phdthesis`）。

## 根因与设计方案

1. **译文 PDF 存储路径与安全边界**：
   - 之前 `library_add_attachment` 直接写入 `storageDir` 根层级。
   - 方案：在 `LibrarySettings` 中增加 `translatedPdfDir`（默认自动归档至 `<storageDir>/translated-pdfs`，亦支持用户自定义绝对路径）；修改 `library_add_attachment` 使其自动落盘至统一目录，相对路径记为 `translated-pdfs/...`；更新设置时提供自动平滑迁移；安全写权限检查增加该目录白名单；向后兼容旧版直接存放在根目录的附件。
2. **只读轻量 MCP stdio 服务**：
   - 外部 Agent 需要标准化协议（Model Context Protocol）接入，且要求即使桌面应用未启动也能独立运行，或者在应用运行时并发无锁访问。
   - 方案：基于 `node:sqlite` 原生 `readOnly: true` 直连本地数据库（WAL 并发模式），编写零外部重依赖的 MCP stdio 服务器 `bin/paperquay-mcp.cjs` 与核心检索服务 `electron/mcp/knowledgeMcpService.cjs`。提供 `search_papers`、`get_paper_details`、`search_knowledge_base`（支持 FTS5 与关键词降级，附带页码与段落定位）、`read_paper_content`、`search_notes` 等 5 个标准工具。
3. **学术数据模型与引用输出增强**：
   - SQLite `papers` 表此前缺少学术出版与细分文献字段。
   - 方案：`LiteraturePaper` 新增 `itemType`（`journalArticle`, `book`, `bookSection`, `conferencePaper`, `thesis`, `report`, `preprint`, `misc`）及 `publisher`, `institution`, `reportNumber`, `volume`, `issue`, `pages`, `isbn`, `issn`；SQLite 增加幂等列迁移；前端详情面板增加类型选择与条件表单及展示卡片；`src/utils/bibtex.ts` 根据文献类型生成标准 `@book`, `@techreport`, `@phdthesis`, `@mastersthesis`, `@incollection`, `@inproceedings` 结构及学术属性。

## 修改内容

- **数据类型与模型**：
  - `src/types/library.ts`：增加 `LiteratureItemType`；`LiteraturePaper`、`ImportPdfMetadata`、`UpdatePaperRequest` 补充 `translatedPdfDir` 及学术元数据字段。
  - `src/features/literature/importTypes.ts`：`ImportDraftItem` 补充学术元数据字段。
- **SQLite 存储与迁移**：
  - `electron/backend/libraryDatabaseStore.cjs`：通过 `ensureColumn` 迁移增加 `item_type`, `publisher`, `institution`, `report_number`, `volume`, `issue`, `pages`, `isbn`, `issn`；读写与快照持久化同步补齐。
  - `electron/backend/libraryStore.cjs`：设置项增加 `translatedPdfDir: ''`。
- **后端命令与安全策略**：
  - `electron/backend/libraryCommands.cjs`：新增 `resolveTranslatedPdfStorageDir` 与 `migrateTranslatedPdfDirectory`；`library_add_attachment` 和 `library_remove_attachment` 适配统一译文目录；`library_update_paper` 开放学术字段更新。
  - `electron/backend/fileCommands.cjs`：将 `translatedPdfDir` 纳入安全写目录白名单。
- **MCP 知识库服务端与文档**：
  - `electron/mcp/knowledgeMcpService.cjs`：封装只读数据库直连、FTS5 全文切片检索与笔记搜索。
  - `bin/paperquay-mcp.cjs`：实现标准 MCP stdio JSON-RPC 2.0 服务端。
  - `package.json`：注册 `npm run mcp` 脚本与 `bin` 执行命令。
  - `docs/MCP_AGENT_INTEGRATION.md`：编写 Proma、Pi、Codex、Claude Code 配置接入指南。
  - `mcp.json`：为当前开发工作区注册 `paperquay` stdio MCP 服务。
- **引用导出与工具**：
  - `src/utils/bibtex.ts`：增强 `inferBibtexEntryType` 与 `paperToBibtexEntry`，覆盖书、章节、报告、学位论文及细分字段。
  - `src/features/literature/literatureLibraryUtils.ts`：补充 `normalizeItemType` 并映射 Zotero 导入类型。
- **前端设置与详情交互**：
  - `src/features/reader/readerPreferencesTypes.ts`、`readerPreferencesContent.tsx`、`Reader.tsx`：增加“统一译文 PDF 存放文件夹”选择与重置控件。
  - `src/features/literature/components/LibrarySettingsDialog.tsx`：同步补充统一译文目录设置。
  - `src/features/literature/components/LiteraturePaperDetails.tsx`：详情面板提供文献类型选择器、学术出版机构/报告号/卷期页码/ISBN 表单及只读信息展示。
- **测试用例**：
  - `tests/libraryTranslatedPdfAttachments.test.ts`：增加统一子目录落盘与自定义目录迁移测试。
  - `tests/knowledgeMcp.test.ts`：新增 MCP 服务与 JSON-RPC 协议完整流程测试。
  - `tests/bibtex.test.ts`：增加对书籍、报告、硕博学位论文的 BibTeX 导出测试。
  - `tests/libraryDatabaseStore.test.ts`：增加扩展学术字段往返存储测试。

## 验证

- `npm run build`：TypeScript 类型检查与 Vite 编译成功，无任何错误。
- `npm test`：全套 244 个测试用例全部通过（涵盖本次新增的 4 个 MCP 测试用例、扩展 BibTeX 测试用例、扩展 SQLite 持久化测试用例与统一翻译目录测试用例）。
- `node --test tests/libraryCommands.test.mjs && node --test tests/knowledgeGraphCommands.test.mjs`：后端专项测试通过。
