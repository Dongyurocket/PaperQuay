# 2026-10-01 - 笔记 Markdown 表格与公式显示

## 现象

笔记中的 Markdown 表格和 `$...$`、`$$...$$` 公式被显示为普通文本，未按表格或数学公式渲染。

## 根因

笔记 Markdown 解析器此前只生成段落和基础内联节点，没有将 Markdown 表格和数学公式转换为 Tiptap 的 `table`、`inlineMath`、`blockMath` 节点。已有笔记的 `contentJson` 也不会自动重新解析。

## 修改

- 在共享 Markdown 解析器中增加带分隔线的 Markdown 表格解析。
- 增加单行和多行 `$` 数学公式解析。
- 对已有纯文本段落执行兼容升级，使保存过的笔记无需重建即可显示表格和公式。
- 保留编辑器现有的表格和 KaTeX 数学扩展。

## 验证

- `node --test tests/markdownToTiptap.test.ts`：6 项通过。
- `npx tsc --noEmit`：通过。
- `git diff --check`：通过。
- `npm test`：633 项通过；6 项既有 `readerSettings` 测试因 Windows 临时目录 `Access is denied` 失败。
