# PaperQuay v{{VERSION}}

## What's New

- **PDF Outline Sidebar & Chapter Navigation**: Added native document outline sidebar to the PDF reader with tree collapse/expand, keyword filtering, and auto-highlighting of the current reading chapter. When a PDF lacks embedded outlines, an outline hierarchy is derived on the fly from lightweight MinerU headings.
- **RAG Chunk Context & Evidence Drawer**: Enhanced RAG citation cards with a "View Chunk Context" action, allowing readers to preview adjacent neighboring chunks, source sections, and full context in a slide-out drawer without losing reading focus.
- **Select All Filtered Papers in Library**: Supported one-click selection of all papers matching active filters across pages, with a stable frozen snapshot for batch tagging, category management, or export.

## Performance & Architecture Improvements

- **Progressive Streaming for Long Documents**: MinerU parsing worker now splits documents into metadata, chapter index, and 25-page content segments. Outlines become clickable as soon as the index arrives, and first-batch body pages render immediately without blocking on full-text processing.
- **Byte-Budget LRU Memory Management**: Introduced `ByteBudgetLruCache` to manage PDF.js document instances, MinerU structural blocks, and image crops by estimated byte sizes. Safely destroys idle objects while protecting in-use references from eviction.
- **SQL-Level Library Pagination & Incremental Persistence**: Replaced full in-memory sorting with database-level multi-condition filtering and pagination, significantly reducing initial loading latency for large libraries (10,000+ items). Single-item updates persist directly without rewriting other records.
- **Isolated RAG Worker**: Offloaded heavy RAG chunking and vector retrieval to an independent background worker thread, ensuring high UI responsiveness and native abort cancellation.

## Fixes

- **Surrogate Character Sanitization in Embeddings**: Stripped unpaired UTF-16 surrogate characters in text chunks, resolving `400 Invalid UTF-8` failures with OpenAI and compatible embedding endpoints.
- **Library RAG Status Badge Alignment**: Decoupled RAG status indicators from transient MinerU parser states, accurately displaying knowledge base readiness.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

## 新增功能

- **PDF 目录侧栏与章节快速导航**：PDF 阅读器新增原生目录侧栏，支持树状折叠、关键词筛选及当前阅读页章节自动高亮；文档缺少原生 PDF 目录时，自动基于轻量 MinerU 章节索引即时生成层级目录树。
- **RAG 原生切片上下文与证据抽屉**：RAG 检索证据卡片新增「查看切片上下文」，在抽屉中直观浏览同文档同来源的前后邻居切片、原文章节路径与完整正文；底层 RAG 存储与服务直接支持按切片 ID 扩展前后上下文窗口。
- **文库跨页全选当前筛选结果**：文献列表支持一键全选当前筛选条件下的全部文献（即使跨越多页），冻结操作快照并支持批量移动分类、批量打标签或导出。

## 性能与架构优化

- **超长解析文档分段与渐进可用**：Worker 中 MinerU JSON 解析重构为「元数据、章节索引、正文分段」分离；章节索引到达后目录立即可用，首批分段（前 25 页）到达即刻渲染正文，极大缩短超长大文件阅读等待时间。
- **全局内存预算按字节计量与对象生命周期管理**：新增 `ByteBudgetLruCache`，对 PDF.js 文档对象、MinerU 解析结构块、切片图像与缩略图按预估字节统一管控；支持引用借用保护，超额淘汰时安全销毁闲置对象并释放底册内存。
- **文库 SQL 级分页与增量更新**：文库查询从全量内存过滤迁移为底层 SQL 级多条件筛选、排序与分页，大幅降低万级文献下的内存占用与首屏加载延迟；单篇文献元数据保存改为单行精准更新，消除大事务重写风险。
- **RAG 独立 Worker 执行隔离**：RAG 切片提取、向量检索与耗时计算移入后台独立 Worker 执行，保障 Electron 主进程及 UI 交互流畅响应，并原生接入取消信号支持。

## 修复

- **嵌入向量孤立代理字符（Surrogates）被拒**：清理文本分块中的孤立代理字符（UTF-16 Unpaired Surrogates），防止 OpenAI / 兼容端点报错 `400 Invalid UTF-8` 导致索引中断。
- **文库 RAG 状态角标误报**：解绑文献列表中 RAG 状态徽标与 MinerU 检测状态的错误联动，真实反映知识库切片就绪情况。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
