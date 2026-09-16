# PaperQuay v{{VERSION}}

PaperQuay is an open-source AI paper workspace for literature management, PDF reading, paper overview generation, full-text translation, inline notes, Zotero import, Agent workflows, and local RAG.

## Downloads

Download the native installer for your operating system from the Assets section below.

| Platform | Recommended asset |
| --- | --- |
| Windows | `.exe` installer or `.msi` package |
| macOS | `.dmg` package for Apple Silicon or Intel |
| Linux | Electron desktop package such as `.AppImage`, `.deb`, or `.tar.gz` |

## Highlights

- **Native Global KNN Vector and FTS5 Hybrid Retrieval**: The underlying `ragStore` removes per-document constraints and enables single-query global KNN vector distance searches alongside FTS5 BM25 keyword searches across the entire library with RRF fusion. The Agent `rag_search` tool is upgraded to direct global hybrid retrieval, answering broad library questions in milliseconds without arbitrary paper count truncation.
- **Decoupled Asynchronous Indexing from Query Path**: Real-time RAG and conversational query flows now schedule unready documents for background indexing without blocking the main retrieval thread, preventing JIT synchronous embedding bottlenecks and preserving snappy interaction.
- **Fix Responses Protocol Tool-Calling in Agent Loop**: Resolved an issue where streaming SSE parsing in `mergeResponsesChunks` failed to aggregate `function_call` event streams, causing model tool calls to be silently swallowed in Responses mode. Aligned polymorphic items with `type: "message"` according to OpenAI specification, preventing HTTP 400 validation rejections.
- **Auto-Fallback from Responses to Chat Completions**: Added protocol auto-fallback so that model endpoints without `/v1/responses` support (such as Ollama, vLLM, DeepSeek, or third-party proxies) automatically fall back to `/v1/chat/completions` instead of falsely classifying the failure as a lack of tool support.
- **End-to-End AbortSignal Pipeline & Cancel Fallback**: Injected cancellation signals across the ReAct agent loop, tool execution, and batch embedding iterations. The UI cancel button immediately aborts in-flight network requests and local tasks, backed by a 500ms safety unlock timer to eliminate stuck run states.

## Notes

- AI features require your own compatible model endpoint and API key in Settings.
- Release assets are generated automatically by GitHub Actions.

---

# PaperQuay v{{VERSION}} 中文说明

PaperQuay 是一个开源 AI 论文工作台，覆盖文献管理、PDF 阅读、论文概览生成、全文翻译、内联笔记、Zotero 导入、Agent 工作流和本地 RAG。

## 下载说明

请在下方 Assets 区域选择与你的操作系统对应的安装包。

| 平台 | 推荐安装包 |
| --- | --- |
| Windows | `.exe` 安装包或 `.msi` 安装包 |
| macOS | Apple Silicon 或 Intel 对应的 `.dmg` 安装包 |
| Linux | `.AppImage`、`.deb` 或 `.tar.gz` 桌面安装包 |

## 本次更新

- **全库单次原生 KNN 向量与 FTS5 混合检索**：底层存储移除单篇文献硬编码限制，单次 SQL 跨全库执行 KNN 向量相似度计算与 FTS5 BM25 全文检索并由 RRF 融合排序；智能体 `rag_search` 工具全面升级为全局混合检索，未指定 `paperIds` 时自动针对全库文献毫秒级召回证据切片，彻底废除人工切片防爆限制。
- **检索与建库解耦异步化**：在智能体问答与检索链路中，未就绪文献调度后台异步索引，当前轮次立即可用已就绪切片或 FTS 关键词秒级返回，彻底杜绝 JIT 同步切块与 embedding 造成的交互假死。
- **修复智能体 Responses 协议流式工具调用解析**：修复 `mergeResponsesChunks` 未拼装 `function_call` 事件流导致 Responses 模式下工具调用被吞的缺陷；补齐 `messagesToResponseInput` 中的 `type: 'message'` 规范契约字段，解决官方标准端点 400 校验错误。
- **Responses 协议智能自愈降级**：对不支持 `/v1/responses` 的上游端点（返回 404/405/400 等），自动优雅降级为 `/v1/chat/completions` 协议重试，避免将端点协议错误误判为“模型不支持工具”而盲目剥离 tools。
- **全链路中断信号（AbortSignal）打通与取消兜底**：在 Agent 工具执行上下文与底层 RAG、批量 Embedding 循环中全面接入 `signal` 中断检查，用户点击取消时立即停止计算与网络请求；前端增加 500ms 防御性超时恢复，彻底杜绝取消按钮无法生效与 UI 锁死问题。

## 使用提示

- AI 功能需要在「设置」中配置兼容的模型服务地址和 API 密钥。
- Release 安装包由 GitHub Actions 自动构建与发布。
