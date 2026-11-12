# PaperQuay v{{VERSION}}

This is an incremental release for the literature workspace, evidence storage, and long-document foundations. The three linked implementation plans remain in progress; this release does not claim that every planned package or desktop acceptance gate is complete.

## What's included

- Literature workspace improvements: structured metadata filters, stable cross-page selection and hydration, persisted processing status, metadata candidates that must be reviewed before applying, resilient summary refresh, and a tabbed details panel.
- Reader assistant new-session button now uses the accent theme tokens in light and dark themes.
- A shared file-location service and entry points for library, reader, and graph views, including version-aware locations for registered parse generations and evidence.
- Knowledge graph safety and persistence foundations: fail-closed local queries, embedding representation/model isolation, a shared SQLite knowledge store, source versions, immutable evidence spans, and review-event storage.
- Long-document foundations: durable parse generations and partition staging, artifact manifests, publication recovery, resumable remote job IDs, persisted section structure, and reader outline navigation.
- Backup and cache recovery fixes for atomic writes and Windows file-lock retries.

## Verification

- `npm run check` passed on the implementation worktree: production build and 1,014 automated tests passed.
- The Windows x64 installer is built by the Release workflow for this version.
- Installed-app acceptance is still pending. The local installer attempt was blocked because PaperQuay MCP server processes kept the installed executable in use. Light/dark computed-style screenshots, Explorer reveal behavior, scale checks, and installed-version interaction regressions have not been recorded as passed.
- Real Paddle/model-service validation and representative long-document resource measurements remain pending. The current engineering-manual sample also exposed table-structure quality gaps in the PDF.js baseline.

## Scope still in progress

The workspace P0-T/P0-F desktop gates and P1–P7 acceptance remain in progress; KG P1 review/extraction integration and KG P2 discovery are incomplete; long-document L0/L1a/L1b/L2/L3 still have implementation or real-service acceptance gaps. See the linked plans and `docs/implementation/joint-execution-ledger.md` for current package-level status.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

---

## 本次内容

本版是文献工作区、证据存储和长文档处理基础的阶段迭代。关联的三份实施计划仍在推进中，本版不宣称所有工作包或桌面验收闸门均已完成。

- 文献工作区：结构化元数据筛选、跨页选择与按 ID 补取、持久化处理状态、比较后应用元数据候选、概览恢复与强制刷新、详情页签。
- 阅读器助手栏的新建会话按钮改用主题强调色令牌，适配浅色和深色主题。
- 文献库、阅读器和图谱入口共用文件位置服务；登记的解析 generation 与证据位置按来源版本校验。
- 图谱持久化与安全基础：局部查询 fail-closed、Embedding 表示/模型隔离、共享 SQLite 知识库、来源版本、不可变证据片段和审核事件。
- 长文档基础：持久解析 generation/分卷 staging、产物 manifest、发布恢复、远端任务 ID 续接、持久章节结构和阅读器目录导航。
- 备份原子写及 Windows 文件锁重试修复。

## 验证与未完成项

- 当前实现工作树的 `npm run check` 通过：生产构建成功，自动化测试 1,014 项通过。
- 本版本 Windows x64 安装包由 Release 工作流构建。
- 安装版验收仍待完成。本机安装时，PaperQuay MCP 服务进程持续占用已安装的可执行文件；因此双主题计算样式截图、资源管理器定位、缩放和安装版交互回归均未记为通过。
- 真实 Paddle/模型服务验证和代表性长文档资源测量待进行。当前工程手册样本显示 PDF.js 基线的复杂表格结构仍有缺口。
- 工作区 P0-T/P0-F 桌面闸门及 P1—P7 验收仍在推进；KG P1 抽取/审核接线与 KG P2 尚未完成；长文档 L0/L1a/L1b/L2/L3 仍有实现或真实服务验收缺口。逐工作包状态见三份计划和 `docs/implementation/joint-execution-ledger.md`。

## Windows 发布范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内自动更新。
