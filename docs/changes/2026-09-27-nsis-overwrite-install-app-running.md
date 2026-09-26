# 2026-09-27 - 修复覆盖安装被误判"PaperQuay 正在运行"

## 现象

Windows 上覆盖安装（不卸载旧版直接运行新版 NSIS 安装器）时，安装器反复提示
"PaperQuay 正在运行，点击确定关闭"，点击后仍无法继续，陷入"无法关闭，请手动关闭"
的重试循环；实际上应用窗口早已关闭。用户只能通过 Geek Uninstaller 整体卸载旧版后才能安装。

## 根因

electron-builder 26 的 NSIS 模板在安装段和卸载段都会执行 `CHECK_APP_RUNNING`
（`templates/nsis/include/allowOnlyOneInstallerInstance.nsh`）：PowerShell 可用时通过
`Get-CimInstance Win32_Process` 检查**所有可执行文件路径位于安装目录下的进程**，
而不是只检查有窗口的主进程。

Electron 应用除主进程外还有同名的 `--type=renderer / gpu-process / utility /
crashpad-handler` 子进程，路径都在安装目录内。上次崩溃、任务管理器强杀或关机竞态
退出后，这些子进程可能成为无窗口的孤儿进程残留；此外 `before-quit` 中 RAG
`worker_threads` 的 `close()` 为异步 fire-and-forget，worker 卡在同步 SQLite 调用时
主进程可能滞留。两类残留都会命中安装器检查；若残留进程以更高权限运行，
per-user 安装器 `Stop-Process` 被拒绝，进入重试死循环。

另外 `win.target` 同时配置了 `nsis` 和 `msi`，两套安装体系的产品码与卸载注册信息
互不识别，混装也是覆盖安装异常的来源之一。

## 修改

- `installer.nsh`（新增，项目根）：定义 `customCheckAppRunning` 宏覆盖默认检测逻辑，
  检测到安装目录下残留进程时自动按路径 `Stop-Process -Force` 并以 nsProcess 按进程名
  兜底强杀，等待后重试，最多 4 次，均失败才提示用户手动结束后重试。
  该宏对安装段和卸载段同时生效。
- `package.json`：`build.nsis.include` 接入 `installer.nsh`；`build.win.target`
  移除 `msi`，仅保留 `nsis`。
- `electron/main.cjs`：`before-quit` 增加 3 秒兜底 `app.exit(0)`（unref 定时器，
  正常退出时不生效），避免后端资源关闭卡住导致无窗口驻留进程。

## 验证

- `npm run build`（tsc + vite）通过。
- `node electron/build.cjs --config.directories.output=release/local-0.3.1-nsis-check`
  打包通过，NSIS 脚本编译无误，仅产出 NSIS 安装器（无 MSI）。
- 手工验证建议：安装后启动再关闭应用，制造/保留一个无窗口的 `PaperQuay.exe`
  残留进程（或直接在任务管理器确认无残留），再次运行新安装器应不再弹
  "正在运行"提示而直接完成覆盖安装。
