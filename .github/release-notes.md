# PaperQuay v{{VERSION}}

## Fixes

- **The "Word add-in (Office bridge)" section was unreachable in settings**: it had been mounted inside a legacy library-settings dialog that no longer renders anywhere, so in 0.3.0/0.3.1 there was no way to copy the connection info or manage the bridge from the UI. The section now lives in the real settings window (Settings → Library & Zotero → bottom), the orphaned dialog was removed, and the add-in's connection hint points to the right place.

After updating, open PaperQuay → Settings → Library & Zotero → "Word add-in (Office bridge)" to copy the connection info (`port:token`) for Word.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`. The Word add-in setup is `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` (Windows only).

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **设置里找不到「Word 加载项（Office 桥）」分区**：该分区此前被挂进了一个已不再渲染的遗留文库设置对话框，导致 0.3.0/0.3.1 里无法从设置界面复制连接信息、管理桥。现在它位于真正的设置窗口（设置 → 文库与 Zotero → 底部），遗留对话框已删除，加载项里的连接指引也已更正。

更新后打开 PaperQuay → 设置 → 文库与 Zotero →「Word 加载项（Office 桥）」即可复制连接信息（`端口:令牌`）粘贴到 Word 加载项。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。Word 加载项安装器为 `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe`（仅 Windows）。
