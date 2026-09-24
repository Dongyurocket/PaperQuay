# PaperQuay v{{VERSION}}

## Fixes

- **Word add-in: certificate trust could silently fail while reporting success**: the installer's trust step and the in-app "Trust local certificate" button called `Import-Certificate` without `$ErrorActionPreference='Stop'`. If you clicked "No" on the Windows security prompt (or the prompt was auto-denied), PowerShell still exited 0, so the UI claimed the certificate was trusted when it never reached the root store — Word kept showing certificate errors. The import now propagates failures correctly and re-checks the certificate store after importing; on failure it tells you the system prompt was likely cancelled.

If Word still reports certificate errors after trusting: the add-in page source reads the certificate only at startup — click "Restart bridge" in settings (or restart PaperQuay) after the installer replaces the certificate.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`. The Word add-in setup is `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` (Windows only).

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **Word 加载项证书信任可能「假成功」**：安装器与设置页「信任本地证书」调用的 `Import-Certificate` 未设 `$ErrorActionPreference='Stop'`。在系统安全提示里点「否」（或提示被系统拒绝）时 PowerShell 仍以退出码 0 结束，界面误报「已导入」而证书实际未进受信任根，Word 依旧报证书错误。现在导入命令正确传播失败，并在导入后回查证书存储区，以证书真的就位为准；失败时给出「可能取消了系统安全提示」的明确原因。

若信任后 Word 仍报证书错误：加载项页面源站只在启动时读取证书——安装器更换证书后，在设置页点「重启桥」（或重启 PaperQuay）即可换用新证书。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。Word 加载项安装器为 `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe`（仅 Windows）。
