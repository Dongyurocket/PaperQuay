# PaperQuay v{{VERSION}}

## New

- **Word add-in (Office bridge)**: a Microsoft Word task-pane add-in that inserts live citation fields and a refreshable bibliography field. Citations are Word content controls (`pq:c|<citeId>`), the bibliography is a single `pq:bib` field, and details live in document settings — so closing and reopening the document keeps refresh working, and inserting a citation in the middle renumbers the whole document on refresh. Defaults to GB/T 7714-2015 numeric (same paper keeps its number, consecutive numbers collapse to `[1-3]`), with GB/T 7714-2015 author-date, APA 7, and IEEE selectable; page locators, prefixes/suffixes, author suppression, unlink-to-plain-text, and a per-document "cited here" list are supported.
- **Local read-only bridge**: the add-in talks to the library over a token-protected, loopback-only HTTP bridge (`127.0.0.1`, default port 23120; Zotero uses 23119). CORS echoes allowlisted origins only — never `*`. The single write path records which Word documents cite a paper (`paper_citations` table) and can be turned off in settings.
- **One-click exe installer**: `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` (in Assets) provisions the self-signed localhost certificate, writes the manifest, and registers the sideload key for the current user — no admin rights, no background process. The add-in pages themselves are hosted by the running PaperQuay app (`https://localhost:3000`). Command line: `--silent`, `--uninstall`, `--diagnose`, `--help`.
- **Single citation-formatting source of truth**: notes, Obsidian vault export, MCP, the Office bridge, and the Word add-in all share `src/shared/citation/`; the drifted "lite port" in `noteVault.cjs` is gone.

## Fixes

- **GB/T conference papers** now render as `[C]//proceedings…` per GB/T 7714-2015, with place of publication supported via a new `publisher_place` column (idempotent migration, wired through metadata extraction, the details form, and the MCP field whitelist).
- **Western author names** render as "Family FM" when structured `familyName`/`givenName` data exists (e.g. Zotero imports); name-only records keep their previous output.
- Numeric years/volumes/issues/pages from import pipelines are no longer silently dropped by citation formatting.

## Notes

- Microsoft Word only — no WPS or LibreOffice. Track Changes should be off while inserting or refreshing.
- The add-in requires the PaperQuay desktop app v{{VERSION}} or newer to be running (it hosts both the add-in pages and the bridge).

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`. The Word add-in setup is `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` (Windows only).

---

# PaperQuay v{{VERSION}} 中文说明

## 新增

- **Word 加载项（Office 桥）**：新增 Microsoft Word 任务窗格加载项，在正文插入引用域、在文末生成可刷新的参考文献表域。引用是 Word 内容控件（`pq:c|<citeId>`），文末表是单个 `pq:bib` 域，明细写在文档设置里——关闭重开文档仍可刷新，中间补一条引用后刷新即可整篇重排编号。默认 GB/T 7714-2015 顺序编码制（同一文献同号、连续编号折叠为 `[1-3]`），可切换 GB/T 7714-2015 著者-出版年、APA 7、IEEE；支持页码、前后缀、隐藏作者、取消链接转纯文本，以及按文档查看「本文引用过」。
- **本机只读桥**：加载项通过带令牌的只读 HTTP 桥访问文献库（`127.0.0.1`，默认端口 23120，Zotero 用 23119）。CORS 只回显白名单来源，绝不使用 `*`。唯一写入路径是把「某文献被哪些 Word 文档引用过」记录回文献库，可在设置里关闭。
- **exe 一键安装器**：Assets 中的 `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe` 自动完成 localhost 自签证书、清单写入与侧载注册表登记，只动当前用户、不需要管理员权限、不常驻进程；加载项页面由运行中的 PaperQuay 本体托管（`https://localhost:3000`）。命令行支持 `--silent` / `--uninstall` / `--diagnose` / `--help`。
- **引用格式化收敛为唯一真源**：笔记工作区、Obsidian vault 导出、MCP、Office 桥与 Word 加载项共用 `src/shared/citation/`，`noteVault.cjs` 里分叉的「精简移植」已删除。

## 修复

- **GB/T 会议论文条目**改为标准的 `[C]//论文集名…` 写法，并通过新增的 `publisher_place` 字段支持出版地（幂等迁移，元数据提取、文献详情表单与 MCP 字段白名单全链路打通）。
- **西文作者**在有结构化 `familyName`/`givenName` 时按「姓 + 名首字母」输出（如 Zotero 导入的文献）；只有整串姓名的旧数据保持原输出。
- 导入链路给出的数字年份/卷/期/页不再被引用格式化静默丢弃。

## 注意

- 仅支持 Microsoft Word，不含 WPS 与 LibreOffice；插入/刷新前请关闭修订模式。
- 加载项要求 PaperQuay 桌面端 v{{VERSION}} 或更高版本保持运行（页面源站与桥都由本体托管）。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。Word 加载项安装器为 `PaperQuay-OfficeAddin-Setup-{{VERSION}}.exe`（仅 Windows）。
