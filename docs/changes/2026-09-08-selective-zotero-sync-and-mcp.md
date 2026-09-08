# Zotero 本地文献库选择性同步与 MCP 工具扩展

## 背景与问题

PaperQuay 原有的 Zotero 集成方式为“一键全量导入”：
1. **只能全量导入**：在文献库界面点击导入后，会递归扫描本地 Zotero 所有的分类并全量拷贝入库，缺乏按分类多选、按关键词挑选、按单篇导入的灵活性；
2. **外部 Agent 无法调度**：PaperQuay 原有的 MCP 知识库服务仅提供只读文献检索能力，未暴露 Zotero 本地读取及 PaperQuay 写入能力，导致 Proma 等外部 AI Agent 无法根据用户意图选择性地导入特定文献。

## 解决方案

### 1. 本地 Zotero 细粒度检索与元数据补全 (`electron/backend/zoteroLocal.cjs`)
- 扩充 `getLocalItemsByKeys`：支持按一组给定的 Zotero itemKey 精准定位条目及其本地 PDF 附件；
- 扩充 `searchLocalLibraryItems`：支持按分类限定、标题、作者、年份或 DOI 条件模糊检索条目；
- 补全条目解析字段：除原有字段外，完整提取 `authors` 列表、`doi`、`publication`、`abstractNote` 与 `url`，为精准检索与引用提供基础。

### 2. MCP 服务端 4 大工具扩展 (`bin/paperquay-mcp.cjs` & `electron/mcp/knowledgeMcpService.cjs`)
- **`zotero_list_collections`**：自动探测本机 Zotero 数据目录，列出完整分类树结构与文献条目统计；
- **`zotero_search_items`**：按条件检索 Zotero 本地条目，并准确标记条目是否包含本地已下载的 PDF 文件；
- **`zotero_preview_sync`**：执行入库前安全预检与差量比对，自动比对 PaperQuay SQLite 文献库，清晰分类为 `ready`（可同步就绪）、`alreadyExists`（已存在去重跳过）与 `missingPdf`（缺少本地 PDF 附件）；
- **`paperquay_sync_from_zotero`**：安全入库执行工具，支持分类自动映射、PDF 拷贝与 SQLite 并发安全事务写入。

### 3. 三重防重与数据一致性保障
- 基于 DOI 精确匹配、标题标准化比对与 PDF 内容 SHA-256 哈希校验进行三重复核，确保文献库干净不重复。

### 4. Proma 专属联动技能发布与全工作区部署
- 定制发布专属技能 `paperquay-zotero-sync/SKILL.md`，规范“意图解析 ➔ 检索预检 ➔ 差量清单确认 ➔ 批准入库”的交互 SOP；
- 已将技能分发至全部 31 个工作区，并在 10 个既有学术技能中完成工具文档升级。

## 验证与测试

- 新增 `tests/zoteroLocal.test.ts` 针对条目定位与条件检索的单元测试；
- 新增 `tests/knowledgeMcp.test.ts` 针对 Zotero 选择性同步完整流水线的端到端集成测试；
- 全库 273 个测试全部通过（0 fail），TypeScript 与 Vite 生产构建 100% 成功。
