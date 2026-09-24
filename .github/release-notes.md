# PaperQuay v{{VERSION}}

## New

- **True Word cross-references for citations**: in numeric styles (GB/T 7714, GB 7714-87, IEEE), each bibliography entry's number is wrapped in a bookmark (`r_<paperId>`), and every in-text `[1]` is rebuilt as a native `REF <bookmark> \h` field. Ctrl+click an in-text citation to jump to its bibliography entry; Word's own "Update Field" (F9) recalculates the numbers too. The citation content controls still drive PaperQuay refresh — fields and controls coexist. Active only for numeric styles and only when a bibliography exists in the document; can be disabled per document ("与文献表建立交叉引用"). "Unlink" now flattens fields to their displayed text before removing the controls.
- **GB 7714-87 punctuation toggle**: full-width compact (default, matching common Chinese journal templates) or half-width with spaces (matching the official GB/T 7714 examples). Saved per document; switching re-renders the whole document. The standard itself does not mandate either width — both are legitimate practice.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`. The Word add-in setup is `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` (Windows only).

---

# PaperQuay v{{VERSION}} 中文说明

## 新增

- **正文引用与文献表的 Word 交叉引用**：顺序编码制（GB/T 7714、GB 7714-87、IEEE）下，文献表条目的序号写入书签（`r_<paperId>`），正文 `[1]` 重建为 Word 原生 `REF` 域——Ctrl+点击正文引用跳到文献表条目，Word 自带「更新域」（F9）也能重算编号。PaperQuay 的内容控件仍负责刷新，域与控件共存。仅顺序编码制且文档里已有文献表时生效；可随文档关闭。「取消链接」会先把域摊平为当前显示文本再移除控件，交出纯文本。
- **GB 7714-87 标点风格开关**：全角紧凑（默认，与多数中文期刊模板一致）/ 半角带空格（与 GB/T 7714 官方示例一致），随文档保存，切换后自动刷新全文。标准本身未强制标点宽窄，两种都是合规实践。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。Word 加载项安装器为 `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe`（仅 Windows）。
