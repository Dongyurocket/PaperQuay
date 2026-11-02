# PaperQuay v{{VERSION}}

A UI consistency pass across the whole app, plus a fix for a library bug that made paper titles disappear.

## Library

- **Paper cards no longer lose their title.** The card grid used a fixed-column layout whose fallback breakpoint was a *viewport* media query, but the list column is sized by the three-pane layout, not the viewport. After widening the category or details panel the breakpoint never fired, the fixed columns ate 372–404px, and in a 445px list the title column was left with 41–73px — titles, authors and file paths were truncated to nothing while badges stacked vertically and each card grew to ~300px of mostly empty space. Cards now use container queries and drop secondary columns as space shrinks; the title column is back to 354px and cards are 165px tall. Narrowing the window to its minimum width no longer collapses the list either.

## Reading

- Assistant sidebar, Q&A sessions and notes state moved out of the reader shell into their own stores. `DocumentReaderTab` went from 62 props to 11. No visible change intended — this is groundwork for keeping the reader maintainable.
- The bridge registry was **not** migrated: extracting it reproduced a real-desktop React "maximum update depth" loop, so it keeps its original lifecycle semantics.
- The reader's two different "dual pane" controls were renamed apart: the PDF layout switch is now "Single PDF / PDF dual pane", and the text column switch is "Original + Translation".

## Knowledge graph

- Node labels are thinned out by importance. Previously every node drew a 9px label, so a 191-node graph turned into overlapping text noise; now only the top ~20% hubs are labelled at the overview level, the selected node is always labelled, and all labels return once you zoom past 1.15×.
- Resizing the window (or maximizing) re-fits the graph instead of leaving it stranded in the corner, and the canvas gained zoom / fit buttons plus a node-type legend.

## Notes

- The graph toggle no longer covers the note title.
- Untranslated English labels (`Saved`, `Backlinks`, `No backlinks`, `Template`, `Search`) now follow the interface language.
- The word count reports characters for Chinese notes instead of a meaningless "67 words".
- The always-visible "Saved" text and "Save" button no longer compete; the button only appears when there is something to save.

## Agent

- **Clearing history now asks for confirmation.** It used to delete every session on a single click, and deleting one session had no confirmation either.
- The session list gained search, date grouping (today / yesterday / previous 7 days / earlier), two-line titles, and a localized usage figure instead of `585k tok`.

## Settings

- Removed the duplicated "Settings" heading, moved the sync interval unit inside its input, and labelled the citation-format dropdown.

## Under the hood

- **Design tokens are enforced.** 1181 hardcoded Tailwind palette classes were replaced with semantic tokens, and the `.pq-saas-scope` selector-patching layer was deleted — it had been forcing hardcoded classes back to token values in CSS, hiding the drift from code review.
- **Brand and status colours are now distinguishable.** In the light theme the accent (`#0d9488`) and success (`#059669`) greens were 13° apart in hue with nearly identical lightness, so "MinerU parsed" and "RAG indexed" badges looked like the same colour. Success moved to a true green (142°), and the dark theme accent is now the same hue family as the light one instead of a desaturated grey-green.
- **Shared UI primitives**: toast notifications (with screen-reader announcements), a global long-task bar, `Dialog`/`ConfirmDialog`, a promise-based confirm host, a single context-menu implementation, and a command palette. All six `window.confirm` call sites are gone.
- **Long tasks are visible outside their panel**: translation and RAG indexing now report into the global task bar, so switching tabs no longer hides progress. Translation shows real percentages; RAG indexing only has status-level events, so it shows an indeterminate state rather than a fake percentage.
- **Keyboard focus is visible**: `:focus-visible` had no rule at all before, so tabbing through controls gave no feedback.
- **Dead code removed**: `LibrarySettingsDialog` (unreferenced; all 13 of its settings live in the unified settings panel) and `PdfAnnotationWorkspace` (806 lines superseded by the reader's inline annotation UI).

## New

- **Command palette** on `Ctrl/Cmd+K` — search and run navigation, tab, settings and theme actions. Shortcuts use a registry: `Ctrl/Cmd+W` closes the current tab, `Ctrl/Cmd+,` opens settings.
- `docs/ui-design-system.md` documents the token tables, component contracts, the sanctioned overlay/menu inventory, and the constraints new UI must respect.

## Verification

- Build passes, 901 tests pass (36 new).
- Verified on the real desktop build: library card layout at three container widths, graph label thinning and zoom-in, notes and settings changes, three migrated modals (Esc / focus trap / scroll lock), three context menus, translation progress in the task bar, and keyboard operation of the palette and focus ring.
- **Not individually re-verified**: the reader's four core flows (RAG Q&A, note saving, translation switching, sidebar drag-resize). The store refactor directly touches the state ownership of the first three; opening a paper with PDF, structured text and the assistant sidebar was confirmed working.

---

# PaperQuay v{{VERSION}}

本次是一次覆盖全应用的界面一致性整理，同时修复了一个会让文库标题消失的缺陷。

## 文库

- **文献卡片不再丢失标题**：卡片列原本用固定宽度布局，降级断点却写成了**视口**媒体查询——而这一栏的宽度由三栏拖拽决定，与视口无关。把分类栏或详情栏拉宽后断点永不命中，固定列吃掉 372~404px，445px 宽的列表里标题列只剩 41~73px，标题、作者、文件路径全被截断成不可见，徽标被挤成竖排，每张卡片被撑到约 300px 高却几乎全是空白。现在改用容器查询并按空间收起次要列，标题列恢复 354px、卡片高度降到 165px。窗口缩到最小宽时列表也不再塌陷。

## 阅读

- 助手侧栏、问答会话与笔记的状态从阅读器外壳移入各自的 store，`DocumentReaderTab` 的 props 由 62 个降到 11 个。不预期任何可见变化——这是为了让阅读器后续可维护。
- **bridge 注册表未迁移**：抽取后在真实桌面会复现 React「最大更新深度」循环，因此保留原有生命周期语义。
- 阅读器里两个都叫「双栏」的控件已改名区分：PDF 布局开关现为「单栏 PDF / PDF 双栏」，文本列开关为「原文 + 译文」。

## 知识图谱

- 节点标签按重要度抽稀。此前每个节点都画 9px 标签，191 个节点的图会变成互相重叠的文字噪声；现在总览只标注前 20% 左右的重点节点，选中的节点始终标注，放大超过 1.15 倍后全部标签恢复。
- 改变窗口大小或最大化时会重新适配图谱，不再停留在角落；画布新增缩放 / 适配按钮与节点类型图例。

## 笔记

- 「图谱」开关不再压住笔记标题。
- 未翻译的英文标签（`Saved`、`Backlinks`、`No backlinks`、`Template`、`Search`）现在跟随界面语言。
- 中文笔记的字数统计改为按字数，不再是毫无意义的「67 words」。
- 常驻的「已保存」文字与「保存」按钮不再互相干扰，按钮只在有内容待保存时出现。

## Agent

- **清空历史现在会请求确认**：此前单击一次就删除全部会话，删除单个会话同样没有确认。
- 会话列表新增搜索、按日期分组（今天 / 昨天 / 最近 7 天 / 更早）、两行标题，用量单位改为本地化的数字而非 `585k tok`。

## 设置

- 删除了重复的「设置」标题，把同步间隔的单位移入输入框内，并为引用格式下拉框补上标签。

## 底层改动

- **设计令牌已强制执行**：1181 处硬编码的 Tailwind 调色板类名替换为语义令牌，同时删除了 `.pq-saas-scope` 选择器补丁层——它原本在 CSS 里把硬编码类强行改回令牌值，让样式漂移在代码审查中完全不可见。
- **品牌色与状态色现在可以区分**：浅色主题下品牌色（`#0d9488`）与成功色（`#059669`）的色相只差 13°、亮度几乎相同，导致「MinerU 已解析」与「RAG 已索引」两个徽标看起来是同一种颜色。成功色已移到纯绿（142°），深色主题的品牌色也改为与浅色同一色相族，不再是降饱和的灰绿。
- **共享 UI 原语**：toast 通知（含读屏播报）、全局长任务条、`Dialog` / `ConfirmDialog`、Promise 式确认宿主、统一的右键菜单实现，以及命令面板。六处 `window.confirm` 调用全部移除。
- **长任务在面板外也可见**：翻译与 RAG 索引现在会汇报到全局任务条，切换标签页不再隐藏进度。翻译显示真实百分比；RAG 索引只有状态级事件，因此显示不确定进度，不伪造百分比。
- **键盘焦点可见**：此前 `:focus-visible` 完全没有规则，用 Tab 走过控件没有任何反馈。
- **删除死代码**：`LibrarySettingsDialog`（无任何引用，其 13 项设置已全部并入统一设置面板）与 `PdfAnnotationWorkspace`（806 行，功能已由阅读器的行内批注取代）。

## 新增

- **命令面板**（`Ctrl/Cmd+K`）：可搜索并执行导航、标签、设置与主题操作。快捷键走注册表：`Ctrl/Cmd+W` 关闭当前标签，`Ctrl/Cmd+,` 打开设置。
- `docs/ui-design-system.md` 记录令牌表、组件契约、允许使用的浮层/菜单清单，以及新界面必须遵守的约束。

## 验证

- 构建通过，901 项测试通过（新增 36 项）。
- 已在真实桌面构建上验证：文库卡片三种容器宽度、图谱标签抽稀与放大、笔记与设置的改动、三个已迁移的模态（Esc / 焦点陷阱 / 滚动锁）、三处右键菜单、任务条中的翻译进度，以及命令面板与焦点环的键盘操作。
- **未逐项复验**：阅读器的四项核心流程（RAG 问答、笔记保存、译文切换、侧栏拖拽调宽）。本次 store 重构直接涉及前三项的状态归属；已确认打开文献后 PDF、结构化正文与问答侧栏均正常。
