# PaperQuay v{{VERSION}}

This release fixes note Markdown vault export dropping formulas. Inline and display Tiptap math nodes are now serialized as `$...$` and `$$...$$`, preserving multiline LaTeX and equation tags during synchronization.

## Downloads

Choose the installer for your system from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本版修复笔记同步 Markdown 文档丢失公式的问题：行内和块级 Tiptap 公式现在分别以 `$...$` 与 `$$...$$` 写入 vault，保留多行 LaTeX 及 `\\tag{}` 等公式内容。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
