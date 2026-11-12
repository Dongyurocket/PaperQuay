# 文献处理状态投影重建

- 日期：2026-11-12
- 工作包：工作区 P4
- 范围：SQLite `paper_processing_status` 启动重建、版本失效和跨重启恢复。

## 实现

`createLibraryDatabaseStore` 打开数据库后，在提供查询前对全库文献执行事务内 reconcile。缺失状态行补为 `unknown`；来源签名与文献标题及全部登记附件身份比对，发现不一致时将旧状态置为 `unknown` 并清空检查时间；仍匹配来源版本的状态（包括 `error`）予以保留。公开的 `reconcileMineruStatusProjection()` 可安全重复运行，便于恢复和验收。删除仍由 SQLite 外键级联处理。

该投影按文献 ID 全库枚举，不依赖当前已加载分页；不扫描磁盘、不调用解析服务，也不迁移文库 JSON。

## 验证

- `node --test tests/libraryQuery.test.ts`：7/7 通过。
- `npm run check`：TypeScript、Vite 生产构建及完整测试通过，993/993。
- 测试覆盖 1,000 余篇文献中超过首屏的条目、投影行丢失后的重启重建、来源版本变更、reconcile 幂等、有效失败状态跨重启保留及文献删除级联。
- 测试期间隔离 TEMP 的笔记 fixture 清理输出 `EPERM` 并跳过若干目录；所有断言通过，命令退出码为 0。
- Vite 仍报告既有大 chunk 与 ineffective dynamic import 提示。

## 边界

本增量关闭了投影缺行、重启恢复和失败状态持久化缺口。运行中解析任务的全面对账、React 事件竞态和 Windows 桌面状态筛选仍待验收，因此 P4 尚未整体完成。
