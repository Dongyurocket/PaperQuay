# 发布与本地更新流程

自 0.4.24 起，正式发布只构建、维护和测试 Windows x64。macOS、Linux 等平台由用户自行从源码打包；历史发布资产和源码中的其他平台构建配置保留。

## 发布前检查

- `package.json` 和 `package-lock.json` 的版本号已同步递增，且高于已发布版本和上游版本。
- `CHANGELOG.md` 已新增本版本条目。
- `.github/release-notes.md` 已改为本次实际变更（`{{VERSION}}` 为版本占位符），否则 Release 会沿用上一版说明。
- `npm ci`、`npm run lint`、`npm run typecheck`（六个 tsc 项目）、`npm run build`、`npm test` 通过。Windows 构建报 `Access is denied` 时，按 [DEVELOPMENT.zh-CN.md](./DEVELOPMENT.zh-CN.md#windows-构建报-access-is-denied) 把 `TEMP`/`TMP` 指到仓库内目录。
- 在 Windows 安装包上完成核心回归：启动、打开已有论文、导入 PDF、打开笔记、设置页和退出。验证使用 `--user-data-dir=<空目录>` 或一次性数据副本，不写入真实文库。
- 涉及备份或恢复的改动：额外做一次导出与导入 smoke，包内含 MinerU 缓存和源机上打开过的 PDF，确认恢复后两者都能打开。
- 没有提交 API key、数据库、PDF、解析结果或构建产物。

## 发布版本

提交并推送版本变更后，推送 `app-vX.Y.Z` 标签：

```powershell
git switch main
git pull --ff-only origin main
git tag app-vX.Y.Z
git push origin app-vX.Y.Z
```

`.github/workflows/release.yml` 在推送 `app-v*` 标签时运行（也可手动触发，此时版本取 `package.json`）：

1. 创建或复用同名 Draft Release，标题为 `PaperQuay vX.Y.Z`，正文取自 `.github/release-notes.md`。
2. 在 `windows-latest`、Node.js 24 上运行 `npm ci`、`npm run build` 和 `node electron/build.cjs --win --x64 --publish never`。
3. 上传 `.exe` 安装包、`.blockmap` 和 `stable.yml`，并删除旧的 `latest*.yml`。
4. Windows 构建成功后将 Draft 转为正式发布。

发布后发现说明有误，可直接在 GitHub 页面编辑 Release。若先发布、再由用户安装后验收，应在发布说明中逐项列出未完成的桌面验证；旧版本或诊断包截图不能作为新安装版通过的证据。

## 更新源

以下两处必须指向同一个 Fork 仓库：

- `package.json` 中 `build.publish` 的 GitHub publisher
- `electron/backend/updateCommands.cjs` 中的 `UPDATE_REPOSITORY`

`scripts/Configure-Fork.ps1` 会同时更新这两处。同步上游后若它们被改回上游仓库，重新运行该脚本。

## 回滚

1. 在 GitHub 上撤下有问题的 Release（例如改回 Draft），避免更多用户更新到该版本。
2. 保留问题版本的日志和复现步骤。
3. 修复后递增版本号重新发布，不要复用已公开的版本号或标签。
4. 需要让用户回到旧版本时，提供旧版本 Release 页面和数据备份恢复说明。
