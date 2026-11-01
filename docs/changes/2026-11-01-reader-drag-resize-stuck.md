# 2026-11-01 - 阅读界面拖拽松手后宽度仍跟随鼠标

## 现象

文献阅读界面三栏布局（PDF | 翻译/结构块 | 问答侧栏）中，拖动问答侧栏左侧分隔条调整宽度后松开鼠标，拖拽状态没有结束，侧栏宽度继续跟随鼠标移动，无法固定。PDF / 翻译分栏和浮动问答面板使用同一套拖拽实现，存在同样的隐患。

## 根因

拖拽结束完全依赖 `window` 收到 `pointerup`，以下情况收不到：

- 鼠标在问答 HTML 回答的 `<iframe>` 上松开。事件派发给 iframe 自己的 document，不冒泡到父窗口，移出 iframe 后父窗口重新收到 `pointermove`，宽度继续跟随。
- 鼠标移出应用窗口后松开，或 Alt+Tab、触控板手势打断拖拽。
- 分隔条未使用 Pointer Capture，`pointermove` 也不检查 `event.buttons`，漏掉 `pointerup` 后没有任何兜底。

加重因素：问答侧栏外层带 `transition-[width] duration-300`，拖动中每次改宽度都触发 300ms 动画，松手后宽度还会滑动一段。

## 修改

- 新增 `src/features/reader/usePointerDragResize.ts`。`startPointerDrag` 对分隔条调用 `setPointerCapture`，后续指针事件重定向到分隔条并冒泡到 `window`，鼠标经过 iframe、PDF 画布或移出窗口都能收到 `pointerup`；同时以 `pointercancel`、`lostpointercapture`、`window.blur` 和 `buttons === 0` 四路兜底结束。
- `Reader.tsx`（问答侧栏）、`DocumentReaderTab.tsx` + `ReaderWorkspace.tsx`（PDF / 翻译分栏）、`readerFloatingAssistantPanel.tsx`（浮动面板）三处拖拽改走该 Hook，原 `window` 监听 effect 删除，边界计算（`MIN/MAX_ASSISTANT_PANEL_WIDTH`、`mainRect.width - 120`、`clampPaneRatio`）保持不变。
- 拖拽期用 `resizing` / `resizingSplit` 把侧栏与左右分栏切到 `transition-none`，松手后不再有 300ms 滑动；非拖拽时过渡动画不变。
- `src/app/index.css` 增加 `body.pq-resizing { user-select: none }` 与 `body.pq-resizing iframe { pointer-events: none }`，作为 iframe 吞事件的第二道保险。
- 两处尺寸持久化改为拖拽结束写一次：侧栏宽度写 `ASSISTANT_PANEL_WIDTH_STORAGE_KEY`，PDF 分栏比例写 `PANE_RATIO_STORAGE_KEY`；双击分隔条重置布局仍会落盘 0.5。

## 验证

- `tsc --noEmit` 无错误；`vite build` 成功。
- `tests/` 全量 865 项通过。新增 `tests/pointerDragResize.test.ts` 4 项：指针捕获与 body 状态恢复、`buttons === 0` 提前结束、三个兜底出口、非左键与其他 `pointerId` 的忽略。
- 打标签前未做 Electron 手工回归（本机依赖以 `--ignore-scripts` 安装，未下载 Electron 二进制），计划文档中的拖动验收项待补。
