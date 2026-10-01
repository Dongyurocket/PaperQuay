# PaperQuay v{{VERSION}}

This release fixes note workspace formula rendering in excerpt cards and legacy nested content. Excerpt cards render inline and display math with KaTeX, while formulas inside lists, quotes, and components are upgraded to Tiptap math nodes. OCR excerpts with a missing closing `$` are handled as math when their content is clearly LaTeX. Block formulas continue to use KaTeX display mode so `\\tag{}` equation numbers render correctly instead of falling back to red raw LaTeX.

## Downloads

Choose the installer for your system from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本版修复笔记摘录卡和旧笔记嵌套内容中的公式渲染问题：摘录卡支持行内、块级及常见括号公式，列表、引用块和组件内的旧公式会自动升级；部分 OCR 缺少结束 `$` 的公式也会按 LaTeX 识别。块级公式继续启用 KaTeX display mode，带有 `\\tag{}` 的公式不再显示为红色 LaTeX 原文。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
