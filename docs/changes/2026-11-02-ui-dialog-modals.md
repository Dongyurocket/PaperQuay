# 2026-11-02 - 三个自建模态迁移到 Dialog 原语（T4）与焦点陷阱边界验证（T7）

## 现象

`src/ui/dialog.tsx` 的 `Dialog` 已提供 Portal + 焦点陷阱 + Esc + 背景滚动锁，但 T4 列出的 11 个自建 `fixed inset-0` 浮层里，仍有三个「真模态」各自实现外壳：

| 组件 | 迁移前外壳 |
| --- | --- |
| `src/features/literature/components/LibrarySettingsDialog.tsx` | `fixed inset-0 z-[82]` + 自带面板尺寸 |
| `src/features/literature/components/ImportConfirmationDialog.tsx` | `fixed inset-0 z-[80]` + 自带面板尺寸 |
| `src/features/blocks/BlockReparseModal.tsx` | `fixed inset-0 z-50` + 自带 `role="dialog" aria-modal="true" aria-label` |

三者都没有 Esc 关闭与滚动锁；其中 `BlockReparseModal` 在 z-50，低于块图片预览的 z-90，同时打开时会被预览盖住。T7 还要求实测焦点陷阱的 Tab 边界循环。

## 根因

外壳逻辑分散在各 feature 里，行为随实现漂移：Esc/滚动锁只有 `Dialog` 有，z-index 各写各的，`role/aria` 也有两套（`BlockReparseModal` 自带 `aria-label`，与 `Dialog` 的 `aria-labelledby` 不同）。

## 修改

### 1. 三个组件改为渲染 `Dialog`（只替换外壳）

- 外壳全部换成 `<Dialog open onClose overlay size labelledBy className>`；内部区域（header / 滚动区 / footer）、文案、令牌、业务逻辑与 props 一律未改，调用点零改动（`ImportConfirmationDialog` 与 `LibrarySettingsDialog` 仍是默认导出，`BlockReparseModal` 仍是具名导出）。
- 面板布局通过 `className` 下放：`flex flex-col` + 原 `max-h`，宽度用 `max-w-[min(820px|1120px,calc(100vw-32px))]`。`className` 经 `utils/cn` 的 `twMerge` 合并，会顶掉 `Dialog` 默认的 `max-w-md` 与 `bg-[var(--pq-bg-primary)]`，不需要新增 width 档。
- 背景维持 `--pq-surface-1`（`BlockReparseModal` 浅色维持 `bg-white`），与迁移前一致。
- 保留各自的内部滚动结构：`max-h` + `flex-col` + `min-h-0 flex-1 overflow-y-auto`（`BlockReparseModal` 的中段仍是 `flex-1 overflow-y-auto`）。若拆掉内层滚动容器，`Dialog` 面板的 `overflow-hidden` 会直接裁掉长内容。
- 旧实现自带的重复项全部删除：`role="dialog"` / `aria-modal` / `aria-label` 改由 `Dialog` 的 `labelledBy` 指向标题 `id`；旧遮罩层与 z-index 类名删除。迁入前旧实现本来就没有 Esc、遮罩点击与滚动锁，因此没有可删的监听器，只有 `BlockReparseModal` 的那份 aria 需要删。
- `dismissOnBackdrop={false}`：三个模态都有未保存内容，且迁移前点击遮罩也确实不关闭，保持原行为。
- 关闭时机沿用原有禁用逻辑：`LibrarySettingsDialog` 在 `saving`、`ImportConfirmationDialog` 在 `working`、`BlockReparseModal` 在 `loading` 时，Esc 与关闭按钮一样不生效（用内部 `requestClose` 包一层）。
- 滚轮委派（`useWheelScrollDelegate`）需要一个「包含滚动目标」的根元素，而 `Dialog` 的面板不在组件控制范围内。两个文库模态在面板内加一层 `className="contents"` 的包装：`display: contents` 不生成盒子，header/滚动区/footer 仍是面板的 flex 子项，布局与迁移前一致；同时这层可以挂 `ref` 与 `onWheelCapture`。

### 2. `src/ui/dialog.tsx` 两处必要修补（T7 发现）

1. **重渲染会重置焦点**。`handleKeyDown` 原来用 `useCallback(..., [onClose])`，而调用方普遍传内联 `onClose`，于是父级每次重渲染都会重建监听，并重跑「打开副作用」：副作用会重新聚焦面板内第一个可聚焦元素。阅读器里的阅读计时器持续触发重渲染，导致 `BlockReparseModal` 里刚 Tab 走的焦点被立刻打回顶部关闭按钮，Tab 循环失效。改为用 `onCloseRef` 读最新回调、`useCallback` 依赖置空，打开副作用只在 `open` 变化时执行。
2. **无 DOM 环境退化为内联渲染**。`createPortal(..., document.body)` 在 Node 的 `renderToStaticMarkup` 路径下会抛 `document is not defined`，`tests/readerMarkdownComponents.test.ts` 正好用合成渲染校验模态内的 Markdown。加 `typeof document === 'undefined'` 守卫：副作用不建立，面板改为内联返回。应用内行为不变。

### 3. z-index 迁移前后

| 组件 | 迁移前 | 迁移后 |
| --- | --- | --- |
| `LibrarySettingsDialog` | `z-[82]` | `z-[120]`（`Dialog` 统一值） |
| `ImportConfirmationDialog` | `z-[80]` | `z-[120]` |
| `BlockReparseModal` | `z-50` | `z-[120]` |

- 仍在模态之上的层：命令面板 `z-[150]`、任务中心 `z-[190]`、toast `z-[200]`、模型/推理选择器 `z-[9999]`、右键菜单 `z-[10000]`、笔记精炼面板 `z-[11000]`。
- 被模态覆盖的层：块图片预览与阅读器偏好窗 `z-[90]`、Agent 工作区浮层 `z-[100]`。其中块预览盖住重识别模态是迁移前的实际遮挡缺陷（`z-50` < `z-90`），迁移后修正。
- 与 `ReaderWorkspace` 的「退出沉浸」按钮（`z-[120]`）同级，但该按钮是整屏遮罩下的浮动按钮，被遮罩覆盖属预期。
- 未发现被遮挡的功能性问题；toast / 任务中心 / 命令面板仍能在模态之上显示。

## 验证

- `npm run build` 通过；`npm test` 869 项全绿（`TEMP`/`TMP` 指向 `.tmp-build`）。
- 实机验收：`node electron/build.cjs --dir` 打包为 `win-unpacked` → 复制到 `%TEMP%` → 清除 `ELECTRON_RUN_AS_NODE` 后启动；UIA 可读（`webContent ready`），用 UIA `find` 读探针文本确认焦点归属，比肉眼判读更稳。
- 三个模态各走一遍四项行为 + Tab 循环，浅色/深色各一张截图（见下表）。焦点陷阱的判据为「焦点元素的 `aria-label`/文本 + 是否位于 `role=dialog` 内 + `body overflow` + 对话框数量」。

| 模态 | 触发路径 | Esc | Tab 不越界 | 背景滚动锁 | 关闭后焦点 |
| --- | --- | --- | --- | --- | --- |
| `ImportConfirmationDialog` | 文库 → 导入 PDF → 选一个 PDF → 取消 | 关闭 | 首个「关闭」Shift+Tab → 末位「确认导入」；末位 Tab → 首个「关闭」 | `bodyOverflow=hidden`，关闭后恢复空 | 回到「导入 PDF」 |
| `BlockReparseModal` | 阅读器 → 结构化块 → 「AI 重析」 | 关闭 | 首个「关闭」Shift+Tab → 末位「开始重新识别」；反向 Tab 回首个 | 同上 | 回到「AI 重析」 |
| `LibrarySettingsDialog` | 临时探针按钮（见下） | 关闭 | 首个「关闭」Shift+Tab → 末位「保存设置」；反向 Tab 回首个 | 同上 | 回到探针按钮 |

- 内部滚动：库设置模态在浅色下滚轮滚动后，header/footer 固定、主体滚动、滚动条位置变化（`library-settings-inner-scroll.png`），说明 `contents` 包装没有破坏 flex 布局。
- 证据截图（本地，未入库）：`.verification-20261102-t4/` 下 `import-confirm-light|dark.png`、`block-reparse-light|dark.png`、`library-settings-light|dark.png`、`library-settings-inner-scroll.png`。

## 存疑与未覆盖

- **`LibrarySettingsDialog` 目前没有任何挂载点**：全仓 `git grep LibrarySettingsDialog` 只命中它自身的定义，`LiteratureLibraryView` 只挂载了 `ImportConfirmationDialog`。因此它无法从真实界面触发，本轮用临时探针组件（真实组件 + 真实 CSS + mock settings，快捷键/按钮打开）完成四项行为与截图验证，探针已删除、未入库。该组件是否应删除或补回入口，需要单独决定。
- 浅色主题的遮罩强度由 `bg-slate-950/42` 变为 `Dialog` 的 `strong`（`slate-950/62`），深色由 `black/56` 变为 `black/70`；`BlockReparseModal` 由 `bg-black/50` 变为 `soft`（浅色 `slate-950/28`、深色 `black/45`）。这是迁入原语后的既定选择，属可见变化，未改任何令牌。
- 实机验收期间未打开「块图片预览」与重识别模态并存的状态，z-90/z-120 的修正结论来自层级推导与单模态截图，没有专门构造叠加场景。
- 轮换完成后，`release/local-ui-t4*` 打包目录里的 `app.asar` 会被 Proma 句柄锁定，需要重启 Proma 后清理。
