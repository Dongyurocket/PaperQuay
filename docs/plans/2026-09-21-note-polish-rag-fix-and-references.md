# 2026-09-21 笔记润色知识库检索失效修复 + 参考文献功能计划

## 背景与证据

### 问题 1：笔记 AI 润色总是匹配不上知识库内容

根因已定位：**检索键与索引键不一致**。

- 索引写入侧：`src/features/reader/readerRag.ts:163` `buildReaderRagDocumentKey(item)` 对 `native-library` 文献返回 `item.itemKey`；`src/features/reader/readerShared.ts:974` `createNativeLibraryWorkspaceItem` 设置 `itemKey: paper.id`（裸 ID）。因此 RAG 索引中 chunks 的 `document_key` 是**裸 `paper.id`**（`src/features/reader/libraryRagIndexing.ts:117` 原样使用该 documentKey；手动索引 `src/features/reader/useReaderRagIndexActions.ts:122` 同样用裸 `item.itemKey`）。
- 润色检索侧：`electron/backend/aiCommands.cjs:1459` `notes_polish_openai_compatible` 查询时传 `documentKey: \`native-library:${paperId}\``（**带前缀**）。
- `electron/backend/ragStore.cjs:866` `indexedSourceRows` 用 `WHERE document_key = ?` 精确匹配（FTS 路径同样按 document_key 过滤），带前缀的键永远匹配不上裸键索引 → 检索必返回空 → 落到「未检索到与笔记相关的已索引文献内容」。
- 旁证：Agent 的 `searchRag`（`src/services/libraryAgent.ts:3060`）传裸 `paperIds`，所以 Agent 知识库问答正常，只有笔记润色失效；知识图谱（`electron/backend/knowledgeGraphCommands.cjs:695-698`）同时查 `paper.id` 与 `native-library:paper.id` 两种键，说明键约定不一致是历史遗留。
- 测试掩盖：`tests/notePolishCommand.test.ts:17` 的 mock 写死匹配 `native-library:paper-1`，测试全绿但生产不匹配。

次要问题（修好键之后仍影响体验）：

1. 润色范围默认 `'none'`（`src/features/notes/NoteEditor.tsx` 的 `useState<NotePolishScope>('none')`），不切换完全不检索。
2. 证据排序非全局：`sort((l, r) => l.sourceRank - r.sourceRank)` 中 sourceRank 只是单篇文献单次检索内的名次（0..2），跨文献 `slice(0, 8)` 不保证留下全局最相关内容。
3. embedding 维度静默不匹配：向量与 FTS 两路都过滤 `embedding_dimension = ?`（`ragStore.cjs:872/1316/1383/1442`），更换 embedding 模型后全部返回空，但提示语是误导性的「未检索到…」。
4. 引用依赖模型返回 JSON citations：provider 不支持 `json_object` 时回退纯文本且 `citations: []`（`aiCommands.cjs:1232` `parseNotePolishResponse`），用户感知就是"没匹配上"。

### 问题 2：笔记缺少参考文献插入 / 列表 / 跳转

现状：

- 已有 `PaperReference` 内联节点（`src/features/notes/extensions/PaperReference.ts`）：`@` 触发、按标题/ID 检索、渲染 `@标题`，attrs 仅 `{paperId, label}`。
- **点击跳转是断的**：`src/features/notes/NotesWorkspace.tsx:977` `handleOpenPaper` 只把文献标题填进笔记搜索框（`setSearch`），并不会打开文献。
- 跳转基建已存在：`emitOpenLibraryPaper(paperId)`（`src/app/appEvents.ts:64`，App.tsx→Reader 已监听，打开文献）与 `emitJumpToNoteAnchor({blockId, pageIndex, ...})`（打开并滚动到具体位置；Reader.tsx:978 监听，要求 detail 含 `noteId` 与 `anchorId`）。
- 笔记的 `linkedPaperIds` 由 `extractPaperRefs`（`src/features/notes/notesTiptap.ts:267`）从文本 `@id` token 提取并在保存时持久化。
- 右侧栏 `NotesRightPanel`（NotesWorkspace.tsx:565）现有 Outline / Backlinks 两个区块，可扩展。

## 修改方案

### A. 润色检索修复（fix(rag)）

1. `electron/backend/aiCommands.cjs`：检索改用**裸 paperId**，并传 `documentKeys: [paperId, \`native-library:${paperId}\`]` 双键兼容可能存在的旧前缀索引。
2. 证据全局排序：候选携带 ragStore 返回的相关度分（RRF/向量分，无分数时以 sourceRank 兜底），全局降序后取 top 8。
3. 维度不匹配显式提示：检索结果为空时，用 `ragStore.listIndexStatuses()`（或 `getDocumentIndexStatus`）对比索引 `embeddingDimension` 与当前查询向量维度，不一致则提示"索引向量维度与当前 embedding 模型不一致，请重建索引"。
4. 引用兜底提示：evidence 非空但模型未返回 citations 时，notice 增加"已检索到 N 条相关知识库内容，但模型未标注引用来源"。
5. `src/features/notes/NoteEditor.tsx`：润色范围默认值从 `'none'` 改为 `'linked-papers'`。
6. 测试：
   - 修正 `tests/notePolishCommand.test.ts` 的 mock 为裸键，并断言命令传给 ragStore 的 documentKeys 同时包含裸键与前缀键（防回归）。
   - 新增集成测试：真实 `createRagStore`（内存库）以裸键索引 → 调 `notes_polish_openai_compatible`（mock openAiChat 网络层）→ 断言检索命中且证据进入 prompt。

### B. 参考文献功能（feat(notes)）

1. **点击跳转修复**：`NotesWorkspace.handleOpenPaper` 改为 `emitOpenLibraryPaper(paperId)`，点击 `@引用` 直接打开文献。
2. **引用节点增强**（向后兼容）：`PaperReference` attrs 增加可选 `anchorId` / `blockId` / `pageIndex` / `sourceType`（parse/render HTML data 属性）；onClick 回调签名扩展为 `(paperId, location?)`。无位置 → `emitOpenLibraryPaper`；有位置 → `emitJumpToNoteAnchor` 跳到具体页/块。
3. **插入入口**：
   - 工具栏新增"插入参考文献"按钮：弹出文献选择器（搜索框 + 库内文献列表，复用 `@` suggestion 的数据源），选中后在光标处插入 `paperReference` 节点。
   - 保留 `@` 触发；Slash command 增加"参考文献"项（打开同一选择器）。
4. **参考文献列表（右侧面板）**：新增 `src/features/notes/noteReferences.ts`，从 `contentJson` 实时派生：扫描 `paperReference` 节点 + 润色产生的 `noteAnchorBlock`（带 paperId），按首次出现排序、按 paperId 去重编号、聚合每篇的位置信息（pageIndex/blockId）。`NotesRightPanel` 新增"参考文献"区块（需传入 `papers` 解析标题/作者/年份），每项点击按上述规则跳转，有位置的标注"第 X 页"。
5. **文末参考文献列表**：工具栏/斜杠命令"插入参考文献列表"：在文末生成"参考文献"标题 + 编号列表（`[n] 标题. 作者, 年份.`），数据来自同一派生函数 + `papers`。重复点击时扫描并替换旧列表（识别"参考文献"标题块）。
6. **测试**：`tests/noteReferences.test.ts`（派生、排序、去重、位置聚合、文末列表生成/替换）；PaperReference attrs 解析测试。

### 工程约定

- 提交 scope：`fix(rag)` / `feat(notes)`。
- 中英 README 如涉及用户可见功能说明需同步。
- 失败必须显式暴露（notice/状态栏），不静默吞错。

## 验证

- `npm run build`
- `npm test`（至少覆盖 notePolishCommand、ragStore、noteReferences、noteEditorUtils）
- 手动：对一篇已索引文献的笔记执行"笔记关联文献/整个知识库"润色，确认引用锚点出现；点击 `@引用` 打开文献；右侧面板列出参考文献并可跳转；文末列表可插入与更新。
