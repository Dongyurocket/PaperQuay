# PaperQuay v{{VERSION}}

## Reader fixes

- PDF source choices now use concise localized labels. Translation language is shown when available, with an explicit unconfirmed-language label otherwise; the file name remains available as a tooltip.
- PDF Compare always opens the original PDF on the left and the attached translation on the right, even when normal reading was switched to the translated PDF.

## Verification

- Automated regression coverage includes localized PDF source labels and comparison-source selection.
- Windows desktop acceptance should verify localized source choices and entering PDF Compare from a translated source.

## Downloads

- Windows x64: `.exe`
- Linux x64: `.AppImage`, `.deb`, `.tar.gz`
- macOS x64: `.dmg`

macOS arm64 installers are not built or published. Historical release assets remain available.

---

# PaperQuay v{{VERSION}}

## 阅读器修复

- PDF 来源选项改为简短的本地化标签；可显示译版语言，缺少语言信息时明确标注“语言待确认”，完整文件名保留在提示中。
- PDF 对照模式固定显示左侧原版、右侧译版；即使普通阅读当前选中了译版，也不会再出现两栏重复译版。

## 验证

- 自动化回归覆盖 PDF 来源本地化标签和对照模式来源选择。
- Windows 桌面验收应验证来源选项本地化，以及从译版直接进入 PDF 对照。

## 下载平台

- Windows x64：`.exe`
- Linux x64：`.AppImage`、`.deb`、`.tar.gz`
- macOS x64：`.dmg`

不构建或发布 macOS arm64 安装包，历史版本资产继续保留。
