# MinerU 缓存原子替换的 Windows 锁冲突恢复

- 日期：2026-11-12（Asia/Shanghai）
- 关联：工作区 W-P3 阶段全量验收；联合实施台账

## 问题与修改

Windows 全套测试中，MinerU 缓存修复会在用临时文件原子替换目标文件时遇到短暂 `EPERM`，导致 `rename` 失败。原子写函数现在只在 Windows 遇到 `EPERM`、`EACCES` 或 `EBUSY` 时执行最多 5 次递增短延迟重试；非 Windows 平台及其他错误保持立即失败。最终失败仍移除本次临时文件并向调用者返回错误。

## 验证

- `node --test tests/mineruCacheRepair.test.ts tests/libraryQuery.test.ts`：11/11 通过，包含首次 rename 抛出模拟 `EPERM` 后重试成功。
- `npx tsc --noEmit`、`git diff --check`：通过。
- 仓库隔离 TEMP 下 `npm run build`：通过，2616 modules transformed。
- `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"`：990/990 通过，退出码 0。笔记 fixture 清理期间有 `EPERM` 跳过提示，不影响断言和进程结果。

该测试通过注入 Windows 锁错误验证恢复分支；运行环境仍是本机 Windows，但测试不能证明所有真实杀毒软件、索引器或同步工具锁场景均会在重试窗口内释放句柄。
