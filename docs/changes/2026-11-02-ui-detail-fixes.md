# 2026-11-02 - 界面细节修正（图谱标签、笔记遮挡与混排、设置表单、双栏命名）

同一批 UI 缺陷修正的合并记录；卡片塌陷因信息量大，单独记在 `2026-11-02-library-card-container-query.md`。

## 现象

1. **知识图谱**：节点标签固定 9px 且无缩放抽稀，191 个节点总览时全图退化为不可读细线；窗口最大化后图谱仍挤在左侧、右侧大片空白；画布内没有图例，也没有缩放按钮。
2. **笔记**：切换「图谱」的小按钮是浮层，直接压住笔记标题首行；右侧栏出现 `OUTLINE`、`BACKLINKS`、`No backlinks`、`Saved`、`Template` 等英文标签，与中文界面并列；「Saved」状态文字与底部「Save」按钮同时常驻，构成双保存入口；中文正文底部显示 `67 words`。
3. **设置**：「设置」作为眉标和大标题各出现一次；Vault 同步间隔的输入框与「分钟」单位分处两列；`GB/T 7714` 下拉框没有任何标签。
4. **阅读器**：顶部 PDF 布局切换里有「双栏对照」，右侧文本区又有「双栏对照」，两处同名但控制的是完全不同的东西。

## 根因

1. 图谱 `graphStyles` 里 `'font-size': 9` 为固定值，未用 cytoscape 的 `min-zoomed-font-size` 做缩放抽稀；`cy.resize()` 只在 `workspaceActive` 变化时调用，没有监听容器尺寸变化。
2. 笔记切换按钮用 `absolute left-3 top-3 z-20` 定位在工作区主区左上角，而编辑器从同一位置起排，必然重叠。`NoteEditor` 的文案表是一张混着中文与未翻译英文的 `TEXT` 常量（`NoteEditor.tsx:287` 附近），与界面语言无关；字数直接取 Tiptap characterCount 的 `words()`，对无空格的中文没有意义。
3. 设置左栏同时渲染了 `uppercase` 眉标与大标题；Vault 间隔用独立 `<span>分钟</span>` 与 number 输入并排，引用格式 select 直接接在容器里没有 label。
4. `BlockViewer.tsx` 的文本显示模式与 `readerWorkspaceHeader.tsx` 的 PDF 布局模式各有一套「双栏对照」文案。

## 修改

**图谱（`src/features/graph/KnowledgeGraphWorkspace.tsx`）**

- 新增 `NODE_COLORS` 常量，节点类型配色与画布图例共用同一份值，避免两处硬编码漂移。
- 节点字号改为 `mapData(size, 20, 60, 10, 13)`（hub 节点略大）。
- 标签抽稀改用**数据驱动**（首版用 `min-zoomed-font-size` 做缩放阈值，实机发现无效，已改）：`toElements` 根据节点规模排序，只在总览时标注前 20% 的 hub（节点数 ≤40 时全标），写入 `displayLabel`；`data(label)` 保留给选中态与放大态。选中节点通过 `node:selected` 样式强制显示标签；用户放大到 1.15 倍后给全部节点加 `.label-all` 类恢复标签。
  - 为何不用缩放阈值：隐藏标签会让节点包围盒变小，`fit` 随即把视图放大，标签又重新满足显示条件，形成反馈振荡，总览仍然是一片重叠文字。
- 新增 `ResizeObserver`：容器尺寸变化（拖侧栏、窗口最大化、分屏）时 debounce 180ms 调 `cy.resize()`；若用户未手动缩放/平移（`userAdjustedViewRef`），同时 `cy.fit()` 重新适配。`zoom`/`dragpan` 且 `originalEvent` 存在时标记为手动；重跑布局与点「适配视图」时清除标记。
- 画布右下角新增常驻控件：缩小、放大、适配视图三个按钮（均带 `title` 与 `aria-label`），以及文献/笔记/标签/分类四色图例。

**笔记（`NoteEditor.tsx`、`NoteEditorToolbar.tsx`、`NotesWorkspace.tsx`）**

- `NotesWorkspace` 主区：把图谱切换按钮从绝对定位浮层改为文档流内的一行工具条，标题不再被遮挡；图谱视图去掉为浮层预留的 `mt-9`。
- `NoteEditor`：`TEXT` 常量改为 `NOTE_TEXT` 的中英二元组表 + `localizeNoteText(l)`，组件内用 `useMemo` 按当前界面语言取值；`formatNoteLength()` 判断正文是否含 CJK，中文报「N 字」、西文报「N words」。
- 保存态改为安静呈现：顶部状态文字仅在保存中/有未保存改动时出现；底部保存按钮仅在 dirty 或保存中时显示，不再与静态「已保存」同时常驻。
- 本地化残留英文：`Outline`→大纲、`No backlinks`→暂无反向链接、`Hide outline`→隐藏大纲、`Search`→搜索、`Template`/`Templates`→模板/插入模板、`Backlinks`→反向链接；图谱切换按钮与提示一并走 `l()`。

**设置（`ReaderPreferencesWindow.tsx`、`readerPreferencesContent.tsx`）**

- 删除重复的「设置」眉标，只保留大标题。
- Vault 同步间隔与引用格式改为两个带标签的字段，`sm:grid-cols-2` 并排；单位「分钟」移入输入框内部作后缀，去掉独立的 spinner 列。

**阅读器（`BlockViewer.tsx`、`readerWorkspaceHeader.tsx`、`PdfViewerToolbar.tsx`）**

- 文本显示模式：`双栏对照` → `原文 + 译文`（en: Original + Translation）。
- PDF 布局模式：`PDF 阅读` → `单栏 PDF`、`双栏对照` → `PDF 双栏`，与文本区彻底区分。
- `PdfViewerToolbar.tsx:304` 的 `l('Delete Selected', 'Delete Selected')` 是中文串里直接写了英文，改为 `l('删除所选', 'Delete Selected')`。

## 验证

`npm run build` 通过（TypeScript 无错误）；`npm test` 全绿（865 项）。

### 实机验证（2026-11-02，Computer Use）

用当前代码打包为 `win-unpacked` 后启动真实应用逐项确认：

- **图谱**：总览只标注 hub（约 38 个）节点，连线与配色变得可读（修复前 191 个标签全部绘制、重叠成噪声）；点两次放大后全部标签恢复且清晰；画布右下角图例（文献/笔记/标签/分类）与缩放/适配按钮均正常显示；图谱居中铺满画布。
- **笔记**：顶部「图谱」入口已在文档流内，标题完整可见、无遮挡；右侧栏为「大纲 / 参考文献 / 反向链接 / 暂无参考文献 / 暂无反向链接」全中文；底部字数显示「2072 字」；工具栏「模板」已中文化；静态「已保存」不再常驻，底部只在有未保存改动时出现「保存」。
- **设置**：只有一个「设置」标题；`同步间隔` 控件显示为 `30 分钟`（单位在框内、原生上下箭头已隐藏）；`引用格式` 有标签且 `GB/T 7714` 正常显示；两个字段并排两列。
- **阅读器**：顶部 PDF 布局为 `PDF / 双栏 / 对照`，右侧文本区为 `原文 MinerU / 译文·中文 / 原文 + 译文`，同名冲突已消除；`删除所选` 已中文化。

### 撤回一项（已用实机确认判断正确）

计划里「导出批注 PDF 浮层压住 PDF 正文」经代码核对与实际截图确认为误判：该按钮位于 `PdfViewerToolbar` 的 `flex flex-wrap` 换行行内，与下方 PDF 画布之间有真实间隙，无绝对定位、不重叠。本次未改动其位置。

### 未覆盖

卡片条目里的 Ctrl 多选、拖拽排序、拖到分类三项需悮饰键或拖拽手势，Cua 在该窗口的后台输入不支持修饰键（返回 `refused`），未验证；本次未改动任何事件处理。
