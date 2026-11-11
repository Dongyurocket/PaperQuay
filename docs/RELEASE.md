# 发布与本地更新流程

## 发布前检查

- `package.json` 的 `version` 已递增。
- `npm ci`、`npm run build` 和 `npm test` 通过。
- 已在 Windows 本地安装包上完成核心回归：启动、打开已有论文、导入 PDF、打开笔记、设置页和退出。
- 涉及备份或恢复的改动：额外执行一次导出与导入 smoke，包内包含 MinerU 缓存和源机上打开过的 PDF，确认恢复后两者都能打开。
- 没有提交 API key、数据库、PDF、解析结果或构建产物。
- 已更新用户可见变更说明。

## 发布版本

个人 Fork 使用 `app-vX.Y.Z` 标签触发 Release 工作流：

```powershell
git switch main
git pull --ff-only origin main
git tag app-v0.1.26
git push origin app-v0.1.26
```

自 `app-v0.4.24` 起，GitHub Actions 仅构建和上传 Windows x64 安装包、`.blockmap` 及 `stable.yml`，Windows 构建成功后将 Draft 转为正式发布。作者精力有限，macOS、Linux 等其他平台由用户自行从源码打包，作者不承担维护和测试。保留历史发布资产和源码内的其他平台构建配置。

Release 说明来自 `.github/release-notes.md`（`{{VERSION}}` 为版本占位符），发布前应先更新该文件为本次实际变更；若发布后才发现说明有误，可直接在 GitHub 页面编辑 Release 内容。若用户明确安排先发布、由其安装后继续验收，应在发布说明中逐项记录尚未完成的桌面验证，不能将旧版本或诊断包截图当作新安装版通过证据。

## 更新源

个人 Fork 配置完成后，以下两处必须指向同一个个人仓库：

- `package.json` 的 Electron Builder GitHub publisher
- `electron/backend/updateCommands.cjs` 的 Release API 查询目标

`Configure-Fork.ps1` 会同时更新这两处。若同步上游后发现它们恢复为上游仓库，重新执行该脚本即可。

## 回滚

如果新版本有严重问题：

1. 在 GitHub 暂停发布有问题版本的后续更新。
2. 在本地保留问题版本的日志和复现步骤。
3. 修复后递增版本号重新发布，不要复用已经公开的版本号或标签。
4. 如需让用户回到旧版本，提供旧版本 Release 页面和数据备份恢复说明。
