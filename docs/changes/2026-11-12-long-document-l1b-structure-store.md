# L1b 章节树与物理/印刷页映射持久化

## 实现

- PaddleOCR generation 发布现在读取本 generation manifest 中的 `content_list_v2.json`，以解析块的 `text_level` 和页结构生成章节/节候选。支持扁平块、分页数组和页字典；标题缺失或 JSON 无效时保留 document 根单元和逐物理页映射，印刷页标签保持未知。
- 候选单元与逐页映射先登记到同一 generation，再由 `publishGeneration` 在单个 SQLite 事务中校验完整页覆盖、单元页范围和来源版本，并一并发布映射历史及 current 指针。失败不会把新 generation 切为 current。
- 新增只读 `knowledge_document_structure_get` 查询，要求明确 source ID，只返回 published 且 current generation 与当前 active source version 一致的章节和页映射；无效 ID、无存储、无 current 或来源版本过期均 fail closed。服务层提供结构结果类型，供阅读器目录和图谱证据入口复用。
- 共享 `paperquay-knowledge.sqlite` 将 `unit_revision` 加入 document unit schema、将 knowledge schema 版本提升至 2，并对已有 unit 表做幂等升级。
- 新增单元树增量 upsert 和读取接口，保留同代其他章节；显式保存 parent、kind、ordinal、标题、物理页范围、印刷页标签、revision、内容 hash 与可选正文。不可变 revision 快照单独追加保存；相同 revision 尝试写入不同内容会冲突失败。
- 新增物理页到印刷页及章节单元映射的增量写入/读取接口。物理页采用 1 起算；`printedPage` 保留原始标签字符串，罗马数字、附录页码等不转数值。显式 mapping revision 采用追加历史，相同 revision 冲突时拒绝覆盖。
- 写入校验拒绝无效页范围、重复 ID、未知/跨代父节点、层级环、重复或不存在的物理页以及超出单元范围的映射。没有隐式删除其他单元或页映射。

## 验证

- `node --test tests/knowledgeStoreStructure.test.mjs tests/knowledgeStoreEvidence.test.mjs tests/backupKnowledgeStore.test.mjs`：4/4。覆盖已发布 generation 的结构写入、单章修订保留兄弟、revision 冲突、物理页与印刷标签分离、树环和页映射拒绝、数据库关闭重开及旧 schema 迁移幂等。
- 页码修订增量后的 `node --test tests/knowledgeStoreStructure.test.mjs tests/knowledgeStoreEvidence.test.mjs tests/backupKnowledgeStore.test.mjs`：4/4；完整 `npm run check` 构建通过、全套 1006/1006、退出码 0。测试 fixture 清理器对隔离 TEMP 报 `EPERM` 并跳过清理。此前 EvidenceSpan locator 完整检查为 1005/1005。
- 只读当前章节查询新增后，`node --test tests/documentStructureCommands.test.mjs tests/knowledgeGraphCommands.test.mjs`：11/11；覆盖 source ID 绑定、忽略 building/旧 current 与来源版本变更后的 stale generation。最终隔离 TEMP `npm run check` 构建通过、完整测试 1012/1012、退出码 0；测试清理器仍对部分隔离目录报告 `EPERM` 并跳过清理。
- `git diff --check` 与相关后端 `node --check` 通过。

## 尚未完成

章节候选现从 Paddle 解析产物写入 generation，并与页映射同事务发布，且有 fail-closed 只读 current 结构查询；仍未接入阅读器目录、人工目录修订 UI/冲突处置、EvidenceSpan 页映射、单章索引和覆盖恢复 UI。代表性长文档评测仍缺外部解析条件，L1b 继续进行中。
