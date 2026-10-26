# 2026-10-26 - 文献级 RAG 索引开关

## 现象

本地 RAG 只能整库启用。单篇文献无法移出知识库，索引一旦建立就会继续参与检索、问答补索引和文献相似度。

## 根因

`papers` 没有逐篇成员标记。四个索引入口和三个写库命令都不检查文献是否应被索引。

## 修改

- `papers.rag_enabled` 默认加入。该列不进入全列 UPSERT；全量保存沿用参考文献的做法，清表前缓存、插入后写回。
- 唯一命令 `library_set_rag_membership` 在同一把文献锁里改标记，关闭时删除该文献的索引派生数据。笔记索引不删。
- `rag_index_document`、`rag_finalize_document_index`、`rag_report_document_index_failure` 在写库前拒绝已排除文献，错误消息含 `rag_index_excluded`，不写失败行。
- 解析后索引、阅读器问答和 Agent 在 embedding 前返回排除。问答与单篇 Agent 仍回退全文。
- 详情、右键和批量栏可加入或移出。列表角标优先显示「已排除」。设置里的索引统计增加已排除篇数。启动时后台清掉已排除文献的残留索引。
- 列表可按全部 / 已加入 / 已排除筛选。MCP `get_paper_details` 与 `search_papers` 返回 `ragEnabled`。

## 验证

- `tests/libraryDatabaseStore.test.ts`：旧库补列后为加入；`savePaper` 与 `store.save()` 不把已排除写回加入。
- `tests/ragStore.test.ts`：`removeDocumentIndex` 可重复调用，文献索引行被删除，笔记索引仍在。
- `tests/ragMembership.test.ts`：拒绝写入后没有失败行；移出会等正在进行的索引写入结束后再删除。
- `npm run build` 与 `npm test`。
