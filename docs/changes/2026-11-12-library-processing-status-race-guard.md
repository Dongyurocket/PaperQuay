# 文献处理状态迟到结果保护

- 日期：2026-11-12
- 工作包：工作区 P4
- 依赖：全库持久状态投影与来源版本签名。

## 实现

每篇文献的原生更新事件推进 UI 状态修订号。后台文件存在性检查在读取持久状态后、检查附件路径后以及提交成功/失败状态前核对该修订号。旧轮次不再覆盖新文献版本的状态，也不撤销新轮次建立的去重标记；批次取消只清理仍属于本轮的条目。数据库仍以 paper ID 和来源签名作为最终写入边界。

## 验证

- `node --test tests/libraryQuery.test.ts tests/literatureLibraryUtils.test.ts tests/libraryCommands.test.mjs`：27/27 通过。
- `npx tsc --noEmit`：通过。
- `npm run check`：生产构建与完整测试通过，993/993。
- 删除竞态回归：来源快照取得后删除文献，迟到状态写入返回 `{ accepted: 0, stale: 1 }`，不会复建状态孤儿行。
- 完整测试的笔记 fixture 清理器仍报告隔离 TEMP `EPERM` 并跳过清理；断言全部通过。构建保留既有大 chunk／动态导入提示。

## 待验收

目前缺少 LiteratureLibraryView 的 React 运行时竞态测试环境和可运行的 Windows Electron 当前源码实例。迟到请求守卫已做类型、数据库竞态和全量回归验证，仍需桌面确认来源更新与连续状态任务交错时的徽标行为。P4 不因此标为完成。
