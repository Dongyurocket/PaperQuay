# 2026-11-23 - 审计 4A-1 小批：主进程边界（D1-6、D1-2、D1-11）

关联计划：[2026-11-23 审计剩余工作清单](../plans/2026-11-23-audit-remaining.md) 第 4 批的前三项。
本批只处理三个主进程 / preload 边界，不改 schema、不重构其他模块。

## 现象

- **D1-6**：`backup_import_stage` 直接信任渲染层 `targets`；`backupImport.stageBackupImport` 只要求绝对路径。任意路径（含 UNC、设备路径、用户文档 / 桌面）都能作为恢复目标：已存在的目录会被重命名为 `.pre-import-*`，随后写入备份内容。
- **D1-2**：生产版 `will-navigate` 用 `url.startsWith('file://')` 放行任意本地 HTML。攻击者页面可在主窗口加载并继承 preload 暴露的 clipboard / 事件订阅等非 IPC 能力。
- **D1-11**：preload 每次文档加载都同步取回同一份 restore payload；在发送 ack 前无条件 `localStorage.clear()`。ack 丢失、页面重复加载或应用在 ack 前重启，都会再次清空并覆盖恢复后新写的设置。

## 根因

- 恢复目标的安全校验只覆盖「不能落在数据 / 文献库 / 缓存 / Vault 内」，没有绑定「目录来自主进程文件对话框」这一授权事实。
- 导航放行规则以字符串前缀判断协议，没有把允许的文档收窄到应用自身入口。
- 渲染层恢复流程没有「该 restoreId 已完成」的持久状态，清空与 ack 不是幂等操作。

## 修改

### D1-6 恢复目标绑定对话框授权

- `electron/backend/backupCommands.cjs`
  - 新增会话级 `authorizedRestoreTargets`：只有 `backup_select_library_dir` / `backup_select_vault_dir`（内部 `choosePath('directory')`）返回的目录会登记，并同步写入 `pathPolicy.approveWritePath` 的持久授权（`backupCommands.cjs:65-99,158`）。
  - `backup_import_stage` 先把 `targets` 交给 `sanitizeRestoreTargets`：非绝对路径拒绝为 `TARGET_NOT_WRITABLE`；UNC / 设备路径 / ADS 拒绝为 `UNSAFE_DESTINATION`；不在本次授权集合内的目录（包括存在的非空目录）拒绝，且不会调用导入器（`backupCommands.cjs:300-301`）。
  - 传给导入器的 `authorizedTargets` 是规范化后的授权目录列表，作为第二道校验。
- `electron/backend/backupImport.cjs`
  - `validateAbsoluteTarget` 增加字符串层 UNC / 设备路径 / ADS 拒绝；`deleteOldData` 同样受益（`:179-190`）。
  - 新增 `authorizedRestoreRoots` / `assertRestoreTargetAuthorized`：`libraryStorageDir`、显式 `translatedPdfDir`、`notesVaultDir` 必须位于 `authorizedTargets` 内（含 realpath 与链接父级解析）；完全没有授权记录时同样拒绝（`:192-211,792-799`）。
  - 默认 `translatedPdfDir` 由已授权的库目录派生，也重新做包含校验。

### D1-2 will-navigate 只放行应用自身文档

- `electron/ipcSecurity.cjs` 新增 `isTrustedRendererNavigation`：先走 `isTrustedRendererUrl` 的协议 / 来源白名单，再解析 URL 并要求 file: 文档的规范化 pathname 与 `dist/index.html` 完全一致（拒绝 `dist/other.html`、`dist/../evil.html`、编码穿越、非空 host）。开发版仍只信任 dev server 同源页面（`:32-60`）。
- `electron/main.cjs` 的 `will-navigate` 改用该判定；被拒绝的 http(s) 仍交给 `shell.openExternal`（`:201-221`）。

### D1-11 恢复完成标记

- 新增 `src/shared/rendererStorageRestore.cjs`：把「清空并写入恢复快照」抽成可测试函数。
  - 写入前读取 `paperquay-restore-state-v1` 标记；同一 `restoreId` 已完成时直接返回 `skipped: true`，不再 `clear()`。标记中保留 `failedKeys`，ack 重试仍能上报配额失败。
  - 标记在 `clear()` 与全部写入之后落盘；`clear()` 本身失败时不落标记，下次加载仍会重试。
- `electron/preload.cjs` 改为调用该模块并通过 ack 回报 `failedKeys` / `warnings`，不再直接操作 `storage.clear()`（`:1-30`）。

## 验证

- 新增 / 更新用例：
  - `tests/backupCommands.test.ts`：未授权目录被拒且导入器未被调用；选择对话框返回的目录被接受并作为 `authorizedTargets` 传入；UNC / 设备目标被拒；原取消用例先显式选择目录。
  - `tests/backupRestorePaths.test.ts`：新增 T0——未授权非空目录保持原样、无授权记录拒绝、UNC / 设备路径即使列为授权也拒绝；fixture 改到仓库内 `.tmp-test/`。
  - `tests/ipcSecurity.test.mjs`：新增 will-navigate 用例——入口 / hash / query 放行，任意本地 HTML、`dist/other.html`、`..` 与 `%2e%2e` 穿越、非空 host、外部 https、错误 dev 端口均拒绝。
  - `tests/rendererStorageRestore.test.ts`：首次恢复清空并写标记；重复加载保留恢复后新键；新 restoreId 重新替换；写失败仍落标记且重试 ack 保留 `failedKeys`；clear 失败不落标记并重试。
  - `tests/p3aMetadata.test.ts`、`tests/backupPackage.test.ts`：直接调用 `stageBackupImport` 时显式提供 `authorizedTargets`。
- 命令与结果（2026-11-23，本机）：
  - `npm run typecheck`：四个项目 0 诊断。
  - `npm test`：937 项，936 通过、1 跳过、0 失败。
  - `npm run build`：通过（Vite 仅有既有的 `INEFFECTIVE_DYNAMIC_IMPORT` 警告）。

## 剩余风险

- 恢复目标授权是会话级：目录选择与 `backup_import_stage` 必须在同一主进程会话内完成。当前 UI 流程满足；若以后加入跨重启的断点续导，需要把授权记录纳入 `pathPolicy` 的持久文件并同时校验 restoreId。
- `backup_import_inspect` 的 `packagePath` 仍未绑定 `backup_select_package` 的对话框授权（本批未纳入 D1-6 范围）；非法包会被容器校验拒绝，但 UNC 包路径仍可能先触发 SMB 探测。
- `paperquay-restore-state-v1` 会随 `captureRendererState()` 进入后续导出包；它只是恢复幂等标记，不包含凭据，导入新 restoreId 时会被覆盖。
- will-navigate 的精确判定未做安装包实机验收；`loadFile` 在 asar 下的 URL 形态已由同一 `pathToFileURL` 生成，静态用例覆盖，仍建议随 §8.6 安装版冒烟复核。
