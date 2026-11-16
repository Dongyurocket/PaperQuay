# 文库顶栏与筛选（P2）及 MinerU 结果定位修正

2026-11-16，分支 `ui/p2-library-toolbar-filters`，基于 `main` @ `3e0f6b4`（0.4.26）。本轮未修改版本号、schema 或 `user_version`，未提交、推送或发布。

## 第 0 步：修正 0.4.26 的 MinerU 结果定位

0.4.26 的「打开 MinerU 结果文件夹」只检查缓存目录，结果保存在 PDF 同目录时会报「未找到」。现在与 Markdown 项合并为「在文件夹中显示 MinerU 结果」／「Show MinerU Output in Folder」，保留 FileType 图标。

`paperFileLocations.ts` 使用已有缓存路径生成器、`getMineruJsonPathCandidates`、`guessSiblingJsonPaths`，按以下优先级选择第一个存在的文件：

1. 三种历史缓存目录中的 `full.md`。
2. PDF 同目录的 `full.md`（仅启用 `autoLoadSiblingJson` 时）。
3. 三种缓存目录中的 `content_list_v2.json`、`content_list.json`、`middle.json`。
4. PDF 同目录的上述 JSON（仅启用同目录加载时）。

后端 `reveal_path` 保持原有文件定位和目录打开分支。用户手册 §2.4 与 P0/P1 记录已同步修正。

## 第 1 步：P2 文库顶栏与筛选

- 新增 `libraryFilters.ts`：筛选状态、默认值、完整结构校验、序列化、统一查询构建、筛选标签与单项移除。使用 `paperquay-literature-filters-v1`；旧排序和标题显示键不变。
- 新增 `LiteratureToolbar.tsx`、`LiteratureFilterPopover.tsx`，从列表组件抽出顶栏。顶栏包括全选计数、带清除的搜索、筛选数徽标、排序、视图、唯一主按钮「导入 PDF」与更多菜单；筛选生效时增加可移除标签及匹配数。
- 视图菜单包含标题语言、阅读热力列、舒适／紧凑密度；更多菜单提供存储体检和刷新。状态文字走 toast。Ctrl+F 注册到共享命令表，并在文库隐藏时停用，避免影响阅读器。
- 顶栏根据文库面板自身宽度逐步收起按钮文案；面板小于 480px 时，视图选项并入更多菜单以保留单行布局。窄面板仍显示筛选数量角标，字号不小于 11px。
- 前端 `ListPapersRequest`、SQL `buildLibraryFilter`、JS `paperMatches` 同步支持收藏、多个标签、年份、类型、阅读状态、附件、概览、来源及指定 ID；标签多选为任一匹配，不同筛选维度取交集。
- 新增 `library_list_tags`，按标签 ID 去重并统计不同文献数。MinerU 状态在初始化／刷新后检查完整文库，筛选通过已解析 ID 集合下推 SQL，保持分页、总数与跨页全选一致。
- `LiteratureLibraryView.tsx` 使用统一查询与新 hook 接线，整份筛选变化后清空选区；在途全选查询通过筛选快照作废，防止返回旧选区。

## 独立审查与反驳复核

审查分逻辑／后端一致性及样式两个方向，由两个独立审查者完成。每项先检查已有流程或用户约定是否足以反驳，再决定处理：

| 发现 | 反驳复核与处理 |
| --- | --- |
| 阅读状态／最近阅读所需字段不随阅读更新 | 阅读历史只写 localStorage，不能反驳；补齐现有阅读字段的写回与刷新，不增加列 |
| 外部删除或恢复文件后附件标记过期 | 迁移和重定位能更新标记，但不覆盖外部修改；附件筛选按需检查真实路径，以 ID 集合交给 SQL，并把相同观测映射到返回的附件状态；不持久化临时观测 |
| 桌面 Zotero 导入被固定标记为 local | MCP 同步能正确标记，但桌面导入走不同路径；补传并保存来源 |
| Unicode 空白概览在 SQL 与 JS 中含义不同 | ASCII 空白已有处理，但全角空格等仍不一致；SQL 使用与 JS trim 相同的空白集合 |
| PDF 同目录 Markdown 优先于缓存 JSON，可能属于同目录另一篇论文 | 本轮用户明确指定此优先级；保留该顺序。同目录自动加载沿用用户选择，不凭文件名推断归属 |
| 共享菜单缺少键盘操作 | 鼠标遮罩关闭不能替代键盘；补焦点进入、方向键、Escape 和焦点恢复 |
| 筛选弹层焦点未进入、复选框焦点不可见 | Portal 改变 Tab 顺序，且全局 input 取消轮廓；补焦点管理与令牌化焦点样式 |
| 长标签撑宽弹层与筛选标签 | 标签长度合法也会溢出；约束最小宽度、折行／截断并保持移除按钮可见 |
| 工具栏焦点环被滚动容器裁切 | 全局有焦点环，但容器裁切仍成立；保留焦点环空间 |
| 窄文库列按窗口断点显示过多文案 | 整窗宽度不能代表面板宽度；按容器宽度折叠文案和低优先级操作 |
| 弹层和菜单阴影被 Tailwind 类型推断／pq 样式覆盖 | DOM 计算样式确认；显式使用阴影令牌并处理 CSS 覆盖优先级 |

## 相对方案的补充与限制

- 增加附件实时检查、阅读字段写回和桌面 Zotero 来源修正，原因是独立审查确认原数据链不能支撑新筛选。全库扫描仅在使用附件筛选时进行；普通查询仍使用 SQL。返回给界面的附件状态与检查结果一致，外部恢复文件后可正常打开，不回写用户库。
- 「最近阅读」快捷筛选明确定义为最近 30 天；「已读完」按 PDF 阅读进度达到末页判断。历史上未写入数据库的阅读状态在后续阅读时补齐，历史来源不作推断回填。
- 为满足窄文库列的单行布局，视图选项在小于 480px 的面板中并入更多菜单；宽面板维持独立视图入口。
- MinerU 状态分批回填期间，筛选结果会随检测完成更新；全量状态就绪后包含全库匹配。文件检查失败可沿用既有标记以允许后续重试。

## 验证

- `npx tsc --noEmit`：通过。
- `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"`：**1018 / 1018 通过**，比 997 项基线增加 21 项，无失败或跳过。所有新条件加入 SQL／JS 对照请求列表，原有标题显示用例保留。
- 测试和构建均将 `TEMP`、`TMP` 指向仓库内 `.tmp-build/`；系统默认临时目录的一次测试因已知 esbuild 权限问题失败，切换目录后通过。
- `npm run build`：通过；仍有现有的 Browserslist、混合导入及包体积提示。
- `git diff --check`：通过。
- 独立样式审查的组件浏览器验证：212 项断言通过，覆盖中英文、浅深主题、288–960px 面板、菜单／弹层键盘操作、两位数筛选角标和最近阅读默认降序。截图已留存于本次会话产物；这是隔离组件验证，完整 Electron 流程仍按下列清单验收。
- 自动验证只使用内存桩、隔离 SQLite 和仓库内临时文件，未访问或写入用户真实文库。

### 仍需桌面验证

以下项目需在 `--user-data-dir=<空目录>` 或一次性复制库中验证：

1. 资源管理器实际定位原始／译版 PDF 与 MinerU Markdown／JSON；同目录加载开关与缺失文件提示。
2. 每种筛选单独及组合、跨页全选和批量操作、退出重启后的筛选恢复；含大库 MinerU 后台状态回填。
3. 完整 Electron 阅读流程打开、滚动至末页、切回文库，确认未读／在读／已读完与最近阅读排序；桌面 Zotero 分类导入后的来源。
4. 1040px／1440px 窗口和窄文库列，在浅色／深色主题、实际显示缩放下检查工具栏、弹层、焦点与 toast。

## 改动文件

| 范围 | 文件 |
| --- | --- |
| MinerU 定位 | `src/features/literature/paperFileLocations.ts`、`usePaperFileLocationMenu.tsx`；`tests/paperFileLocations.test.ts` |
| 筛选状态与查询 | `src/features/literature/libraryFilters.ts`、`useLibraryFilters.ts`、`selectionFilterGuard.ts`、`useSelectionFilterGuard.ts`、`useLibraryQueryRefresh.ts`；`src/types/library.ts`、`src/services/library.ts` |
| 顶栏与列表 | `src/features/literature/components/LiteratureToolbar.tsx`、`LiteratureFilterPopover.tsx`、`LiteraturePaperList.tsx`；`src/features/literature/LiteratureLibraryView.tsx` |
| 后端 | `electron/backend/libraryQuery.cjs`、`libraryStore.cjs`、`libraryCommands.cjs`、`libraryDatabaseStore.cjs`、`libraryAttachmentAvailability.cjs` |
| 阅读数据接通 | `src/features/literature/libraryEvents.ts`；`src/features/reader/DocumentReaderTab.tsx`、`libraryReadingProgress.ts`、`useLibraryReadingTracking.ts` |
| 共享界面 | `src/ui/commands.ts`、`menu.tsx` |
| 新增及扩展测试 | `tests/libraryFilters.test.ts`、`libraryQuery.test.ts`、`libraryAttachmentAvailability.test.mjs`、`libraryReadingImport.test.mjs`、`libraryReadingProgress.test.ts`、`libraryReadingTracking.test.ts`、`libraryQueryRefresh.test.ts`、`selectionFilterGuard.test.ts`、`uiCommands.test.ts` |
| 文档 | `docs/USER_MANUAL.zh-CN.md`、`docs/plans/2026-11-16-library-reader-ui-simplification.md`、`docs/changes/2026-11-16-ui-p0-p1-overview-cache-and-reveal.md`、本记录 |
