# PaperQuay v{{VERSION}}

## Fixes

- **Bibliography inserts at the cursor**: it used to always append at the end of the document. Now it is inserted where your cursor is (starting a new paragraph when the cursor sits inside a non-empty one); an existing bibliography refreshes in place regardless of cursor position.
- **Optional bibliography heading**: a new "include heading" toggle (saved per document) lets the bibliography be just the entry list — handy when your template already has its own "References" heading.
- **Superscript numeric citations**: a new "render in-text citations as superscript" toggle (numeric styles only, saved per document) applies on insert and across the whole document on refresh.
- **No visible control frames**: citations and the bibliography no longer show Word's content-control bounding box. They look exactly like ordinary text while remaining refreshable fields (you can still unlink them before submission).

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`. The Word add-in setup is `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` (Windows only).

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **参考文献表插到光标处**：此前固定追加到文档末尾。现在插入在光标所在位置（光标落在非空段落中时自动另起新段）；已存在表时光标位置无关，原位刷新。
- **可只要条目列表**：新增「含标题行」开关（随文档保存），关闭后只插入条目，方便模板自带「参考文献」标题的文档。
- **上标引用**：新增「正文引用以上标形式插入」开关（仅顺序编码制，随文档保存），插入与刷新全文时统一应用。
- **控件不再带框**：引用与文献表不再显示 Word 内容控件的外框，视觉上与普通文字完全一致，同时保留域身份——仍可刷新重排，交付前也仍可「取消链接」变回纯文本。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。Word 加载项安装器为 `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe`（仅 Windows）。
