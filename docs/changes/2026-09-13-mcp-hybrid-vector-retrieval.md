# 2026-09-13 - MCP 知识库检索支持向量混合检索

## 现象

PaperQuay 桌面端的本地 RAG 检索是「向量 KNN + FTS5 BM25 + RRF 融合」的混合检索，但 MCP stdio 知识库服务（`bin/paperquay-mcp.cjs`）的 `search_knowledge_base` 只走 FTS5 关键词通道，对语义相近但措辞不同的查询召回能力弱于应用内检索。

## 根因

MCP 服务是独立只读进程，此前不读取 embedding 配置、不加载 sqlite-vec 扩展，也没有向量检索代码路径。

## 修改

- `electron/mcp/knowledgeMcpService.cjs`：
  - 新增 `resolveEmbeddingConfig()`，直接读取渲染层持久化的 `<数据目录>/.settings/paperquay.config.json`（`settings.embeddingBaseUrl` / `embeddingModel` / `embeddingDimensions` + `secrets.embeddingApiKey`），与桌面端共用同一份配置；
  - 复用 `electron/backend/utils.cjs` 的 `embedTexts` 将查询向量化，复用 `ragStore.cjs` 已导出的 `rrfFuse` 做融合排序；
  - 新增跨库向量检索：只读连接加载 sqlite-vec 扩展，按 `rag_indexes` 中 ready 的（document_key, source_type）逐源做 vec0 KNN（partition key 约束决定必须扇出），全局按距离归并；维度优先匹配当前配置的 embedding model key，不一致或异常时降级；
  - `searchKnowledgeBase` 改为 async，新增 `mode` 参数（`auto` 默认 / `hybrid` / `keyword`），响应新增 `retrievalMode`、`embeddingModel`、`warning` 与每条结果的 `channels`；任何向量链路失败都降级为关键词检索不报错；
  - 构造函数支持注入 `embedFn` 便于测试；环境变量 `PAPERQUAY_MCP_EMBEDDING=off` 可全局禁用向量通道。
- `bin/paperquay-mcp.cjs`：`search_knowledge_base` schema 增加 `mode` 参数并更新描述，`SERVER_VERSION` 升至 0.1.40。
- `tests/knowledgeMcp.test.ts`：新增混合检索融合排序、channels 标记、embedding 失败/维度不匹配降级、hybrid 无配置 warning 等用例；临时目录清理改为重试后容忍 EPERM（Windows 杀毒软件短暂持有句柄）。
- `docs/MCP_AGENT_INTEGRATION.md`：更新特性与工具表，新增「向量混合检索说明」章节（模式、配置来源、隐私边界）。

## 验证

- `npm run build` 通过；`npm test` 全部 288 个用例通过（含 4 个新增/更新的 knowledgeMcp 用例）。
- 用本机真实数据目录（SiliconFlow Qwen3-VL-Embedding-8B，4096 维）端到端验证：`mode=auto` 返回 `retrievalMode: 'hybrid'`，向量与 FTS 双通道结果正确融合排序；`PAPERQUAY_MCP_EMBEDDING=off` 时返回 `keyword` 且结果与旧行为一致。
