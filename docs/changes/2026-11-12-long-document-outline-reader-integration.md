# 长文档章节目录接入阅读器（2026-11-12）

## 实现

- 阅读器请求共享 knowledge store 中已发布的章节结构，并将非 document 单元转换为 MinerU 目录项；层级依据父子关系计算，物理页映射到 PDF.js 的零基页索引。目录项使用独立 synthetic block ID，因此现有导航在无对应正文块时按页跳转。
- 仅 native-library 文献且当前显示本地原文 PDF 时请求结构。renderer 按文献/PDF 请求序号丢弃迟到响应，并在来源切换时立即清空旧结构。
- IPC 可选接收当前 PDF 路径；带路径调用会要求其精确匹配该文献已登记、存在的原文 PDF 附件，且附件 content hash、知识库 sourceVersion 和主进程对磁盘文件流式计算的 SHA-256 相同。翻译版、其他 PDF、丢失附件、内容变化及旧 sourceVersion 均不返回持久目录。无路径调用保留既有只读查询行为，供不需要绑定本地 viewer 的调用端使用。
- 原生 PDF 目录优先级保持在 PDF viewer 现有实现内；MinerU 的临时目录仍可作为持久章节结构为空时的回退。

## 验证

- `node --test tests/documentStructureCommands.test.mjs tests/mineruSegments.test.ts tests/documentOutline.test.mjs tests/paddleOcrLifecycle.test.ts`：18/18 通过。
- `$env:TEMP=...; $env:TMP=$env:TEMP; npm run build`：通过，2618 modules transformed。构建显示既有大 chunk、无效动态导入及 Browserslist 数据提示。
- `$env:TEMP=...; $env:TMP=$env:TEMP; npm run check`：生产构建通过；全套测试 1014/1014、0 失败。隔离 MCP notes fixture cleanup 输出 Windows `EPERM` 并跳过删除，不影响测试退出码。
- `node --check electron/backend/knowledgeGraphCommands.cjs` 与 `git diff --check`：通过。

## 未覆盖

- 未运行当前源码 Electron 桌面、真实 PDF 点击导航或 Windows Explorer；Electron runtime 的已知启动异常仍阻止此前的桌面验收。
- 本次只接入目录展示/跳页，不提供人工目录修订、章节定位面板、EvidenceSpan 页映射、章节级索引与覆盖；这些仍属于 L1b/L2 和 P0-F 后续工作。
- 未调用真实 Paddle 服务，也未测量代表性长文档质量、峰值内存、磁盘和耗时。L0 表格质量闸门仍未通过。
