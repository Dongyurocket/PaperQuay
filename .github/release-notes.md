# PaperQuay v{{VERSION}}

## What's New

- Retired PaddleOCR-VL. MinerU is now the only parsing provider, with its OCR retry as the single fallback path. Existing MinerU caches stay readable and old backups are normalized on restore.
- Removed the standalone Agent workspace, its runtime/memory/IPC, and the note AI polish UI. Reader Q&A, summaries, translation, selection translation, block re-parsing and excerpt distillation remain. A one-time idempotent cleanup removes old local Agent records; new backups no longer include Agent history.
- MCP writes now use per-record updates with version checks. While the desktop app is running, `update_paper`, category/attachment/note writes and deletions require `expectedUpdatedAt` or a preview version; stale writes return `PAPER_CONFLICT`, `CATEGORY_CONFLICT` or `NOTE_CONFLICT` instead of silently overwriting. New `preview_delete_papers` and `deleteFilePaperIds` limit deletion to managed, unshared files.
- The desktop app refreshes the library and note lists after external writes. Dirty paper forms and note editors show an "external update" banner and let the user reload or continue.
- Reader Q&A supports current-paper, selected-papers and whole-library scopes. Citations carry the paper identity and text/image/table evidence kind; table indexes include captions and table bodies; evidence is packed against the QA model context window with skipped papers/evidence reported.
- MCP note writes require versions, and content updates must preserve every `paperquay://anchor/<id>` link. Folder cascade deletes validate every affected folder version. Vault sync only runs manually or on a user-enabled timer.
- Knowledge-graph manual relations can now be edited (label, description, weight); the Add Relation form is fixed. The `ai_suggested` type is retired, and existing AI relations are backed up and removed once.
- New `read_paper_figure` (MinerU image/table block, 8 MB image cap) and `preview_delete_papers`. The MCP server now exposes 28 tools (14 read-only, 14 write). Skills, integration guide and user manual are updated.

## Verification

- Production build passed; the full test suite ran 793 tests with 792 passing, 1 optional benchmark skipped, 0 failed.
- Isolated MCP smoke: `initialize` and `tools/list` returned 28 tools; `read_paper_figure` returned text + image content blocks; `preview_delete_papers` returned a preview version.
- Isolated `--user-data-dir` Windows packaged startup smoke passed (stable for 15 seconds, databases and cleanup marker created). The installed build was not exercised with per-screen UI clicks before publication.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 本次更新

- 退役 PaddleOCR-VL，MinerU 成为唯一解析引擎，OCR 重试是唯一降级入口；旧缓存与旧备份继续兼容。
- 移除独立 Agent 工作区、运行/记忆/IPC 和笔记 AI 润色，保留阅读器问答、摘要、翻译、选区翻译、块重解析与选区摘录；首次升级清理旧 Agent 本地记录，新备份不再包含 Agent 历史。
- MCP 写入改为目标记录写 + 版本检查；应用运行时写入必须携带 `expectedUpdatedAt` 或预览版本，冲突返回 `PAPER_CONFLICT` / `CATEGORY_CONFLICT` / `NOTE_CONFLICT`，不再静默覆盖。新增 `preview_delete_papers` 与 `deleteFilePaperIds`，只删除受管且未共用的文件。
- 外部写入后桌面应用刷新文库与笔记列表，脏表单/笔记显示「外部更新」提示，由用户选择重载或继续。
- 阅读器问答支持当前文献 / 选定文献 / 全库范围；引用携带文献身份与文字/图片/表格类型；表格索引包含图注与正文；按 QA 模型上下文窗口装箱并报告跳过的文献与证据。
- 笔记 MCP 写入要求版本，含锚点的正文更新必须保留 `paperquay://anchor/<id>`；文件夹级联删除校验所有受影响版本；Vault 同步只在手动或用户开启定时任务时执行。
- 知识图谱支持编辑人工关系；修复「添加关系」按钮不可用的问题；移除 `ai_suggested` 类型并一次性备份清理存量关系。
- 新增 `read_paper_figure`（MinerU 图表块，图片 8 MB 上限）与 `preview_delete_papers`；MCP 共 28 个工具（14 只读、14 写入），Skills、集成指南和用户手册已同步。

## 验证

- 生产构建通过；全量测试 793 项，792 通过，1 项可选基准跳过，0 失败。
- 隔离 MCP 冒烟：初始化与工具列表返回 28 个工具；图表读取返回文本 + 图片内容块；删除预览返回预览版本。
- 隔离 `--user-data-dir` 的 Windows 打包启动冒烟通过（15 秒稳定运行，数据库与清理标记正常创建）；发布前未对安装版执行逐页界面点击验收。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
