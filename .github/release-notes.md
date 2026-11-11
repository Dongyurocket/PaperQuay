# PaperQuay v{{VERSION}}

## Reader fixes

- Recalculate fit presets when a PDF pane or window changes size, including when a hidden reader becomes active again. Manual numeric zoom is preserved without restarting the PDF load.
- Wait for PDF.js page initialization before applying the initial comparison page signal, so initialization cannot overwrite a completed synchronization jump.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

## Verification

- `npm run check`: typecheck, frontend build, and all 976 tests passed.
- The installed 0.4.23 Windows app rendered distinct original English and translated Chinese PDFs directly from the translated entry, with 47 pages on each side. Source labels, full-name tooltips, bidirectional scrolling, and tab restoration were checked.
- That desktop run exposed pane-fit and initial-page synchronization issues. New regression tests failed before the fixes and pass afterward. Desktop verification of these fixes in the installed 0.4.24 release remains pending the user's update.
- The existing library has no translated attachment with known language metadata, so the known-language desktop branch remains unverified; logic coverage is retained.

---

## 阅读器修复

- PDF 分栏、窗口尺寸变化或隐藏页签重新激活时，重新计算适配比例；保留用户手动设置的数字缩放，不重启 PDF 加载。
- 初始对照同步等待 PDF.js 页面初始化完成，避免同步跳页被初始化位置恢复覆盖。

## Windows 发布与维护范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内更新。

## 验证

- `npm run check` 类型检查、前端构建及全部 976 项测试通过。
- 已安装的 Windows 0.4.23 从译版直接进入对照后，原版英文与译版中文均可读，两侧各 47 页；已检查来源短标签、完整名提示、双向滚动和页签恢复。
- 本次桌面测试发现分栏适配与初始页同步问题；新增回归先复现失败，修复后通过。安装版 0.4.24 的这两项桌面复验，待用户更新后继续。
- 现有文库的译版均未设置已知语言元数据，因此已知语言标签的桌面分支仍未验证，逻辑回归保留。
