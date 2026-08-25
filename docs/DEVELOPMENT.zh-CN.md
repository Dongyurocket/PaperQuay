# PaperQuay 二次开发说明

本仓库用于基于上游 PaperQuay 的个人二次开发。目标是：

- 保持与上游 `WangQrkkk/PaperQuay` 的同步能力。
- 将个人修复和功能放在独立分支，便于本地验证和向上游提 Pull Request。
- 使用个人 GitHub Fork 的 Release 作为本地安装版的更新源。
- 将每个 Bug 的复现、根因、修复和验证过程留在仓库中，避免只依赖聊天记录。

## 当前状态

- 上游仓库：`https://github.com/WangQrkkk/PaperQuay.git`
- 本地源码目录：当前工作区根目录
- 本地已安装版本目录：`C:\Users\yusen\AppData\Local\Programs\PaperQuay`
- 应用类型：Electron + React + TypeScript + Vite
- Node.js 要求：18 或更高；当前项目 CI 使用 Node.js 24
- 许可证：AGPL-3.0-only

## 第一次配置

1. 在 GitHub 登录你的账号。
2. 打开上游仓库并点击 Fork，仓库名建议保留为 `PaperQuay`。
3. 在 PowerShell 中进入本仓库，然后运行：

```powershell
.\scripts\Configure-Fork.ps1 -ForkOwner "你的GitHub用户名"
```

该脚本会：

- 将原来的 `origin` 改名为 `upstream`。
- 添加你的 Fork 为 `origin`。
- 把应用内更新检查和 Electron Builder 发布目标切换到你的 Fork。
- 输出需要提交的配置变更。

Fork 完成后检查远程：

```powershell
git remote -v
```

预期结果是 `upstream` 指向 `WangQrkkk/PaperQuay`，`origin` 指向你的 GitHub 用户名下的 `PaperQuay`。

## 日常工作流

### 1. 同步上游

确保没有未提交修改后运行：

```powershell
.\scripts\Sync-Upstream.ps1
```

脚本默认同步 `main`，并把同步后的主分支推送到你的 Fork。若本地有未提交修改，脚本会停止，不会覆盖工作。

### 2. 创建修复分支

```powershell
git switch main
git pull --ff-only origin main
git switch -c fix/简短问题名
```

建议命名：

- `fix/xxx`：Bug 修复
- `feat/xxx`：新功能
- `docs/xxx`：文档
- `refactor/xxx`：不改变行为的重构
- `chore/xxx`：构建、依赖和开发工具

### 3. 本地开发

```powershell
npm ci
npm run dev
```

只做类型检查和前端构建：

```powershell
npm run build
```

运行测试：

```powershell
npm test
```

完整检查：

```powershell
.\scripts\Run-Checks.ps1
```

### 4. 构建并安装 Windows 版本

构建安装包：

```powershell
.\scripts\Build-Local.ps1
```

构建完成后，安装包在 `release/`。需要启动安装程序时：

```powershell
.\scripts\Build-Local.ps1 -Install
```

安装前请先关闭正在运行的 PaperQuay。个人构建与正式版使用同一个应用标识和用户数据目录，首次切换前建议先使用应用内备份功能备份文献库、笔记和 RAG 数据库。

### 5. 提交与提 PR

```powershell
git add .
git commit -m "fix: 简短描述问题"
git push -u origin fix/简短问题名
```

个人 Fork 内部的修改通过 GitHub Actions 验证后，再决定：

- 向上游 `WangQrkkk/PaperQuay:main` 提 Pull Request；或
- 先在个人 Fork 中继续迭代，等修复稳定后再提 PR。

上游 PR 应聚焦单一问题，并附带复现步骤、根因、验证方式和必要截图。

## 本地更新机制

PaperQuay 的 Windows 自动更新依赖 GitHub Release。个人构建必须使用个人 Fork 的 Release，否则会继续检查上游 Release。

推荐流程：

1. 在个人 Fork 的 `main` 上准备一个可发布版本。
2. 修改 `package.json` 的 `version`，例如从 `0.1.25` 改为 `0.1.26`。
3. 更新 `.github/release-notes.md` 为本次实际变更说明（`{{VERSION}}` 为版本占位符），否则 Release 会沿用上一次的内容。
4. 提交并推送版本变更。
5. 创建并推送 `app-v0.1.26` 标签：

```powershell
git tag app-v0.1.26
git push origin app-v0.1.26
```

6. GitHub Actions 会构建 Windows、Linux 和 macOS 安装包，先创建 Draft Release，构建全部成功后自动转为正式发布；发现说明或产物有误时，可直接在 GitHub 页面编辑 Release 或按 `docs/RELEASE.md` 回滚。
7. 已安装的个人版本下次检查更新时会从个人 Fork 获取新版本。

版本号必须递增。不要使用与上游相同或更低的版本号，否则更新器会认为没有新版本。

注意：若 Fork 仓库从未运行过 GitHub Actions，GitHub 会默认禁用工作流（Actions 页面显示 “Workflows aren't being run on this forked repository”）。需要先在仓库 Actions 页面手动启用，标签推送才能触发 Release 工作流。

## 文档约定

- Bug 记录：`.github/ISSUE_TEMPLATE/bug_report.md`
- 开发与同步：本文档
- 发布流程：`docs/RELEASE.md`
- 上游同步检查：`docs/UPSTREAM.md`
- 变更记录：`docs/changes/`

每个修复建议至少记录：现象、复现步骤、预期行为、实际行为、影响范围、根因、修复方案和验证结果。

## 数据与安全边界

不要提交以下内容：

- API key、Token、密码或证书
- PDF、解析结果和个人笔记
- SQLite 数据库、备份包和运行时目录
- `release/`、`dist/` 等构建产物

本仓库继承上游 AGPL-3.0-only 许可证。修改后再分发或通过网络提供修改版时，应遵守 AGPL 和上游 `TRADEMARKS.md` 中的品牌说明。
