# PaperQuay v{{VERSION}}

Resizing the reader panels no longer keeps following the mouse after you release it.

- Releasing the drag over an HTML answer (rendered in an `iframe`) never reached the parent window, so the assistant sidebar stayed in resize mode and its width kept tracking the pointer.
- Separators now capture the pointer, so `pointerup` always arrives even over an `iframe`, outside the window, or after Alt+Tab. The drag also ends on pointer cancel, lost pointer capture, window blur, or a move with no button held.
- Width transitions are disabled while dragging, so the panel stops exactly where you release it instead of sliding for another 300 ms.
- The PDF/translation split and the floating chat panel use the same mechanism.
- Assistant sidebar width and PDF split ratio are now saved once on release instead of on every mouse move.

Validation: typecheck and the production build pass; all 865 tests pass, including 4 new separator-drag cases. Desktop installers were not hand-regressed before tagging. Installers are built by the `app-v{{VERSION}}` release workflow.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

阅读界面拖动分隔条后，松手即停，宽度不再继续跟随鼠标。

- 问答侧栏的 HTML 回答渲染在 `iframe` 内，之前在其上松开鼠标时父窗口收不到 `pointerup`，侧栏会一直停留在拖拽状态，宽度继续跟随指针。
- 分隔条现在使用 Pointer Capture，即使鼠标在 `iframe` 上松开、移出窗口后松开或 Alt+Tab 打断，`pointerup` 也必定送达；同时以指针取消、捕获丢失、窗口失焦、左键已松开四路兜底结束。
- 拖动期间关闭宽度过渡，松手后不再额外滑动 300ms。
- PDF / 翻译分栏与浮动问答面板使用同一套实现，一并修复。
- 侧栏宽度与 PDF 分栏比例改为松手后写一次，不再拖动过程中每帧写 `localStorage`。

验证：类型检查与生产构建通过；全部 865 项测试通过，含 4 项新增的分隔条拖拽用例。打标签前没有在干净安装版上完成桌面手工回归。安装包由 `app-v{{VERSION}}` Release 工作流构建。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
