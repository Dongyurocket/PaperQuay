# 2026-09-25 PaperQuay Office 插件（Word 文献引用）方案

> 相关文档：[引用样式真源 `src/features/notes/bibliography.ts`](../../src/features/notes/bibliography.ts) ·
> [笔记系统痛点方案](./2026-09-24-notes-system-painpoints-and-solutions.md) ·
> [MCP 接入指南](../MCP_AGENT_INTEGRATION.md)

- 日期：2026-09-25
- 状态：**P0 已实施**（2026-09-25；Word 加载项、本地只读 HTTP 桥、共享引用真源、文献「出版地」字段、`/documents/cited` 回写均已落地；使用与接口说明见 [`docs/OFFICE_ADDIN.zh-CN.md`](../OFFICE_ADDIN.zh-CN.md)，变更记录见 [`docs/changes/2026-09-25-office-word-addin-citations.md`](../changes/2026-09-25-office-word-addin-citations.md)）。分发采用与 D4 不同的最终形态：页面源站由 PaperQuay 本体托管（`electron/backend/officeAddinHost.cjs`），并提供 **exe 安装器**（`office-addin/installer/PaperQuayOfficeAddinInstaller.cs` + `npm run office-addin:installer` → `release/PaperQuay-OfficeAddin-Setup-<版本>.exe`）一键完成证书、清单与侧载注册，不常驻进程、无需管理员权限。按批准范围**仅适配 Microsoft Word**，原 P2 的 WPS / LibreOffice 不做；citeproc-js + CSL 仍属未做的后续项。
- 范围：新增 `office-addin/`（Word 加载项）、新增 `electron/backend/officeBridge.cjs`（本地只读 HTTP 桥）、新增共享引用格式化模块、PaperQuay 设置页新增"Office 插件"分区
- 参考实现：Zotero（本地 HTTP 服务 + 文档内可刷新引用域 + 文档级 preferences）
- 目标一句话：在 Word 里获得 Zotero 级别的写作用引用体验 —— 搜库、插引用、生成/更新文末文献列表，**默认 GB/T 7714-2015 顺序编码制**

---

## 摘要（决策一览）

| # | 决策点 | 推荐方案 | 备选 | 理由 |
|---|--------|----------|------|------|
| D1 | 插件载体 | **Office.js Web 加载项（任务窗格）** | VBA `.dotm`（Zotero 经典做法）/ VSTO | 一套代码覆盖 Word Windows/Mac/Web；Office.js 是唯一官方跨平台路径；VBA 有宏安全提示且仅 Windows 桌面 |
| D2 | 引用引擎 | **P0 复用现有格式化器，P1 引入 citeproc-js + CSL** | 一步到位 citeproc-js | 仓库已有 GB/T 7714/APA/IEEE 真源且已被 480 例测试覆盖，先落地链路再扩样式，避免一次性引入 CSL 映射风险 |
| D3 | 数据通道 | **本地 HTTP 桥（127.0.0.1 + Bearer token）** | ① 静态导出 `.bib`/CSL-JSON 给插件解析 ② 插件直连 SQLite（浏览器环境不可行） | 浏览器 app 无法走 stdio MCP 或 Electron IPC；Zotero 同款先例；静态导出模式保留为降级方案（见 §9.3） |
| D4 | 资源托管 | **GitHub Pages 托管插件静态资源 + 侧载脚本** | 纯本地文件夹侧载 / AppSource | 个人 Fork 已在用 GitHub Releases；Pages 顺带解决 Word on the web 必须 HTTPS 的硬要求；不上架市场 |
| D5 | 库写入 | **默认只读；仅"标记本文引用过"走护栏写入（P1）** | 全只读 | 运行中的桌面应用 `store.save()` 是全量重写，外部写入必须走 `assertWritable` 护栏，否则静默丢数据 |
| D6 | WPS | **P2 适配层** | P0 一并支持 | WPS 加载项 API 与 Office.js 不同且有版本门槛，先用 `DocumentAdapter` 接口把位置留出来 |
| D7 | 默认样式 | **GB/T 7714-2015 顺序编码制（numeric，`[n]`）** | 著者-出版年制 | 与笔记侧默认一致（`normalizeNoteCitationStyle` 回退 `gbt7714`） |

---

## 1. 目标与非目标

**目标（P0 验收面）**

1. Word 任务窗格可连接 PaperQuay，按标题/作者/年份/分类/标签检索本地文献库。
2. 光标处插入引用：单篇、多篇一次插入；同一文献多处引用同号。
3. 一键插入文末"参考文献"列表，编号与正文引用一致，默认 GB/T 7714-2015 顺序编码制。
4. 中间插入引用后**刷新**，全文编号与文献列表重排（Zotero 的 Refresh 语义）。
5. 引用可取消链接（转为纯文本）；文档关闭重开后引用仍可刷新。

**非目标**

- 不替代笔记编辑器内的引用体系（`paperReference` 节点仍走 `noteReferences.ts`），但两者必须共用同一格式化真源。
- 不做 AppSource 上架、不做云端同步、不上传文档内容。
- P0 不做 PDF 批注引用、不做 "cited by" 统计、不做团队共享库。

---

## 2. 现状与可复用资产（代码证据）

| 资产 | 位置 | 复用方式 |
|------|------|----------|
| 引用格式化真源 | `src/features/notes/bibliography.ts:216-230` `formatBibliographyEntry(paper, fallbackLabel, style)` | 直接作为桥的格式化实现；样式 id 沿用 `gbt7714/apa7/ieee` |
| 默认样式语义 | `src/features/notes/bibliography.ts:17-18` `normalizeNoteCitationStyle` 未知值回退 `gbt7714` | 插件端样式 id 校验同规则 |
| GB/T 类型标志 | `src/features/notes/bibliography.ts:111-131` `[J]/[C]/[M]/[D]/[R]/[EB/OL]` | 保留，作为与 citeproc-js 对比的回归基线 |
| 作者截断规则 | `src/features/notes/bibliography.ts:56-62` 至多 3 位 + `等`/`et al.` | 保留 |
| 引用派生语义 | `src/features/notes/noteReferences.ts:62-78` 首次出现排序 + paperId 去重 + 编号实时派生不落盘 | Word 侧必须实现同语义（编号由文档顺序派生，不写进文档数据） |
| 文献数据模型 | `src/types/library.ts:71-104` `LiteraturePaper`（含 `itemType/publisher/institution/volume/issue/pages/isbn/issn`） | 桥的出参直接复用它，前端无需二次映射 |
| 作者姓/名分立 | `src/types/library.ts:19-25` `LiteratureAuthor.familyName/givenName` | 修 GB/T 西文作者"姓 + 名首字母"用（见 §7.2） |
| 库检索参数 | `src/types/library.ts:153-161` `ListPapersRequest`（search/sortBy/limit/offset） | 桥的 `/papers` 查询契约对齐 |
| 只读打开 SQLite | `electron/mcp/knowledgeMcpService.cjs:123` `openReadOnlyDb()` | 桥复用该模式，避免与运行中应用的内存库冲突 |
| 写入护栏 | `electron/mcp/knowledgeMcpService.cjs:1434-1455` `assertWritable` / `withWritableLibrary` | D5 的唯一写通道 |
| BibTeX 导出 | `src/utils/bibtex.ts:309` `papersToBibtex` / `:187` `paperToBibtexEntry` | 降级模式（§9.3）与"导出给其他工具"复用 |

**关键缺口**：仓库目前**没有任何本地 HTTP 服务**——`electron/dev.cjs:1` 是唯一使用 `node:http` 的文件，`electron/main.cjs` 只注册 IPC。笔记方案里"本地 HTTP API"仍标记为缺口（`docs/plans/2026-09-24-notes-system-painpoints-and-solutions.md:219`）。本方案的桥建成后，同一份 API 可顺带补齐该缺口（外部 Agent / 笔记 vault 也可复用）。

---

## 3. 总体架构

```
┌──────────────────────────── Word / Word on the web ────────────────────────────┐
│  任务窗格（HTTPS 静态页，GitHub Pages 或本地侧载）                              │
│  ├─ 检索面板：搜库 / 分类筛选 / 多选                                            │
│  ├─ 引用操作：插入引用 · 插入文献列表 · 刷新 · 取消链接 · 样式切换              │
│  └─ src/doc/wordAdapter.ts  ←→  Word 文档（ContentControl 引用域 + 文档设置）   │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │  http://127.0.0.1:<port>   Authorization: Bearer <token>
                                │  （Chromium/WKWebView 视 localhost 为可信来源，不受混合内容拦截；需实测）
┌───────────────────────────────▼────────────────────────────────────────────────┐
│  PaperQuay Electron 主进程                                                      │
│  electron/backend/officeBridge.cjs   ← 新增                                     │
│  ├─ GET /health · /papers · /papers/:id · /categories · /styles                 │
│  ├─ POST /citations/render        （编号派生 + 引用文本 + 文献列表文本）        │
│  └─ POST /documents/cited         （P1，走 assertWritable 护栏）                │
│        ↓ 复用                                                                    │
│  libraryDatabaseStore.cjs / openReadOnlyDb  ·  citationFormatters（共享模块）   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**三份契约**（实现前先冻结，写进 `docs/OFFICE_ADDIN.zh-CN.md`）

1. **端点契约**：§5.4 的 HTTP API（版本号 `v1`，`/health` 返回 `apiVersion`）。
2. **文档内数据契约**：引用控件 tag 格式 + 文档级设置键（§6），决定引用能否刷新、能否跨人打开。
3. **样式契约**：style id + locale + 编号策略（numeric 顺序编码 / author-date）（§7.1）。

---

## 4. 载体选型：为什么是 Office.js Web 加载项

| 方案 | Windows 桌面 Word | Mac Word | Word on the web | WPS | 成本 | 结论 |
|------|------------------|----------|-----------------|-----|------|------|
| **Office.js Web 加载项** | ✅（WebView2） | ✅（WKWebView） | ✅ | 部分/待验证 | 一套 TS 代码 | **推荐** |
| VBA `.dotm` + 本地 HTTP | ✅（Zotero 经典） | ❌ | ❌ | ❌ | 宏安全提示、签名、维护差 | 不推荐（仅作 P2 应急） |
| VSTO/.NET 加载项 | ✅ | ❌ | ❌ | ❌ | 需签名与安装器 | 不推荐 |
| 静态文件模式（无桥） | ✅ | ✅ | ✅ | ✅ | 功能降级 | 保留为降级方案（§9.3） |

Zotero 的桌面集成走的是 Word 模板 + 本地 HTTP（`127.0.0.1:23119`）的路线；我们用 Office.js 承载 UI、用同样的本地 HTTP 取数据，等于把它的"本地服务"这一半保留、把"插件分发"这一半换成跨平台方案。

---

## 5. 本地 HTTP 桥（新组件）

### 5.1 文件与生命周期

- 新增 `electron/backend/officeBridge.cjs`，导出 `createOfficeBridge({ app, getLibrary })` 风格的工厂（与 `electron/backend.cjs` 其他命令模块一致）。
- 在 `electron/main.cjs:145` `app.whenReady()` 内启动，`before-quit` 关闭；启动失败**不阻塞应用**，只在设置页显示错误原因。
- 开关：设置项 `officeBridgeEnabled`（默认开），关闭后端口立即释放。

### 5.2 端口与发现

- 默认端口 **23120**（刻意避开 Zotero 的 23119）；被占用则 23121…23129 依次尝试，全失败则报告并可手动指定。
- 实际 `{ port, token, apiVersion, appVersion, pid }` 写入 `app.getPath('userData')/PaperQuay/paperquay-office-bridge.json`；设置页提供"复制连接信息"（一次性粘进插件）与"重置令牌"。
- 插件端 `src/bridge/discovery.ts`：优先读用户粘贴的 endpoint+token；P1 支持"从剪贴板自动填充 + 记住"。

### 5.3 安全

- 只绑 `127.0.0.1`（绝不 `0.0.0.0`）。
- `Authorization: Bearer <token>`，token 为 32 字节随机 hex，权限 0600；重置即失效所有插件实例。
- CORS **allowlist 白名单**（`https://127.0.0.1:*`、`https://localhost:*`、`https://<user>.github.io`、Office 宿主壳域），回显单一 Origin + `Vary: Origin`，**绝不用 `*`**；处理 `OPTIONS` 预检（预检不带 Authorization，靠 Origin 白名单）。
- 无遥测、无外联；桥默认只返回元数据与格式化文本，**不暴露 PDF、笔记正文、RAG 切片**（P2 若要"引用到具体页/批注"必须显式开关）。
- 插件页面严格 CSP、不引第三方脚本（Pages 托管时代码公开可审计，但页面本身不能被打进第三方 JS 读到 token）。

### 5.4 端点（`apiVersion: 1`）

| 方法 | 路径 | 入参 | 出参 |
|------|------|------|------|
| GET | `/health` | — | `{ app, appVersion, apiVersion, libraryReady, paperCount }` |
| GET | `/papers` | `query, categoryId, tagId, limit, offset` | `{ papers: LiteraturePaper-lite[], total }` |
| GET | `/papers/:id` | — | 单篇完整元数据 |
| GET | `/categories` | — | 分类树（供筛选下拉） |
| GET | `/styles` | — | `[{ id, label, kind: 'numeric'\|'author-date', default }]` |
| POST | `/citations/render` | `{ style, locale, items: [{ paperId, locator?, prefix?, suffix?, suppressAuthor? }] }` | `{ inline: string, entries: [{ paperId, seq, text }], bibliographyText: string }` |
| POST | `/documents/cited` | `{ paperIds }`（P1） | `{ marked: n }`，走 `withWritableLibrary` |

- `LiteraturePaper-lite`：`id/title/titleZh/authors/year/publication/itemType/doi/volume/issue/pages/publisher/institution/reportNumber/isbn/issn/url/citation` —— 恰好是 `formatBibliographyEntry` 所需字段，避免整库（含摘要）过网。
- **编号派生在桥里做**：服务端按传入 `items` 的顺序（= 文档出现顺序）首次出现编号、同 paperId 复用序号，返回带 `seq` 的条目；与 `noteReferences.ts:62-78` 的语义一致。
- 错误统一 `{ error: { code, message } }`：`UNAUTHORIZED` / `NOT_RUNNING`（插件连不上时）/ `LIBRARY_NOT_READY` / `UNKNOWN_PAPER`。插件对每种错误给可操作文案（如"请先启动 PaperQuay 桌面端"）。

### 5.5 并发与数据一致性

- 桥用**只读连接**读 SQLite（复用 `openReadOnlyDb` 模式）；不加载 `libraryStore` 的内存态，从根本上规避"运行中应用 `store.save()` 全量重写覆盖外部写入"。
- SQLite WAL 下只读连接可并发读，无需加锁；`/documents/cited` 是唯一写路径，且必须过 `assertWritable(allowWhileAppRunning)` 护栏（与 MCP 同款语义）。
- 单篇文献元数据写入若将来开放，必须走 UPSERT（`ON CONFLICT (id) DO UPDATE`）——`papers` 关联表（含 `paper_references`）是 `ON DELETE CASCADE`，`INSERT OR REPLACE` 会连带删除参考文献（AGENTS.md 红线）。

---

## 6. Word 侧文档模型（方案的核心）

Zotero 的引用之所以能"刷新重排"，是因为引用在文档里是**有身份的域**。Office.js 里等价物是 **Content Control（内容控件）**。

### 6.1 引用控件

- 每个引用（可含多篇） = 一个 `Word.ContentControl`：
  - `tag = "pq:c|<paperId>[|<locator>][|<prefix>][|<suffix>][|<flags>]"`，多篇用 `;` 分隔；`flags` 记录 `suppressAuthor`、上标等。
  - 控件内文本 = 桥返回的 `inline`（如 `[1-3]`、`(Smith et al., 2020)`）。
  - 视觉提示：控件标题（title）写 "PaperQuay 引用"，便于用户识别与卸载。
- tag 里**只放短标识**；完整 payload（样式、locale、完整条目快照）放**文档级设置**，避免 tag 长度失控。
- 冗余索引：所有引用过的 paperId 同时写进文档设置 `pq.citedIds`，即使某个控件被用户破坏也能重建文献列表（并可在刷新时提示"发现 N 个失效引用"）。

### 6.2 文献列表控件

- 文末列表 = 单个 `ContentControl`，`tag = "pq:bib"`，内容为按序编号的段落列表；标题段落固定文案"参考文献"（与笔记侧 `REFERENCE_LIST_HEADING` 一致）。
- 刷新时整体重写该控件内容，不散落成普通段落；重复点击"插入文献列表"时先查找已有 `pq:bib` 控件再替换。

### 6.3 文档级设置（相当于 Zotero 的 Document Preferences）

| 键 | 内容 |
|----|------|
| `pq:style` | 样式 id（默认 `gbt7714`） |
| `pq:locale` | `zh-CN` / `en-US` |
| `pq:version` | 文档模型版本（用于未来迁移） |
| `pq:citedIds` | 引用过的 paperId 数组 |
| `pq:bibControlId` | 文献列表控件 id |

写入 `Office.context.document.settings`（随文档保存）。样式切换改这里，然后一次刷新全文。

### 6.4 刷新算法

1. `document.body.contentControls` 递归（含表格、页眉页脚内的控件）筛 `pq:c|`。
2. 用 `range` 的**文档顺序**收集条目 → 调 `POST /citations/render`。
3. 逐个控件对比新 `inline` 文本：不同才写（减少撤销栈噪音）；编号变化导致几乎全变时按需多次写入。
4. 重写 `pq:bib` 控件为 `bibliographyText`。
5. 失败时**不静默**：在任务窗格顶部红色状态条显示原因（沿用仓库"失败必须显式暴露"的工程约定）。

### 6.5 已知限制（必须在文档里写明）

- **修订模式（Track Changes）**：写入会被记录为修订甚至被 Word 拒绝，需提示用户刷新前接受/关闭修订。
- 仅支持 `.docx`（`.doc` 不支持）。
- 受保护视图/受限编辑/只读文档不可写。
- 共同编辑（Co-authoring）下并发刷新可能冲突，提示"由一人刷新"。
- 上标形态（GB/T 顺序编码制允许 `[1]` 上标）作为样式选项：P1 实现对控件 range 设 `font.superscript`。

---

## 7. 样式与格式化契约

### 7.1 样式 id

| id | 呈现 | 列表排序 | 上线阶段 |
|----|------|----------|----------|
| `gbt7714`（默认） | 顺序编码 `[n]`，可上标 | **按引用顺序** | P0 |
| `apa7` | `(Smith et al., 2020)` | 作者字母序 | P1（桥已支持，需补排序策略） |
| `ieee` | `[n]` | 按引用顺序 | P1 |
| `gbt7714-author-date` | `(张三, 2020)` | 作者字母序 | P1（需新写格式化分支） |
| 任意 CSL | 由 `.csl` 决定 | 由 CSL 决定 | P2（citeproc-js） |

### 7.2 Word 场景必须修正的现有偏差（已核代码）

1. **列表顺序**：`formatBibliographyEntry` 只格式化单条，顺序由调用方决定；顺序编码制必须按引用顺序（笔记侧已按首次出现排序，桥需显式保证）。
2. **西文作者格式**：`formatAuthorsGbt`（`bibliography.ts:57-62`）直接用 `author.name` 拼接；GB/T 要求"姓 + 名首字母"，而模型里已有 `familyName/givenName`（`src/types/library.ts:19-25`）—— 改为优先用结构化字段、退化到 `name`。
3. **出版地缺失**：GB/T 专著格式为 `出版地: 出版者, 年`，而 `formatGbt7714`（`bibliography.ts:148-152`）只写 `出版者, 年`。决定：P1 给 `papers` 增可选列 `publisher_place`（幂等迁移，见 `libraryDatabaseStore.cjs` 既有列迁移模式），P0 先接受偏差并在文档注明。
4. **会议论文形态**：GB/T 为 `[C]//论文集名`，当前是 `[C]. 论文集名, 年`（`bibliography.ts:158-164`）—— P0 修正。
5. **`titleZh` 未使用**：中文文献可输出"中文题名 = 英文题名"的 GB/T 双题名形态；P2 再做。
6. **`noteVault.cjs` 已分叉**：`electron/backend/noteVault.cjs:246-248` 有一份"同规则精简移植"。本次引入共享模块时应把它收敛回真源，避免三处分叉。

### 7.3 共享模块与构建（关键工程决策）

真源是 TS（`src/features/notes/bibliography.ts`），而桥运行在 CJS 主进程。两条路：

- **(a) 推荐**：把格式化逻辑提到 `src/shared/citation/format.ts`（纯函数、无 DOM），用已有的 `esbuild` devDependency 加一个构建步骤产出 `electron/generated/citationFormatters.cjs`，桥 `require` 它；`noteVault.cjs`、笔记侧、桥三处共用同一实现。测试仍用 `node --test tests/*.test.ts`（直接测 TS 源）。
- (b) 继续沿用"精简移植"：已有先例，但会随样式增加持续分叉，且 GB/T 细节修正要改多处 —— 不推荐。

构建顺序须保证 `npm run build` 先生成 `electron/generated/*`；`electron-builder` 的 `files` 需包含该目录（`package.json:119-151`）。桥若在文件缺失时应给出明确安装损坏提示，而不是 `MODULE_NOT_FOUND`。

---

## 8. 仓库布局与分发

```
office-addin/                      # 独立子工程（不进根 workspaces，不影响 npm ci/build/test）
  manifest.xml                     # 加载项清单（含 Ribbon 按钮 → 任务窗格）
  package.json / vite.config.ts / tsconfig.json
  src/taskpane/{index.tsx, App.tsx, SearchPanel.tsx, CitationBar.tsx}
  src/bridge/{client.ts, discovery.ts, types.ts}
  src/doc/{adapter.ts, wordAdapter.ts, wpsAdapter.ts}   # WPS 在 P2
  src/doc/citationControl.ts        # tag 编解码 / 扫描 / 重写
electron/backend/officeBridge.cjs   # 本地桥（新增）
src/shared/citation/format.ts       # 共享格式化真源（新增，见 §7.3）
scripts/Install-OfficeAddin.ps1     # 侧载：复制清单/写注册表键
scripts/Build-OfficeAddin.ps1       # 产出 release/PaperQuay-office-addin-<ver>.zip
docs/OFFICE_ADDIN.zh-CN.md          # 用户安装与使用指南
```

- **侧载**（桌面 Word）：Windows 网络共享目录 + 受信任目录，或 `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` 指向清单路径；Mac 拷贝到 `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`。具体键值与目录以官方侧载文档为准，脚本需在真机回归。
- **托管**（Word on the web 必需 HTTPS）：`https://<owner>.github.io/PaperQuay/office-addin/`；清单与静态资源由 CI 在打 tag 时同步发布。
- **应用内一键安装**（P1）：设置页"Office 插件"分区提供"安装到 Word / 复制清单路径 / 打开安装指南"。
- 打包产物：`electron-builder` 用 `extraResources` 附带清单与脚本，Release 附一个 zip，用户不必进仓库取文件。
- 版本兼容：插件启动先 `GET /health`，比较 `apiVersion` 与 `appVersion`，不匹配则提示升级（沿用"更新源/Release"流程，见 `docs/RELEASE.md`）。

---

## 9. 备选与降级

### 9.1 若 WKWebView/WPS 拦截 `https → http://127.0.0.1`
Chromium 把 `localhost/127.0.0.1` 视为 potentially trustworthy，混合内容不拦；WKWebView 与 WPS 内嵌 webview 的行为**必须实测**（P0 第一件事）。若被拦，降级为 **HTTPS 桥**：PaperQuay 生成本地自签证书并引导信任，或走 `https://127.0.0.1:<port>` + 首次信任弹窗。

### 9.2 若 Office.js 能力不足（控件 API 在旧版 Word 缺失）
`WordApi 1.1~1.3` 是控件基础能力，覆盖率较高；仍不足时退到**书签 + 隐藏文本域**（Word field）方案，代价是刷新逻辑更脆。P0 先验证目标 Word 版本（Microsoft 365 桌面 + Web）。

### 9.3 静态文件降级模式（无桥也能用）
设置页"导出引用库"产出 CSL-JSON/BibTeX（复用 `papersToBibtex`），插件用文件选择器读入后本地格式化。功能少了"库实时检索/标为已引用"，但**零端口、零鉴权、零网络**，适合锁机房环境、WPS 与其他办公套件。留作 P2，同一 `DocumentAdapter` 复用。

---

## 10. 分期与工作量

| 阶段 | 内容 | 交付 | 估时 |
|------|------|------|------|
| **P0** MVP | 桥（`/health`/`/papers`/`/categories`/`/styles`/`/citations/render` + token + CORS + 端口发现）；插件（连接、检索、插引用、插入文献列表、刷新、取消链接）；GB/T 7714 顺序编码制；共享格式化模块 + 反分叉；侧载脚本与安装文档 | 能在 Word 桌面版完成"搜库 → 插 3 条引用 → 插入列表 → 中间补一条 → 刷新 → 编号重排" | 4–6 人日 |
| **P1** 好用 | 样式切换（APA 7/IEEE/GB-T 著者-出版年）、locator（页码/章节）、前后缀、抑制作者、上标、`/documents/cited` 回流"已引用"标记、Pages 托管（Word on the web）、设置页分区 + 一键安装 + 令牌管理、GB/T 偏差修正（会议论文/出版地列迁移） | 日常写论文可全程不碰 Zotero | 4–6 人日 |
| **P2** 扩展 | citeproc-js + CSL 任意样式（含导入 `.csl`）、WPS 适配、静态文件模式、LibreOffice `.oxt`、桥开放给笔记 vault/外部 Agent（补 2026-09-24 方案的"本地 HTTP API"缺口） | 生态化 | 视需求 |

**P0 完成定义（DoD）**：`npm run build` + `npm test` 全绿；新增桥与格式化的单测；三份契约写入 `docs/OFFICE_ADDIN.zh-CN.md`；README（中英）、`CHANGELOG.md`、`AGENTS.md` 项目地图同步；Word 桌面版手工回归通过。

---

## 11. 风险清单

| 风险 | 影响 | 缓解 |
|------|------|------|
| 混合内容/内嵌 webview 拦截本地 HTTP | 插件连不上 | P0 第一天实测 Windows/Mac；备选 HTTPS 桥（§9.1） |
| Office.js ContentControl 在目标 Word 版本行为差异 | 刷新失败/破坏文档 | 目标版本矩阵实测；tag+settings 双写冗余；破坏时可从 `pq:citedIds` 重建 |
| citeproc-js 引入（P2） | 许可证与体积 | 双许可 CPAL-1.0/AGPL-3.0 与仓库 AGPL-3.0-only 兼容；CSL 样式为 CC-BY-SA，需保留署名 |
| 端口占用/发现体验 | 用户配置成本 | 端口扫描 + 发现文件 + "复制连接信息"一键粘贴 |
| 运行中应用的库写入冲突 | 静默丢数据 | 桥只读；唯一写路径过护栏；禁止 `INSERT OR REPLACE` |
| 分叉的格式化实现 | 三处规则不一致 | §7.3 收敛到 `src/shared/citation` 单一真源 |
| WPS 支持不确定 | 国内用户覆盖受限 | P2 适配层 + 静态文件降级兜底 |
| CJK 标点与半/全角（`[1]` vs `［1］`）、作者-年份制标点 | 格式不合规 | 单测固化 GB/T 2015 样例；P2 交给 CSL |

---

## 12. 验证计划

**自动化**
- `tests/officeBridge.test.ts`（新建，纳入现有 `tests/*.test.ts` glob）：临时库 fixture 起桥 → 断言无 token 401、非白名单 Origin 无 CORS 头、`/papers` 检索与分页、`/citations/render` 的 GB/T 输出、同文献多引用同号、传入顺序 → 编号顺序、未知 paperId 的错误码。
- `tests/bibliography.test.ts`（扩展）：会议论文 `[C]//`、西文作者姓+名首字母（用 `familyName/givenName`）、列表排序策略。
- `npm run build` + `npm test` 保持全绿；`office-addin` 独立 `build`/`typecheck` 脚本。
- **[已实施]** 桥的端到端冒烟：`scripts/office-addin-smoke.mjs`（`npm run office-addin:smoke`）读发现文件后依次打 `/health`、`/papers`、`/citations/render`，不需要打开 Word；退出码区分「找不到发现文件 / 桥不可达 / 库为空 / 渲染失败」。

**手工矩阵**（记录在 `docs/changes/`）

| 环境 | 用例 |
|------|------|
| Word 365 Windows 桌面 | 侧载 → 连接 → 插单篇/多篇 → 插入列表 → 中间补引用 → 刷新 → 关闭重开 → 刷新 → 取消链接 → 导出 PDF |
| Word on the web | 同上（Pages 托管清单） |
| Word for Mac | 连接与刷新（若可测） |
| 异常路径 | PaperQuay 未启动 / 令牌错误 / 端口被占 / 库为空 / 文献被删除后刷新 / 修订模式开启 |
| WPS（P2） | 连接 + 插入 + 刷新 |

---

## 13. 需要拍板的问题

1. **D1 载体**：确认走 Office.js Web 加载项？（备选：仅 Windows 的 VBA 原生插件，可完全离线但不可跨平台）
2. **D2 引擎**：P0 复用现有 GB/T/APA/IEEE 格式化器、P1/P2 再上 citeproc-js —— 还是直接一步到位 CSL？
3. **D3/D4 分发**：接受"GitHub Pages 托管插件静态资源"？（否则 Word on the web 不可用，只能桌面侧载）
4. **D5**：P0 是否要"标记本文引用过（写回库）"？还是 P0 全只读？
5. **P0 范围**：是否接受"P0 只做 GB/T 7714 顺序编码制"，样式切换放 P1？
6. **WPS/Word on the web** 是否属于必须支持的场景（影响 D1/D4 与排期）？
