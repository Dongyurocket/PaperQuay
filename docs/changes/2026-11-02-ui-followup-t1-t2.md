# 2026-11-02 - UI 收尾 T1/T2：文献卡片交互实机补验与计划文档状态校正

## 现象

1. 交接文档 `docs/plans/2026-11-02-ui-followup-handoff.md` 的 T1 把「单选、Ctrl 多选、拖拽排序、拖到分类」四项列为未验证：阶段 1 受限于 Cua 后台输入不支持修饰键，后三项被跳过。
2. 同文档 T2 指出两份计划文档头部状态与代码不符：`2026-09-23-performance-reader-outline-and-rag-context.md` 仍写「设计方案，尚未实施」，`2026-11-01-reader-assistant-sidebar-resize-stuck.md` 没有状态行。

## 根因

1. T1 的缺口在验证手段而非代码：后台键盘输入不携带修饰键，无法完成 Ctrl+点击；拖拽与分类落点则需要连续 pointermove，后台点击也不适用。
2. T2 是状态行未随实施同步：目录面板与 `src/features/pdf/pdfOutline.ts`、`src/features/reader/readerResourceBudget.ts`、`src/features/reader/mineruParseWorker.ts`、跨分页全选（`handleToggleSelectAll`/`selectAllState`）以及 `electron/backend/ragStore.cjs` 的 `getChunkContext` 均已在 `main`；`2026-11-01` 对应的修复提交 `b7233f2` 也已在 `main`。

## 修改

- 代码未改动（T1 是纯验证）。
- `docs/plans/2026-09-23-performance-reader-outline-and-rag-context.md`：状态改为「已实施（2026-11-02 核验交付物；7.1 性能基线未实测）」，新增「0. 实施核验」小节逐项列代码证据。
- `docs/plans/2026-11-01-reader-assistant-sidebar-resize-stuck.md`：新增「状态」小节，注明修复提交 `b7233f2` 已在 `main` 及其落地文件。
- `docs/plans/2026-11-02-ui-followup-handoff.md`：状态行改为进行中，补齐 T1/T2 完成情况，并在「已知陷阱」新增第 8、9 条（见「验证」）。
- `docs/changes/2026-11-02-ui-followup-t1-t2.md`：本记录。

## 验证

实机路径按交接文档第五节：`node electron/build.cjs --dir --config.directories.output=release/local-ui-t1` 打包，整体复制到 `%TEMP%\pq-ui-t1` 后启动，Cua 前台操作（已获用户授权）。应用 UIA 树为空，坐标按窗口截图换算（`screen = 窗口原点 + 预览像素 / imageScale`）。

| 交互 | 结果 | 证据 |
| --- | --- | --- |
| 单选 | 通过 | 点击第 2 张卡，右侧详情标题由第 1 篇切到「面向任务的倾转旋翼 eVTOL 推进系统多学科设计优化」，第 2 张卡高亮 |
| Ctrl 多选 | 通过 | 真 Ctrl 按住 + 鼠标点击（`keybd_event` Ctrl 按下，`mouse_event` 点击，Ctrl 释放）：首次点击出现批量工具条「已选 1 篇」，再 Ctrl 点击第 4 张卡变「已选 2 篇」，两行均打勾 |
| 拖拽排序 | 通过 | 切「手动排序」后把第 2 行把手拖到第 1 行上方，列表顺序交换并提示「文献排序已保存」；`papers.sort_order` 被重写为 `0..n`；重启应用后顺序保留；切到「名称 A-Z」后再拖拽无效果（把手禁用态成立） |
| 拖到分类 | 通过 | 把第 1 张卡拖到左栏「医疗与eVTOL」，该分类计数 13→14 并提示「已添加到分类」，`paper_categories` 新增归属；重启应用后计数与归属保留 |

与交接文档描述的差异：多选达到 2 篇及以上时，右栏显示「批量操作」面板（`LiteratureLibraryView.tsx:3135` 的 `selectedCount >= 2`），不是 T1 表格写的「右栏保持最后点击项」；只有选中 1 篇时右栏才保留最后点击项的详情。该行为是有意设计，本次按实际记录，未改代码。

数据边界：实机验收会写真实文库（Electron 的应用数据路径不随 `$env:APPDATA` 变化）。验证前已把 `paperquay-library.sqlite` 备份到 `%TEMP%\pq-ui-t1-appdata`，验证结束后整体还原，`Get-FileHash` 与备份一致；还原后顺序为 `-147…`、该分类 13 篇、目标文献归属 1 条。本地截图（未入库）在 `.tmp-build/ui-t1/01-single-select.png` ~ `06-persisted-after-restart.png`。
