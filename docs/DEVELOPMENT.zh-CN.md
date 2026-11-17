# PaperQuay 二次开发说明

本仓库是上游 `WangQrkkk/PaperQuay` 的个人 Fork，用于个人修复与功能开发。原则：

- 保持能与上游同步，修复放独立分支，便于向上游提 PR。
- 本地安装版的自动更新源是个人 Fork 的 Release。
- 每个 Bug 的复现、根因、修复和验证记录在仓库中，不只留在聊天记录里。

## 基本信息

- 上游：`https://github.com/WangQrkkk/PaperQuay.git`；个人 Fork：`Dongyurocket/PaperQuay`（`package.json` 的 `build.publish` 与 `electron/backend/updateCommands.cjs` 的 `UPDATE_REPOSITORY`）
- 技术栈：Electron + React + TypeScript + Vite
- Node.js：22.18 或更高；CI 使用 Node.js 24
- 平台范围：自 0.4.24 起只维护和测试 Windows x64
- 本机安装目录：`C:\Users\yusen\AppData\Local\Programs\PaperQuay`
- 许可证：AGPL-3.0-only

## 首次配置 Fork

在 GitHub 上 Fork 上游仓库后，在 PowerShell 中运行：

```powershell
.\scripts\Configure-Fork.ps1 -ForkOwner "你的GitHub用户名"
git remote -v
```

脚本会把原 `origin` 改名为 `upstream`，添加你的 Fork 为 `origin`，并把应用内更新检查和 Electron Builder 发布目标改到你的 Fork。完成后 `upstream` 应指向 `WangQrkkk/PaperQuay`，`origin` 指向你的 Fork。远程分工和同步细节见 [UPSTREAM.md](./UPSTREAM.md)。

## 日常工作流

### 同步上游与建分支

```powershell
.\scripts\Sync-Upstream.ps1          # 工作区必须干净；默认同步 main 并推送到 origin
git switch -c fix/简短问题名
```

分支前缀：`fix/`（Bug）、`feat/`（功能）、`docs/`（文档）、`refactor/`（不改行为的重构）、`chore/`（构建、依赖、工具）。

### 开发与检查

```powershell
npm ci
npm run dev                # 桌面开发模式
npx tsc --noEmit           # 类型检查
npm run build              # tsc + vite build
npm test                   # node --test "tests/*.test.ts" "tests/*.test.mjs"
.\scripts\Run-Checks.ps1   # 依次运行 npm run build 和 npm test
```

需要串行跑测试时：

```powershell
node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"
```

改动 `electron/backend/backupImport.cjs` 后至少运行 `npm test`，恢复路径回归测试在 `tests/backupRestorePaths.test.ts`。

### Windows 构建报 `Access is denied`

本机默认 `TEMP` 下，`npm run build` 可能因 esbuild 临时目录报 `Access is denied`。这是环境问题，不要为它改产品代码。把 `TEMP`/`TMP` 指到仓库内目录再构建（`.tmp-*/` 已在 `.gitignore` 中）：

```powershell
New-Item -ItemType Directory -Force .tmp-build | Out-Null
$env:TEMP = "$PWD\.tmp-build"; $env:TMP = $env:TEMP
npm run build
```

### 构建并安装 Windows 版本

```powershell
.\scripts\Build-Local.ps1            # 安装包输出到 release/
.\scripts\Build-Local.ps1 -Install   # 构建后启动安装程序
```

安装前先关闭正在运行的 PaperQuay。个人构建与正式版使用同一个应用标识（`dev.paperquay.app`）和用户数据目录，首次切换前先在应用内导出 `.pqbackup`（见[用户手册 5.7 节](./USER_MANUAL.zh-CN.md#57-加密备份与迁移)）。

### 提交与提 PR

```powershell
git add <文件>
git commit -m "fix: 简短描述问题"
git push -u origin fix/简短问题名
```

推送到 `main` 和 PR 会触发 `.github/workflows/build.yml`（Windows 上运行 `npm ci`、`npm run build`、`npm test`）。通过后可向上游 `WangQrkkk/PaperQuay:main` 提 PR，或继续在 Fork 中迭代。上游 PR 应聚焦单一问题，附复现步骤、根因、验证方式和必要截图。

## 数据位置与隔离验证

运行时数据在 `<userData>/PaperQuay/`（`electron/backend/libraryStore.cjs` 的 `createAppPaths`）：

- `paperquay-library.sqlite`：文库与文库设置
- `paperquay-notes.sqlite`：笔记
- `paperquay-rag.sqlite`：知识库检索索引
- `paperquay-knowledge-graph-relations.json`：知识图谱关系
- `.settings/paperquay.config.json`、`.mineru-cache/`、`agent-memory/` 等

验证时不要写入真实文库。用 `--user-data-dir=<空目录>` 启动，或使用复制出来的一次性数据目录。不要改动知识库/RAG 的 schema 或 `user_version`。运行安装版时不要加 `--version` 之类的探测参数：打包版会忽略它，并用真实数据目录启动。

## 发布与本地更新

Windows 自动更新依赖 Fork 的 GitHub Release。完整流程、检查清单和回滚见 [RELEASE.md](./RELEASE.md)。要点：

1. 同步递增 `package.json` 和 `package-lock.json` 中的版本号，版本号必须高于上游和已发布版本。
2. 更新 `CHANGELOG.md` 和 `.github/release-notes.md`（`{{VERSION}}` 为版本占位符）。
3. 提交、推送后，推送 `app-vX.Y.Z` 标签触发 Release 工作流。

Fork 仓库首次使用 Actions 时，GitHub 默认禁用工作流，需先在仓库 Actions 页面手动启用，标签推送才会触发 Release。

## 文档约定

- Bug 报告模板：`.github/ISSUE_TEMPLATE/bug_report.md`
- 发布流程：[RELEASE.md](./RELEASE.md)；上游同步：[UPSTREAM.md](./UPSTREAM.md)
- 版本变更：`CHANGELOG.md`；单项变更与验收记录：`docs/changes/`

每个修复至少记录：现象、复现步骤、预期与实际行为、影响范围、根因、修复方案和验证结果。

## 数据与安全边界

不要提交：

- API key、Token、密码或证书
- PDF、解析结果和个人笔记
- SQLite 数据库、备份包（含 `.pqbackup`）和运行时目录
- `release/`、`dist/` 等构建产物

`.pqbackup` 可能包含 API Key 和个人数据，忘记密码后无法恢复。

本仓库继承上游 AGPL-3.0-only 许可证。修改后再分发或通过网络提供修改版时，应遵守 AGPL 和 [TRADEMARKS.md](../TRADEMARKS.md) 中的品牌说明。
