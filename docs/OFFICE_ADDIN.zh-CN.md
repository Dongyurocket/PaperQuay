# PaperQuay Word 加载项使用与开发说明

本文说明 PaperQuay 的 Word 加载项（Office 桥）如何工作、如何安装，以及它的接口契约与边界。方案来源：`docs/plans/2026-09-25-office-addin-citation-plan.md`。

**适用范围：仅 Microsoft Word**（Word 桌面版 Windows / macOS、Word on the web）。不包含 WPS 与 LibreOffice：这两者不提供 Office.js 加载项运行时，需要另外的实现路径。

## 1. 能力

- 在正文里插入**引用域**：默认 GB/T 7714-2015 顺序编码制，同一文献同号，编号由桥统一派生。
- 在**光标所在位置**插入参考文献表（可只保留条目列表、不带标题行），正文增删引用后一键刷新重排。
- **交叉引用**：顺序编码制下正文 `[1]` 是 Word 原生交叉引用域（REF + 书签），Ctrl+点击跳到文献表条目，Word「更新域」也能重算。
- 切换引用样式：GB/T 7714-2015 顺序编码制、GB 7714-87 顺序编码制（CAJ-CD，可选全角/半角标点）、GB/T 7714-2015 著者-出版年、APA 7、IEEE。
- 单条引用的页码/前后缀/隐藏作者。
- 「取消链接」：把域变成普通文字，交出对文档的完全控制权。
- 唯一写入：把「某文献被哪些 Word 文档引用过」记录回文献库（可关闭）。

数据不出本机：加载项只访问 `127.0.0.1` 上由 PaperQuay 主进程开出的**只读**桥。

## 2. 架构

```
Word 加载项（office-addin/）
   │  ① 页面由本机源站托管（officeAddinHost.cjs，https://localhost:3000，回退 http://localhost:3007）
   │  ② Bearer token 调用本地只读桥
   ▼
Office 桥（electron/backend/officeBridge.cjs，127.0.0.1:23120 起）
   │  ③ 只读查询 SQLite；唯一写入是 paper_citations 表
   ▼
引用格式化真源（src/shared/citation/）
   └─ esbuild → electron/generated/citationFormatters.cjs（主进程 / 桥）
              → office-addin/dist/citation-shared.js（加载项浏览器环境）
```

- **格式化真源唯一**：笔记工作区、Obsidian vault 导出、MCP、Office 桥与加载项共用 `src/shared/citation/`。加载项不自己实现格式规则，只渲染桥返回的文本，因此改格式规则不会出现两侧不一致。
- **桥与页面源站都是主进程的一部分**：随 PaperQuay 启动（`app.whenReady()` 后），随退出关闭（`app.on('before-quit')`）。Word 加载项本身不读数据库、不碰文件系统。
- **exe 安装器不常驻进程**：它只做三件本地设置——生成/复用 localhost 自签证书、按实际端口写出清单、注册侧载注册表键（见下文安装节）；页面始终由运行中的 PaperQuay 本体提供。

## 3. 安装（Windows 桌面版）

### 3.1 exe 安装器（推荐给使用者）

Release 里附带 `PaperQuay-OfficeAddin-Setup-<版本>.exe`（或自行 `npm run office-addin:installer` 编译，只依赖 Windows 自带的 .NET Framework 4.x csc，无需 .NET SDK）。

- **双击运行**（图形界面）：默认生成/复用自签证书 → 写入清单到 `%LOCALAPPDATA%\PaperQuay\OfficeAddin\manifest.xml` → 注册侧载键 `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` → 可选导入证书到「受信任的根证书颁发机构（当前用户）」。全部只动当前用户，**不需要管理员权限**。
- **命令行**：`--silent` 静默安装（`--no-trust` 跳过证书信任）、`--http` 改用 HTTP 回退源站、`--diagnose` 只读诊断（不改动任何设置）、`--uninstall` 卸载、`--https-port/--http-port` 换端口、`--help` 查看全部参数。源码：`office-addin/installer/PaperQuayOfficeAddinInstaller.cs`。
- 安装后**保持 PaperQuay 运行**（页面源站与桥随应用启停），重启 Word，在「开始」选项卡应能看到 PaperQuay 分组与「插入引用」按钮。
- 要求 PaperQuay 本体 ≥ 本次引入 Office 桥的版本（0.3.0 起）；旧版本体没有页面源站与桥，加载项会连不上。

### 3.2 开发者路径（脚本侧载）

```powershell
npm ci
npm run build                  # 先产出 electron/generated 与 office-addin/dist
npm run office-addin:build     # 加载项资源 + 图标（-- -SkipIcons 可跳过图标）
npm run office-addin:serve     # 起本地 HTTPS 服务（默认 https://localhost:3000）
npm run office-addin:install   # 侧载到 Word（写 HKCU 开发者加载项目录）
npm run office-addin:smoke     # 可选：不开 Word，直接验证桥 + 检索 + 渲染输出
```

要点：

- `office-addin:serve` 是给**开发**用的独立静态服务（调试加载项页面时不必启动整个应用）；日常使用由 PaperQuay 本体托管页面，无需此脚本。首次运行会用 PowerShell `New-SelfSignedCertificate` 生成自签证书（`office-addin/.certs/paperquay-addin.pfx`，三年有效）。Word 会校验证书链，**首次需要把证书装进「受信任的根证书颁发机构」**才不报错；也可以：
  - `npm run office-addin:serve -- --trust` 自动导入信任；
  - `npm run office-addin:serve -- --http` 改用 `http://localhost:3000`（部分环境可用，不推荐）；
  - `--port 3007` 换端口，脚本会同步生成 `office-addin/manifest.local.xml`（把清单里的来源地址替换成实际地址）。
- `office-addin:install` 把清单路径写进 `HKCU:\Software\Microsoft\Office\16.0\WEF\Developer`，Word 重启后在「开始 → 加载项」或「插入 → 我的加载项」里出现。卸载用 `scripts/Install-OfficeAddin.ps1 -Uninstall`。
- 侧载用的是开发者加载项目录，不需要商店账号，也不影响正式版 Office。

## 4. 在 Word 里的使用流程

1. **连接**：PaperQuay → 设置 → 「文库与 Zotero」→ 底部的「Word 加载项（Office 桥）」分区 → 确认「运行中」→ 点「复制连接信息」（形如 `23120:3f9c…`）→ 粘进加载项顶部的连接框 → 「连接」。连接信息含本机端口与令牌，等价于本机密码，不要外传。
2. **选样式**：加载项「引用样式」下拉（默认 GB/T 7714-2015 顺序编码制）→「应用到文档」。样式存在文档里，换机器打开仍保持。
3. **检索**：输入标题/作者/关键词 → 「检索」→ 从结果里勾选（可多选，一次插入同一组引用）。
4. **插入引用**：可填页码（`12` 或 `12-15`）、前缀（如「参见」）、后缀、隐藏作者 → 「插入引用」。插入的是一段带域的文本，正文里看起来就是 `[1]`。
5. **插入参考文献表**：把光标放在要插表的位置（通常是文末的空行）→「插入参考文献表」。表是一个域：光标落在非空段落时会自动另起新段；已存在表时原位刷新，与光标位置无关。标题默认为「参考文献」，可改文案，也可关掉「含标题行」只保留条目列表。
6. **上标引用**：「引用样式」卡里的「正文引用以上标形式插入」开关（仅顺序编码制生效），选择随文档保存，切换后自动刷新全文。
6. **刷新**：改过正文引用顺序、删掉某条引用、或改了样式之后点「刷新」，全文编号与参考文献表会重算。加载项在插入/删除后也会自动刷新一次。
7. **取消链接**：交付终稿前可用「取消链接」把全文引用域和参考文献表变成普通文字（此后不能再刷新）。
8. **本文引用**：加载项下半部分是本文引用列表，可直接定位/删除单条引用；开启回写后，这里记录的文献会在 PaperQuay 的「本文引用过」里可查（`office_list_citations`）。

## 5. 设置项

设置存在文献库设置的 `officeAddin` 键下（`library.settings.officeAddin`）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 随应用启动桥。关闭后加载项无法连接。 |
| `port` | `23120` | 起始端口，被占用时最多向后顺延 9 个（23120–23129）。改后需「重启桥」。 |
| `allowWriteBack` | `true` | 是否允许 `POST /documents/cited` 回写「本文引用过」。关闭后该端点返回 403 `WRITE_DISABLED`。 |
| `allowedOrigins` | `[]` | 额外允许的加载项来源。默认已允许 `https://localhost:3000`、`http://localhost:3000`、`https://127.0.0.1:3000`。 |

主进程侧命令：`office_get_status`、`office_start_bridge`、`office_stop_bridge`、`office_restart_bridge`、`office_list_citations`、`office_reveal_discovery_file`、`office_trust_addin_certificate`（生成并信任页面源站证书）、`office_reveal_addin_source`（定位清单/源目录）。

页面源站设置存在 `officeAddin.source` 键下：`enabled`（默认开）、`httpsPort`（默认 3000）、`httpPort`（默认 3007）、`allowHttpFallback`（默认开）。改端口后点「重启桥」生效，且必须用 exe 安装器或 `office-addin:install` 让清单里的地址与新端口一致。

## 6. 桥接口契约（apiVersion 1）

- 地址：`http://127.0.0.1:<port>`，仅监听回环地址。
- 鉴权：除 `GET /health` 外都需要 `Authorization: Bearer <token>`；token 每次启动随机生成（`crypto.randomBytes(24)`）。
- 发现文件：`<userData>/PaperQuay/paperquay-office-bridge.json`（权限 0600），内容是 `{ name, port, token, apiVersion, appVersion, pid, startedAt, url }`。桥停止时只删自己写的那份（比对 `pid` 与 `port`）。
- 响应：JSON；错误统一 `{ "error": { "code": "…", "message": "…" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 可匿名。返回 `ok/name/apiVersion/appVersion/port/pid/startedAt/authorized/authRequired/capabilities`；`capabilities` 含 `citations`、`styles`、`defaultStyle`、`writeBack`。带错 token 会得到 401。 |
| GET | `/papers` | `search`、`categoryId`、`tagId`、`sortBy`、`sortDirection`、`limit`（默认 50，上限 200）、`offset`。返回 `{ papers, total, offset, limit }`。 |
| GET | `/papers/:id` | 单篇文献；不存在返回 `UNKNOWN_PAPER`。 |
| GET | `/categories` | `{ categories: [{ id, name, parentId, paperCount, isSystem, systemKey }] }`。 |
| GET | `/styles` | `{ defaultStyle, styles: [{ id, label, labelEn, kind, description }] }`。 |
| POST | `/citations/render` | 入参 `{ style, locale, items?, groups?, bibliographyTitle?, bibliographyOrder? }`：`items` 为单组插入，`groups` 为全文刷新（按文档顺序）。返回 `{ style, kind, inline, groups, entries, bibliography, bibliographyTitle, missingPaperIds }`。 |
| POST | `/documents/cited` | 唯一写入路径。入参 `{ documentId, documentTitle?, paperIds, citedAt?, source? }`，按（文献, 文档）去重 upsert 到 `paper_citations`；`allowWriteBack=false` 时 403。 |

错误码：`UNAUTHORIZED`、`FORBIDDEN_ORIGIN`、`METHOD_NOT_ALLOWED`、`NOT_FOUND`、`BAD_REQUEST`、`UNKNOWN_PAPER`、`LIBRARY_NOT_READY`、`WRITE_DISABLED`、`INTERNAL`。

CORS：只有请求带 `Origin` 时才校验白名单，响应带 `Vary: Origin`（绝不使用 `*`）；未知来源返回 403 且不带 `Access-Control-Allow-Origin`；`OPTIONS` 预检返回 204。

## 7. Word 文档模型

- **引用域**：每个引用是独立 ContentControl，`tag = pq:c|<citeId>`（短标签，规避 `ContentControl.tag` 的 64 字符上限）。域里的文本就是引用文本（如 `[1]` 或 `[1-3]`）。控件外观设为 Hidden——不显示 Word 的内容控件边框，视觉上与普通文字一致，但保留域身份，可刷新、可取消链接；顺序编码制下可选上标呈现。
- **交叉引用（顺序编码制）**：开启后，文献表条目序号包在书签 `r_<paperId>` 里，正文引用重建为 `REF <书签> \h` 域（显示缓存的序号文本；Ctrl+点击跳转；Word 的「更新域」可原生重算）。仅当文档里已有文献表时启用；文献表被删后刷新自动退回纯文本，重新插入表后刷新又升级，自修复。著者-出版年制无序号，不做交叉引用。
- **参考文献域**：`tag = pq:bib` 的单个 ContentControl；标题单独一段，默认「参考文献」。
- **明细存在文档设置里**（`Office.context.document.settings`）：

| 键 | 内容 |
| --- | --- |
| `pq:style` | 当前引用样式 id |
| `pq:locale` | 语言 |
| `pq:schemaVersion` | 文档模型版本（当前 `1`） |
| `pq:citations` | `[{ citeId, items: [{ paperId, label, locator, prefix, suffix, suppressAuthor }], updatedAt }]` |
| `pq:citedPaperIds` | 本文引用过的文献 id 列表（用于回写） |
| `pq:bibControlId` | 参考文献域的 id |
| `pq:documentTitle` | 文档标题（回写用） |
| `pq:documentId` | 本文的稳定 id（回写用；加载项首次生成后写入） |
| `pq:bibliographyTitle` | 参考文献表标题文案 |
| `pq:bibHeading` | 文献表是否含标题行（`'0'` 为只有列表；默认含） |
| `pq:superscript` | 顺序编码制正文引用是否上标（`'1'` 为上标；默认否） |
| `pq:punctuation` | GB 7714-87 标点风格（`'full'` 全角紧凑，默认；`'half'` 半角带空格） |
| `pq:crossref` | 顺序编码制正文引用是否与文献表建立交叉引用（`'0'` 关闭；默认开） |

- **刷新算法**：Office.js 没有字符偏移，`body.contentControls` 的顺序也没有文档保证，因此加载项用 `body.getOoxml()` 读一次全文 XML，用 `extractCitationControlTagsFromOoxml` 按**真实文档顺序**取出 citeId 序列，作为 `groups` 发给桥；桥按该顺序派生编号后返回每个域的文本，加载项按 tag 匹配逐个写回（写回与顺序无关）。这样"在中间补一条，全文重排"是准确的。
- 编号规则：numeric 样式按引用**首次出现顺序**编号（同一文献同号），连续编号折叠为 `[1-3]`；author-date 样式的文末表默认按首作者姓氏字母序（可用 `bibliographyOrder: 'appearance'` 改为按出现顺序）。

## 8. 已知限制

- **修订模式**：Word 打开修订（Track Changes）时写入会被记录为修订，也可能被拒绝。请在关闭修订时插入/刷新。
- **仅 `.docx`**：不支持 `.doc`（二进制格式）与受保护的文档；文档受保护或只读时无法插入域。
- **共同编辑**：多人同时编辑时，各端的刷新互相看不到对方的中间状态，可能出现编号不一致；建议同一时间只有一人刷新。
- **样式切换会改变文献表顺序**（顺序编码制 ↔ 著者-出版年），这是格式定义决定的，不是缺陷。
- 尚未实现：任意 CSL 样式（citeproc-js）、按样式规则本地化的页码格式（`chap.`/`p.` 之外的写法）、WPS/LibreOffice、Word on the web 的公网托管静态站点（当前页面由本机 PaperQuay 托管，Word on the web 访问不到）。
- 数值容错：`src/shared/citation` 的 `cleanPart` 会把有限数字（年份、卷、期、页）按文本处理，避免导入链路给数字时字段被静默丢弃。

## 9. 开发与验证

新增/主要文件：

| 路径 | 作用 |
| --- | --- |
| `src/shared/citation/*.ts` | 格式化与文档模型的唯一真源（`types/text/styles/numbering/documentTags/format`） |
| `scripts/build-citation.mjs` | esbuild 产出 `electron/generated/citationFormatters.cjs` 与 `office-addin/dist/citation-shared.js` |
| `electron/backend/officeBridge.cjs` | 本地只读桥（HTTP + 鉴权 + CORS + 发现文件） |
| `electron/backend/officeAddinHost.cjs` | 加载项页面源站（只绑 127.0.0.1、证书查找/生成、随应用启停） |
| `electron/backend/officeCommands.cjs` | 桥与源站的 IPC 生命周期命令 |
| `src/services/officeAddin.ts`、`src/features/literature/components/OfficeAddinSection.tsx` | 渲染层封装与设置界面 |
| `office-addin/` | 加载项子工程：`manifest.xml`、`taskpane.html/css/js`、`commands.html`、`assets/` |
| `office-addin/installer/PaperQuayOfficeAddinInstaller.cs` | exe 安装器源码（单文件 WinForms，C# 5 语法，Framework csc 直接编译） |
| `scripts/Build-OfficeAddinInstaller.ps1` | 编译安装器：内嵌清单与图标 → `release/PaperQuay-OfficeAddin-Setup-<版本>.exe` |
| `scripts/office-addin-server.mjs` | 开发用本地 HTTPS/HTTP 静态服务 + `manifest.local.xml` 生成 |
| `scripts/{Build,Install}-OfficeAddin.ps1`、`scripts/generate-office-addin-icons.mjs` | 资源构建、侧载、图标生成 |
| `scripts/office-addin-smoke.mjs` | 不开 Word 的桥冒烟脚本（读发现文件 → `/health` → `/papers` → `/citations/render`） |

**改了 `src/shared/citation/` 就必须重新构建产物**：`npm run build:citation`。测试里的沙箱用例直接加载 `office-addin/dist/citation-shared.js`，产物不重建会测到旧逻辑。

验证：

- `npm run build`（含 `build:citation`）+ `npm test` 必须全绿（当前 530 例通过）。
- `tests/officeBridge.test.ts`：鉴权、CORS、错误码、检索分页、render 的顺序编号与同文献同号、`/documents/cited` 写回与关闭写入。
- `tests/officeAddin.test.ts`：清单与资源一致性（含图标尺寸）、taskpane 用到的共享成员都存在、沙箱内完成一次 GB/T 渲染、文档设置往返、exe 安装器源码/构建脚本与清单约定一致。
- `tests/citationFormat.test.ts`、`tests/bibliography.test.ts`、`tests/noteVault.test.ts`：三种样式与笔记/vault 侧一致性。
- `npm run office-addin:smoke`（桥冒烟，需 PaperQuay 正在运行且已「启动桥」）：自动读发现文件（或用 `--port/--token`/`--discovery` 指定），依次打 `/health`、`/papers`、`/citations/render`，打印真实文献库的编号与文献表；退出码 2=找不到发现文件、3=桥不可达、4=库为空、5=渲染失败。可用 `--style apa7`、`--search 关键词`、`--paper-id <id>` 调整。
- 手工回归：Word 桌面版插入 3 条 → 在光标处插入参考文献表 → 中间补一条 → 刷新 → 编号重排 → 关闭重开文档后仍可刷新 → 上标开关 → 含标题行开关。

## 10. 排障

| 现象 | 原因与处理 |
| --- | --- |
| 加载项报「连接令牌不正确」 | 桥重启后 token 变了。回 PaperQuay 设置里重新「复制连接信息」。 |
| 加载项连不上（Failed to fetch） | 桥没启动（设置里点「启动桥」）；或端口被防火墙拦；确认 `GET http://127.0.0.1:<port>/health` 能返回 JSON。 |
| 403 `FORBIDDEN_ORIGIN` | 加载项来源不在白名单。把实际来源（如 `https://localhost:3007`）加进「额外的加载项来源白名单」。 |
| Word 提示证书不受信任 | exe 安装器勾选「信任证书」重跑一次，或点 PaperQuay 设置页「信任本地证书」；开发者路径用 `npm run office-addin:serve -- --trust`。 |
| 证书已信任但 Word 仍报证书错误 | 源站只在启动时读取证书：若安装器在 PaperQuay 运行期间换过证书，正在运行的应用仍持旧证书。在设置页点「重启桥」（或重启 PaperQuay）让源站换用安装器目录里的证书。 |
| Word 里看不到加载项 | 侧载注册表项不在（重跑 exe 安装器或 `office-addin:install`），或清单来源地址与源站端口不一致（用 exe 安装器 `--https-port` 重写清单；开发者路径确认侧载的是 `manifest.local.xml`）。可用 `--diagnose` 逐项排查。 |
| 想确认安装状态 | 运行 `PaperQuay-OfficeAddin-Setup-<版本>.exe --diagnose`：只读检查清单、注册表、证书信任、页面源站与桥的可达性。 |
| 刷新没反应 | 文档处于修订模式或受保护；先关闭修订再刷新。 |
| 参考文献表缺条目 | 该文献在桥返回里被判为缺失（源文献被删）——条目会用插入时的标题快照兜底，`missingPaperIds` 会列出这些 id。 |
