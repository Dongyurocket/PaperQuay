# PaperQuay UI 设计系统

> 生效日期：2026-11-02　适用版本：v0.4.16 之后
> 本文是 UI 视觉与样式的判定依据。新增界面按此执行；存量代码按「改动时顺带对齐」推进。

## 一、设计令牌

所有颜色、圆角、阴影、动效都通过 CSS 变量定义在 `src/app/index.css` 的 `:root`（浅色）与 `.dark`（深色）两套作用域里。**界面代码不得直接写颜色值**。

### 1.1 表面与背景

| 令牌 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--pq-bg-primary` / `--pq-bg` | 应用底色 | `#fafaf9` | `#0a0a0a` |
| `--pq-surface-1` / `--pq-surface` | 卡片、面板、输入框底 | `#ffffff` | `#1a1a1a` |
| `--pq-surface-2` | 次级面板、工具栏、悬停底 | `#f5f5f4` | `#202020` |
| `--pq-surface-3` | 再深一级的分隔块 | `#e7e5e4` | `#262626` |
| `--pq-sidebar` | 左侧导航栏底 | `#ffffff` | `#141414` |
| `--pq-bg-elevated` | 浮层/玻璃拟态底 | `rgba(255,255,255,.86)` | `rgba(26,26,26,.88)` |

### 1.2 文字

| 令牌 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--pq-text` | 正文与标题 | `#1c1917` | `rgba(255,255,255,.92)` |
| `--pq-text-muted` | 次要说明、元信息 | `#57534e` | `rgba(255,255,255,.65)` |
| `--pq-text-faint` | 占位符、弱提示、图标 | `#a8a29e` | `rgba(255,255,255,.45)` |
| `--pq-text-quaternary` | 极弱装饰性文字 | `#d6d3d1` | `rgba(255,255,255,.25)` |

### 1.3 边框

| 令牌 | 用途 |
| --- | --- |
| `--pq-border` | 默认边框、分隔线 |
| `--pq-border-strong` | 强调边框、悬停态 |
| `--pq-border-soft` / `--pq-border-subtle` | 极浅分隔（分组之间） |

### 1.4 品牌色（accent）与语义色

**品牌基色以浅色主题的 `#0d9488`（teal-600，约 174° 色相）为准，深色主题只提亮、不改色相。**

| 令牌 | 用途 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `--pq-accent` | 品牌色：选中态、图标、强调文字 | `#0d9488` | `#2dd4bf` |
| `--pq-accent-hover` | 悬停 | `#0f766e` | `#5eead4` |
| `--pq-accent-soft` / `--pq-accent-bg` | 浅色强调底（胶囊、选中行） | 10% 透明 | 14% 透明 |
| `--pq-accent-border` | 强调边框 | 22% 透明 | 28% 透明 |
| `--pq-accent-button-bg` | 主按钮底 | `#0d9488` | `#115e59` |
| `--pq-accent-button-text` | 主按钮文字 | `#ffffff` | `#ecfeff` |
| `--pq-success-button-bg` / `-bg-hover` / `-text` | 成功实心按钮 | `#15803d` / `#166534` / `#ffffff` | `#14532d` / `#166534` / `#dcfce7` |
| `--pq-danger-button-bg` / `-bg-hover` / `-text` | 危险实心按钮 | `#dc2626` / `#b91c1c` / `#ffffff` | `#7f1d1d` / `#991b1b` / `#fee2e2` |
| `--pq-warning-button-bg` / `-bg-hover` / `-text` | 警告实心按钮 | `#b45309` / `#92400e` / `#ffffff` | `#78350f` / `#92400e` / `#fef3c7` |

**按钮级令牌专供实心按钮**：浅色是「亮底 + 白字」，深色反过来是「深底 + 浅字」。不要用 `--pq-{semantic}` 直接当实心按钮底——它是文字/图标色，深色主题下为亮色，叠浅字会失去对比度；也不要把它映射到 `--pq-{semantic}-bg`（10% 透明度，按钮会消失）。每组文字对底按 §六 第 3 条核算，当前 9 组均 ≥4.5:1（最低浅色 danger 4.83:1）。

语义色与品牌色必须能靠色相区分：

| 语义 | 令牌 | 浅色 | 深色 | 色相 |
| --- | --- | --- | --- | --- |
| 成功 | `--pq-success` | `#16a34a` | `#4ade80` | 142°（纯绿） |
| 警告 | `--pq-warning` | `#d97706` | `#fbbf24` | 32° |
| 危险 | `--pq-danger` | `#dc2626` | `#f87171` | 0° |
| 信息 | `--pq-info` | `#0891b2` | `#67e8f9` | 192° |

> **历史坑（勿回退）**：浅色主题曾用 `--pq-success: #059669`（161°），与 accent `#0d9488`（175°）只差 13°、亮度饱和度几乎相同，导致「强调」与「成功」在视觉上不可区分——文库卡片上「MinerU 已解析」（success）与「RAG 已索引」（accent）两个徽标看起来是同一种绿色。深色主题的 accent 曾是 `#86a89f`（164°/16% 饱和），与浅色品牌色完全不是同一个颜色。两者均已修正，不要改回去。

### 1.5 圆角、阴影、动效

| 令牌 | 值 |
| --- | --- |
| `--pq-radius-sm` / `md` / `lg` | 8px / 12px / 16px |
| `--pq-shadow-soft` / `float` / `dialog` | 三级阴影，深色下自动加重 |
| `--pq-motion-fast` / `motion` / `motion-slow` | 120ms / 200ms / 300ms，`ease-out` |

## 二、组件约定

现成的类在 `index.css` 里，优先复用，不要重写：

| 类名 | 用途 |
| --- | --- |
| `.pq-panel` / `.pq-panel-muted` / `.pq-acrylic` | 面板容器（实底 / 次级 / 玻璃拟态） |
| `.pq-card` | 可悬停卡片 |
| `.pq-button` / `.pq-button-primary` / `.pq-icon-button` | 次级按钮 / 主按钮 / 图标按钮 |
| `.pq-input` | 输入框（含焦点态） |
| `.pq-chip` | 胶囊标签 |
| `.pq-toolbar` / `.pq-workspace-surface` | 工具栏 / 工作区表面 |
| `.pq-chat-composer` / `.pq-chat-bubble-*` | 对话输入区与气泡 |
| `.pq-nav-item` | 左栏导航项 |

浮层与反馈不要各写一套，统一用 `src/ui/`：

| 模块 | 用途 |
| --- | --- |
| `src/ui/dialog.tsx` | `Dialog`（Portal + 焦点陷阱 + Esc + 滚动锁；已在 `LibrarySettingsDialog`、`ImportConfirmationDialog`、`BlockReparseModal` 使用）、`ConfirmDialog` |
| `src/ui/confirmHost.tsx` | 命令式 `confirmAction()`；**禁止再用 `window.confirm`** |
| `src/ui/toast.tsx` | 一次性反馈 `toast.success/error/info/progress` |
| `src/ui/taskCenter.tsx` | 长任务全局进度条 |
| `src/ui/commandPalette.tsx` + `commands.ts` | 命令面板与快捷键注册表 |

## 三、字号与间距

- 正文 13–14px；标题 15–16px；元信息/徽标 **不小于 11px**（曾有 50 处 `text-[10px]`，已统一提升）。
- 圆角：控件 8px（`--pq-radius-sm`），卡片/面板 12px，对话框 16px。
- 间距以 4px 为步进（Tailwind 的 1/2/3/4/6/8 即 4/8/12/16/24/32px）。

## 四、禁止项

1. **禁止在 JSX 里写死调色板类名**（`text-slate-500`、`bg-emerald-50`、`border-slate-200` 等）。一律用 `var(--pq-*)`。存量已清理 1181 处，剩余的多为带 `dark:` 成对覆盖的实心按钮与深底浅字，改动时顺带处理。
2. **禁止用 `window.confirm`**，改用 `confirmAction()`。
3. **禁止新增 `fixed inset-0` 自建遮罩**，用 `Dialog`。
4. **禁止省略键盘焦点样式**：全局 `:focus-visible` 已生效，不要用 `outline-none` 在没有替代焦点样式的情况下覆盖它。
5. **禁止用 CSS 选择器「补丁」修正硬编码色**。曾经有个 `.pq-saas-scope [class*="text-slate-900"] {...}` 的补丁层，用属性选择器把硬编码类强行改回令牌；已于 2026-11-02 删除（86 行），源码改为直接使用令牌。不要用这种方式掩盖漂移。
6. **禁止在未验证深色主题的情况下提交配色改动**。

## 五、已知约束

- 浅色主题下 `--pq-accent`（3.74:1）与 `--pq-success`（3.30:1）对白底**未达 WCAG AA 的 4.5:1**。这两个绿系色是品牌与语义的既有选择，主要用于徽标、图标、加粗小字而非正文；若将来需要正文级使用，应另立更深的一组令牌，而不是直接加深品牌色。
- 深色主题主按钮 `#ecfeff` on `#115e59` 为 7.29:1，深色 accent/success 对深底均在 9:1 以上，均通过 AA。
- 部分历史组件仍带 `dark:bg-*`、`dark:text-*` 覆盖（多为实心状态按钮的成对写法），属于有意保留：这些场景需要「浅底深字 / 深底浅字」的反转，语义令牌没有覆盖，改动时不要盲目删除。

## 六、修改令牌的流程

1. 只改 `:root` 与 `.dark` 两处，不要在两处之外定义颜色。
2. 同步检查引用该令牌的组件在**浅色与深色**下的表现，两套主题都要截图。
3. 改动 accent/success 这类语义色时，先算色相与对比度：语义色之间色相差应 ≥ 30°，正文文字对底 ≥ 4.5:1。
4. 在 `docs/changes/` 留记录，说明改了什么、为什么、验证了什么。
