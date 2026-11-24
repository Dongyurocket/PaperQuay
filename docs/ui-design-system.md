# PaperQuay UI 设计系统

> 适用版本：v0.4.30。本文是 UI 视觉与交互约定的判定依据。新增界面按此执行；存量代码在改动时顺带对齐。

## 一、设计令牌

颜色、圆角、阴影、动效全部定义为 `--pq-*` CSS 变量，位于 `src/app/index.css` 的 `:root`（浅色）与 `.dark`（深色）。**界面代码只引用 `var(--pq-*)`，不直接写颜色值。**

### 1.1 表面与背景

| 令牌 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--pq-bg-primary` / `--pq-bg` | 应用底色 | `#fafaf9` | `#0a0a0a` |
| `--pq-surface-1` / `--pq-surface` | 卡片、面板、输入框底 | `#ffffff` | `#1a1a1a` |
| `--pq-surface-2` | 次级面板、工具栏、悬停底 | `#f5f5f4` | `#202020` |
| `--pq-surface-3` | 再深一级的分隔块 | `#e7e5e4` | `#262626` |
| `--pq-sidebar` | 左侧导航栏底 | `#ffffff` | `#141414` |
| `--pq-bg-elevated` | 浮层、玻璃拟态底 | `rgba(255,255,255,.86)` | `rgba(26,26,26,.88)` |
| `--pq-hover` / `--pq-active` | 悬停 / 按下叠加层 | 黑 4% / 8% | 白 6% / 10% |

### 1.2 文字

| 令牌 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--pq-text` | 正文与标题 | `#1c1917` | `rgba(255,255,255,.92)` |
| `--pq-text-muted` | 次要说明、元信息 | `#57534e` | `rgba(255,255,255,.65)` |
| `--pq-text-faint` | 占位符、弱提示、图标 | `#6b6a66` | `rgba(255,255,255,.55)` |

> 未引用的令牌（`surface-elevated`、`text-quaternary`、`accent-light`、`accent-text`、`teal`、`success-button-*`、`motion`、`motion-slow`、`bg-solid`、`bg-subtle`）已删除；`tests/uiDesignTokens.test.ts` 会拒绝任何零引用令牌。
>
> `tailwind.config.ts` 的 `paper.elevated` / `paper.text-quaternary` / `paper.accent-text` 是历史别名，现分别映射到 `--pq-bg-elevated` / `--pq-text-faint` / `--pq-accent`（不恢复已删令牌）。守卫会解析 Tailwind 配置里的全部 `var(--pq-*)` 引用：必须已在 `index.css` 声明，随主题变化的令牌必须在 `:root` 与 `.dark` 双声明；删除最后一个引用所在声明会让负向用例失败。

### 1.3 边框

| 令牌 | 用途 |
| --- | --- |
| `--pq-border` | 默认边框、分隔线 |
| `--pq-border-strong` | 强调边框、悬停态 |
| `--pq-border-soft` / `--pq-border-subtle` | 极浅分隔（分组之间） |

### 1.4 品牌色与语义色

品牌基色以浅色主题的 `#0f766e`（teal-700）为准；深色主题只提亮，不改色相。浅色 accent 作为文字在白色/浅强调底上均 ≥4.5:1（对应 axe WCAG AA）。

| 令牌 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--pq-accent` | 选中态、图标、强调文字 | `#0f766e` | `#2dd4bf` |
| `--pq-accent-hover` | 悬停 | `#115e59` | `#5eead4` |
| `--pq-accent-soft` / `--pq-accent-bg` | 浅强调底（胶囊、选中行） | 10% 透明 | 14% 透明 |
| `--pq-accent-border` | 强调边框 | 22% 透明 | 28% 透明 |
| `--pq-accent-button-bg` | 主按钮底 | `#0f766e` | `#115e59` |
| `--pq-accent-button-text` | 主按钮文字 | `#ffffff` | `#ecfeff` |
| `--pq-danger-button-bg` / `-bg-hover` / `-text` | 危险实心按钮 | `#dc2626` / `#b91c1c` / `#ffffff` | `#7f1d1d` / `#991b1b` / `#fee2e2` |
| `--pq-warning-button-bg` / `-bg-hover` / `-text` | 警告实心按钮 | `#b45309` / `#92400e` / `#ffffff` | `#78350f` / `#92400e` / `#fef3c7` |

实心按钮只用按钮级令牌：浅色是「亮底 + 白字」，深色是「深底 + 浅字」。不要把 `--pq-{semantic}` 当按钮底（深色下它是亮色，叠浅字失去对比度），也不要用 `--pq-{semantic}-bg`（10% 透明，按钮会消失）。危险/警告两组文字对底均 ≥4.5:1（最低为浅色 danger 4.83:1）；success 没有实心按钮场景，对应令牌已删除。

语义色必须能靠色相与品牌色区分：

| 语义 | 令牌 | 浅色 | 深色 | 色相 |
| --- | --- | --- | --- | --- |
| 成功 | `--pq-success` | `#16a34a` | `#4ade80` | 142° |
| 警告 | `--pq-warning` | `#9a3412` | `#fbbf24` | 15° |
| 危险 | `--pq-danger` | `#dc2626` | `#f87171` | 0° |
| 信息 | `--pq-info` | `#0891b2` | `#67e8f9` | 192° |

> **勿回退**：浅色 `--pq-success` 曾为 `#059669`（161°），与 accent（175°）几乎同色，「MinerU 已解析」与「RAG 已索引」徽标无法区分；深色 accent 曾为 `#86a89f`，与浅色品牌色不是同一颜色。两处均已修正。

### 1.5 圆角、阴影、动效

| 令牌 | 值 |
| --- | --- |
| `--pq-radius-sm` / `md` / `lg` | 8px / 12px / 16px |
| `--pq-control-sm` / `--pq-control-md` | 28px / 32px，`Button` / `IconButton` 的 `size` 唯一高度来源 |
| `--pq-shadow-soft` / `float` / `dialog` | 三级阴影，深色下加重 |
| `--pq-motion-fast` | 120ms `ease-out`，所有交互过渡的唯一时长 |

### 1.6 表格与滚动条

MinerU 解析表格与全局滚动条也走语义令牌，浅/深各一组，不在 CSS 规则里写裸 hex/rgba：

| 令牌 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--pq-table-text` | 表格正文 | `#334155` | `#cbd5e1` |
| `--pq-table-head-text` | 表头文字 | `#0f172a` | `#e2e8f0` |
| `--pq-table-head-bg` | 表头底 | `rgba(248,250,252,.96)` | `rgba(15,23,42,.94)` |
| `--pq-table-border` | 单元格边框 | `#e2e8f0` | `#1e293b` |
| `--pq-table-row-alt-bg` | 隔行底 | `#fbfdff` | `#0f172a` |
| `--pq-table-row-hover-bg` | 行悬停底 | `#f6f9fc` | `#1a2744` |
| `--pq-scrollbar-thumb` / `-hover` | 滚动条滑块 | 蓝灰 34% / 42% | 白 12% / 20% |

### 1.7 焦点环与 kicker 对比度

- `.pq-input` 的 3px 实心 accent 焦点环与全局 `:focus-visible` 的 2px outline 对相邻表面均 ≥3:1：浅色最低 5.02:1（`#0f766e` 对 `--pq-bg-secondary`；白底 5.47:1），深色最低 8.13:1。
- 笔记组件 kicker（`--pq-text-primary` on `--pq-accent-bg` 合成到 `--pq-bg-secondary`）≥4.5:1：浅色 14.32:1、深色 9.90:1。
- 数值由 `tests/uiContrast.test.ts` 解析真实令牌后计算；改令牌必须同步跑该用例。

## 二、组件约定

### 2.1 全局样式类

`src/app/index.css` 中已有的类优先复用，不要重写：

| 类名 | 用途 |
| --- | --- |
| `.pq-panel` / `.pq-panel-muted` / `.pq-acrylic` | 面板容器（实底 / 次级 / 玻璃拟态） |
| `.pq-card` | 可悬停卡片 |
| `.pq-button` / `.pq-button-primary` / `.pq-icon-button` | 次级按钮 / 主按钮 / 图标按钮 |
| `.pq-input` | 输入框（含焦点态） |
| `.pq-chip` | 胶囊标签 |
| `.pq-toolbar` / `.pq-workspace-surface` | 工具栏 / 工作区表面 |
| `.pq-chat-composer` / `.pq-chat-bubble-*` | 对话输入区与气泡 |
| `.pq-nav-item` | 导航项、分段切换项 |

新增全局变体（如 `.pq-icon-button-accent`）必须同时适配浅色与深色令牌，并登记在本表。

### 2.2 界面文字

所有可见文字、`title`、`aria-label` 都用 `useLocaleText()`（`src/i18n/uiLanguage.tsx`）返回的 `l('中文', 'English')` 双语写法，不写单语硬编码文本。非组件代码（如命令定义）接收同签名的 `localize(zh, en)` 参数。

### 2.3 浮层、菜单与反馈（`src/ui/`）

浮层与反馈统一使用下列实现，不各写一套：

| 模块 | 用途 |
| --- | --- |
| `menu.tsx` 的 `Menu` | **唯一菜单实现**：右键菜单与 `⋯` 溢出/下拉菜单。支持分隔符、`danger`/`accent` 色调、点击外部关闭；document 级键盘处理（Esc / Tab / ↑↓ / Home / End）始终可用，指针菜单首次方向键即可从触发前焦点进入菜单项，关闭时把焦点归还给触发元素。坐标为视口坐标，经 `clampPosition` 贴边钳制，边距 8px。 |
| `dialog.tsx` 的 `Dialog` / `ConfirmDialog` | 模态：Portal、焦点陷阱、Esc、滚动锁、焦点归还。`overlay` 选遮罩强度，`align="top"` 供搜索型浮层靠上；嵌套对话框按栈只让栈顶响应 Esc / Tab。 |
| `textInputDialog.tsx` 的 `TextInputDialog` | 单行文本输入模态（重命名、批量加标签），替代 `window.prompt`。 |
| `confirmHost.tsx` 的 `confirmAction()` | 命令式确认，返回 `Promise<boolean>`；**不用 `window.confirm`**。 |
| `toast.tsx` 的 `toast` | 一次性反馈，见 §2.4。 |
| `taskCenter.tsx` | 长任务全局进度。 |
| `commandPalette.tsx` + `commands.ts` | 命令面板与快捷键注册表，见 §2.5。 |

`src/components/ContextMenu.tsx` 与 `src/features/notes/NotesContextMenu.tsx` 只是对 `Menu` 的 re-export 兼容层，不要在其中另写定位逻辑；新代码直接从 `src/ui/menu.tsx` 导入。

**登记例外**（确需新例外时，先写进本表并说明坐标空间与理由）：

| 位置 | 原因 |
| --- | --- |
| `src/features/graph/KnowledgeGraphWorkspace.tsx` 图谱节点菜单 | 在画布容器内 `absolute` 定位，坐标属于容器并随平移、缩放变化；`Menu` 使用 Portal 和视口坐标，迁移会错位。 |
| `src/app/App.tsx` 标题栏关闭按钮 | 悬停色沿用 Windows 原生标题栏的关闭色，已收敛为 `--pq-window-close-bg` / `--pq-window-close-text` 令牌，两套主题一致。 |

锚点弹出层不是菜单，不要改成 `Menu`，也不要当作漏迁的菜单：如 PDF 工具行的颜色面板、笔记编辑器的插入表格网格、模型预设选择器。

### 2.4 Toast

- 用 `toast.success / error / info / progress(message, { description?, key?, duration? })`。
- 默认时长：success、info 3.2s，error 5s，progress 不自动关闭。`duration: 0` 表示不自动关闭。
- 同一 `key` 的 toast 会被替换而不堆叠，适合更新同一件事的状态；需要持续展示的长任务进度放进任务中心（`taskCenter.tsx`）。
- toast 只做一次性反馈；需要用户决定的操作用 `confirmAction()` 或 `Dialog`。

### 2.5 快捷键与命令

- 快捷键只在 `src/ui/commands.ts` 的注册表中声明：模块调用 `registerCommands()` 登记 `AppCommand`，`shortcut` 写成 `mod+w`、`mod+shift+f` 这类形式，`mod` 在 Windows 为 Ctrl、macOS 为 Cmd。
- App 层的 `useGlobalShortcuts()` 统一监听并分派；组件不要自行 `window.addEventListener('keydown')` 注册全局快捷键。
- `useGlobalShortcuts()` 只分派带 `mod` 的组合键，且按键位逐个放行（当前为 `mod+k` 命令面板、`f`、`w`、`,`）；新增其他键位时要同时扩展这里的分派。`mod+w`、`mod+,` 在输入框内不拦截。
- 当前不可用的命令让 `isAvailable` 返回 `false`，它不会出现在命令面板中，快捷键也不触发。

### 2.6 顶栏、工具行与按钮尺寸

- 阅读器顶栏高 **40px**；阅读器中每个 PDF、译版 PDF 或结构化阅读窗格各有一条 **36px** 工具行，对照模式下两个窗格各保留一条。
- 工具行内的图标按钮和紧凑控件统一 **32px**，圆角 `--pq-radius-sm`（8px），文字不小于 11px。按钮高度只用 `src/ui/button.tsx` 的 `Button` / `IconButton`（`size='sm'|'md'` 对应 28px / 32px），不要再写 `h-7` / `h-8`。
- 桌面窗口最小宽度为 **960px**（`electron/main.cjs` 的 `minWidth`），因此 `index.css` 的 `@media (max-width: 980px)` 在桌面可达；Web 预览不受该限制。
- 工具栏**不换行**：按容器宽度分配可见项，放不下的低频操作进入 `⋯` 溢出菜单（`Menu`）。
- 文档信息、统计和状态提示放进 `ⓘ` 的 `title` / `aria-label`，不额外占一行。
- 阅读器沉浸模式由命令 `reader.toggle-immersive`（`Ctrl/Cmd+Shift+F`）切换，隐藏顶栏与工具行，`Esc` 退出。

## 三、字号与间距

- 正文 13–14px；标题 15–16px；元信息、徽标**不小于 11px**，不用 `text-[10px]`。
- 圆角：控件 8px，卡片与面板 12px，对话框 16px。
- 间距以 4px 为步进（Tailwind 1/2/3/4/6/8 即 4/8/12/16/24/32px）。

## 四、禁止项

1. **不在 JSX 里写死调色板类名**（`text-slate-500`、`bg-emerald-50`、`border-slate-200` 等），一律用 `var(--pq-*)`。存量少数实心按钮的 `dark:` 成对写法改动时顺带处理。硬编码调色板与任意 hex 颜色由 `tests/uiDesignTokens.test.ts` 守卫。
2. **不用 `window.confirm` / `window.alert` / `window.prompt`**，改用 `confirmAction()`、`Dialog` 或 `TextInputDialog`；由 `tests/uiDesignTokens.test.ts` 守卫。
3. **不新增 `fixed inset-0` 自建遮罩**，用 `Dialog`（`src/ui` 内除外）；由 `tests/uiDesignTokens.test.ts` 守卫。
4. **不省略键盘焦点样式**：全局 `:focus-visible` 已生效，没有替代焦点样式时不要用 `outline-none` 覆盖；抑制 outline 只允许作用于自带焦点视觉的包装控件（`.pq-input` / `.pq-chat-composer` 内部）。
5. **不用 CSS 属性选择器「补丁」修正硬编码色**（已删除的 `.pq-saas-scope [class*="text-slate-900"]` 就是反例），直接改源码用令牌。
6. **不在未验证深色主题的情况下提交配色改动**。
7. **实心强调 / 危险 / 警告按钮只用按钮级令牌**（`--pq-*-button-bg/-text`），不写裸 `text-white`；由 `tests/uiDesignTokens.test.ts` 守卫。

## 五、已知约束

- 浅色 `--pq-success`（3.30:1）对白底未达 WCAG AA 4.5:1，用于徽标、图标、加粗小字，不用于正文；需要正文级使用时另立更深的令牌，不直接加深品牌色。浅色 `--pq-accent` 已为 `#0f766e`：对白底 5.47:1、对 `--pq-bg-secondary` 5.02:1，可用于正文级强调。
- 深色主按钮 `#ecfeff` on `#115e59` 为 7.29:1；深色 accent、success 对深底均在 9:1 以上。
- 部分组件保留 `dark:bg-*`、`dark:text-*` 成对覆盖，用于语义令牌未覆盖的「浅底深字 / 深底浅字」反转场景，不要盲目删除。

## 六、修改令牌的流程

1. 只改 `:root` 与 `.dark` 两处，不在别处定义颜色。
2. 检查引用该令牌的组件在浅色与深色下的表现，两套主题都截图。
3. 改语义色前先算色相与对比度：语义色之间色相差 ≥30°，正文文字对底 ≥4.5:1。
4. 在 `docs/changes/` 记录改了什么、为什么、验证了什么。
