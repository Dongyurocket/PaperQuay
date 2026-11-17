# PaperQuay v{{VERSION}}

## Leaner reader top bar and toolbars

- The reader top bar is now a single 40px row. Breadcrumbs and the author line are gone; authors, year, file, status and usage tips sit in the ⓘ next to the title, which shows a spinner while parsing or translating. "Overview / Read" and the PDF views are icon segments, the PDF version picker appears only when there are several versions, and less-used actions are under "⋯". The "Collapse status bar" button and the bottom bar are removed.
- The PDF toolbar is a single 36px row that never wraps. The four color swatches are one "Current color" popover; the page number can be typed (Enter jumps, Esc restores, out-of-range values are clamped); zoom offers Fit width, Fit page and 100%; "Delete Selected" appears only when an annotation is selected. The reading heatmap and "Export Annotated PDF" are under "⋯". When the window is narrow, tools, page navigation and zoom that do not fit move into "⋯" with full equivalents.
- The structured-reading toolbar drops its permanent labels; block counts and linking tips are in ⓘ, and it matches the PDF toolbar height.
- New immersive reading: click the top-bar icon or press `Ctrl+Shift+F` (`Command+Shift+F` on macOS). The top bar and all toolbars hide, leaving only an exit button; press the shortcut again or `Esc` to exit.
- The onboarding guide has been removed. Notes on the old welcome document still open normally.

## Fixes

- In the Chinese UI, AI Overview subheadings in library details were shown in English (Background, Key Findings and so on). They now follow the UI language and switch immediately, with no need to regenerate old overviews. The stored format is unchanged, so MCP and agents read the same content. AI keywords are omitted from the overview only when all of them already appear in the paper's keywords.
- Translation progress now shows as a toast plus a thin progress line under the toolbar instead of taking a row. Toasts meant to stay open no longer disappear immediately.

## Verification

- `npm run build` passed; `npm test` passed all 1103 tests, including new tests for toolbar overflow and page input, immersive mode, overview heading localization and old note-target compatibility.
- Before release, three independent reviews (reader logic, overview and onboarding, UI rules and accessibility) with adversarial verification found and fixed 9 kinds of issues. The development Electron build could not start on the release machine, so desktop visual acceptance of the new reader UI is pending installation of this release.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

---

## 阅读器顶栏与工具栏精简

- 阅读器顶栏压缩为一行（40px）：去掉面包屑和作者行，作者、年份、文件、状态和操作提示收进标题旁的 ⓘ，解析或翻译进行中时显示进度图标。「概览 / 阅读」和 PDF 视图改为图标分段，PDF 版本下拉只在有多个版本时出现，低频操作进入「⋯」。删除「收起状态栏」按钮和底栏。
- PDF 工具行改为不换行的 36px 单行：四个色块合并为「当前颜色」弹层；页码可输入跳转（Enter 跳转、Esc 还原、越界自动夹取）；缩放可选适合宽度、适合页面、100%；「删除所选」只在选中批注时出现。阅读热力图和「导出批注 PDF」在「⋯」里；窗口变窄时，放不下的工具、翻页和缩放收进「⋯」，菜单中有完整对应项。
- 结构化阅读工具行去掉常驻说明标签，块数和联动说明收进 ⓘ，与 PDF 工具行同高。
- 新增沉浸阅读：点顶栏图标或按 `Ctrl+Shift+F`（macOS 为 `Command+Shift+F`）进入，顶栏和所有工具行隐藏，只留退出按钮；再按一次或按 `Esc` 退出。
- 新手引导已整体移除。旧欢迎文档上的笔记仍能正常打开。

## 修复

- 中文界面下，文库详情「AI 概览」的小标题显示为英文（Background、Key Findings 等）。现在按界面语言显示，切换语言立即生效，旧概览无需重新生成；存储格式不变，MCP 和 Agent 读到的内容不受影响。AI 关键词只在全部已出现在文献关键词中时才在概览里省略。
- 翻译进度改为 toast 加工具行底部细进度线，不再占用一行；「不自动关闭」的 toast 不会再一出现就消失。

## 验证

- `npm run build` 通过；`npm test` 全部 1103 项通过，含工具栏溢出与页码、沉浸模式、概览标题本地化和旧笔记目标兼容等新测试。
- 发版前经阅读器逻辑、概览与引导、界面规则与可访问性三个方向的独立审查与反驳复核，修复 9 类问题。本机无法启动开发版 Electron，阅读器新界面的桌面视觉验收待安装此版本后完成。

## Windows 发布范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内更新。
