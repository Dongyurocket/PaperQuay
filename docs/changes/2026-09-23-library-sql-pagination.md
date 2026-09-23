# 2026-09-23 - 文库 SQL 分页与单项增量写入（P2-1）

对应方案：`docs/plans/2026-09-23-performance-reader-outline-and-rag-context.md` 的 P2 文库读写。本次只落地分页查询和单项增量写入。全选（P2-2）与 RAG Worker（P2-3）未做。

## 现象

- 文献列表通过 `library_list_papers` 把整库载入 JavaScript，再筛选、排序、截断，硬顶 1000 条。库变大时打开和刷新都等待全库水合。
- 改一篇文献的分类、标签或附件也会整库删除后重插。`paper_references` 等关联靠外键 `ON DELETE CASCADE`，`INSERT OR REPLACE` 会把引用一并删掉。

## 根因

- 筛选和排序没有下推到 SQLite。旧命令保留是为了不打断仍按全量快照调用的路径。
- 单行写入若用 `INSERT OR REPLACE`，SQLite 会先删除再插入，外键级联清掉该文献的引用和其他关联。

## 修改

- 新增 `electron/backend/libraryQuery.cjs`：分类、标签、搜索和排序在 SQL 内完成。搜索为各字段 `LIKE %词% ESCAPE '\'`，并查关键词、作者、标签。普通分类用递归后代；未分类、收藏、最近导入对齐原有语义。任何排序最后都加 `p.id ASC`，避免翻页在并列键上重复或漏行。
- `libraryDatabaseStore.cjs` 增加 `queryPapers`、`countPapers`、`listPaperIds`、`listCategoriesWithCounts`、`getPaper`、`savePaper`、`deletePaper`。`savePaper` 使用 `ON CONFLICT DO UPDATE`，只重建该文献自己的关键词、作者、标签、分类和附件，不触碰 `paper_references`。
- 分类计数按文献去重（`COUNT(DISTINCT paper_id)`）。同一篇同时挂在父分类和子分类时只计一次，与原来的 JS 计数一致。
- 补充 `papers(imported_at)`、`papers(is_favorite)` 索引，服务最近导入和收藏筛选。`%词%` 搜索无法用普通 B-tree，仍是扫描。
- `libraryCommands.cjs` 注册 `library_query_papers`、`library_count_papers`、`library_list_paper_ids`。单篇分类、更新、删除、附件增删和路径迁移改为增量写入。删除自有文件前按路径查其他引用，不再为这个判断加载全库。`library_list_papers` 保留，旧调用方仍最多拿到 1000 条。
- 文献列表改为按当前筛选滚动加载，每页 500 条，并显示已加载数和匹配总数。筛选变化会使进行中的翻页失效，避免旧页拼进新结果。需要全库快照的 MinerU 状态和批量元数据补齐仍分页拉全量，但走新查询。

## 方案修正

- 分类删除、导入和手动排序仍整库保存。这些操作少，且会改多行或分类树；强行拆成增量容易和现有归一化分叉。
- 排序使用 SQLite `lower()` / BINARY，与 JavaScript `localeCompare` 在非 ASCII 并列时可能不同。最近导入在同一毫秒内的标题次序也可能不同。分页稳定性靠 `p.id ASC`，不靠这两种次序完全一致。
- 列表行仍返回阅读器需要的附件、标签和作者，没有改成只含标题和年份的瘦行。瘦行要改选中后的按需读取，留到后续。
- 全选的 ID 枚举和计数接口已经可用，界面三态和跨页选择模型还没接。

## 验证

- `node --test tests/libraryQuery.test.ts`：筛选集合、manual/title/year 顺序、分页不重不漏、父子分类去重、`savePaper` 保留引用、`deletePaper` 级联删除引用。
- `tests/libraryTranslatedPdfAttachments.test.ts` 的失败回滚改为拦截 `savePaper`。增量写入后，持久化失败仍拒绝请求并留下上一份译文附件。
- `npx tsc --noEmit` 通过。
