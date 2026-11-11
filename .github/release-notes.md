# PaperQuay v{{VERSION}}

## Reader fixes

- Keep the original PDF loading task stable when entering comparison from a translated PDF, rerendering the reader, or resizing the panes.
- Bind each pane's file name, page count, errors, and reading state to its actual source. Missing originals have an explicit unavailable state.
- Show separate loading and rendering stages, unknown page counts, and a retry action with the failing file name and error.
- Fix in-memory PDF opening and comparison page synchronization when the target is far away or the documents have different page counts.
- Preserve localized source labels, translation language, and full file-name tooltips.

## Verification

- `npm run check`: typecheck, frontend build, and all 973 tests passed for 0.4.23.
- Regression coverage exercises the real reader/viewer component chain with controlled PDF.js and DOM fixtures, including task cancellation, stale results, source ownership, independent failures, retry, and bidirectional page synchronization.
- Final installed Windows desktop acceptance remains pending. Local unpacked launches exited before showing a window; intermediate diagnostic screenshots do not establish acceptance of this release. Verification will continue after the user updates the installed app.
- This change adds no migration, renaming, or cleanup of existing literature, PDFs, attachments, or library databases.

## Downloads

- Windows x64: `.exe`
- Linux x64: `.AppImage`, `.deb`, `.tar.gz`
- macOS x64: `.dmg`

macOS arm64 installers are not built or published. Historical release assets remain available.

---

# PaperQuay v{{VERSION}}

## 阅读器修复

- 从译版进入对照、阅读器重复渲染或调整分栏时，保持原版 PDF 加载任务稳定。
- 两栏文件名、页数、错误和阅读状态绑定各自的实际来源；原版缺失时明确显示不可用。
- 区分文档加载和页面绘制阶段；未知页数明确提示，失败时显示文件名、错误和重试按钮。
- 修复内存 PDF 无法打开，以及目标页较远或两份文档页数不同时的对照翻页同步。
- 保留本地化来源短标签、译版语言和完整文件名提示。

## 验证

- 0.4.23 的 `npm run check` 类型检查、前端构建及全部 973 项测试通过。
- 回归测试连接真实阅读器及 PDF viewer 组件链，使用受控 PDF.js/DOM 夹具，覆盖任务取消、迟到结果、来源归属、独立失败、重试和双向翻页同步。
- 最终 Windows 安装版桌面验收待完成。本地解包版在窗口出现前退出；中间诊断截图不能证明本次发布包验收通过。用户更新安装版后继续验证。
- 本次变更不新增既有文献、PDF、附件或文库数据库的迁移、改名及清理操作。

## 下载平台

- Windows x64：`.exe`
- Linux x64：`.AppImage`、`.deb`、`.tar.gz`
- macOS x64：`.dmg`

不构建或发布 macOS arm64 安装包，历史版本资产继续保留。
