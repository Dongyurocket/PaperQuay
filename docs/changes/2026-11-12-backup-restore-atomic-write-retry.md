# 备份恢复清单的 Windows 原子写入恢复

日期：2026-11-12（Asia/Shanghai）

完整测试在 Windows 上重复出现一项备份导入用例的临时 `EPERM` rename 失败；隔离运行同一恢复测试文件时通过。`electron/backend/backupImport.cjs` 的原子 JSON 写入现改用唯一临时文件名，并对 Windows `EPERM`、`EACCES`、`EBUSY` 执行最多六次（初次加五次重试、渐增间隔）的原子 rename。终止失败会删除本次唯一临时文件并保留原目标文件。

验证：`node --check electron/backend/backupImport.cjs` 通过；`node --test tests/backupRestorePaths.test.ts` 为 8 项通过；修复后完整 `npm test` 为 982 项通过、0 失败。Node 测试运行器仍打印部分隔离笔记目录清理的 `EPERM` 提示，但这些没有造成测试失败。
