# 文库与阅读器界面精简优化计划

- 日期：2026-11-16
- 状态：**方案已确认（2026-11-16）**；决策见第 6 节。P0 + P1 已随 0.4.26 发布；P2（文库顶栏与筛选，含 MinerU 结果定位修正）已随 0.4.27 发布（记录见 `docs/changes/2026-11-16-ui-p2-library-toolbar-filters.md`）；P3a（元数据字段）与 P3（详情面板）已随 0.4.28 发布（记录见 `docs/changes/2026-11-17-p3-details-metadata.md`）；三者的安装版桌面验收已通过（用户确认，2026-11-17）；P4（概览页）已随 0.4.29 发布（记录见 `docs/changes/2026-11-17-p4-overview.md`），安装版桌面验收已通过（用户确认，2026-11-17）；第 0 步（概览小标题本地化、新手引导移除）、P5（阅读器顶栏与工具栏）与 P6（文档收尾）已随 0.4.30 发布（记录见 `docs/changes/2026-11-17-p5-reader-toolbar.md`），安装版桌面验收待用户安装此版本后完成
- 基线：`main` @ `fe647ec`（package.json 0.4.25），工作区干净
- 范围：文库顶部工具栏与筛选、右侧文献详情面板（含元数据编辑）、文献右键「打开所在位置」、阅读器助手栏黑色「+」按钮、论文概览页（含「每次都要点生成概览」缺陷）、阅读模式顶部栏与工具栏
- 依据：`docs/ui-design-system.md`（令牌、圆角、按钮变体、Menu 唯一实现）；`AGENTS.md` 红线（不改 RAG schema、不写真实文库、不擅自提交/发版）
- 调研方式：6 路并行源码调研 + 1 路抽查复核，关键结论已二次核对行号（见各节「证据」）

---

## 0. 需求理解

把用户这次的诉求拆成 8 项。原标 ⚠ 的理解已于 2026-11-16 确认：「更眼睛风格」= **更精致 / 更现代**。

| # | 用户原话要点 | 理解为 | 性质 |
| --- | --- | --- | --- |
| R1 | 第一幅图（文库顶栏）功能整合优化，筛选更全面、简单易操作 | 顶栏从 8 个同权重控件收成「搜索 + 筛选 + 排序 + 视图 + 导入 + 更多」；新增多维筛选（收藏、阅读状态、年份、类型、标签、附件、处理状态、来源），并显示已生效筛选条与一键清除 | UI + 后端查询扩展 |
| R2 | 第二幅图（详情面板）更简洁、「更眼睛风格」、更紧凑、更好操作，尤其编辑元数据；功能整合并补缺 | 已确认为「更精致 / 更现代」的风格（低饱和、细边框、少卡片嵌套、信息密度高）。四个大处理卡片收成状态条；编辑改为分组表单 + 行内快速编辑；补齐 DOI/URL/年份展示、复制引用/BibTeX、按 DOI 重新识别（差异预览）、作者列表编辑、标签补全、字段校验 | UI + 少量纯函数 |
| R3 | 右键文献可打开 PDF、Markdown 等数据所在位置 | 右键菜单新增「打开所在位置」组：原始 PDF、译版 PDF、MinerU 结果文件夹、Markdown（full.md），外加「复制路径」；详情面板的「更多」菜单复用同一组 | 需新增受限 IPC |
| R4 | 黑色加号在日间模式很难看 | 助手栏「新建会话」按钮改为令牌化样式，顺带清理全仓同类「黑底按钮」 | 纯样式 |
| R5 | 概览每次要点「生成概览」才显示 | **缺陷**：阅读器打开时从不被动读取磁盘上的概览缓存 | 逻辑修复 |
| R6 | 概览这块 UI 也要优化 | 修标题被挤成一词一行；按钮分主次；去掉 6 处重复的「概览」字样；右侧信息卡改紧凑列表 | UI |
| R7 | 阅读时上面的 UI 真丑 | 顶部 4 层「装饰带」（标题栏 / PDF 工具栏 / 结构化阅读工具栏 / 底部状态栏 ≈250px）压成 1 条细栏 + 每窗格 1 条紧凑工具行 | UI |
| R8 | 补进计划文档，重新给一份 prompt | 本文档 + `docs/plans/2026-11-16-library-reader-ui-handoff-prompt.md` | 文档 |

调研顺带发现 2 个**非 UI 的真缺陷**，并入 P0：

- B1 `resolveSelectedPapers` 闭包过期：依赖数组漏了 `ragMembershipFilter`，「全选 + 批量操作」可能按旧的知识库筛选解析（`LiteratureLibraryView.tsx:564-566` 读取，`:590` 依赖缺失）。
- B2 阅读器打开时把 `summary: null` 同步回文库预览状态，会覆盖文库侧已缓存的概览（`DocumentReaderTab.tsx:893-902` → `useReaderLibraryPreview.ts:286-294` 用 `hasOwnProperty('summary')` 判定）。这是 R5 的加重因素。

---

## 1. 现状与根因（证据）

### 1.1 文库顶栏（R1）

- 位置：`src/features/literature/components/LiteraturePaperList.tsx:489-618`，一行 `flex-wrap` 放 8 个控件：全选、搜索、排序 select（9 项）、知识库 select、标题显示 select、导入 PDF、存储体检、刷新；下方固定一行状态文字（`:611-617`）。
- 状态在 `LiteratureLibraryView.tsx`：`searchQuery :396`、`ragMembershipFilter :397`（均不持久化）、`paperSort :427`（持久化 `paperquay-literature-paper-sort-v1`）、`titleDisplayMode :428`（持久化 `-title-display-v1`）。
- 唯一的「筛选」是知识库成员。后端 `electron/backend/libraryQuery.cjs` `buildLibraryFilter :39-114` 已支持 `tagId`，但前端没有入口；`libraryOrderClause :120-140` 已支持 `lastReadAt` 排序，前端选项里没有。
- 查询请求对象在 `LiteratureLibraryView.tsx` 里手抄了 6 份（`:559 :622 :816 :850 :2135 :2925`），每加一个筛选都要改 6 处。
- 可直接用于筛选、**无需改 schema** 的列（`libraryDatabaseStore.cjs:44-124`）：`is_favorite`、`item_type`、`year`、`last_read_at`、`reading_progress`、`ai_summary`、`source`、`attachments.kind/language/missing`。
- 不能直接 SQL 过滤的：MinerU 是否已解析（由文件存在性推导，`literatureLibraryUtils.ts:252-316`）、RAG 是否已索引（在 RAG 库）。

### 1.2 详情面板（R2）

- `src/features/literature/components/LiteraturePaperDetails.tsx`（1394 行，无组件测试），由 `LiteratureLibraryView.tsx:3349-3369` 挂载。
- 自上而下：装饰性标题栏「文献详情 / 已选择文献」(`:645-662`) → 标题/作者 → 收藏 + 编辑 → 整宽「打开阅读」→ 知识库卡 → 文档处理卡（3 个大 tile + 译版 PDF 区 + 进度卡，`:762-920`）→ 元信息 `<dl>` → 阅读时间图 → 关键词 → 标签 → AI 概览 → 用户笔记。
- 只读态**不显示**年份、DOI、URL、摘要、引用信息（`:1192-1240`）；DOI/URL 不可点。
- 编辑态（`:930-1189`）21 个字段平铺无分组；作者是逗号分隔单行文本；标签是逗号文本；`handleSave :578-608` **无任何校验**；切换文献时直接丢弃草稿（`:558-563`）。
- 「重新识别元数据」只在列表右键菜单里有（`LiteratureLibraryView.tsx:3022-3029`），详情面板没有入口。
- 已有可复用件：`lookupLiteratureMetadata`（`src/services/metadata.ts:23`）、`buildManualMetadataUpdateRequest`（`LiteratureLibraryView.tsx:200-260`）、`paperToBibtexEntry`（`src/utils/bibtex.ts:187`）、`formatBibliographyEntry`（`src/features/notes/bibliography.ts:232`）。
- 硬编码颜色残留：`#8a8f94`(`:654`)、`bg-white/65`(`:691`)、`bg-white/80`(`:484`)、`bg-white/54`(`:1310`) 等。

### 1.3 右键打开所在位置（R3）

- 右键菜单已存在：`paperContextMenuEntries`（`LiteratureLibraryView.tsx:2992-3077`），项为收藏、加标签、解析元数据、知识库、RAG 索引、删除；用 `src/ui/menu.tsx` 的 `Menu` 渲染（`:3417-3424`）。`Menu` 无子菜单、无键盘导航。
- **后端没有通用的「在文件夹中显示」命令**：`shell.showItemInFolder` 只在 `backupCommands.cjs:298`（限备份历史），`shell.openPath` 只在 `reviewCommands.cjs:3112`（无路径校验，不可照抄）。
- 路径解析都已有：原始 PDF `paperPdfPath`（`src/utils/libraryPaper.ts:75`）；译版 PDF `resolvePaperTranslatedPdfAttachment`（`:86`）；MinerU 目录有 3 种候选命名 `buildMineruCachePathCandidates`（`src/utils/mineruCache.ts:79-142`）、汇总 `mineruOutputPathCandidatesForPaper`（`literatureLibraryUtils.ts:470-500`）；批量存在性检查 IPC `paths_exist`（`fileCommands.cjs:394`）。
- 笔记存于 `paperquay-notes.sqlite`，没有逐篇文件，不提供「笔记所在位置」。

### 1.4 黑色加号（R4）

- `src/features/reader/assistantSidebarChat.tsx:1116`：`bg-slate-950 text-white shadow-[0_8px_18px_…] hover:bg-slate-800 dark:bg-white dark:text-slate-950`。日间是整条幽灵按钮里唯一的实心黑块，夜间变纯白块，违反设计规范 §4 规则 1。
- 同类黑底按钮全仓 12 处（见 §3 P1-2 表）。

### 1.5 概览要手动点（R5）——根因已确认

1. **主因**：阅读器只在 `handleGeneratePaperSummary`（`DocumentReaderTab.tsx:2170-2314`）里调用 `tryLoadSavedSummary`（`:1127-1149`）读磁盘缓存；自动触发 effect（`:4184-4213`）要求 `settings.autoGenerateSummary && summaryConfigured`，而 `autoGenerateSummary` 默认 `false`（`readerShared.ts:180`）。所以缓存明明在，打开时却不读。截图里的「已从本地缓存恢复论文概览 100/100」正是点击后的成功提示（`:2263-2265`），说明缓存键匹配，只是没被被动读取。
2. 读缓存被排在「模型已配置」「MinerU 正文已加载」检查之后（`:2180-2253`），没配 API Key 时缓存永远显示不出来。文库侧 `generateLibraryPreview`（`useReaderLibraryPreview.ts:674-773`）顺序是对的：先读缓存再查配置。
3. 历史恢复（`:3750-3782`）只认 localStorage，文库批量生成的概览不会写进历史。
4. 加重因素 B2（见上）。

### 1.6 概览页 UI（R6）

- `src/features/reader/readerWorkspaceOverview.tsx`（`ReaderWorkspace.tsx:758` 挂载）。
- 标题被挤成一词一行：hero 行 `:103` 是 `flex flex-wrap justify-between`，标题容器 `:104` 是 `min-w-0 flex-1`（flex-basis 0），按钮组 `:118` 是 `shrink-0` 且有 4 个 `px-4` 大按钮 → flex-wrap 永不换行，30px 标题只剩窄缝。
- 「概览」字样重复 6 处：hero 徽标 `:106`、卡片标题「AI 概览」(`assistantSidebarPrimitives.tsx:282`)、「概览已生成」`:341`、摘要标题 `:352-353`、tab「概览」`:266`、tab 内大写标签 `:376-377`。
- 右侧「论文信息」5 个堆叠盒子（`:201-263`），来源信息与 hero 重复。
- 硬编码 `bg-slate-900`、`border-slate-200/80`、`bg-white`、rgba 渐变（`:101 :122 :211 :339`），圆角 30/24/22px，规范要求控件 8px、卡片 12px。
- `SummaryPanel`（`assistantSidebarPrimitives.tsx:243-389`）同时被助手栏使用（`compact` 分支），改动要两处验。

### 1.7 阅读顶部栏（R7）

- 第 1 带：`readerWorkspaceHeader.tsx`（531 行）：面包屑 + 22px 标题 + 作者行 + 概览/阅读 + 三种 PDF 视图 + 原始 PDF（单版本时是不可点的假按钮，多版本时是 180-420px 的 select）+ 沉浸 + 收起状态栏 + 工具。
- 第 2 带左：`src/features/pdf/PdfViewerToolbar.tsx`：4 个 40px 工具 + 4 色块 + 未本地化的「Custom」+ 页码（只读）+ 缩放%（只读）+ 翻页 + 缩放 + 热力图 + 删除所选（常驻）+ 实心黑「导出批注 PDF」；`flex-wrap justify-between`，双栏时会折成两行。对照模式每个窗格各一条。
- 第 2 带右：`src/features/blocks/BlockViewer.tsx:890-958`：装饰性「Structured Reading」药丸 + 块数徽标 ×2 + 显示模式分段（选中态 `bg-slate-900`）+ 缩放 + 常驻提示药丸。
- 第 4 带：底部状态栏 `ReaderWorkspace.tsx:807-816` 常驻。
- 合计约 250px 纵向装饰；「收起状态栏」实际收的是顶栏而非底栏，名不副实；沉浸模式不隐藏结构化阅读工具栏与底栏。
- 参照物：对照模式右窗格 `TranslatedPdfPane.tsx:103-144` 已是 24px 紧凑条，可作为尺寸基准。

---

## 2. 设计原则（全局）

1. **一层装饰只做一件事**：去掉纯装饰的标题栏、药丸、提示条；提示放 tooltip。
2. **主次分明**：每个区域最多 1 个主按钮（`.pq-button-primary`），其余为幽灵/图标按钮；低频动作进「⋯ 更多」。
3. **只用令牌**：禁止 `slate-*`/`white`/`black`/raw rgba；控件圆角 8px（`--pq-radius-sm`）、卡片 12px；新增变体写进 `src/app/index.css` 并同时验 `:root` 与 `.dark`。
4. **尺寸统一**：顶栏/工具栏按钮 32px，正文控件 36px，主按钮 36px；文字不小于 11px。
5. **菜单只用 `src/ui/menu.tsx`**（规范 §3）；需要子菜单或键盘导航时在 `Menu` 本体上补，不另起实现。
6. **中英成对**：所有新文案走 `l('中文','English')`；顺手修掉 "Structured Reading"、"Custom"、"Previous page"、`InlineProgressBar` 的硬编码「处理进度」。
7. **删除新手引导残留**：新手引导运行接线已经移除，`data-tour`/`dataTour` 锚点和相关契约测试随本轮删除；旧笔记目标中的 `onboarding:` 前缀只保留读取兼容。
8. **控制合并冲突面**：新逻辑放新文件/新 hook，对超大文件只做小范围接线。冲突热点：`DocumentReaderTab.tsx` 4509 行、`LiteratureLibraryView.tsx` 3794、`PdfViewer.tsx` 3316、`assistantSidebarChat.tsx` 1846、`LiteraturePaperDetails.tsx` 1394。上游 `WangQrkkk/PaperQuay`（`docs/UPSTREAM.md`）本地未配置 remote，但同步关系存在。

---

## 3. 分阶段方案

按「风险低、收益直接」→「结构性改动」排序。每阶段独立可交付、独立验收。

### P0　逻辑缺陷（先做，不改视觉）

**P0-1 打开即显示已缓存概览（R5）**

- 新增纯函数 `shouldAutoLoadCachedSummary({ sourceKey, summary, loading, attemptedKey })`（放 `src/features/reader/documentReaderSummarySource.ts` 或新文件），单测进 `tests/documentReaderCache.test.ts`。
- `DocumentReaderTab.tsx` 新增**被动读缓存** effect：`paperSummaryNextSourceKey` 非空、`paperSummary` 为空、未在加载时调用 `tryLoadSavedSummary`；**不依赖** `autoGenerateSummary` 与 `summaryConfigured`；用独立 ref + 请求 id 防竞态；命中后设置 `paperSummarySourceKey`，让 `:4193` 的自动生成 effect 短路。
- 源键尚为空时（MinerU 块未加载 / pdf-text 模式 PDF 未加载）的兜底：把文库侧 `libraryPreviewStates[workspaceId].summary` 或 `paper.aiSummary` 作为 prop 传入并先行显示（`Reader.tsx:1036-1062` 当前未传）。
- `handleGeneratePaperSummary`：把读缓存挪到配置检查之前，与文库侧顺序一致；只有缓存未命中才检查模型配置。
- 被动路径**只读缓存，不抽 PDF 文本**（`loadCachedPdfDocumentText` 很重）。
- 「自动生成」仍保持默认关闭（消耗 AI 额度），只修「自动显示已有结果」。
- 不改源键格式（`tests/documentReaderSummarySource.test.ts` 固定了格式与旧键）。

**P0-2 同步不再用 null 覆盖（B2）**：`DocumentReaderTab.tsx:888-926` 发送同步时 `paperSummary` 为 null 则不带 `summary` 字段；或在 `handleLibraryPreviewSync` 中拒绝以 null 覆盖非空值。补单测。

**P0-3 修 `resolveSelectedPapers` 依赖（B1）**：P1 引入 `buildPaperQuery(filters)` 后自然消失；若 P0 单独上线，先把 `ragMembershipFilter` 补进依赖。

验收：用 `--user-data-dir=<空目录>` + 拷贝的缓存，关闭自动生成并清空 API Key，打开已有概览的论文 → 概览页直接显示，无需点击；从阅读器返回文库，详情面板概览不丢失。

### P1　小而独立的 UI 修复

**P1-1 黑色「+」按钮（R4）**

**已定方案 A**（与相邻按钮同为幽灵按钮，图标用强调色）：

```text
pq-icon-button h-8 w-8 shrink-0 text-[var(--pq-accent)]
hover:bg-[var(--pq-accent-soft)] hover:text-[var(--pq-accent-hover)]
```

- 日间：图标 `#0d9488`，悬停底 10% teal；夜间：图标 `#2dd4bf`，悬停 14% teal。无 `dark:` 覆写、无阴影、无额外边框。
- 同时修：发送按钮禁用态改为 `disabled:bg-[var(--pq-surface-3)] disabled:text-[var(--pq-text-faint)] disabled:opacity-100`（现在靠 opacity 变成「褪色青」）；脑图标按钮去掉 `bg-white/60`，激活态与 RAG 开关统一为 accent-soft（现为 success 绿，规范 `:65` 警告过易混淆）；更多菜单悬停 `hover:bg-white/70` → `--pq-hover`。

**P1-2 清理同类黑底按钮**（统一为 `.pq-button-primary` 或新增 `.pq-icon-button-accent`）

| 位置 | 元素 | 去向 |
| --- | --- | --- |
| `reader/assistantSidebarChat.tsx:1116` | 新建会话 + | P1-1 方案 A |
| `pdf/PdfViewerToolbar.tsx:310` | 导出批注 PDF | P5 移入「⋯」 |
| `reader/readerWorkspaceOverview.tsx:122` | 进入阅读 | P4 改主按钮 |
| `reader/readerSelectionQuickActions.tsx:413` | 加入问答 | primary |
| `reader/assistantSidebarPrimitives.tsx:493` | 加入问答 | primary |
| `reader/assistantSidebarDrawers.tsx:307` | 插入选中文本 | primary |
| `reader/readerPreferencesContent.tsx:635 :1058 :1384` | 设置内操作 | primary |
| `reader/readerPreferencesUpdateSection.tsx:264` | 更新 | primary（已有 dark 覆写，确认后去掉） |
| `blocks/BlockViewer.tsx:917` | 显示模式选中态 | accent-soft 分段 |
| `notes/NoteDistillPreviewPanel.tsx:159` | 确认蒸馏 | primary |
| `agent/AgentExecutionCards.tsx:259`、`agent/AgentWorkspaceMessages.tsx:687` | 头像块 | 保留（规范 `:133` 登记的有意配对），只确认 |

**P1-3 右键「打开所在位置」（R3）**

- 后端：`electron/backend/fileCommands.cjs` 新增 `reveal_path({ path })`：
  - 文件存在 → `shell.showItemInFolder`；目录 → `shell.openPath`；不存在 → `{ ok:false, reason:'missing' }`。
  - **根目录白名单**：dataDir、storageDir、translatedPdfDir、mineruCacheDir、remotePdfDownloadDir、文库内各附件 `originalPath` 所在目录；复用 `assertWriteAllowed`（`:136-163`）的规范化与前缀判断思路。不照抄 `review_open_output` 的无校验写法。
  - 可选 `open_path`：仅允许 `.pdf` / `.md` 用系统默认程序打开。
  - 测试加进已有 `tests/fileCommands.test.ts`，参照 `tests/backupCommands.test.ts:23,58` mock `shell`。
- 前端：
  - `src/services/desktop.ts` 新增 `revealLocalPath` / `openLocalPath`。
  - 新纯函数 `resolvePaperFileLocations(paper, { storageDir, mineruCacheDir, autoLoadSiblingJson })` → `{ originalPdf, translatedPdfs[], mineruDir, markdown, contentListJson }`，候选路径一次 `paths_exist` 选第一个存在者；单测进 `tests/literatureLibraryUtils.test.ts`。
  - 新 hook `usePaperFileLocations`（新文件，避免继续膨胀 `LiteratureLibraryView.tsx`）。
  - 右键菜单在「删除」分隔线之前加一组（`Menu` 无子菜单，用平铺 + 分隔线）：
    - 在文件夹中显示 PDF
    - 在文件夹中显示译版 PDF（多个译版时按语言列出，最多 3 项）
    - 打开 MinerU 结果文件夹
    - 在文件夹中显示 Markdown（full.md）
    - 复制 PDF 路径
  - 菜单打开时异步检查存在性；不存在的项置灰并在 tooltip 说明「尚未解析 / 文件缺失」。
  - 详情面板「⋯」菜单与概览页右侧信息复用同一组条目（键盘用户的替代入口）。
- 验收：Windows 下正、反斜杠混合路径均能正确定位；白名单外路径被拒绝。

### P2　文库顶栏与筛选（R1）

**布局（单行，窄宽时按优先级折叠）**

```text
[☐ 196] [🔍 搜索标题、作者、摘要、DOI…      ✕] [⚲ 筛选 ·3] [⇅ 出版时间↓] [▦ 视图] [+ 导入 PDF] [⋯]
已筛选：★ 收藏 ✕  2020–2025 ✕  有译版 PDF ✕   清除全部          显示 42 / 196
```

- 全选：紧凑复选框 + 计数；保留三态。
- 搜索：内置清除按钮；`Ctrl+F` 聚焦（注册到 `src/ui/commands.ts`）。
- **筛选按钮** → 锚定弹层（徽标显示已生效数），分组如下：

| 组 | 选项 | 实现 |
| --- | --- | --- |
| 常用 | 仅收藏 · 最近阅读 · 未读 | SQL `is_favorite` / `last_read_at` |
| 阅读状态 | 未读 / 在读 / 已读完 | SQL `last_read_at` + `reading_progress` |
| 出版年份 | 起止年份（两个数字框 + 「近 3 年 / 近 5 年」快捷） | SQL `year` |
| 文献类型 | 多选：期刊 / 会议 / 学位论文 / 报告 / 图书 / 预印本 / 其他 | SQL `item_type` |
| 标签 | 多选，带搜索 | SQL `tagIds[]`（后端已有单个 `tagId`，扩为数组） |
| 附件 | 有 PDF · 有译版 PDF · 文件缺失 | SQL `attachments.kind/missing` |
| 处理状态 | 已生成概览 · 已解析 MinerU | 概览：SQL `ai_summary`；MinerU：见下 |
| 知识库 | 全部 / 已加入 / 已排除 | 现有 `ragEnabled`（从顶栏 select 迁入） |
| 来源 | 本地 / Zotero | SQL `source` |

- **MinerU 已解析**不是数据库列。方案：由渲染端基于 `fetchAllLibraryPapers` + 已有状态推导出 id 集合，以新增的 `paperIds` 条件交给 SQL，保证分页和总数正确。实施前先核对 `paperStatuses` 是否覆盖全库；若只覆盖当前页，此项放到 P2 末尾单独做，不阻塞其他筛选。**不加 library schema 列**。
- 已生效筛选显示为第二行 chips，可单独移除，并带「清除全部」和「显示 N / 总数」；无筛选时第二行不出现。原状态文字「文献库已就绪」等改走 toast，不再常驻占行。
- 排序：图标按钮 + 菜单，补上后端已支持的「最近阅读」；方向用同一按钮切换。
- **视图**菜单：标题显示（中英 / 中文 / 原文）、阅读热力列开关、列表密度（舒适 / 紧凑）。
- **⋯ 更多**：存储体检、刷新、从 Zotero 导入（若已有入口则复用）。
- 筛选状态持久化：新 key `paperquay-literature-filters-v1`，结构校验失败回落默认值；旧的 sort / title-display key 保持不变。

**代码改动**

- 新增 `src/features/literature/libraryFilters.ts`：`LibraryFilterState` 类型、默认值、序列化/校验、`buildPaperQuery(filters, sort, category, search)`、`describeActiveFilters()`（生成 chips）。替换 `LiteratureLibraryView.tsx` 里 6 份手抄请求；顺带解决 B1。
- 新增 `LiteratureFilterPopover.tsx`、`LiteratureToolbar.tsx`，把顶栏从 `LiteraturePaperList.tsx:489-618` 抽出。
- 后端：`ListPapersRequest`（`src/types/library.ts:199-209`）、`buildLibraryFilter`（`libraryQuery.cjs`）、JS 对照实现 `paperMatches`（`libraryStore.cjs:153-235`）**三处同步**新增 `favorite`、`tagIds`、`yearFrom/yearTo`、`itemTypes`、`readStatus`、`hasPdf`、`hasTranslatedPdf`、`missingFile`、`hasSummary`、`source`、`paperIds`。
- 新 IPC `library_list_tags`（返回去重的标签及计数），供筛选与 P3 标签补全使用。
- 选区清空 effect（`:479-499`）改为比较整份筛选对象。

**测试**：`tests/libraryQuery.test.ts:152-231` 要求 SQL 与 JS 对照结果一致，新条件逐个加进请求列表；`tests/literatureLibraryUtils.test.ts` 保持标题显示用例通过；新增 `tests/libraryFilters.test.ts`。

### P3　详情面板与元数据编辑（R2）

**只读态布局（自上而下）**

```text
标题（可点击行内编辑）                         [★] [⋯]
中文标题
作者 A, 作者 B 等 · 2024 · Journal of Sound and Vibration
[ 打开阅读 ]  [ 编辑 ]
─ 状态条 ──────────────────────────────────────────
 ✓知识库  ✓MinerU  ✓译文  ✓概览  译版PDF·中文     (每个 chip 可点：未完成→执行，已完成→菜单「重新执行/查看」)
 ▬▬▬▬▬▬▬▬▬▬▬ 任务进行时显示细进度条 + 文字
▸ 信息      类型、期刊/出版社、卷(期):页、年份、DOI↗(复制)、URL↗、ISSN/ISBN
▸ 摘要      默认 3 行折叠，可展开
▸ AI 概览   tabs（与概览页共用解析函数）
▸ 关键词与标签
▸ 笔记
▸ 阅读时间  默认折叠
```

- 删除装饰性「文献详情 / 已选择文献」标题栏（`:645-662`）。
- 「本地知识库」卡、「文档处理」卡（3 个大 tile + 译版区）、进度卡合并为**一条状态条**；译版 PDF 的设置语言/替换/移除/附加进入该 chip 的菜单，保留 BCP 47 校验对话框（`:883-920`）。
- **⋯ 菜单**：打开所在位置组（同 P1-3）、复制 DOI、复制引用（GB/T 7714 / APA，复用 `formatBibliographyEntry`）、复制 BibTeX（`paperToBibtexEntry`）、按 DOI 重新识别、移出/加入知识库、删除。
- 分区折叠状态持久化（`paperquay-literature-details-sections-v1`）。

**编辑态**

- 字段按组折叠，组内按文献类型显示相关字段：
  - 基本：标题、中文标题（含「AI 翻译」）、**作者列表编辑器**（逐行增删、拖拽排序、粘贴整串自动拆分）、年份、文献类型
  - 出版：期刊/会议/学校（标签随类型变）、出版社/机构、卷、期、页、报告号
  - 标识：DOI（输入框右侧「从 DOI 获取」）、ISBN、ISSN、URL
  - 内容：摘要、关键词（chip 输入）
  - 整理：标签（chip 输入 + 已有标签补全，数据来自 `library_list_tags`）、分类（多选，走现有 `AssignPaperCategoryRequest`）、收藏
  - 备注：用户笔记、引用信息
- 校验（新纯函数 `validatePaperDraft`，单测）：DOI 规范化（去 `https://doi.org/`、`doi:` 前缀）、年份 4 位且 ≤ 当前年 + 1、ISSN `NNNN-NNN[NX]`、URL 合法。错误就地提示，阻止保存。
- **元数据重新识别带差异预览**：调用 `lookupLiteratureMetadata`，逐字段显示「当前 → 识别结果」，勾选后应用；改造 `buildManualMetadataUpdateRequest` 为纯函数并补测。
- 行内快速编辑：标题、年份、DOI 等单字段点击即编辑，回车保存、Esc 取消，只提交该字段。
- 键盘：`Ctrl+S` 保存、`Esc` 取消；切换文献时若草稿有改动，弹确认（保存 / 放弃 / 取消切换），不再静默丢弃。
- 保存中禁用并发保存；保存成功走 toast。
- 后端白名单两处保持一致：`libraryCommands.cjs:855` 与 `knowledgeMcpService.cjs:333`（P3a 新增字段时两处同时改）。

**P3a 元数据新字段（已确认纳入本轮，先于 P3 布局实施）**

新增 4 个字段，只动 **library 库**（`paperquay-library.sqlite`），不涉及知识库/RAG schema 与 `user_version`。

| 字段 | 存储 | 前端类型 | 说明 |
| --- | --- | --- | --- |
| 论文语言 | `papers.language TEXT` | `LiteraturePaper.language?: string \| null` | BCP 47（如 `en`、`zh-CN`），复用译版 PDF 语言的校验函数；和 `attachments.language`（译版语言）是两回事，命名与界面文案要区分（「论文语言」vs「译版语言」） |
| 引用键 | `papers.citation_key TEXT` | `citationKey?: string \| null` | 为空时 `bibtex.ts:194` 仍走 `buildCitationKey` 自动生成；非空时作为 BibTeX 键；校验 `^[A-Za-z0-9_:\-.]+$`；库内重复时提示但不阻止 |
| 作者单位 | `authors.affiliation TEXT` | `LiteratureAuthor.affiliation?: string \| null` | 每位作者一条 |
| ORCID | `authors.orcid TEXT` | `LiteratureAuthor.orcid?: string \| null` | 校验 `NNNN-NNNN-NNNN-NNN[NX]` 及校验位；展示为 `https://orcid.org/…` 链接 |

- 迁移：沿用 `libraryDatabaseStore.cjs:246-257` 的 `ensureColumn` 追加列模式（幂等、只加列、默认 NULL），**不重建表**。注意 `authors` 表经 `migrateRepeatedIdListTable`（`:216`）重建过，新列必须同时写进 `CREATE TABLE` 定义与 `ensureColumn`，并核对该迁移的列清单参数不会把新列丢掉。
- 读写全链路需同步：
  - `libraryDatabaseStore.cjs` 的 INSERT/SELECT 与行映射；JSON 版 `libraryStore.cjs`（若仍作为对照/回退实现）
  - `src/types/library.ts`：`LiteraturePaper`、`LiteratureAuthor`、`UpdatePaperRequest`
  - `UpdatePaperRequest` 现有 `authors?: string[]` **保持不变**以兼容 MCP 与旧调用方；新增可选 `authorDetails?: { name; givenName?; familyName?; affiliation?; orcid? }[]`，两者同时给出时以 `authorDetails` 为准
  - 字段白名单两处一致：`libraryCommands.cjs:855` 与 `electron/mcp/knowledgeMcpService.cjs:333`；MCP `update_paper` 的参数说明与 `skills/` 下 paperquay-library-manage 文档同步
  - `src/utils/bibtex.ts`：优先用 `paper.citationKey`；导出 `language` 字段
  - 引用格式 `formatBibliographyEntry` 不受影响（单位、ORCID 不进引文）
  - 元数据识别 `lookupLiteratureMetadata`：CrossRef 返回的 `language`、作者 `affiliation[].name`、`ORCID` 映射进差异预览（有则填，无则不覆盖）
  - Zotero 导入（`zoteroImport.ts` / 同步命令）：Zotero `language` 字段与 `extra` 中的 `Citation Key:` 行映射；不覆盖用户已手填的值
  - 筛选（P2）：「论文语言」可作为后续筛选项，本轮不加入弹层
- 测试：store 往返（新列写入→读出）、旧库升级（无新列的库打开后自动补列且数据不丢）、白名单一致性（`tests/knowledgeMcpWrite.test.ts`）、bibtex 键优先级（`tests/bibtex.test.ts`）、ORCID/引用键/语言校验纯函数。
- 备份/恢复：备份是整库文件，新列随库走；需验证「新版备份 → 恢复到新版」与「旧版备份 → 恢复到新版后自动补列」两条路径。
- 编辑态落位：「基本」组加「论文语言」；「标识」组加「引用键」（占位符显示自动生成的键）；作者列表编辑器每行可展开填写单位与 ORCID。只读态在作者名旁显示 ORCID 图标，悬停显示单位。

### P4　概览页（R6）

```text
[论文概览]
Energy and power transition in green aviation: Current status and prospects …（整行宽度，最多 3 行）
Chengjie Li, Bin Yu, … · 2026 · Journal · 本地文库 / 我的文库
[ 进入阅读 → ]  [ 处理 ▾ ]（MinerU 解析 / 翻译全文 / 重新识别…需确认）
┌ AI 概览 ── 已生成 · 10 关键词 · 19 发现 ──────── [↻] ┐   ┌ 文件 ─────────────────┐
│ 绿色航空中的能源与动力转型：…（中文标题）              │   │ PDF   xxx.pdf    [📂]  │
│ [概览][背景][问题][方法][实验][发现][结论][局限]       │   │ JSON  content_list…[📂]│
│ 正文 / 发现以列表呈现                                  │   │ 531 个结构块           │
└────────────────────────────────────────────────────────┘   └───────────────────────┘
```

- 标题与操作上下排列，修掉一词一行；`进入阅读` 为唯一主按钮，其余收进「处理」菜单，「重新识别」需二次确认（消耗额度）。
- 「概览」字样只保留：页面徽标 1 处 + 卡片标题「AI 概览」1 处；删除卡片说明文字、「概览已生成」大徽标（并入状态行）、tab 内重复的大写标签。
- 右侧信息卡改为紧凑键值列表，每个文件带「在文件夹中显示」（复用 P1-3）；删除与 hero 重复的「来源」块。
- 无概览时（P0 修复后仅在确实无缓存时出现）显示一个空状态 + 「生成概览」按钮，并注明是否已配置模型。
- 全部令牌化；圆角 12/8；验日夜两套主题。
- `SummaryPanel` 的 `compact`（助手栏）分支一起回归。
- 删除引导锚点；保留旧笔记 `onboarding:` 目标的读取兼容。

### P5　阅读顶部栏与工具栏（R7）

**目标：顶部装饰从 ~250px 降到 ~80px（1 条 40px 顶栏 + 每窗格 1 条 36px 工具行），底栏并入顶栏或可隐藏。**

```text
顶栏 40px
[‹] Energy and power transition in green avi…ⓘ   [概览|阅读]  [▭|▭▭|⧉]   [原始PDF▾] [⤢] [⋯]
左窗格 36px
[↖][🖍][T][✎] [●▾]  │  ‹ [23] / 35 ›  │  − 78%▾ +  │                          [⋯]
右窗格 36px
[原文|译文·中文|原文+译文]                                     − 100% +   ⓘ420块/520译文
```

- 顶栏：去掉面包屑大写行与作者行，作者/年份/文件名放进标题旁 ⓘ tooltip；概览/阅读、视图模式为 32px 图标分段（窄宽仅图标、宽屏显示文字）；PDF 版本控件只在多版本时出现，且为紧凑下拉；「沉浸」变图标；**删除「收起状态栏」按钮**（顶栏已足够薄），同时移除 `headerCollapsed` 状态；其 localStorage 键 `WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY` 不再读写，残留值无害，不做清理。
- PDF 工具行：工具按钮 32px；4 色块 + Custom 合并为一个当前色按钮 + 弹层；页码改为**可输入跳转**；缩放百分比可点开预设（适合宽度 / 适合页面 / 100%）；「删除所选」只在 `hasSelectedEditor` 为真时出现，并支持 `Delete` 键；阅读热力、导出批注 PDF 进入「⋯」；保存/错误/翻译进度改为 toast + 细进度线，不再额外占行；去掉 `flex-wrap`，窄宽时低优先级项自动收进「⋯」。
- 结构化阅读工具行：删除「Structured Reading」药丸和常驻提示（提示改为 ⓘ tooltip）；块数并入 ⓘ；显示模式选中态改 accent-soft；按 `TranslatedPdfPane.tsx:103-144` 的尺寸对齐。
- 沉浸模式：同时隐藏结构化阅读工具行与底栏；注册快捷键 `mod+shift+f`（Windows 为 `Ctrl+Shift+F`），写进 `src/ui/commands.ts`。不用 `F11`：主进程未调用 `Menu.setApplicationMenu`，Electron 默认菜单可能已把 F11 绑到窗口全屏。该项用户未单独表态，按此默认执行，可随时改。
- 底栏：信息并入顶栏 tooltip；「单击预览，双击进入阅读」类提示放进相应元素 tooltip。
- 不动 `ReaderWorkspace.tsx:380-480` 的对照同步逻辑。
- 保持组件名与 `currentPage`/`pageCount` 等 props：`tests/pdfViewerPageCountLifecycle.test.ts` 按组件名查找 `PdfViewerToolbar`、`TranslatedPdfPane`、`BlockViewer`、`ReaderWorkspaceHeader`。

### P6　收尾

- `docs/changes/2026-11-xx-*.md` 按阶段补变更记录；`docs/USER_MANUAL.zh-CN.md` 同步筛选、右键菜单、详情编辑、阅读工具栏的新交互。
- `docs/ui-design-system.md` 登记新增变体（如 `.pq-icon-button-accent`）与「顶栏 40px / 工具行 36px」尺寸约定。
- `src/ui/menu.tsx` 的键盘导航与 `role="menu"`：本计划只在新增菜单项上保证可用，`Menu` 本体的 a11y 补齐列为独立后续项。

---

## 4. 验证

每阶段都要：

1. `npx tsc --noEmit`
2. `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` 全绿
3. 构建：先把 `TEMP`/`TMP` 指到仓库内目录再 `npm run build`（ISS-09）
4. 实机：`--user-data-dir=<空目录>` 或拷贝出的一次性库，**不碰真实文库**
5. 日间 / 夜间各截图一次（规范 §4 规则 6）；中文 / 英文界面各看一次
6. 窗口最小尺寸 1040×720 与最大化各看一次（文库三栏、阅读双栏）

阶段专项验收：

| 阶段 | 专项验收 |
| --- | --- |
| P0 | 关闭自动生成、清空 API Key，打开已有缓存的论文 → 概览直接显示；返回文库，详情概览不被清空 |
| P1 | 「+」在日夜两主题与相邻按钮同一视觉层级；右键 4 类位置均能在资源管理器中定位，缺失项置灰 |
| P2 | 每个筛选单独及组合生效，总数与分页正确；「全选 + 批量」按当前筛选解析；重启后筛选保留 |
| P3a | 旧库打开后自动补 4 列且原数据完好；新字段经界面与 MCP `update_paper` 都能写入并读回；自定义引用键出现在 BibTeX 导出；旧备份恢复后正常 |
| P3 | 非法 DOI/年份/ISSN/URL/ORCID/引用键阻止保存；切换文献有未保存提示；重新识别差异预览可逐项取舍 |
| P4 | 1040 宽时标题不再一词一行；「概览」字样不重复；助手栏 SummaryPanel 正常 |
| P5 | 顶部装饰高度 ≤ 90px（单栏）；双栏时工具行不折行；沉浸隐藏所有工具行与底栏 |

---

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 超大文件合并冲突 | 新逻辑放新文件（`libraryFilters.ts`、`LiteratureToolbar.tsx`、`LiteratureFilterPopover.tsx`、`usePaperFileLocations.ts`、详情面板子组件）；对大文件只做接线 |
| 详情面板无测试 | 先把 `draftFromPaper`、`validatePaperDraft`、`buildManualMetadataUpdateRequest`、概览分节解析抽成纯函数并补测，再动布局 |
| `reveal_path` 被滥用 | 根目录白名单 + 路径规范化 + 只对存在的路径操作；`open_path` 仅限 `.pdf`/`.md` |
| 自动行为消耗 AI 额度 | P0 只做「自动显示缓存」，「自动生成」维持默认关闭 |
| 筛选 SQL 与 JS 对照不一致 | 三处同步修改，由 `tests/libraryQuery.test.ts` 的一致性断言兜底 |
| P3a 改 library 库结构 | 只用 `ensureColumn` 追加可空列；先在拷贝库上验证升级与备份恢复；不碰知识库/RAG 库 |
| 两种「语言」混淆 | 论文语言（`papers.language`）与译版语言（`attachments.language`）在类型名、文案、筛选里明确区分 |
| 旧引导数据断开 | 保留 `onboarding:` 笔记目标的读取兼容，并用纯函数测试锁定解析结果 |

---

## 6. 决策记录（2026-11-16 确认）

| # | 问题 | 决定 |
| --- | --- | --- |
| 1 | 「更眼睛风格」含义 | **更精致 / 更现代**：低饱和、细边框、少卡片嵌套、高信息密度；不走护眼暖色方向 |
| 2 | 「+」按钮样式 | **方案 A**：幽灵按钮 + 强调色图标 |
| 3 | 「收起状态栏」按钮 | **删除** |
| 4 | 沉浸模式快捷键 | 用户未单独表态，按默认 **`Ctrl+Shift+F`（`mod+shift+f`）** 执行，可随时改 |
| 5 | 元数据新字段 | **纳入本轮**：论文语言、引用键、作者单位、ORCID，见 P3a |
| 6 | 实施顺序 | **P0 → P1 → P2 → P3（含 P3a，先数据后布局）→ P4 → P5**；P0、P1 可同一分支，P2 起每阶段一个分支 |
