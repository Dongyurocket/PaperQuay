# PaperQuay v{{VERSION}}

## Fixes

- Corrected the Settings "Notes & Vault" description: sync runs only on the manual action or a user-enabled timer; opening the notes workspace no longer syncs silently.
- Removed the remaining Agent mention from the AI model role description; the roles are translation, selection translation, overview, and QA.
- Corrected backup scope text so new backups no longer claim to include Agent memory, Agent runs, or Agent history. RAG database and reader-state descriptions now match what is actually exported.
- Removed the remaining Agent tool-choice wording from the reasoning-effort hint.

## Verification

- Production build passed; 793 tests ran with 792 passing, 1 optional benchmark skipped, 0 failed.
- Computer Use smoke on the installed 0.4.32 build covered: startup and library load; Settings (document parsing, AI models, Vault copy); knowledge-graph custom relation create → edit → delete; notes workspace and editor toolbar (no AI polish); reader Q&A sidebar with current/selected/library scope chips. The test relation was deleted and no test data was left behind.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 修复内容

- 修正设置页「笔记与 Vault」说明：同步只在手动触发或用户开启定时任务时执行；打开笔记工作区不再静默同步。
- 移除「AI 模型」角色说明中残留的 Agent 默认模型文案；角色只保留翻译、选区翻译、论文概览和问答。
- 修正备份范围说明：新备份不再包含 Agent 记忆、运行记录或 Agent 历史；RAG 数据库与阅读器状态的说明按实际导出范围更新。
- 移除推理档位提示中残留的 Agent 工具选择文案。

## 验证

- 生产构建通过；793 项测试中 792 通过、1 项可选基准跳过、0 失败。
- 在已安装的 0.4.32 上使用 Computer Use 验证：启动与文库加载、设置页（文档解析 / AI 模型 / Vault 文案）、知识图谱自定义关系新增→编辑→删除、笔记工作区与编辑器工具栏（无 AI 润色）、阅读器问答侧栏（当前文献 / 选定文献 / 全库三档可见）。测试关系已删除，未保留测试数据。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
