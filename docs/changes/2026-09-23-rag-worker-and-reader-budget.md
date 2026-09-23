# RAG 执行隔离、上下文边界与阅读标签休眠

## 现象

RAG 数据库在主进程里同步打开。启动时向量汇总会一次扫完整表。检索命中后，笔记润色只把命中片段本身交给模型。非活动阅读标签仍然挂着整篇 PDF 和解析结果。大 JSON 的解析也在界面线程里做。

## 根因

`createRagStore` 直接使用 `node:sqlite` 的同步连接，调用方没有队列。切片表没有代次和章节字段，邻接查询无法在章节边界停下。阅读区把每个标签都渲染成 `DocumentReaderTab`，只是用 `hidden` 藏起来。

## 修改

- Electron 默认把 RAG 连接放进 `worker_threads`。`PAPERQUAY_RAG_INPROCESS=1` 时仍在进程内，测试继续走这条路径。窗口先创建，再初始化后端。
- 向量汇总按 `document_key` 分批，并用游标记录进度。不先清空缓存表。
- `rag_chunks` 增加 `generation_id`、`section_id`、`section_path`、`start_offset`、`end_offset`、`text_version`。旧库先补列，再加索引，不改唯一约束，也不因此重嵌。
- 新索引把正文签名当作代次。MinerU 标题成为章节，PDF 按页分节，并记下切片在原文中的起止位置。上下文查询只取同一代次。目标行有章节且没有要求整篇时，不跨章。
- 笔记润色和知识库检索在命中后补上前后各一片，再交给模型。旧库没有这些列时，知识库仍只返回命中文本。
- MinerU JSON 解析改到渲染线程的 Worker，结果按页分段传回。没有 Worker 时仍在当前线程解析。
- 同时挂载的阅读标签默认不超过两个。正在翻译的标签不休眠。问答记录留在阅读区父组件。

## 验证

- `node --test tests/ragStore.test.ts tests/readerResourceBudget.test.ts tests/readerRagContext.test.ts tests/knowledgeGraphCommands.test.mjs tests/knowledgeMcp.test.ts`
- `npx tsc --noEmit`
- `npm test`
