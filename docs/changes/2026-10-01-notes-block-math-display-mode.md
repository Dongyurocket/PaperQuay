# 笔记块公式编号渲染修复

- 日期：2026-10-01
- 版本：0.4.2
- 范围：笔记编辑器块级公式

## 问题

使用 `$$...$$` 包裹且包含 `\\tag{}` 的公式在笔记中显示为红色 LaTeX 原文。KaTeX 要求 `\\tag{}` 只能用于 display mode，而编辑器此前用默认的行内模式渲染块公式。

## 修改

笔记编辑器分别配置 `BlockMath` 和 `InlineMath`：块公式启用 `displayMode: true`，行内公式保持 `displayMode: false`。这样公式编号可正常渲染，同时不改变行内公式布局。

## 验证

- TypeScript 检查通过。
- `node --test tests/markdownToTiptap.test.ts`：6 项通过。
- Vite 构建在代码生成阶段通过；Windows 临时 esbuild 目录清理阶段受 `Access is denied` 影响，需在发布环境复核完整构建。
