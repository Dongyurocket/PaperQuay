# 笔记系统 P3-5/P3-7/P3-8 低成本项

## 现象

复审路线中的三个低成本项尚未闭环：MCP `search_notes` 仍依赖四字段 `LIKE`，已配置的 vault 只能手动同步，引用样式存放在独立 localStorage 键且笔记列表缺少排序和批量整理能力。

## 方案原文要求

- P3-5：`search_notes` 切换到 `notes_fts`，保留 LIKE 兜底及 `paperId`、`pageKind` 过滤。
- P3-7：笔记工作区启动时同步已配置 vault，并提供默认关闭、15–60 分钟可调的自动同步。
- P3-8：引用样式进入阅读器设置体系；笔记列表增加多条件排序和批量操作。

## 实际修改

- `knowledgeMcpService.cjs` 在存在 `notes_fts` 时使用 FTS5 trigram 查询，关键词按空白分组并以 AND 组合；`deleted_at`、`paperId`、`pageKind` 条件仍在 notes 表查询中组合。FTS 表缺失、查询异常或短于 3 个字符的 token 会回退原四字段 LIKE。稳定排序增加 `id ASC` 作为最终 tie-breaker。新建 notes 数据库使用 trigram FTS，旧数据库不强制迁移。
- `NotesWorkspace` 挂载时只要已配置 vault 目录就静默同步一次；设置打开后才安装 15–60 分钟定时任务。成功刷新现有笔记/文件夹列表，失败静默吞掉；没有加入 OS 文件 watcher，也没有新增依赖。
- `ReaderSettings` 增加引用样式、定时同步开关和间隔字段，默认分别为 `gbt7714`、关闭和 30 分钟，并在归一化时限制间隔为 15–60 分钟。旧引用样式键仅迁移一次到阅读器设置，之后工具栏改为写设置键，不随笔记正文或独立 localStorage 数据同步。
- `NotesList` 支持更新时间、创建时间、标题排序；选择笔记后可批量追加标签或选择已有文件夹/未分类。批量请求只组装 `tags`/`folderId` patch，最终逐条复用既有 `updateNote`，不修改 `content`、`contentJson`、`anchors` 或 `excerpt`。
- 新增纯逻辑模块和测试，覆盖排序比较器、批量 patch、自动同步节流、设置归一化/迁移以及 FTS 过滤、稳定排序和 LIKE 回退。

## 收窄项与理由

- 未加入 OS watcher。P3-7 的启动同步和定时同步已经覆盖跨应用协作的低成本断点；watcher 会引入跨平台生命周期、重复触发和额外依赖，不符合本轮低成本范围。
- 未自动迁移已有旧 tokenizer 的 `notes_fts` 表。查询异常会回退 LIKE，避免破坏旧版只读数据库；后续若需要统一 tokenizer，可单独设计可重建索引迁移。
- 引用样式的旧值保留并写入迁移标记，而不是立即删除，便于异常恢复且保证不会重复迁移。

## 验证

- `npm run build` 通过。
- 定向测试通过：29 tests，29 pass，0 fail。
- `npm run check` 需在本次改动完成后作为最终门禁执行。
- 未启动 Electron 桌面端，未完成真实 vault 同步、编辑中状态保护、设置 UI 点击和列表批量操作的手工回归；不将这些行为标记为已验证。
