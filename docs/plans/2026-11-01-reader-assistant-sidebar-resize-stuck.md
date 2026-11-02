# 阅读界面问答侧栏拖拽无法结束（宽度跟随鼠标）修复计划

## 状态

已修复（2026-11-02 核对：修复提交 `b7233f2` 已在 `main`；落地 `src/features/reader/usePointerDragResize.ts` 及 `AssistantSidebar.tsx`、`DocumentReaderTab.tsx`、`Reader.tsx`、`ReaderWorkspace.tsx`、`readerFloatingAssistantPanel.tsx` 的接入，另含 `tests/pointerDragResize.test.ts`）

## 现象

文献阅读界面三栏布局（PDF | 翻译/结构块 | 问答侧栏）。拖动问答侧栏左侧分隔条调整宽度后松开鼠标，拖拽状态未结束，侧栏宽度仍随鼠标移动，无法固定。

## 相关代码

| 位置 | 作用 |
| --- | --- |
| `src/features/reader/Reader.tsx:398-443` | 问答侧栏拖拽 effect：在 `window` 上监听 `pointermove` / `pointerup` |
| `src/features/reader/Reader.tsx:1160-1172` | 分隔条 `onPointerDown`：只执行 `setReaderAssistantPanelResizing(true)` |
| `src/features/reader/AssistantSidebar.tsx:229-233` | 侧栏外层容器带 `transition-[width] duration-300` |
| `src/features/reader/assistantSidebarChat.tsx:597` | 问答 HTML 回答用 `<iframe srcDoc>` 渲染 |
| `src/features/reader/DocumentReaderTab.tsx:4249-4283` + `ReaderWorkspace.tsx:500` | PDF / 翻译分栏拖拽，同一实现模式 |
| `src/features/reader/readerFloatingAssistantPanel.tsx:50-81` | 浮动问答面板拖动，同一实现模式 |

## 原因

拖拽结束完全依赖 `window` 收到 `pointerup`。以下情况 `window` 收不到该事件，`readerAssistantPanelResizing` 保持 `true`，之后所有 `pointermove` 继续改宽度：

1. **鼠标在 iframe 上松开（主因）**。问答侧栏的 HTML 回答渲染在 `<iframe>` 内。拖动时鼠标移入 iframe 区域，`pointermove` / `pointerup` 派发给 iframe 自己的 document，不冒泡到父窗口的 `window`。在 iframe 上松开鼠标，父窗口收不到 `pointerup`；鼠标移出 iframe 后，父窗口重新收到 `pointermove`，宽度继续跟随。这解释了为什么 PDF / 翻译分栏较少出现此问题：该分栏附近没有 iframe。
2. **未使用 Pointer Capture**。分隔条 `onPointerDown` 未调用 `setPointerCapture`，指针事件按鼠标所在元素派发。鼠标移出 Electron 窗口后松开、或系统中断手势（Alt+Tab、触控板手势、右键菜单弹出），都可能丢失 `pointerup`。
3. **未处理兜底事件**。没有监听 `pointercancel`、`lostpointercapture`、`window` 的 `blur`；`pointermove` 也不检查 `event.buttons`，即使左键已松开（`buttons === 0`）仍继续调整宽度。

加重因素：`AssistantSidebar` 外层容器有 `transition-[width] duration-300`。拖动时每次改宽度都触发 300ms 动画，鼠标停下后宽度仍会滑动一段，手感上像"固定不下来"。

## 修复方案

### 1. 抽取统一拖拽 Hook

新增 `src/features/reader/usePointerDragResize.ts`（或放在 `readerWorkspaceShared.ts`），供三处拖拽复用：

```ts
// 伪代码
function startPointerDrag(
  event: React.PointerEvent<HTMLElement>,
  { onMove, onEnd, cursor = 'col-resize' },
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  target.setPointerCapture(pointerId);

  const prevUserSelect = document.body.style.userSelect;
  const prevCursor = document.body.style.cursor;
  document.body.style.userSelect = 'none';
  document.body.style.cursor = cursor;
  document.body.classList.add('pq-resizing'); // 用于禁用 iframe 指针事件

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (e.buttons === 0) { end(); return; }   // 左键已松开，兜底结束
    onMove(e);
  };
  const end = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    target.removeEventListener('lostpointercapture', end);
    window.removeEventListener('blur', end);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    document.body.style.userSelect = prevUserSelect;
    document.body.style.cursor = prevCursor;
    document.body.classList.remove('pq-resizing');
    onEnd?.();
  };

  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('lostpointercapture', end);
  window.addEventListener('blur', end);
}
```

要点：

- `setPointerCapture` 让后续指针事件全部派发到分隔条，鼠标经过 iframe、PDF 画布或移出窗口都不影响；`pointerup` 必定送达。
- `pointercancel`、`lostpointercapture`、`window.blur` 三个兜底出口。
- `pointermove` 中 `buttons === 0` 立即结束，防止任何遗漏导致的"粘手"。
- 组件卸载时也要调用 `end`（hook 内用 ref 保存清理函数，在 `useEffect` cleanup 中执行）。

### 2. 拖拽期间屏蔽 iframe 指针事件

在全局样式（如 `src/index.css`）加入：

```css
body.pq-resizing iframe { pointer-events: none; }
```

Pointer Capture 已能解决主因，此项作为双重保险，也避免拖动时 iframe 出现悬停效果。

### 3. 拖拽期间关闭宽度过渡动画

- `AssistantSidebar` 新增 `resizing?: boolean` prop，`resizing` 为 `true` 时去掉 `transition-[width]`（改用 `transition-none`）。
- `Reader.tsx` 把 `readerAssistantPanelResizing` 传给 `AssistantSidebar`；外层 `<aside>` 的 `transition-all duration-300` 同样在拖拽时关闭。
- `ReaderWorkspace.tsx:449` 左侧 PDF 栏如有宽度过渡，同样处理。

### 4. 替换三处调用

| 位置 | 改动 |
| --- | --- |
| `Reader.tsx` | 删除 398-443 的 effect；分隔条 `onPointerDown` 改为调用 `startPointerDrag`，`onMove` 中计算并设置宽度；保留 `readerAssistantPanelResizing` 状态仅用于关闭动画 |
| `DocumentReaderTab.tsx` + `ReaderWorkspace.tsx` | 同样改造 PDF / 翻译分栏，`onStartResize` 改为接收 `PointerEvent` 或直接在 `ReaderWorkspace` 内调用 hook |
| `readerFloatingAssistantPanel.tsx` | 浮动面板拖动同样改造（cursor 用 `move`） |

### 5. 可选优化

- `pointermove` 用 `requestAnimationFrame` 合并，避免每帧多次 `setState`。
- 宽度写入 `localStorage` 改为拖拽结束时写一次，而非每次宽度变化都写（当前 `Reader.tsx:391-396`）。

## 验证

手动验证（`npm run dev` / Electron）：

1. 问答侧栏打开、对话中包含 HTML 回答（iframe）。拖动分隔条，使鼠标进入 iframe 区域后松开 → 宽度固定，再移动鼠标宽度不变。
2. 拖动时鼠标移出应用窗口后松开，再移回 → 拖拽已结束。
3. 拖动中按 Alt+Tab 切走再切回 → 拖拽已结束。
4. 拖动时宽度紧跟鼠标，松开后无 300ms 滑动。
5. 非拖拽时打开/关闭侧栏，宽度过渡动画仍正常。
6. PDF / 翻译分栏、浮动问答面板拖动行为同样正常；双击分隔条重置布局仍可用。
7. 宽度刷新后能从 `localStorage` 恢复。

自动化：运行现有 `npm run typecheck`（或 `tsc --noEmit`）与 `tests/` 相关测试；如有 Playwright/Electron e2e，可补一条"在 iframe 上松开后宽度不再变化"的用例。

## 风险

- `setPointerCapture` 后，分隔条之外的元素在拖拽期间收不到 hover 事件，属预期行为。
- 改造三处拖拽需保持原有边界计算（`MIN_ASSISTANT_PANEL_WIDTH`、`mainRect.width - 120`、`clampPaneRatio`）不变。
