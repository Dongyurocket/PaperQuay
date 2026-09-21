# 2026-09-21 - 笔记润色 RAG 键修复与参考文献

## 现象

1. 笔记 AI 润色在「笔记关联文献 / 整个知识库」范围内几乎总是提示未检索到已索引内容，即使对应文献已经建好 RAG 索引。
2. 笔记里的 `@文献` 点击后只把标题填进搜索框，不会打开文献；也没有参考文献列表、页级跳转和文末列表。

## 根因

- RAG 索引写入的 `document_key` 是裸 `paper.id`，润色查询却使用 `native-library:${paperId}`，精确匹配永远落空。
- 单测 mock 写死匹配带前缀键，测试全绿但生产不命中。
- 证据按单篇 `sourceRank` 截断，不保证全局最相关；embedding 维度不一致时提示语仍是「未检索到」。
- `handleOpenPaper` 未调用已有的 `emitOpenLibraryPaper` / `emitJumpToNoteAnchor`；`PaperReference` 只有 `{paperId, label}`，无法携带页/块位置。

## 修改

- 润色检索同时查询裸 `paperId` 与 `native-library:` 前缀键；证据按 RAG 相关度全局排序后取 top 8。
- 索引向量维度与当前 embedding 不一致时显式提示重建索引；已检索到证据但模型未返回 citations 时给出兜底提示。
- 润色范围默认改为「笔记关联文献」。
- `@引用` 点击打开文献；带页/块位置时跳到对应位置。
- `PaperReference` 增加可选 `pageIndex` / `blockId` / `anchorId`，旧数据仍可解析。
- 工具栏、斜杠命令与 `@` 共用文献选择器插入参考文献。
- 右侧栏与文末列表由 `noteReferences.ts` 从 `contentJson` 实时派生，不落库。

## 验证

- `npm run check`：TypeScript 构建通过，373 项测试全绿。
- 新增 `tests/noteReferences.test.ts`、`tests/notePolishRagRetrieval.test.ts`；修正 `tests/notePolishCommand.test.ts` 同时断言裸键与前缀键。
