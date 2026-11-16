# PaperQuay v{{VERSION}}

## Fix: show MinerU output in Explorer

- 0.4.26's "Open MinerU Output Folder" showed "not found" when the parse result sat next to the PDF. It is now merged with the Markdown item as "Show MinerU Output in Folder": it reveals `full.md`, or `content_list_v2.json` / `content_list.json` / `middle.json` when there is no Markdown, checking both the MinerU cache and the PDF's folder (the latter when "Auto-load sibling JSON" is on).

## New library toolbar and filters

- One-row toolbar: select-all count, search with a clear button (`Ctrl+F` to focus), a Filter button with a count badge, sort (now with "Recently read"), a View menu (title language, reading heat column, comfortable/compact density), a single primary "Import PDF" button and a "⋯" menu (storage check, refresh). In a library pane narrower than 480px, View options move into "⋯".
- Combine filters for favorites, read in the last 30 days, read status (unread / reading / finished), publication year range, item type, tags (any of several), has PDF, has translated PDF, missing file, has overview, parsed by MinerU and source. Active filters show as removable chips with "Clear all" and the match count, and are kept after restart.
- Paging, totals and cross-page select-all follow the filters. Attachment filters check whether files really exist.
- Status text such as "Library ready" now appears as a toast. Menus and the filter popover support keyboard navigation and visible focus.

## Other fixes

- Reading progress and last-read time are saved to the library, so read status and "Recently read" sorting work.
- Papers imported from Zotero on the desktop keep Zotero as their source.

## Verification

- `npm run build` passed; `npm test` passed all 1018 tests, including 21 new tests for filter state, SQL/JS filter parity, attachment checks, reading-progress write-back and MinerU output location.
- Installed-app acceptance is pending installation of this release: revealing MinerU output, combined filters with cross-page select-all, filters kept after restart, read status and recent-read sorting, and toolbar/popover appearance in light and dark themes.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

---

## 修复：在资源管理器中显示 MinerU 结果

- 0.4.26 的「打开 MinerU 结果文件夹」在解析结果位于 PDF 同目录时显示「未找到」。现与 Markdown 项合并为「在文件夹中显示 MinerU 结果」：优先定位 `full.md`，没有时定位 `content_list_v2.json`、`content_list.json` 或 `middle.json`；同时检查 MinerU 缓存目录和 PDF 同目录（后者需启用「自动加载同目录 JSON」）。

## 文库顶栏与筛选

- 顶栏改为单行：全选计数、带清除按钮的搜索（`Ctrl+F` 聚焦）、带数量角标的「筛选」、排序（新增「最近阅读」）、视图菜单（标题语言、阅读热力列、舒适／紧凑密度）、唯一主按钮「导入 PDF」和「⋯」（存储体检、刷新）。文库面板窄于 480px 时，视图选项并入「⋯」。
- 可组合筛选：收藏、最近 30 天阅读、阅读状态（未读／在读／已读完）、出版年份范围、文献类型、标签（多选，任一匹配）、有 PDF、有译版 PDF、文件缺失、有概览、MinerU 已解析、来源。生效条件显示为可单独移除的标签，附「清除全部」和匹配数，重启后保留。
- 分页、总数和跨页全选与筛选结果一致；附件相关筛选会检查文件是否真实存在。
- 「文献库已就绪」等状态文字改为 toast；菜单和筛选弹层支持键盘操作并显示焦点。

## 其他修复

- 阅读进度和最近阅读时间写回文库，阅读状态筛选与「最近阅读」排序随之生效。
- 桌面端从 Zotero 导入的文献保留来源为 Zotero。

## 验证

- `npm run build` 通过；`npm test` 全部 1018 项通过，含筛选状态、SQL／JS 筛选一致性、附件检查、阅读进度写回和 MinerU 结果定位等 21 项新测试。
- 安装版验收待安装此版本后完成：定位 MinerU 结果、组合筛选与跨页全选、重启后筛选恢复、阅读状态与最近阅读排序、浅深主题下的顶栏和弹层。

## Windows 发布范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内更新。
