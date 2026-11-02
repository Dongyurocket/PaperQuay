# 2026-11-02 - 合并两套右键菜单为 `src/ui/menu` 原语（T5）并删除死代码

## 现象

- 仓库里有两份右键菜单实现：`src/components/ContextMenu.tsx`（110 行）与 `src/features/notes/NotesContextMenu.tsx`（177 行）。两者的 props、类型结构、分隔符判定、菜单高度估算与贴边钳制逐行相同，笔记侧只多出两个文本选择判定函数。
- `src/components/ContextMenu.tsx` 被 3 处使用（`TabBar`、`BlockViewer`、`PdfViewer`），`NotesContextMenu.tsx` 被 4 处使用（`NoteBlockControls`、`NoteEditor`、`NotesSidebar`、`NotesWorkspace`）。
- T4 遗留：`src/features/literature/components/LibrarySettingsDialog.tsx` 全仓无挂载点。

## 根因

- 菜单外壳是从一份实现复制出来的，后续任何行为调整都要两份同步，容易漂移；设计规范要求共享浮层原语集中在 `src/ui/`。
- `LibrarySettingsDialog` 的 13 个设置字段已在 `src/features/reader/readerPreferencesContent.tsx` 中实现（阅读器偏好 → 本地文库），该组件本身没有入口，属死代码。

## 修改

1. **新增唯一实现 `src/ui/menu.tsx`**：导出 `Menu` 组件与 `MenuItem` / `MenuEntry` 类型；保留 `x` / `y` / `title` / `entries` / `onClose` / `width` 全部 props 语义。分隔符、`tone="danger"` / `"accent"` 配色、`estimateMenuHeight` + `clampPosition` 贴边钳制、点击遮罩/再次右键关闭、Portal 渲染与无 DOM 环境退化全部原样搬迁，未新增子菜单、快捷键提示或键盘导航（原实现本来就没有）。
2. **新增 `src/features/notes/noteContextMenuTargets.ts`**：`isEditableContextTarget` / `hasActiveTextSelection` 原样搬移；原 `NotesContextMenu.tsx` 继续 re-export，notes 侧导入路径不变。
3. **两个旧模块改为薄 shim**，7 个调用点零改动：
   - `src/components/ContextMenu.tsx`：`export { Menu as ContextMenu }` + `ContextMenuEntry` / `ContextMenuItem` 类型别名；
   - `src/features/notes/NotesContextMenu.tsx`：`export { Menu as NotesContextMenu }` + `NotesContextMenuEntry` / `NotesContextMenuItem`，并保留 `shouldUseNativeTextContextMenu`、`copyTextToClipboard` 与两个辅助函数的 re-export。
   - 这是有意的取舍：一次提交不同时改 7 处 import，降低回归面。下一步可把 7 个调用点改为直接 import `src/ui/menu` 与 `noteContextMenuTargets`，然后删除两个 shim。
4. **删除死代码** `src/features/literature/components/LibrarySettingsDialog.tsx`。
5. **文档**：`docs/ui-design-system.md` 组件表新增 `src/ui/menu.tsx` 行并去掉已删组件的引用；`docs/plans/2026-11-02-ui-followup-handoff.md` 补 T5 完成情况。

## 验证

- `npm run build` 通过；`npm test` 869 项全绿（`TEMP`/`TMP` 指向 `.tmp-build`）。
- 唯一实现：`grep -rl "clampPosition" src --include=*.tsx` 只命中 `src/ui/menu.tsx`（两个 shim 是纯 re-export，不含该函数）。
- 调用点零改动：`git status` 中不出现 7 个调用点文件，改动集合仅 2 个 shim、2 个新文件、1 个删除。
- 死代码证据（删除前）：`git grep -n "LibrarySettingsDialog"` 只命中自身定义与 `docs/` 记录，没有任何 import / 挂载点；13 个设置字段在 `readerPreferencesContent.tsx` 中均存在（`openAlexEnabled` / `openAlexApiKey` / `openAlexMailto` / `importMode` / `fileNamingRule` / `createCategoryFolders` / `preserveOriginalPath` / `folderWatchEnabled` / `autoRenameFiles` / `storageDir` / `translatedPdfDir` / `zoteroLocalDataDir` 各 3–4 处；`backupEnabled` 仅出现在默认设置对象中，UI 侧本就没有开关）。
- 实机验收（打包到 `%TEMP%` 启动，浅色/深色各一轮）：

| 菜单 | 触发 | 打开 | 选项可用 | 点外部关闭 | 位置钳制 |
| --- | --- | --- | --- | --- | --- |
| 标签栏 | 右键「我的文库」标签 | 标题「我的文库」+ 5 项 + 分隔线 | 「关闭标签」为 error 红色且库标签禁用（UIA `isEnabled=false`） | 关闭后 UIA 再查无该项 | 触发点在顶部，未产生位移；使用同一 `clampPosition` |
| 笔记块 | 右键笔记正文段落 | 标题「Quote」+ 14 项，超出时内部滚动（`max-h` 420px） | 「设为一级标题」UIA `isEnabled=true`，item class 与统一原语一致 | 同上 | 是：菜单顶边高于点击点（长菜单改为向上放置） |
| 文库分类 | 右键「能源动力与电推进系统」 | 3 项（新建子分类 / 重命名分类 / 删除分类） | 「删除分类」红色 | 同上 | 该菜单是独立实现，代码中没有 `clampPosition`，触发点未越界 |

- 证据截图（本地，未入库）：`.verification-20261102-t5/` 下 `tabbar-menu-light.png`、`noteblock-menu-light.png`、`category-menu-light.png`、`tabbar-menu-dark.png`、`noteblock-menu-dark.png`。
- 真实数据保护：验证前备份 `paperquay-library.sqlite` / `paperquay-notes.sqlite`，验证后 `Get-FileHash` 与备份一致（SHA256 前缀 `24E68F64…` / `88F16E84…`），本轮未写真实库。

## 存疑与未覆盖

- **文库分类右键菜单是第三套独立实现**：`LiteratureCategorySidebar.tsx` 自己 `createPortal` 一个 `pq-acrylic` 浮层（`z-[10000]`），没有 `clampPosition`、没有统一宽度与 item 度量，视觉与另外两处不同。本轮只合并了两套 `ContextMenu`，未动它；「三处菜单完全一致」目前只在统一原语覆盖的标签栏与笔记块成立。若要彻底统一，需要把分类菜单也改成 `Menu`（涉及样式归一，建议单独立项）。
- **横向钳制没有构造出实测场景**：窗口足够宽，三个菜单的触发点都不在右侧 224px 内，只实测到纵向（下方）钳制；横向分支与纵向共用同一个 `clampPosition`，按代码推导成立。
- **`PdfAnnotationWorkspace.tsx` 核查结论**：`git grep -n "PdfAnnotationWorkspace"` 只命中自身定义与一份计划文档的引用，无任何 import / 挂载点，疑似死代码；**本轮未删除**，等确认。
- `backupEnabled` 在 `readerPreferencesContent.tsx` 只是默认值，没有对应控件；由于被删组件本来就没有入口，不存在能力回退。
- 打包目录 `release/local-ui-t5` 与 `%TEMP%\pq-t5` 的 `app.asar` 会被 Proma 句柄锁定，需要重启 Proma 后再清理。
