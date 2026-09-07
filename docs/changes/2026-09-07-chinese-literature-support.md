# 2026-09-07 - 中文文献支持（免翻译、知识库检索、元数据补全）

## 现象

中文文献在文库中体验不佳：

1. 中文论文仍会触发全文/标题翻译，浪费模型调用；
2. 本地 RAG 知识库的全文检索（FTS5 unicode61 分词）把整段中文当成一个 token，中文关键词完全无法命中，只有向量检索在工作；
3. MinerU 解析完成后，文献要等打开阅读器发起问答时才会被索引进知识库；
4. 中文论文普遍不在 Crossref/OpenAlex 覆盖范围内，导入和批量补全元数据时大量「未匹配」。

## 根因

1. 翻译流程没有语言检测，不区分源文献语言；
2. `rag_chunks_fts` 使用 unicode61 分词，缺少 CJK 支持；
3. RAG 索引仅在阅读器 QA 路径懒触发，解析与索引没有联动；
4. 元数据来源只有 Crossref/OpenAlex 两个英文数据库，没有中文文献兜底手段。

## 修改

### 语言检测基础设施

- 新增 `src/utils/languageDetect.ts`：`containsCjk` / `isChineseDominant`（中文主体判定：≥8 个 CJK 字符且不少于拉丁字母数的一半，兼容中文论文夹杂英文术语）/ `normalizeLanguageCode`（"Chinese"/"Simplified Chinese"/"简体中文"/"zh-CN" → "zh"）/ `isChineseLanguage`。

### 中文文献免翻译

- `useReaderLibraryActions.ts` 全文翻译：正文块合并文本中文主导且目标语言为中文时直接跳过，任务状态标记成功并提示「检测到该文献为中文，无需翻译」；
- 单篇标题翻译：标题含中文时直接返回原标题作为中文标题；
- 批量标题翻译：中文标题分流直填 `titleZh`（不占翻译接口、不要求配置翻译模型），外文标题维持原翻译流程，汇总消息分列「翻译成功 / 中文直填 / 跳过」。

### 知识库中文检索

- `electron/backend/ragStore.cjs`：FTS5 分词器从 unicode61 迁移到 trigram（3 字滑窗子串匹配，天然支持中文，英文退化为子串匹配召回更高）；旧库启动时自动 DROP 旧 FTS 表/触发器并重建 + rebuild 索引；运行环境不支持 trigram 时回退 unicode61；
- MinerU 解析（单篇与批量、新解析与缓存复用）成功后，自动把 mineru-markdown 源后台纳入本地 RAG 索引（`src/features/reader/libraryRagIndexing.ts`）；需用户已启用本地 RAG 且配置 embedding 服务，不满足时静默跳过，失败走既有索引冷却。

### 中文文献元数据补全

- `electron/backend/aiCommands.cjs` 新增 `extract_literature_metadata_openai_compatible` 命令：用 OpenAI 兼容模型从文献首页文本抽取标题、作者、年份、期刊、DOI、摘要、关键词、卷期页、ISSN、itemType（JSON 输出，清洗后返回）；
- `src/services/metadata.ts` 新增 `extractLiteratureMetadataWithLlm`；`MetadataLookupResult` 扩展 keywords/publisher/volume/issue/pages/issn/itemType 可选字段；
- `LiteratureLibraryView` 三个元数据入口在远程检索未命中时对中文文献走 LLM 兜底：导入对话框（复用本地首页提取的 firstPageText）、批量「解析元数据」（标题含中文时现场读取首页文本）、单篇「解析元数据」对话框；LLM 预设复用总结模型预设（`metadataLlmPreset` prop，由 Reader 注入），未配置或文献非中文时不触发；
- `metadataUpdateForPaper` / `buildManualMetadataUpdateRequest` 支持合并 keywords（仅当论文无关键词时）、publisher/volume/issue/pages/issn/itemType；导入草稿合并（`mergeRemoteMetadataIntoDraft`）同步支持这些字段。

## 验证

- `npx tsc --noEmit` 通过；
- `npm run check`（构建 + 测试）通过：251 个测试全部通过；
- 新增 `tests/languageDetect.test.ts`：中文主体判定（含中英混合、误判边界）、语言码归一化；
- `tests/ragStore.test.ts` 新增：中文 chunk 在向量距离劣势下经 trigram FTS 命中并进入 RRF 融合结果；旧 unicode61 库自动迁移到 trigram 后中文检索可用。
