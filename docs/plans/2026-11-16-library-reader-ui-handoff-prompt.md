# 交接 Prompt：文库与阅读器界面精简优化

> 用法：整段复制给执行会话。一次只交付一个阶段；按顺序把 `<阶段>` 换成 P0 → P1 → P2 → P3a → P3 → P4 → P5。P0 和 P1 可在同一会话、同一分支完成。
>
> 已确认决策（2026-11-16）：风格走「更精致 / 更现代」；「+」用方案 A；删除「收起状态栏」；沉浸快捷键 `Ctrl+Shift+F`；论文语言、引用键、作者单位、ORCID 四个新字段纳入本轮（P3a）。

---

你在 PaperQuay 仓库（`C:\Users\yusen\Downloads\PaperQuay`，Electron + React + TypeScript，`main` 分支）里实施界面优化的 **<阶段>**。

## 先读

1. `docs/plans/2026-11-16-library-reader-ui-simplification.md`：完整方案。第 1 节是现状证据（带行号），第 3 节是各阶段做法，第 4 节是验收。只做本阶段的内容。
2. `docs/ui-design-system.md`：只用 `var(--pq-*)` 令牌，不写 `slate-*`/`white`/`black`/raw rgba；控件圆角 8px、卡片 12px；菜单只用 `src/ui/menu.tsx`；改颜色要验 `:root` 与 `.dark` 两套主题。
3. `AGENTS.md`：常用命令与红线。

行号以方案文档写作时（`fe647ec`）为准，动手前先用 codegraph 或 Read 重新定位。

## 必须遵守

- 不改知识库/RAG 的 schema 或 `user_version`。library 库只有 P3a 可以加列，且只能用 `ensureColumn` 追加可空列，不重建表。
- 不写入真实文库。实机验证只用 `--user-data-dir=<空目录>` 或拷贝出的一次性库。
- 不提交、不推送、不改版本号、不发版，除非用户明确要求。
- 所有新文案用 `l('中文','English')`。
- 不保留 `data-tour` 引导锚点；新手引导已经整体移除，旧笔记 `onboarding:` 目标只保留读取兼容。
- 新逻辑尽量放进新文件或新 hook。`DocumentReaderTab.tsx`、`LiteratureLibraryView.tsx`、`PdfViewer.tsx`、`assistantSidebarChat.tsx` 这几个超大文件只做接线级改动。
- 优先抽纯函数并写单测，再改布局。

## 各阶段要点

**P0 逻辑缺陷**
- 阅读器打开论文时被动读取磁盘概览缓存。新 effect 不依赖 `autoGenerateSummary`/`summaryConfigured`，用独立 ref 和请求 id 防竞态，命中后设置 `paperSummarySourceKey`。源键为空时用文库侧 summary 或 `paper.aiSummary` 兜底。被动路径不抽 PDF 文本。
- `handleGeneratePaperSummary` 改为先读缓存，再检查模型配置。
- 同步到文库预览时不再用 `summary: null` 覆盖已有概览。
- `resolveSelectedPapers` 的依赖数组补上 `ragMembershipFilter`。
- 「自动生成」保持默认关闭。
- 不改概览源键格式。

**P1 小修复**
- 助手栏「新建会话 +」改为 `pq-icon-button h-8 w-8 shrink-0 text-[var(--pq-accent)] hover:bg-[var(--pq-accent-soft)] hover:text-[var(--pq-accent-hover)]`（已定方案 A）。
- 修发送按钮禁用态、脑图标按钮和更多菜单的悬停色。
- 按方案 P1-2 表清理同类黑底按钮。
- 新增 `reveal_path` IPC（`fileCommands.cjs`），限定根目录白名单，测试写进 `tests/fileCommands.test.ts`。
- 新增纯函数 `resolvePaperFileLocations` 及单测，新增 hook `usePaperFileLocations`。
- 右键菜单在「删除」前加一组：PDF、译版 PDF、MinerU 文件夹、Markdown 的所在位置，以及复制 PDF 路径。不存在的项置灰。

**P2 顶栏与筛选**
- 新增 `libraryFilters.ts`，提供 `buildPaperQuery`，替换 6 份手抄的查询请求。
- 新增 `LiteratureToolbar.tsx` 和 `LiteratureFilterPopover.tsx`。
- 后端有三处要同步扩展筛选条件：`ListPapersRequest`、`libraryQuery.cjs` 的 `buildLibraryFilter`、`libraryStore.cjs` 的 `paperMatches`。新增条件：`favorite`、`tagIds`、`yearFrom`/`yearTo`、`itemTypes`、`readStatus`、`hasPdf`、`hasTranslatedPdf`、`missingFile`、`hasSummary`、`source`、`paperIds`。
- 新增 IPC `library_list_tags`。
- 已生效筛选以 chips 显示，带「清除全部」和「显示 N / 总数」。
- 视图菜单放标题显示和热力列，「⋯」菜单放存储体检和刷新。
- 筛选状态持久化到 `paperquay-literature-filters-v1`。
- `tests/libraryQuery.test.ts` 要求 SQL 与 JS 结果一致，新条件逐个加进去。

**P3a 元数据新字段（先于 P3 布局）**
- 新增 4 列：`papers.language`、`papers.citation_key`、`authors.affiliation`、`authors.orcid`。在 `libraryDatabaseStore.cjs` 里写进 `CREATE TABLE` 定义，并加 `ensureColumn`。核对 `authors` 表的 `migrateRepeatedIdListTable` 列清单，确保它不会丢掉新列。
- 读写全链路同步：store 的 INSERT/SELECT 和行映射、`src/types/library.ts`、两处字段白名单（`libraryCommands.cjs` 和 `knowledgeMcpService.cjs`）、MCP `update_paper` 的参数说明和 skill 文档。
- `UpdatePaperRequest.authors: string[]` 保持兼容。新增可选的 `authorDetails`（含单位、ORCID），两者都给时以 `authorDetails` 为准。
- `bibtex.ts` 优先用 `citationKey`，并导出 `language`。元数据识别和 Zotero 导入映射这些新字段，但不覆盖用户手填的值。
- 新增校验纯函数：BCP 47 语言、引用键、ORCID（含校验位）。
- 测试覆盖：新列往返读写、旧库升级自动补列、白名单一致、BibTeX 键优先级、旧备份恢复。
- 「论文语言」和译版 PDF 的「译版语言」是两个概念，命名和文案要分开。

**P3 详情面板**
- 删掉装饰标题栏。
- 知识库、文档处理、进度三块合并为一条可点的状态条。
- 信息区补上年份、DOI（可点、可复制）和 URL；摘要默认折叠。
- 新增「⋯」菜单：所在位置、复制 DOI/引用/BibTeX、按 DOI 重新识别、知识库、删除。
- 编辑表单分为基本、出版、标识、内容、整理、备注六组。
- 作者用列表编辑器，每行可展开填写单位和 ORCID。标签输入支持补全。
- 「基本」组加论文语言，「标识」组加引用键（占位符显示自动生成的键）。
- 新增 `validatePaperDraft` 并写单测。
- 重新识别时逐字段显示差异，由用户勾选后应用。
- `Ctrl+S` 保存，`Esc` 取消；切换文献前若有未保存修改，先确认。
- 保留译版 PDF 语言对话框的 BCP 47 校验。

**P4 概览页**
- 标题与操作按钮上下排列。「进入阅读」是唯一主按钮，其余收进「处理」菜单；「重新识别」需二次确认。
- 「概览」字样去重，只留页面徽标和卡片标题两处。
- 右侧改为紧凑的文件列表，每项带「在文件夹中显示」。
- 全部改用令牌。
- 回归助手栏 `SummaryPanel` 的 `compact` 分支。

**P5 阅读顶部**
- 顶栏 40px：标题旁放 ⓘ tooltip；概览/阅读和视图模式用图标分段；PDF 版本控件只在有多个版本时出现。
- PDF 工具行 36px：
  - 颜色合并为一个按钮。
  - 页码可输入跳转，缩放可选预设。
  - 「删除所选」只在有选中批注时出现。
  - 热力图和导出批注 PDF 收进「⋯」。
  - 不再折行。
- 结构化阅读工具行：去掉 Structured Reading 药丸和常驻提示。
- 删除「收起状态栏」按钮和 `headerCollapsed` 状态。
- 沉浸模式隐藏全部工具行和底栏，并在 `src/ui/commands.ts` 注册快捷键 `mod+shift+f`。
- 不动 `ReaderWorkspace.tsx:380-480` 的对照同步逻辑。
- 保持 `PdfViewerToolbar`、`TranslatedPdfPane`、`BlockViewer`、`ReaderWorkspaceHeader` 的组件名和 `currentPage`/`pageCount` props（`tests/pdfViewerPageCountLifecycle.test.ts` 依赖它们）。

## 完成标准

1. `npx tsc --noEmit` 通过。
2. `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` 全绿。
3. 把 `TEMP`/`TMP` 指到仓库内目录后，`npm run build` 通过。
4. 实机按方案第 4 节的本阶段专项验收逐条通过。日间、夜间各截图一次；中文、英文界面各看一次；窗口最小尺寸 1040×720 和最大化各看一次。
5. 在 `docs/changes/` 写本阶段变更记录。交互有变化时同步 `docs/USER_MANUAL.zh-CN.md`。
6. 回报内容：改了哪些文件、测试数量变化、截图结论、未完成或偏离方案的地方及原因。不要自行提交。
