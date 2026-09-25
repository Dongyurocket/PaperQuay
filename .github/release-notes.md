# PaperQuay v{{VERSION}}

## New

- **Zero-config Word add-in**: the add-in pages are served by PaperQuay itself, so the task pane talks to a same-origin `/api/v1` that the host forwards to the read-only bridge **in-process** — no network hop and no token to copy. Open the pane while the app runs and it connects, then reconnects on its own after a drop. Cross-origin requests are refused outright (a custom request header is required, `Host` and `Origin` are checked, and CORS preflights are never answered); the per-launch port/token route is still there for external tools under "advanced". Settings now shows a "Word connected" record of the last request.
- **Citation details move into a Custom XML Part of the document** (`urn:paperquay:word:v2`), replacing document settings: the model survives Save As and conversion, and 0.3.x documents migrate automatically on open. It stores style preferences, the per-citation manual-edit records, and a metadata snapshot of every cited paper — so the document refreshes correctly with PaperQuay closed, on another machine, or after a paper has left the library (a new `POST /papers/batch` refreshes those snapshots from the library).
- **Jump links replace REF fields**: each bibliography entry is wrapped in a hidden bookmark (`_PQ_<hash>`), and each in-text number is an internal hyperlink (explicitly no underline, automatic colour). Ctrl+click to jump, PDF export keeps the links, and Word's "Update Field" (F9) never reports "Error! Bookmark not defined." anymore.
- **Fewer surprises**: citations you edited by hand are no longer silently overwritten on refresh, duplicates created by copy/paste split into independent citations with their own numbers, and the ribbon is now a PaperQuay tab (`Cite`: insert citation / insert bibliography / refresh — `Document`: preferences / open pane) built from TypeScript sources downlevelled to ES5 for Word 2016.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`. The Word add-in setup is `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` (Windows only).

---

# PaperQuay v{{VERSION}} 中文说明

## 新增

- **Word 加载项免配置连接**：加载项页面由 PaperQuay 本体托管，任务窗格请求同源 `/api/v1`，源站在**进程内**转发给只读桥——不走网络，也没有令牌要复制。保持应用运行、打开窗格即自动连接，断开后自动重连。跨源请求一律被拒（必须带自定义请求头，校验 `Host`/`Origin`，且从不同意 CORS 预检）；每次启动随机生成的端口/令牌只留给「高级：外部工具的端口/令牌连接」里的外部工具。设置页新增「Word 已连接」的最近请求记录。
- **引用明细迁入文档的 Custom XML Part**（`urn:paperquay:word:v2`，取代文档设置项）：文档另存、转换都不再丢模型，0.3.x 文档打开即自动迁移。模型里存样式偏好、每条引用的手改记录，以及每篇被引文献的**元数据快照**——所以 PaperQuay 没运行、换台机器、文献已移出库，文档仍能照常刷新；连着应用时用新增的 `POST /papers/batch` 按库里最新数据刷新快照。
- **跳转链接取代 REF 域**：文献表每条目整段包在隐藏书签 `_PQ_<hash>` 里，正文每个编号是内部超链接（显式无下划线、自动颜色）。Ctrl+点击跳转、导出 PDF 保留链接，Word 自带「更新域」（F9）不再出现「错误！未定义书签」。
- **更少意外覆盖**：手改过的引用刷新时不再被静默覆盖；复制粘贴产生的重复引用会自动拆成各自独立的编号；功能区改为 PaperQuay 自定义选项卡（`引用`：插入引用 / 插入参考文献表 / 刷新；`文档`：首选项 / 打开窗格），源码迁移到 TypeScript 并降级为兼容 Word 2016 的 ES5 产物。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。Word 加载项安装器为 `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe`（仅 Windows）。
