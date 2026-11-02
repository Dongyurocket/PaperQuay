# 2026-11-02 - 文库分类右键改用 `Menu`，并删除批注死代码（T5 收尾）

## 现象

- `LiteratureCategorySidebar` 自己用 `createPortal` 画右键菜单：`fixed inset-0 z-[10000]`、`pq-acrylic`、硬编码深色值。`openContextMenu` 里还有一套手写钳制（12px 边距、宽按 232、高按 168 或 60），不走 `clampPosition`。上一轮用 `grep clampPosition` 验收，所以这套实现没被算进去。
- `PdfAnnotationWorkspace.tsx` 无任何 import / 动态 import / 字符串挂载，功能已由 `PdfViewer` 与 `PdfViewerToolbar` 的行内批注替代。

## 根因

- 分类菜单是第三套外壳，没有复用 `src/ui/menu.tsx`。只搜函数名会把「没写这个名字」误当成「没有第二套定位」。
- 建议口径 `contextMenu.(x|y)|position: 'fixed'` 仍有两个洞：把坐标传给 `Menu` 的调用点会误伤；`paperContextMenu` 和 Tailwind `fixed` 又搜不到。

## 修改

1. `LiteratureCategorySidebar` 改为 `Menu` / `MenuEntry`。菜单项顺序与文案不变：用户分类为「新建子分类」「展开/折叠分类」（仅有子分类时，文案看 `collapsedCategoryIds`）、「重命名分类」、分隔线、「删除分类」（`tone: 'danger'`）；system 分类和空白处仍只有「新建顶层分类」。图标保留。点击外部与再次右键关闭由 `Menu` 承担。展开、折叠、新建、重命名、删除回调不变。
2. 删掉 `openContextMenu` 的手写钳制，坐标原样交给 `clampPosition`。
3. 删除 `src/features/pdf/PdfAnnotationWorkspace.tsx`。
4. 交接文档 T5 的验收改为下面两条命令，不再用 `grep clampPosition`。

可见变化限于：acrylic 面板换成菜单面板（含原语自带的 12px 字号、32px 行高、宽 224）、硬编码深色值换成令牌、贴边改为原语钳制。危险项文字仍是 `--pq-error`（`--pq-danger` 的别名）；hover 底从可能未定义的 `--pq-danger-bg` 变为已定义的 `--pq-error-bg`，这是 `tone="danger"` 的原语行为。

## 验证

- `npm run build` 通过。`TEMP`/`TMP` 指向 `.tmp-build` 时 `npm test` 为 869 pass / 0 fail。
- 删除前 `git grep PdfAnnotationWorkspace` 只命中该文件自身和文档，没有代码引用。删除后 `tsc` 通过。

审计命令与输出（2026-11-02）：

```text
git grep -n -E "clampPosition|clampFloatingMenuPosition|pq-acrylic fixed" -- "src/*.tsx" "src/**/*.tsx"
src/features/literature/LiteratureLibraryView.tsx:113:  clampFloatingMenuPosition,
src/features/literature/LiteratureLibraryView.tsx:2600:    const position = clampFloatingMenuPosition(event.clientX, event.clientY, 240, 220);
src/features/literature/LiteratureLibraryView.tsx:3242:            className="pq-acrylic fixed w-60 p-1.5"
src/ui/menu.tsx:50:function clampPosition(x: number, y: number, width: number, height: number) {
src/ui/menu.tsx:67:  const position = clampPosition(x, y, width, estimateMenuHeight(entries, Boolean(title)));

git grep -n -E "Math\.min\(contextMenu\.(x|y)" -- "src/*.tsx" "src/**/*.tsx"
src/features/graph/KnowledgeGraphWorkspace.tsx:1789:              left: Math.min(contextMenu.x + 8, Math.max(8, (containerRef.current?.clientWidth ?? 220) - 188)),
src/features/graph/KnowledgeGraphWorkspace.tsx:1790:              top: Math.min(contextMenu.y + 8, Math.max(8, (containerRef.current?.clientHeight ?? 220) - 180)),
```

分类：`clampPosition` 只在 `src/ui/menu.tsx`。另外两处是本轮没有迁的自建菜单，不是「没有第四处」：

- 文献行右键：`LiteratureLibraryView` 的 `paperContextMenu`，自带 `clampFloatingMenuPosition` 和 `pq-acrylic fixed`。建议口径因变量名不是 `contextMenu`、也没有 `position: 'fixed'` 字符串而会漏掉。
- 图谱节点菜单：`KnowledgeGraphWorkspace` 在容器内 `absolute` 手写 `Math.min`。它不是 `position: 'fixed'`。

`readerWorkspaceHeader` 的工具栏溢出菜单和 `NoteEditorToolbar` 的表格网格是锚点弹出层，不是右键菜单，本轮未改。

实机（打包到 `%LOCALAPPDATA%\Temp\pq-t5b` 启动）：

| 菜单 | 浅色 | 深色 | 打开 | 危险项 | 禁用 | 点外部关闭 | 钳制 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 标签栏 | 有 | 有 | 是 | 「关闭标签」红色 | 文库标签的关闭项以及「关闭其他/右侧」为禁用外观 | 是 | 触发点在左上，未贴边 |
| 笔记块 | 有 | 有 | 是 | 「删除当前块」红色 | 本块菜单无禁用项 | 是 | 长菜单留在窗口内 |
| 文库分类 | 有 | 有 | 是 | 「删除分类」为 `text-[var(--pq-error)]` | 无禁用项 | 是 | 贴底时菜单整体上移，底边未出窗口 |

分类回归：折叠再展开「飞行器总体设计」后子分类消失又出现；「所有文献」只有「新建顶层分类」；在其下新建「T5验收临时」、改名为「T5验收改名」、确认删除后界面不再出现该名称。

截图（未入库）：`.verification-20261102-t5b/` 下 `tabbar-menu-light.png`、`tabbar-menu-dark.png`、`noteblock-menu-light.png`、`noteblock-menu-dark.png`、`category-menu-light.png`、`category-menu-dark.png`。另有 `category-system-menu-light.png`、`category-menu-clamp-bottom.png`。

真实库：验收前 `paperquay-library.sqlite` SHA256 `24E68F64…`，笔记库 `88F16E84…`。分类写入后文献库哈希变化，关闭应用后按备份还原，哈希回到 `24E68F64…`。笔记库前后一致。主题从深色点回「浅色模式」。

## 存疑与未覆盖

- 横向钳制没有单独截到。分类栏和笔记正文都到不了窗口右侧 232px 内；纵向钳制已在贴底的分类菜单上看到，横纵共用 `clampPosition`。
- 文献行右键和图谱节点菜单仍是自建定位，见上面的审计输出。
- 打包目录 `release/local-ui-t5b` 与 `%LOCALAPPDATA%\Temp\pq-t5b` 可能被句柄锁住，需要之后再清。
