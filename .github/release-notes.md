# PaperQuay v{{VERSION}}

This release fixes the Windows overwrite-install failure where the NSIS installer kept reporting "PaperQuay is running" even though the app was closed, forcing a full third-party uninstall before upgrading.

## Fixes

- **Overwrite installs no longer get stuck on "PaperQuay is running"**: the installer checks every process running from the install directory, and orphaned Electron helper processes (`--type=renderer / gpu / utility / crashpad-handler`, all named `PaperQuay.exe`) left behind by a crash or forced close used to trigger the prompt and could not be closed automatically. A custom NSIS `customCheckAppRunning` script now force-closes leftover processes under the install directory and retries automatically; it only asks you to intervene after several failed attempts.
- **More reliable app shutdown**: a 3-second forced-exit fallback in `before-quit` prevents backend resources (e.g. the RAG worker thread) from leaving a windowless background process behind when closing stalls.
- **Windows ships NSIS only**: the MSI target is removed — mixing MSI and NSIS installs breaks upgrade detection and was another source of overwrite-install anomalies. If you previously installed the `.msi` build, uninstall it once and switch to the `.exe`.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本次修复 Windows 覆盖安装失败的问题：此前即使用户已关闭 PaperQuay，NSIS 安装器仍反复提示「PaperQuay 正在运行」且无法继续，只能用第三方卸载工具整体卸载后才能装新版。

## 修复

- **覆盖安装不再被误判「正在运行」**：安装器会检测安装目录下的所有进程，上次崩溃或强制结束残留的无窗口子进程（renderer / gpu / utility / crashpad-handler，进程名均为 PaperQuay.exe）会触发误报且无法自动关闭。现在通过自定义 NSIS `customCheckAppRunning` 脚本自动强制结束安装目录下的残留进程并重试，多次失败后才需要手动处理。
- **退出兜底加固**：`before-quit` 增加 3 秒强制退出兜底，避免后端资源（如 RAG worker 线程）关闭卡住时留下无窗口驻留进程。
- **Windows 仅发布 NSIS 安装包**：移除 MSI 构建目标——MSI 与 NSIS 双体系混装会互相不识别，也是覆盖安装异常的来源之一。如果你之前装的是 `.msi` 版本，请先卸载一次再改用 `.exe`。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
