# 2026-11-02 - UI 设计系统：令牌迁移、accent 统一、补丁层移除

阶段 3 的落地记录。前两阶段见 `2026-11-02-library-card-container-query.md`、`2026-11-02-ui-detail-fixes.md`、`2026-11-02-ui-interaction-infrastructure.md`。

## 现象

1. **令牌体系形同虚设**：`index.css` 里定义了完整的两套主题变量，但界面代码里另有 691 处硬编码 Tailwind 调色板（`border-slate-200` 单独就有 197 处）绕过了它。
2. **漂移被补丁掩盖**：`index.css` 里有一段 `.pq-saas-scope [class*="text-slate-900"] { … }` 的属性选择器补丁（86 行、40 条规则），把硬编码类在 CSS 层强行改回令牌值。它让界面"看起来没问题"，却让漂移无法在代码审查中被发现。
3. **品牌色跨主题不连续**：浅色 accent 是 `#0d9488`（174.7°/84%/32%），深色却是 `#86a89f`（164°/16%/59%）——饱和度塌到 16%，与浅色不是同一个颜色。
4. **「强调」与「成功」不可区分**：浅色 accent `#0d9488`（174.7°）与 success `#059669`（161.4°）色相只差 13°，亮度饱和度几乎相同。文库卡片上「MinerU 已解析」（success）与「RAG 已索引」（accent）两个徽标看起来是同一种绿色。
5. **字号过小**：50 处 `text-[10px]` 用于徽标与元信息。

## 修改

### 令牌迁移（codemod）

写了映射脚本（一次性工具，未入库）按语义替换，共 **1181 处 / 42 个文件**：

| 原类 | 令牌 |
| --- | --- |
| `text-slate-900/800/950` | `var(--pq-text)` |
| `text-slate-700/600/500` | `var(--pq-text-muted)` |
| `text-slate-400/300` | `var(--pq-text-faint)` |
| `border-slate-100/200` | `var(--pq-border)` |
| `border-slate-300/400/500` | `var(--pq-border-strong)` |
| `bg-slate-50/100` | `var(--pq-surface-2)` |
| `bg-slate-200/300` | `var(--pq-surface-3)` |
| 状态色 `bg-{family}-50/100/200/300` | `var(--pq-{semantic}-bg)` |
| 状态色 `text-{family}-500~900` | `var(--pq-{semantic})` |
| 状态色 `border-{family}-200/300/400` | `color-mix(… var(--pq-{semantic}) 28% …)` |

映射有意**收紧**，以下一律不动：

- 实心状态底色（`bg-emerald-600`、`bg-rose-700` 等）与其成对的 `text-white`／`dark:bg-*-400 dark:text-slate-950`。这些是饱和实心按钮，映射到 10% 透明的 `-bg` 令牌会让按钮消失、文字不可读。
- 深底上的浅字（`text-emerald-100/200/300`），映射成 `--pq-success` 在浅色主题下对比度会反掉。
- 带不透明度后缀的叠加层（`bg-white/92`、`border-white/10`）。
- 上游近期改动的两个文件（`DocumentReaderTab.tsx`、`assistantSidebarChat.tsx`）——避开是为了不让下次 `upstream` 同步产生冲突。

### 移除补丁层

删除 `.pq-saas-scope` 全部 40 条选择器规则（86 行）。删前先确认它覆写的具体 hex 类在源码中已全部为 0，唯一的例外是 4 处 `bg-teal-600` 实心按钮——先把它们改成 `--pq-accent-button-bg` / `--pq-accent-button-text`，再删补丁。另外清掉 5 处 JSX 里已变成空壳的 `pq-saas-scope` 类名。

副作用：补丁曾给所有带边框的 `input/textarea/label` 强加半透明白底（`rgba(255,255,255,.68)`）。移除后输入框改用自身的 `--pq-surface-2` 实色底，语义更正确，观感可接受。

### accent 与语义色

- 深色 accent：`#86a89f` → `#2dd4bf`（172.5°/66%/50%），同色相提亮；`hover`/`strong`/`light`/`soft`/`border`/`ring`/`shadow` 全套随之更新；`--pq-accent-button-bg` 改为 `#115e59`、`bg-hover` `#0f766e`、`text` `#ecfeff`。
- `--pq-success`：浅色 `#059669` → `#16a34a`（142°），深色 `#6ee7b7` → `#4ade80`（142°），与 accent 拉开 30° 以上。

### 字号

50 处 `text-[10px]` → `text-[11px]`（徽标与元信息下限）。

### 文档

新增 `docs/ui-design-system.md`：令牌表（含浅/深两套值）、组件类与 `src/ui/` 原语的职责、字号间距、六条禁止项、已知对比度约束、修改令牌的流程。

## 验证

- `npm run build` 通过；`npm test` **869 项全绿**。
- 副作用抽查：确认替换只发生在类名字符串中，没有把 `var()` 写进 `color:` 之类的原始颜色位置（`grep -E "color:\s*'\[var"` 无命中）。
- **实机验证（Cua，打包为 `win-unpacked` 运行真实应用）**：
  - 浅色文库页：卡片、徽标、工具栏正常；三个徽标现在呈绿/青/蓝三种可区分色相——按像素采样确认 `概览已生成` 的文字色为 `#0891b2`（info），与 accent、success 均不同。
  - 设置面板：输入框由半透明白变为实色 `--pq-surface-2`，`30 分钟` 单位内嵌与「引用格式」标签仍在。
  - 深色文库页与笔记页：整体可读；主按钮实测底色 `(17,94,89)`＝`#115e59`，确认走的是 `--pq-accent-button-bg` 而非亮 accent。
- 对比度核算：深色主按钮 `#ecfeff` on `#115e59` = **7.29:1**；深色 accent 对深底 9.35:1、success 9.99:1，均过 AA。浅色 accent（3.74:1）与 success（3.30:1）对白底**未达 4.5:1**，属既有特性（原值同样偏低），已写入设计文档的「已知约束」，不通过加深品牌色来"修"。

## 未完成

- **阅读器 store 分片延后**：`DocumentReaderTab` 有 62 个 props、4503 行 / 15 万字符，`Reader.tsx` 另有 15 个 `useState` 与命令式 bridge；仓库现有 869 项测试以 server/service 为主，阅读器 UI 无自动化回归。在没有回归网的前提下做这个拆分，风险落在最核心的阅读链路上，故不在本轮执行。建议下一轮先为 QA 会话、笔记、翻译三组状态补基础测试，再按「新增状态先进 store → 旧状态按模块迁移」推进。
- 仍有约 115 处中性色与约 300 处状态色硬编码，均为「实心按钮 + 深底浅字 + `dark:` 成对覆盖」的场景，需按组件语义逐个定义令牌（如 `--pq-danger-button-bg/text`）后再处理，不做机械替换。
