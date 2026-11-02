# 2026-11-02 - 文献行右键改用 `Menu`（T5）

## 现象

文献行右键在 `LiteratureLibraryView` 里自己用 `createPortal` 画菜单。面板是 `pq-acrylic fixed w-60`，标题和条目带硬编码深色值。打开前调用 `clampFloatingMenuPosition(clientX, clientY, 240, 220)`。高度按 220 估算，6 个动作项加上标题后实际更高，贴底仍可能溢出。

这个函数名不是 `clampPosition`。只搜 `clampPosition` 搜不到这套钳制。

## 根因

文献行菜单没有复用 `src/ui/menu.tsx`。`clampFloatingMenuPosition` 与 `Menu` 的 `clampPosition` 是两套视口钳制。

## 修改

1. 文献行右键改为 `Menu` / `MenuEntry`。标题用 `Menu` 的 `title`，内容是文献标题。
2. 坐标改为原始 `clientX` / `clientY`，贴边只由 `clampPosition` 负责。
3. 删除只被这一处使用的 `clampFloatingMenuPosition` 和 `FloatingMenuPosition`。
4. 图谱节点菜单不改代码。该菜单在画布容器内 `absolute` 定位，坐标属于容器，并按容器宽高钳制。`Menu` 使用 Portal 和视口坐标。两套坐标空间不同。例外登记在 `docs/ui-design-system.md` 的“浮层与菜单清单”。

动作项是 6 个，不是交接里暂写的 8 个。翻译版 PDF 的附加和移除在文献详情，不在这个右键菜单。

| 顺序 | 文案 | disabled | 色调 |
| --- | --- | --- | --- |
| 1 | 已收藏为“取消收藏”，否则“加入收藏” | `paperSaving` | 默认 |
| 2 | 添加自定义标签 | 无 | 默认 |
| 3 | 解析元数据 | 无 | 默认 |
| 4 | `ragEnabled === false` 为“加入本地知识库”，否则“移出本地知识库” | `paperSaving \|\| batchWorking` | 默认，不是危险色 |
| 5 | 仅当 `ragIndexAvailable && onIndexPaperRag`。索引中为“RAG 索引中…”，否则“建立/重建 RAG 索引” | 正在索引该文献，或 `ragEnabled === false` | 默认 |
| 6 | 删除文献记录 | 无 | `tone: 'danger'` |

图标、`strokeWidth` 和收藏星标的实心/空心保持原样。第 5 项前面没有分隔线；删除项前仍有一条分隔线。

可见变化限于菜单面板：`pq-acrylic`、宽 240、`text-sm`、`rounded-xl` 换成 `Menu` 的 `pq-card`、宽 224、`text-xs`、行高 32。硬编码深色值换成令牌。`dark:text-violet-200` 改为 `--pq-accent`。知识库图标保留 `dark:text-[var(--pq-text-faint)]`，这是已有令牌，不是写死的色值。危险项文字从 `--pq-danger` 改为 `--pq-error`（二者互为别名）。悬停底从源码里未定义的 `--pq-danger-bg` 改为已定义的 `--pq-error-bg`。禁用透明度从 0.60 改为原语的 0.45。标题改为单行截断。

## 验证

- `npm run build` 通过。`TEMP`/`TMP` 指向 `.tmp-build` 时 `npm test` 为 869 pass / 0 fail。
- 实机使用 `release/local-ui-t5c` 复制到 `%LOCALAPPDATA%\Temp\pq-t5c` 后启动。没有点击“删除文献记录”或“移出本地知识库”。
- 点菜单外的侧栏后菜单关闭。再次右键能打开新菜单，说明上一次已经关掉。

审计命令与输出（2026-11-02）：

```text
git grep -n -E "clampPosition|clampFloatingMenuPosition|pq-acrylic fixed" -- "src/*.tsx" "src/**/*.tsx"
src/ui/menu.tsx:50:function clampPosition(x: number, y: number, width: number, height: number) {
src/ui/menu.tsx:67:  const position = clampPosition(x, y, width, estimateMenuHeight(entries, Boolean(title)));

git grep -n -E "Math\.min\(contextMenu\.(x|y)" -- "src/*.tsx" "src/**/*.tsx"
src/features/graph/KnowledgeGraphWorkspace.tsx:1789:              left: Math.min(contextMenu.x + 8, Math.max(8, (containerRef.current?.clientWidth ?? 220) - 188)),
src/features/graph/KnowledgeGraphWorkspace.tsx:1790:              top: Math.min(contextMenu.y + 8, Math.max(8, (containerRef.current?.clientHeight ?? 220) - 180)),
```

`clampPosition` 只在 `src/ui/menu.tsx`。两个 shim 只 re-export，没有定位代码。剩下的 `Math.min(contextMenu.)` 是已登记的图谱节点菜单。

笔记表格网格的 `getFloatingMenuPosition` 是锚点弹出层，不是右键菜单，不在上面两条命令的命中里。

实机：

| 场景 | 主题 | 条目 | 危险项 | 点外部关闭 | 钳制 |
| --- | --- | --- | --- | --- | --- |
| 列表中部 | 浅色 | 6 项齐全 | “删除文献记录”为红色 | 是 | 未贴边 |
| 窗口右下角的文献行 | 浅色 | 6 项齐全，标题截断 | 红色 | 是 | 菜单整体留在窗口内，底边未出窗口 |
| 列表中部 | 深色 | 6 项齐全 | 红色 | 是 | 未贴边 |
| 窗口右下角的文献行 | 深色 | 6 项齐全，标题截断 | 红色 | 是 | 菜单整体留在窗口内，底边未出窗口 |

窗口放在屏幕右下角：右缘约 3831（屏幕宽 3840），底缘约 2079（任务栏从 y=2088 开始）。

截图（未入库）：`.verification-20261102-t5c/` 下 `paper-row-menu-light-middle.png`、`paper-row-menu-light-clamp.png`、`paper-row-menu-dark-middle.png`、`paper-row-menu-dark-clamp.png`。

真实库：验收前后 `paperquay-library.sqlite` SHA256 都是 `24E68F641CA82A0411A6491893D7114910BA8631AE87D9FE5FE2DAB69B5374AF`。笔记库前后都是 `88F16E8445AF9F551FFD0D0D8C1474804798CE358DE27D1A59F942B893CFD571`。文献库修改时间仍是 2026-10-26 22:39:33。

## 存疑与未覆盖

- 横向钳制没有单独出现。文献行右边是详情栏，最小宽 320。菜单宽 224，再加 8 的边距，钳制区只有视口右侧 232。文献行到不了这个区域。纵向钳制已在贴底菜单上看到，横纵共用 `clampPosition`。
- 没有点出禁用外观。抽到的文献都已加入知识库，“建立/重建 RAG 索引”是可点外观。`paperSaving`、批量操作进行中、正在索引、`ragEnabled === false` 这四种 disabled 没有在界面上制造，避免写入真实库。
- 主题从浅色切到深色再点回浅色。验收结束时界面是浅色。
- 打包目录 `release/local-ui-t5c` 与 `%LOCALAPPDATA%\Temp\pq-t5c` 可能被句柄锁住，需要之后再清。
