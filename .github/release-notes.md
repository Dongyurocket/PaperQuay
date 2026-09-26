# PaperQuay v{{VERSION}}

This is a packaging hotfix for the desktop builds. The 0.3.0 installers shipped without the shared Markdown→Tiptap parser, so the app reported "A JavaScript error occurred in the main process" right after launch and never opened a window.

## Fixes

- **Desktop packages ship the shared Markdown parser again**: `src/shared/**/*` is now part of the electron-builder `files` whitelist, so `electron/backend/noteVault.cjs` and the MCP service can resolve `src/shared/markdownToTiptap.cjs` from inside `app.asar`. Note import, vault sync and MCP note writes are unchanged — every caller keeps using the same single parser implementation.
- **Upgrading from 0.3.0**: install this build over it. It carries the same notes features as 0.3.0 with the packaging gap closed; existing libraries, notes and RAG databases are untouched.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本次是桌面安装包的打包修复。0.3.0 的安装包遗漏了共享的 Markdown → Tiptap 解析器，启动后立刻弹出「A JavaScript error occurred in the main process」错误框，主窗口根本打不开。

## 修复

- **安装包重新包含共享 Markdown 解析器**：electron-builder 的 `files` 白名单补入 `src/shared/**/*`，主进程的 `electron/backend/noteVault.cjs` 与 MCP 服务都能在 `app.asar` 内解析到 `src/shared/markdownToTiptap.cjs`；同样是同一份解析实现，笔记导入、vault 同步、MCP 笔记写入的行为没有任何变化。
- **从 0.3.0 升级**：直接覆盖安装本版本即可——笔记功能与 0.3.0 相同，只是补上了打包缺口；既有文献库、笔记与 RAG 数据库不受影响。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
