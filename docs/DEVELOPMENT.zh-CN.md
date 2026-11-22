# PaperQuay 二次开发说明

本仓库是 `WangQrkkk/PaperQuay` 的个人 Fork，用于修复问题、补充功能和维护本地发布。开发遵守三条原则：

- 保持与上游同步，修复放在独立分支，便于向上游提交 PR。
- 本地安装版的更新源指向个人 Fork 的 Release。
- 每个修复记录现象、根因、修改和验证，不只留在聊天记录里。

## 基本信息

- 上游：`https://github.com/WangQrkkk/PaperQuay.git`
- 个人 Fork：`Dongyurocket/PaperQuay`
- 技术栈：Electron + React + TypeScript + Vite
- Node.js：22.18 或更高；CI 使用 Node.js 24
- 平台：自 0.4.24 起只维护和测试 Windows x64
- 默认安装目录：`%LOCALAPPDATA%\Programs\PaperQuay`
- 许可证：`AGPL-3.0-only`

`package.json` 的 `build.publish` 和 `electron/backend/updateCommands.cjs` 的 `UPDATE_REPOSITORY` 必须指向同一个 Fork。同步上游后要核对这两处。

## 首次配置 Fork

在 GitHub Fork 上游仓库后运行：

```powershell
.\scripts\Configure-Fork.ps1 -ForkOwner "你的GitHub用户名"
git remote -v
```

脚本会把原 `origin` 改名为 `upstream`，添加你的 Fork 为 `origin`，并更新发布目标。完成后，`upstream` 应指向 `WangQrkkk/PaperQuay`。

远程分工和同步细节见 [UPSTREAM.md](./UPSTREAM.md)。

## 日常工作流

### 同步上游与建分支

```powershell
.\scripts\Sync-Upstream.ps1          # 工作区必须干净；默认同步 main 并推送到 origin
git switch -c fix/简短问题名
```

分支前缀：

- `fix/`：Bug。
- `feat/`：功能。
- `docs/`：文档。
- `refactor/`：不改变行为的重构。
- `chore/`：构建、依赖和工具。

### 开发与检查

```powershell
npm ci
npm run dev                # 桌面开发模式
npx tsc --noEmit           # 类型检查
npm run build              # tsc + vite build
npm test                   # node --test "tests/*.test.ts" "tests/*.test.mjs"
.\scripts\Run-Checks.ps1   # 依次运行 build 和 test
```

需要串行跑测试时：

```powershell
node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"
```

改动 `electron/backend/backupImport.cjs` 后至少运行 `npm test`。恢复路径回归测试在 `tests/backupRestorePaths.test.ts`。

### Windows 构建报 `Access is denied`

默认 `TEMP` 下，esbuild 可能因临时目录权限失败。这是环境问题，不要改产品代码。把 `TEMP` 和 `TMP` 指到仓库内目录后重试：

```powershell
New-Item -ItemType Directory -Force .tmp-build | Out-Null
$env:TEMP = "$PWD\.tmp-build"
$env:TMP = $env:TEMP
npm run build
```

### 构建并安装 Windows 版本

```powershell
.\scripts\Build-Local.ps1            # 输出到 release/
.\scripts\Build-Local.ps1 -Install   # 构建后启动安装程序
```

安装前关闭 PaperQuay。个人构建与正式版使用同一应用标识和用户数据目录。首次切换前先导出 `.pqbackup`，步骤见[用户手册 5.6 节](./USER_MANUAL.zh-CN.md#56-加密备份与迁移)。

### 提交与提 PR

```powershell
git add <文件>
git commit -m "fix: 简短描述问题"
git push -u origin fix/简短问题名
```

推送到 `main` 和 PR 会触发 `.github/workflows/build.yml`，在 Windows 上运行 `npm ci`、`npm run build` 和 `npm test`。

上游 PR 应聚焦一个问题，并附：

- 复现步骤。
- 根因。
- 修复方式。
- 验证结果。
- 必要的截图。

## 数据位置与隔离验证

运行时数据位于 `<userData>/PaperQuay/`，由 `electron/backend/libraryStore.cjs` 的 `createAppPaths` 生成：

- `paperquay-library.sqlite`：文库和文库设置。
- `paperquay-notes.sqlite`：笔记。
- `paperquay-rag.sqlite`：RAG 索引。
- `paperquay-knowledge-graph-relations.json`：知识图谱关系。
- `.settings/paperquay.config.json`：应用设置。
- `.mineru-cache/`：MinerU 解析和翻译缓存。

验证时不要写入真实文库。用 `--user-data-dir=<空目录>` 启动，或复制一份一次性数据目录。不要修改 RAG schema 或 `user_version`。

安装版启动时不要加 `--version` 等探测参数。打包版会忽略这些参数，并使用真实数据目录。

### 文档截图

截图必须来自当前版本，并使用临时数据目录。截图前删除或替换个人信息、真实文献标题、本机路径和 API Key。不要用旧版截图证明新版本行为。

## 发布

Windows 自动更新依赖 Fork 的 GitHub Release。完整流程和回滚见 [RELEASE.md](./RELEASE.md)。

1. 同步递增 `package.json` 和 `package-lock.json` 的版本号，且高于上游和已发布版本。
2. 更新 `CHANGELOG.md` 和 `.github/release-notes.md`。
3. 提交、推送，再推送 `app-vX.Y.Z` 标签触发 Release。

Fork 首次使用 Actions 时，GitHub 默认禁用工作流。先在 Actions 页面启用，标签推送才会触发发布。

## 文档约定

- Bug 模板：`.github/ISSUE_TEMPLATE/bug_report.md`。
- 发布流程：[RELEASE.md](./RELEASE.md)。
- 上游同步：[UPSTREAM.md](./UPSTREAM.md)。
- 版本变更：`CHANGELOG.md`。
- 单项变更与验收：`docs/changes/`。

每个修复至少记录：现象、复现步骤、预期与实际行为、影响范围、根因、修复方案和验证结果。

## 数据与安全边界

不要提交：

- API Key、Token、密码或证书。
- PDF、解析结果和个人笔记。
- SQLite 数据库、`.pqbackup` 和运行时目录。
- `release/`、`dist/` 等构建产物。

本仓库继承上游 `AGPL-3.0-only`。修改后再分发或通过网络提供服务时，遵守 AGPL 和 [TRADEMARKS.md](../TRADEMARKS.md)。
