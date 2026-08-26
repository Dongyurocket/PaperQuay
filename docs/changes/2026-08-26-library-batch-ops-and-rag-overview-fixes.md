# 2026-08-26 - 文库批量操作、概览缓存与 RAG 状态修复

对应计划文档：`docs/plans/2026-08-26-library-batch-features-and-bugfixes.md`（P0–P2 已全部落地）。

## 一、Bug 修复

### 1. 概览已生成却在重新打开文献时重复生成

**现象**：文库预览中已生成概览，打开文献切到概览页仍显示"生成中..."并重新调用模型。

**根因**：文库预览（`readerLibraryPreview.ts`）与阅读器（`documentReaderSummarySource.ts`）使用两套不同的 sourceKey 算法（`workspaceId` 前缀 + markdown 路径 vs `itemKey` 前缀 + mineruPath + blockCount），缓存文件以 sourceKey 哈希命名，两边永远互查不到。

**修改**：

- `documentReaderSummarySource.ts`：`buildPaperSummarySourceKey` 改为统一算法 `itemKey::promptVersion::language::sourceMode::contentSignature`，其中 MinerU 模式的内容签名由新增的 `computeMineruBlocksContentSignature(blocks)` 计算（块数 + 全文 hash），不再依赖易漂移的 `mineruPath` 绝对路径；新增 `buildLegacyPaperSummarySourceKeys` 生成旧版 key 候选。
- `documentReaderCache.ts` / `readerLibraryPreview.ts`：`loadSavedSummaryCache` 与 `readSavedPreviewSummary` 支持 `legacySourceKeys` 候选查找并返回 `matchedSourceKey`。
- `DocumentReaderTab.tsx` / `useReaderLibraryPreview.ts`：命中旧 key 后按新 key 写回一份缓存，完成无感迁移。

### 2. 侧栏问答 RAG 报 Embedding HTTP 404，Agent 处"看似正常"

**现象**：侧栏提示"未命中本地 RAG：检索失败…Embedding HTTP 404"；Agent 回答正常。

**根因**：Embedding 配置指向的服务没有 `/v1/embeddings` 端点（典型：直接复用了 chat 模型服务商地址；`readerShared.ts` 的 legacy 迁移逻辑在 embedding 配置为空时会自动继承 QA 聊天 preset，放大了该问题）。两处 RAG 走同一份配置都会失败，但 Agent 侧 `libraryAgent.ts` 的 `try/catch` 只 `console.warn` 静默回退，造成"Agent 正常"的错觉。

**修改**：

- `libraryAgent.ts`：`PaperContextPayload` 新增 `ragError`，`buildPapersWithRequestedContext` 汇总为 `ragErrors`，`LibraryAgentRunResult` 的 answer/choice/plan 分支新增 `ragNotice`，失败状态不再静默。
- `AgentWorkspace.tsx` / `AgentWorkspace.types.ts` / `AgentWorkspaceMessages.tsx`：消息记录并渲染琥珀色 RAG 回退提示条。
- `readerQaContext.ts`：侧栏失败文案追加排查指引；识别 404 时明确提示"该服务没有 /v1/embeddings 端点，请改用 embeddings 模型并测试连接"。
- 新增 Embedding 连接测试：后端 `rag_test_embedding` 命令（`aiCommands.cjs`，`utils.cjs` 导出 `embeddingsEndpoint`）、前端 `testRagEmbeddingEndpoint`（`services/rag.ts`）、设置页"测试 Embedding 连接"按钮（`readerPreferencesContent.tsx`，成功显示维度与耗时，404 时给出专门指引）。

### 3. 思考强度：侧栏入口不可见 + 缺少最高档

**根因**：侧栏 `ReasoningEffortPicker` 的渲染条件 `!compactComposer || ultraCompactComposer` 导致中等紧凑宽度下控件消失，只剩菜单里一个不显示当前档位的循环按钮。类型定义最高只有 `xhigh`。

**修改**：

- `types/reader.ts`：`ModelReasoningEffort` 新增 `'max'` 档（最高）。
- `ReasoningEffortPicker.tsx`、`readerShared.ts` 的 `MODEL_REASONING_OPTIONS`、`AgentWorkspaceView.tsx` 的 `agentReasoningOptions`、`libraryAgent.ts` 的 `normalizeAgentRuntimeConfig` 白名单、`assistantSidebarChat.tsx` 循环数组同步加入 max；后端本就直接透传 `reasoning_effort`/`reasoning.effort`，无需改动。
- `assistantSidebarChat.tsx`：`ReasoningEffortPicker` 改为所有宽度下始终渲染（紧凑时用图标模式）；"更多操作"菜单中的思考强度项显示当前档位。

## 二、新功能

### 4. 文库页多选与批量操作

- `LiteratureLibraryView.tsx`：新增 `multiSelectedPaperIds` + `selectionAnchorId` 状态与 `handleSelectPaperWithModifiers`（普通点击单选并清空多选、Ctrl/Cmd 切换、Shift 范围选择）；文献列表刷新后自动清理失效选中 id；多选 ≥2 时详情面板切换为批量摘要视图。
- `LiteraturePaperList.tsx`：新增 `multiSelectedPaperIds` 与带修饰键的 `onSelectPaper`；多选激活时行首显示 checkbox（取代拖拽手柄），多选行弱高亮；空格键支持修饰键。
- 批量工具栏（多选时出现于列表顶部）：翻译标题、导出 Bib、移动分类（下拉）、收藏、批量删除（确认对话框，新增 `delete-papers` 类型，循环调用 `library_delete_paper`）、取消选择。demo 模式下写操作禁用。

### 5. 批量标题翻译

- `useReaderLibraryActions.ts` 新增 `handleBatchTranslatePaperTitles`：复用翻译模型 preset 与 `translateTextOpenAICompatible`，按 `libraryBatchConcurrency` 做 worker 池并发，逐篇 `library_update_paper` 落库 `titleZh` 并广播 `NATIVE_PAPER_UPDATED_EVENT`（文库列表增量刷新）；默认跳过已有中文标题的文献，失败不中断批次，结束汇总成功/失败/跳过数。

### 6. 批量导出 Bib（两种格式）

- 新增 `src/utils/bibtex.ts`：特殊字符转义、citation key 生成（第一作者姓 + 年份 + 标题首个实词，冲突加字母后缀）、entry 类型推断（article/inproceedings/book/misc）、作者 `Family, Given` 格式化、`titleZh` 写入 `note`（BibTeX）或 `titleaddon`（BibLaTeX，`dialect` 选项预留）。
- 两种导出形态：**合并为单个 .bib**（`library-YYYYMMDD.bib`）与**每篇一个 .bib 文件**（选目录逐篇写入 `{citationKey}.bib`，文件名与条目 key 通过 `citationKey` 选项强制一致）。
- 后端 `fileCommands.cjs` 新增通用 `select_save_file_path`（filters 参数化，保留 `select_save_pdf_path` 不变）；前端 `services/desktop.ts` 新增 `selectSaveFilePath`。
- 工具栏"导出 Bib"按钮展开格式选择菜单，经 `Reader.tsx` 接入 `handleBatchExportBib`。

## 验证

- `npx tsc --noEmit` 通过。
- `npm test`：195 个测试全部通过（新增 `tests/bibtex.test.ts` 6 例；`tests/documentReaderCache.test.ts` 更新返回类型并新增 legacy key 命中用例；`tests/documentReaderSummarySource.test.ts` 更新为新算法并新增内容签名稳定性与 legacy key 覆盖用例）。
- `npm run build`：生产构建通过。

## 未做/后续

- 计划文档中 Q4 的"内容变化时提示刷新而非自动生成"UI 增强未做：缓存 key 统一后，自动生成会先命中缓存秒级恢复，用户痛点已消除；如仍需显式提示可后续补。
- 多选拖拽整组移动分类、右键菜单对多选生效、Agent 架构 ReAct 化等 P3 项见计划文档 Q7。
