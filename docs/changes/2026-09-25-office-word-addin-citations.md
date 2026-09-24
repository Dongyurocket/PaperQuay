# 2026-09-25 - Word 加载项：在 Word 里插入引用与参考文献表

对应方案：`docs/plans/2026-09-25-office-addin-citation-plan.md`。按用户确认的范围，本次只做 Microsoft Word（WPS / LibreOffice 不做）。

## 现象

- 笔记工作区已经能按 GB/T 7714-2015 / APA 7 / IEEE 生成引用与参考文献表，但写论文时参考文献列表还得手工抄进 Word；正文增删引用后编号要人工重排。
- 仓库里没有可以被浏览器环境调用的本地接口：现有对外通道只有 Electron IPC（渲染层）和 stdio MCP（外部 Agent），加载项都够不到。

## 根因

- 引用格式化真源是渲染层 TS 模块（`src/features/notes/bibliography.ts`），主进程无法直接 require，导致它在 `electron/backend/noteVault.cjs` 里有一份"同规则精简移植"的分叉。
- Word 加载项运行在浏览器里，既不能读 SQLite，也没有 Node 能力，必须有一个本机服务替它查库和算格式。

## 修改

- 抽出引用格式化真源 `src/shared/citation/`（`types` / `text` / `styles` / `numbering` / `documentTags` / `format`），`format.ts` 提供 `formatBibliographyEntry`、`renderCitations`、`inline` 文本与文末条目；笔记侧 `src/features/notes/bibliography.ts` 改为再导出，`noteVault.cjs` 的分叉删除改走产物。新增 `scripts/build-citation.mjs`（esbuild）产出 `electron/generated/citationFormatters.cjs` 与 `office-addin/dist/citation-shared.js`，`npm run build` 前置执行。
- 顺带修正 GB/T 条目偏差：会议论文改为 `[C]//论文集名. 年, 卷(期). 出版地: 出版者: 页`；专著/学位论文使用新增的**出版地**字段（`papers.publisher_place`，幂等 `ALTER TABLE` 迁移，`LiteraturePaper`/更新请求/元数据/文献详情表单/MCP 字段白名单全链路打通）；西文作者在有结构化姓名时输出「姓 + 名首字母」。
- 新增 `electron/backend/officeBridge.cjs`：`127.0.0.1` 上的**只读** HTTP 桥，端口默认 23120（避开 Zotero 的 23119，被占用顺延），Bearer token 每次启动随机生成，发现文件 `<userData>/PaperQuay/paperquay-office-bridge.json`（0600，停止时只删自己的）。CORS 只回显白名单来源并带 `Vary: Origin`，未知来源 403，绝不返回 `*`。端点：`/health`、`/papers`、`/papers/:id`、`/categories`、`/styles`、`/citations/render`、`/documents/cited`。唯一写入路径 `/documents/cited` 把「本文引用过」按（文献, 文档）upsert 到新增的 `paper_citations` 表（`ON DELETE CASCADE`），可在设置里关闭。
- 新增 `electron/backend/officeCommands.cjs`（`office_get_status` / `office_start_bridge` / `office_stop_bridge` / `office_restart_bridge` / `office_list_citations` / `office_reveal_discovery_file`），在 `backend.cjs` 组装、`main.cjs` 的 `app.whenReady()` 与 `before-quit` 挂载生命周期。
- 渲染层新增 `src/services/officeAddin.ts` 与设置对话框的「Word 加载项（Office 桥）」分区：开关、端口、是否允许回写、额外来源白名单、启动/停止/重启、复制连接信息、打开发现文件。
- 新增加载项子工程 `office-addin/`：`manifest.xml`（任务窗格 + 功能区按钮 + VersionOverrides）、`taskpane.html/css/js`（连接、检索、多选、页码/前后缀/隐藏作者、插入引用、插入参考文献表、刷新、取消链接、本文引用）、`commands.html`、`assets/icon-{16,32,64,80}.png`（脚本生成）。文档模型：每条引用是一个 `pq:c|<citeId>` 的 ContentControl，文末表是单个 `pq:bib`，明细写在文档设置 `pq:citations`；刷新时用 `body.getOoxml()` 取真实文档顺序再让桥派生编号，避免 `contentControls` 顺序不保证的问题。
- 新增加载项页面源站 `electron/backend/officeAddinHost.cjs`：主进程随应用启停托管 `office-addin/` 静态资源（`https://localhost:3000`，证书不可用时回退 `http://localhost:3007`），只绑 127.0.0.1、只读、防目录穿越；证书查找顺序为安装器目录 → `dataDir/office-addin` → `office-addin/.certs`，都没有时自动生成自签证书。源站设置存在 `officeAddin.source`（enabled / httpsPort / httpPort / allowHttpFallback），设置页可开关、改端口、一键「信任本地证书」（`office_trust_addin_certificate`）。
- 新增 exe 安装器 `office-addin/installer/PaperQuayOfficeAddinInstaller.cs`（单文件 WinForms，C# 5 语法）+ 编译脚本 `scripts/Build-OfficeAddinInstaller.ps1`（`npm run office-addin:installer`）：用 Windows 自带 .NET Framework 4.x csc 编译，清单与图标以嵌入资源打进 exe，产出 `release/PaperQuay-OfficeAddin-Setup-<版本>.exe`（136 KB）。安装器只做三件本地设置（均只动当前用户、无需管理员）：生成/复用 localhost 自签证书 → `%LOCALAPPDATA%\PaperQuay\OfficeAddin`、按实际端口写出 manifest.xml、注册侧载键 `HKCU\Software\Microsoft\Office\16.0\WEF\Developer`，可选导入受信任根。支持 `--silent` / `--no-trust` / `--http` / `--uninstall` / `--diagnose`（只读体检：清单、注册表、证书信任、页面与桥可达性）/ `--help`。页面本体由 PaperQuay 源站托管，安装器不常驻进程。
- 新增本地托管与侧载：`scripts/office-addin-server.mjs`（PowerShell 自签证书 + `node:https` 静态服务，可 `--http`/`--trust`/`--port`，并生成 `manifest.local.xml`）、`scripts/Install-OfficeAddin.ps1`（写 `HKCU\...\WEF\Developer`）、`scripts/Build-OfficeAddin.ps1`、`scripts/generate-office-addin-icons.mjs`、`scripts/office-addin-smoke.mjs`（`npm run office-addin:smoke`：不开 Word 直接打桥，验证真实库的检索与编号输出）；`package.json` 增加 `office-addin:build` / `office-addin:serve` / `office-addin:install` / `office-addin:installer` / `office-addin:smoke`。
- 新增 `docs/OFFICE_ADDIN.zh-CN.md`：安装、使用、接口契约、文档模型、限制与排障。

## 验证

- `npx tsc --noEmit` 通过；`npm test` 全量 **530 例通过 / 0 失败**（含新增 `tests/officeBridge.test.ts` 21 例、`tests/officeAddin.test.ts` 9 例、`tests/citationFormat.test.ts`）。
- `tests/bibliography.test.ts` 与 `tests/noteVault.test.ts` 的会议论文期望同步改为 `[C]//`；其余断言不变，说明结构化作者路径对只有 `name` 的旧数据保持原输出。
- `scripts/office-addin-server.mjs --http --port 3007` 冒烟：`/taskpane.html`、`/manifest.xml`、`/dist/citation-shared.js`、`/assets/icon-32.png` 均 200，未知路径 404。
- exe 安装器（2026-09-25 补充）：`npm run office-addin:installer` 用 Framework64 v4.0.30319 csc 编译通过并校验嵌入资源；产物 `--help`、`--diagnose` 输出正常；`--silent --no-trust` 实机安装走通（生成证书 → 写清单 → 注册侧载键 → 安装后自检报告符合预期），仅「证书未受信任 / 页面与桥不可达」两条预期告警（PaperQuay 未运行、信任需交互确认）。
- `npm run office-addin:smoke` 用替身桥验证脚本正常路径（发现文件 → `/health` → `/papers` → `/citations/render`，退出码 0），无桥时退出码 2 并提示排查方式；真实桥 + 真实文献库的输出需在 PaperQuay 运行时执行一次。
- 待手工回归（Word 桌面版）：连接 → 插入 3 条引用 → 插入参考文献表 → 中间补一条 → 刷新 → 编号重排 → 关掉重开文档仍可刷新。

## 方案修正

- 取消 citeproc-js / CSL 与 WPS、LibreOffice 范围（按用户确认只做 Word，样式先复用现有三种）。
- 桥默认随应用启动（`officeAddin.enabled` 默认 `true`）：它只监听回环地址且要求 token，默认只读；如需彻底关闭可在设置里关掉。
- 引用域标签用短 id `pq:c|<citeId>` 而不是把明细塞进 tag，绕开 `ContentControl.tag` 的 64 字符限制，明细放文档设置。
- `cleanPart` 增加有限数字兜底：`papers.year` 等列在库里是 TEXT，但导入链路可能给数字，原来会被静默丢弃。

## 后续修复（0.3.5，2026-09-25）

- **交叉引用**：正文引用从纯文本升级为 Word 原生 `REF <书签> \h` 域。文献表侧：`buildBibliographyEntryParagraph` 把条目序号包进 `r_<paperId>` 书签（w:id 随机基数防冲突）；正文侧：`buildNumericCitationOoxml` 按 collapseSeqRanges（与 formatNumberRanges 同语义）把 `[1-3]` 拆成首尾两个 REF 域。仅在「顺序编码制 + 交叉引用开启 + 文档已有文献表」时启用，否则退回纯文本（插入引用后首刷自动升级；删掉表后刷新自动退化，自修复）。「取消链接」改为先 `insertText(当前文本)` 摊平域再删控件。新增 `pq:crossref` 文档设置（默认开）。
- **GB 7714-87 标点开关**：`formatGbt87Entry`/`formatAuthorsGbt87` 增加 `punctuation: 'full' | 'half'`（full 全角紧凑，half 半角带空格，与 GB/T 7714 官方示例一致），`renderCitations` 透传、桥 `/citations/render` 增加 `punctuation` 入参，加载项「引用样式」卡在选中 GB 7714-87 时显示标点选择。新增 `pq:punctuation` 文档设置（默认全角）。注：GB 7714-87 与 CAJ-CD B/T-1998 均未强制标点宽窄，官方示例为半角，部分中文期刊模板为全角——两种都是合规实践。

## 后续修复（0.3.4，2026-09-25）

- **新增「GB 7714-87 顺序编码制（CAJ-CD）」样式**（`gbt7714-87`）：注册进 `src/shared/citation/styles.ts`，桥 `/styles` 与加载项样式下拉自动带出。与 2015 版的差异点都在 `format.ts` 的 `formatGbt87Entry`：西文作者姓全大写 + 名缩写不加缩写点（沿用「只有结构化姓名才重组」的安全策略，纯 name 串保持原样）；作者全角逗号分隔、超 3 名加「，等」/「，et al」；论文集析出按 87 规范用 `[A].论文集名[C]` 两段式（不再用 2015 的 `[C]//`）；期刊/专著/学位论文的出版信息用全角标点。模型无专利号、更新/引用日期字段，[P]/[EB/OL] 按可得字段尽力输出。规范原文中「题名：[D]」的冒号是原文误植，按「题名[D]」实现。

## 后续修复（0.3.3，2026-09-25）

- **参考文献表插入位置**：`insertBibliography` 此前用 `body.insertParagraph(..., End)` 固定追加到文末。现改为光标处插入——光标落在非空段落时 `insertParagraph('', After)` 另起新段再建控件，避免把表插进句子中间；已存在 `pq:bib` 控件时原位刷新（光标位置无关）。
- **只要列表**：`applyBibliography` 此前总是写标题段。新增「含标题行」开关（文档设置 `pq:bibHeading`，默认开），关掉后只写条目段落，适配模板自带「参考文献」标题的文档。
- **上标选项**：新增「正文引用以上标形式插入」（文档设置 `pq:superscript`，默认关）。插入与刷新两条路径统一经 `decorateCitationControl` 应用 `control.font.superscript`（仅 numeric 样式；切到著者-出版年时强制还原为正文大小）。
- **控件外框**：引用与文献表控件在插入与刷新时统一设 `appearance = Hidden`（WordApi 1.1），不再显示内容控件边框，视觉上与普通文字一致；域身份、刷新、取消链接不受影响，旧文档在下次刷新时自动迁移。

## 后续修复（0.3.2，2026-09-25）

- **设置分区挂错了对话框**：`OfficeAddinSection` 被挂进 `src/features/literature/components/LibrarySettingsDialog.tsx`——该组件自设置窗口重构后已无任何调用方（死代码），导致「复制连接信息」等整个 Office 桥分区在实际 UI 中不可达。修复：分区挂载到实际设置窗口 `readerPreferencesContent.tsx` 的「文库与 Zotero」页签底部，删除遗留对话框，加载项连接指引（taskpane.html）与文档路径同步更正。

## 后续修复（0.3.1，2026-09-25）

- **证书信任假成功**：安装器 `CertificateTools.Trust` 与 `officeAddinHost.cjs` 的 `trustCertificate` 此前只凭 PowerShell 退出码判断 `Import-Certificate` 是否成功；用户在系统安全提示里点「否」（或提示被系统拒绝）时退出码仍为 0，界面误报「已导入」而证书未进受信任根，Word 持续报证书错误。两处都改为 `$ErrorActionPreference='Stop'` + 导入后回查 `Cert:\CurrentUser\Root` 以实际就位为准。实机验证：0.3.0 安装器复现假成功（Root 无证书但日志称已导入），修复后同一命令正确报错；手动导入并回查通过后 `297D7F62` 就位。
- 排障补充：源站只在启动时读证书，安装器在应用运行期间换证书后需「重启桥」或重启 PaperQuay（已写入 OFFICE_ADDIN 文档）。
