# PaperQuay v{{VERSION}}

## Redesigned paper overview

- The title spans the full width (up to three lines, full text on hover), with authors, year, journal and library below. "Start Reading" is the only primary button.
- MinerU parsing, full translation and overview generation are in a "Process" menu that shows done, running or failed for each; a running translation can be cancelled there.
- The "AI Overview" card drops the repeated "overview" labels. Status, keyword and finding counts and the refresh button sit in its title row. Sections (background, problem, method, experiments, findings, conclusion, limitations) appear only when they have content; findings are a list; section tabs support arrow keys, Home and End.
- The files card is a compact list of the original PDF, translated PDF, MinerU output and block count, each with "Show in folder"; missing items are greyed out. From 1200px wide it sits on the right, otherwise below the overview.
- The overview page and the shared overview component use theme tokens and match in light and dark themes.

## Fixes

- With no cached overview, the page shows whether a model is configured and offers "Model Settings" when it is not. PDF text mode no longer needs MinerU blocks before generating.
- "Regenerate overview" asks before spending model quota, and keeps the old overview if generation fails. Closing or switching documents during the confirmation no longer runs the old action.
- Old-cache migration and new overview saves are written in order, so a late old cache cannot overwrite a new overview.
- AI actions on a reading selection are no longer hidden when only the overview model is unconfigured.
- Library details and the overview page use distinct guide anchors.

## Verification

- `npm run build` passed; `npm test` passed all 1094 tests, including 46 new tests for section parsing, empty states, Process menu state and confirmation, cache write order, guide anchors and file location.
- Component browser checks covered 1040×720 and 1920×1080, light and dark themes, Chinese and English, and special states. Installed-app acceptance is pending installation of this release: cache restore after restart, real generation and quota confirmation, MinerU and translation status, and revealing files in Explorer.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

---

## 论文概览页重做

- 标题占整行（最多三行，悬停显示全文），下方显示作者、年份、期刊和所在文库；「进入阅读」是唯一主按钮。
- MinerU 解析、全文翻译和生成概览收进「处理」菜单，逐项显示完成、进行中或失败；翻译运行时可在菜单中取消。
- 「AI 概览」卡片去掉重复的「概览」字样，状态、关键词数、发现数和刷新按钮并入标题行。背景、问题、方法、实验、发现、结论、局限等分节只在有内容时显示；发现以列表呈现；分节标签支持方向键、Home 和 End。
- 文件卡改为紧凑列表，显示原始 PDF、译版 PDF、MinerU 结果和结构块数，每项可「在文件夹中显示」，缺失的项置灰。窗口宽 1200px 起排在右侧，更窄时排在概览下方。
- 概览页与共用的概览组件改用主题令牌，深浅主题一致。

## 修复

- 没有概览缓存时显示模型配置状态，未配置时提供「模型设置」入口；PDF 文本模式生成概览不再要求先有 MinerU 结构块。
- 「重新生成概览」先确认额度消耗，失败时保留原概览；确认期间关闭或切换文档，不会再执行旧操作。
- 旧缓存迁移与新概览保存按顺序写入，迟到的旧缓存不会覆盖新概览。
- 仅概览模型未配置时，阅读选区的 AI 提炼不再被隐藏。
- 文库详情和概览页的引导锚点改用不同名称。

## 验证

- `npm run build` 通过；`npm test` 全部 1094 项通过，含分节解析、空状态、处理菜单状态与确认、缓存写入顺序、引导锚点和文件定位等 46 项新测试。
- 组件浏览器验收覆盖 1040×720 与 1920×1080、浅深主题、中英文及特殊状态。安装版验收待安装此版本后完成：重启后缓存恢复、真实生成与额度确认、MinerU 与翻译状态、资源管理器定位。

## Windows 发布范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内更新。
