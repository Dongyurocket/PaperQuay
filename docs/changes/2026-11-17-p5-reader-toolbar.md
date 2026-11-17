# 阅读器顶栏与工具栏（第 0 步、P5、P6）

2026-11-17，分支 `ui/p5-reader-toolbar`，基于 `main@922fefa`（已发布 0.4.29）。本轮没有改版本号、提交、推送或发版；没有修改 library、知识库或 RAG 的 schema / `user_version`，没有写入真实文库。

## 第 0 步：概览显示与新手引导残留

### 0a：文库详情概览本地化

- `formatPaperSummaryForLibrary` 继续写入固定英文 Markdown 标题。这个格式被文库查询、MCP、知识库和 Agent 使用，因此本轮只在旁边补充稳定格式注释，没有回写或迁移已有 `ai_summary`。
- `src/features/reader/overview/summarySections.ts` 现在同时提供标题识别和共享的中英文标签表，识别了 `Takeaways`/「要点」/「启示」以及 `Keywords`/「关键词」。
- 文库详情改用 `parsePaperOverviewForDisplay`：已知标题按当前界面语言即时显示，未知标题保留原文；没有标题的旧文本显示本地化的「概览」。切换中英文只重新渲染显示标签，不重新生成概览。
- `Keywords` 节只在其中的 AI 关键词（不区分大小写）全部已在文献元数据关键词中时隐藏；有任何新词就照常显示，避免 AI 关键词在文库详情中无处可见。存储文本和阅读器概览页的结构化内容不变。
- 全仓检查 `ai_summary`、概览缓存和 `formatPaperSummaryForLibrary` 的使用点后，只有文库详情属于 Markdown 标题的界面展示路径。MCP 的 `aiSummary`、library 查询字段、导出或缓存读写继续保留原始英文 Markdown，作为数据接口和存储格式不做显示层本地化。

### 0b：新手引导整体移除

- 删除 `src` 中全部 `data-tour` 属性和 `dataTour` prop，并去掉只为锚点增加的包装层；删除 `tests/onboardingTourAnchors.test.ts`，更新概览测试保留原有行为断言。
- 移除 onboarding 资源的 `.gitignore` 例外和已过时的规划说明。`OnboardingGuide` 及运行接线此前已由上游提交 `5adc5e3` 删除，本轮清掉最后的 UI 锚点和契约测试。
- `onboarding:` 前缀兼容分支保留在 `src/features/notes/notePaperTarget.ts`。依据是 notes 库的 `notes.paper_id` 会持久化目标键；旧欢迎文档的笔记目标仍可能存在。当前代码没有创建 `onboarding` 来源的路径，所以这只是旧数据读取兼容，不会产生新 onboarding 文档。`tests/notePaperTarget.test.ts` 锁定旧键原样解析，避免被改写成 `native-library:onboarding:…` 后断开笔记。
- P4 记录已改为说明引导锚点被删除，不再保留「恢复引导后补流程」的待办。

## P5：阅读器顶栏和工具栏

- 顶栏压缩为 40px：移除面包屑大写行、作者行和 `headerCollapsed` 状态，不再读写 `WORKSPACE_HEADER_COLLAPSED_STORAGE_KEY`，残留 localStorage 值不清理。标题单行省略，文档来源、作者、年份、文件名、状态、当前块和快捷键提示集中到 `ⓘ` tooltip。
- 「概览 / 阅读」和 PDF 视图切换改为 32px 图标分段；窄宽只保留图标，宽屏显示文字，均带 `aria-label` 和 `title`。PDF 版本下拉只在存在多个版本时出现；沉浸模式改为图标入口，低频处理动作进入共享 `Menu`。
- `PdfViewerToolbar` 改为不换行的 36px 工具行：工具按钮为 32px；颜色色块和 Custom 合并为当前颜色按钮与颜色弹层；页码支持 Enter 跳转、Esc 还原和越界夹取；缩放支持适合宽度、适合页面、100%。热力图、导出批注 PDF 和其他低频项进入「⋯」。
- 「删除所选」只在 `hasSelectedEditor` 时出现，并保留输入框焦点保护；现有 Delete/Backspace 逻辑继续只处理已选批注。保存、错误和翻译反馈使用 toast bridge，翻译进度使用工具行底部细进度线。
- 结构化阅读工具行删除常驻药丸和提示药丸，块数、译文块数和联动说明并入 `ⓘ` tooltip；显示模式选中态使用 accent-soft，工具行统一 36px。空状态文案也改为中英文成对本地化。
- 底栏已删除：状态、当前块、「单击预览，双击进入阅读」和 Ctrl+滚轮缩放提示并入顶栏 ⓘ tooltip；解析或翻译进行中时 ⓘ 改为旋转进度图标，并在 `aria-label` 中带上状态文本。
- 沉浸模式由纯函数派生可见性：隐藏顶栏和各窗格工具行，只保留退出入口；命令只由当前激活的阅读标签注册，避免多个挂载标签共用同一命令 id 时互相覆盖；在 `src/ui/commands.ts` 注册 `mod+shift+f`（Windows 为 Ctrl+Shift+F），Esc 退出。P2 的 `mod+f` 搜索和 `mod+k` 命令面板保持独立，输入框焦点规则不变。
- 对照模式保留两个独立工具行和原有同步逻辑；`ReaderWorkspace.tsx` 只接入可见性，不改对照同步区段。`PdfViewer`、`TranslatedPdfPane`、`BlockViewer` 和 `ReaderWorkspaceHeader` 的组件名及 `currentPage`/`pageCount` props 保持不变。

### 纯函数与回归测试

- `pdfToolbarLogic.ts` 覆盖按容器宽度和优先级分配溢出项、页码解析/夹取、缩放预设映射。
- `readerImmersive.ts` 覆盖沉浸可见性和快捷键命令配置；命令快捷键与 `mod+f`、`mod+k` 的冲突关系有测试锁定。
- `pdfViewerPageCountLifecycle`、对照同步和 Delete 键既有回归测试保持通过；`pqCssTokens` 继续验证所有 `--pq-*` 引用有定义。

## P6：文档和契约收尾

- `docs/ui-design-system.md` 登记 40px 顶栏、36px 工具行、32px 按钮和禁止换行的容器溢出约定。本轮复用已有 `.pq-toolbar`、`.pq-icon-button`、`.pq-nav-item.active`，没有新增 `.pq-icon-button-accent` 等全局 CSS 变体。
- `docs/USER_MANUAL.zh-CN.md` 补充页码跳转、颜色弹层、缩放预设、「⋯」菜单、沉浸快捷键、底栏移除、结构化阅读提示和文库详情概览本地化说明；删除新手引导相关说明。
- `src/ui/menu.tsx` 已具备 P2 补充的 `role="menu"`、`menuitem`/`menuitemcheckbox`、焦点移入、Esc/Tab 返回触发按钮，以及 ArrowUp/ArrowDown/Home/End 键盘导航。本轮复核其实现和所有 P5 菜单调用，未重复实现菜单或新增修改。
- P0–P5 验收证据按既有记录复核：P0 的缓存与同步、P1 的位置菜单、P2 的筛选/分页、P3a/P3 的字段与详情、P4 的概览页均有对应测试或组件记录；P4 的 0.4.29 安装版用户验收已通过。P5 的自动化验收已通过，完整桌面视觉验收仍列在本文末尾。

## 独立审查与反驳复核

版式/主题/可访问性方向复核了顶栏高度、工具行不换行、图标按钮名称、菜单键盘焦点、深浅主题令牌和输入框中的 Delete 行为；逻辑/回归方向复核了概览存储格式、MCP 原始输出、页码夹取、PDF 版本数量、沉浸快捷键冲突、对照同步接线和 `onboarding:` 旧键兼容。确认成立的问题已在本轮修复：PDF 阅读路径残留的渐变、白色背景、Slate 类名和原始 `rgba` 已替换为现有 `--pq-*` 令牌；结构化阅读空状态的英文硬编码已本地化。

## 发版前复审（0.4.30）

发版前对全部改动按「阅读器逻辑」「概览与引导」「界面规则与可访问性」三个方向做了独立审查，每条发现再由独立复核尝试反驳。确认成立并已修复：

- 多个阅读标签同时挂载时，沉浸命令被隐藏标签以 `available=false` 覆盖或在关闭时删除，`Ctrl+Shift+F` 失效；改为只由激活标签注册。
- `toast()` 对 `duration: 0` 仍设置 0ms 计时，翻译进度 toast 一出现就消失；同 key 替换时旧计时器也会提前关掉新 toast。改为 0 不计时，并按 id 管理、替换时清除计时器。翻译进度 toast 的 key 改为每个 PdfViewer 实例独立，卸载时撤下。
- 「导出批注 PDF」只在「⋯」菜单里，而「⋯」在未启用热力图、无选中批注且宽度足够时不显示，导致无法导出；「⋯」改为常驻。
- 窄宽时被收进「⋯」的工具组、翻页和缩放组在菜单里没有对应项；现在菜单给出四个批注工具、上一页/下一页、缩小/放大和三个缩放预设。颜色按钮和「⋯」的宽度计入溢出分配。
- 颜色弹层和缩放预设被 `overflow-hidden` 的工具行裁掉；颜色弹层改为 portal 到 body，缩放预设改用共享 `Menu`。
- 页码输入按 Esc 后 blur 又把输入值写回；现在 Esc 真正还原为当前页。
- 底栏原本只在沉浸模式下隐藏而未删除；已按方案删除并把提示并入 ⓘ。
- 文库详情把 `Keywords` 节无条件隐藏，AI 关键词与元数据关键词不同时无处可见；改为仅在完全重复时隐藏。
- 概览小标题本地化后同名节可能产生重复 React key；改为带序号的 key。顶栏沉浸快捷键提示改由 `formatShortcut` 生成，macOS 显示正确按键。

复核驳回 7 条（如 Shift 组合键在输入框内触发、引导测试断言被削弱、单版本时不显示版本名等），理由是行为与基线一致或不构成缺陷。

## 验证

- `npx tsc --noEmit`：通过。
- P5 专项：**31 / 31 通过**，包含工具栏纯函数、沉浸可见性/快捷键、命令注册、PDF 生命周期和 CSS 令牌契约。
- 全量：**1103 / 1103 通过**，串行执行并将 `TEMP`/`TMP` 指向仓库内 `.tmp-build/`。相对 0.4.29 的 1094 项基线，删除引导锚点测试 2 项，新增第 0 步 6 项（含发版前复审补充的关键词去重测试）和 P5 5 项，净增加 9 项。
- `git diff --check`：通过（完成最终文档和代码修改后复跑）。

## 安装版验收

2026-11-17，用户安装 0.4.30 后完成桌面验收，未发现问题。覆盖文库详情概览小标题中英文切换、单行顶栏与 ⓘ 信息、颜色弹层与缩放预设、页码跳转与 Esc 还原、「⋯」菜单与窄宽溢出、多标签下的沉浸快捷键、翻译进度提示、对照视图同步、多 PDF 版本和深浅主题。下段为发版前的原始记录，保留备查。

## 发版前记录：隔离桌面验证受阻

需要在空的 `--user-data-dir` 或一次性复制库中完成 1040×720 与最大化窗口、浅色/深色主题、中英文界面、单栏/双栏/对照、单 PDF/多 PDF 版本以及沉浸模式进入/退出的 Electron 视觉和操作验收。需要量测单栏顶栏装饰总高度 ≤90px、确认双栏工具行不换行，并把截图保存到 `.tmp-build/p5-screenshots/`。这些验证不应连接或写入用户真实文库。本轮已尝试隔离 Web 预览和 Electron 启动：浏览器预览因缺少 Electron bridge 呈空白，隔离 Electron 进程在当前 Windows 会话中以 `0x80000003` 退出，未生成截图；因此上述桌面项目仍保持待验收。

## 改动文件

| 范围 | 文件 |
| --- | --- |
| 概览本地化与兼容 | `src/features/reader/overview/summarySections.ts`、`src/features/literature/details/paperOverviewPresentation.ts`、`src/features/literature/components/LiteraturePaperDetails.tsx`、`src/features/reader/readerShared.ts`、`tests/summarySections.test.ts` |
| 引导残留与旧笔记键 | `src/app/App.tsx`、`src/features/literature/LiteratureLibraryView.tsx`、`src/features/literature/details/PaperDetailsStatusBar.tsx`、`src/features/reader/Reader.tsx`、`src/features/reader/ReaderWorkspace.tsx`、`src/features/reader/readerWorkspaceHeader.tsx`、`src/features/reader/readerWorkspaceOverview.tsx`、`src/features/reader/overview/OverviewProcessMenu.tsx`、`src/features/reader/assistantSidebarPrimitives.tsx`、`src/features/reader/readerPreferencesContent.tsx`、`src/features/reader/documentReaderNotes.ts`、`src/features/notes/NotesWorkspace.tsx`、`src/types/reader.ts`、`src/features/notes/notePaperTarget.ts`、`tests/notePaperTarget.test.ts`、删除的 `tests/onboardingTourAnchors.test.ts` |
| P5 阅读器接线 | `src/features/reader/readerWorkspaceHeader.tsx`、`src/features/reader/ReaderWorkspace.tsx`、`src/features/reader/TranslatedPdfPane.tsx`、`src/features/blocks/BlockViewer.tsx`、`src/features/pdf/PdfViewer.tsx`、`src/features/pdf/PdfViewerToolbar.tsx`、`src/features/reader/readerImmersive.ts`、`src/ui/commands.ts`、`src/ui/toast.tsx`、`src/ui/toastBridge.ts` |
| P5 纯函数与测试 | `src/features/pdf/toolbar/pdfToolbarLogic.ts`、`tests/pdfToolbarLogic.test.ts`、`tests/readerImmersive.test.ts`、`tests/pdfViewerPageCountLifecycle.test.ts`、`tests/uiCommands.test.ts`、`tests/pqCssTokens.test.ts` |
| P6 文档 | `docs/ui-design-system.md`、`docs/USER_MANUAL.zh-CN.md`、`docs/plans/2026-11-16-library-reader-ui-simplification.md`、本记录 |

本轮不提交。
