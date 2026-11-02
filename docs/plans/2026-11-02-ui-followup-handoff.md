# UI 收尾计划（交接用）

- 日期：2026-11-02
- 状态：**已完成**（T1–T8 已于 2026-11-03 完成；T9 已关闭）
- 前置：三阶段主线已完成并推送。本文件只记录**尚未完成**的部分。
- 关联：
  - 主线方案：`docs/plans/2026-11-02-ui-logic-and-visual-refinement.md`
  - 设计规范（新增代码的审查依据）：`docs/ui-design-system.md`
  - 已落地记录：`docs/changes/2026-11-02-library-card-container-query.md`、`2026-11-02-ui-detail-fixes.md`、`2026-11-02-ui-interaction-infrastructure.md`、`2026-11-02-ui-design-tokens.md`

## 零、当前基线（动手前先确认）

| 项 | 值 |
| --- | --- |
| `main` / `origin/main` | `0540380`（2026-11-02 23:15 核对，两边一致） |
| 构建 | `npm run build` 通过 |
| 测试 | `npm test` **878 项**全绿 |
| 令牌引用 | 2850 处 `var(--pq-*)` |
| 剩余硬编码色 | 中性色 108 处、状态色 **17 处**（T3 前为 351） |
| 自建模态遮罩残留 | 8 个文件（其中 `src/ui/` 的 2 处是合法实现；T4 已迁走 3 个） |
| 自建菜单实现 | 1 处（`src/ui/menu.tsx`）+ 1 处已登记例外（图谱节点菜单） |
| `window.confirm` 残留 | 0 |
| 阅读器组件规模 | `DocumentReaderTab` 62 props / 4503 行；`Reader.tsx` 1252 行 / 15 个 `useState`（其中 20 个 reader 前缀状态） |

## 一、任务清单

按「风险低 → 高」排序。建议按批次分会话执行，每批一个分支、一次 FF 合并。

### T1　补验文献卡片的三项交互（低风险，纯验证）

**为什么还没做**：阶段 1 当时受限于 Cua 后台输入不支持修饰键，Ctrl 多选／拖拽排序／拖到分类三项被跳过。现已确认前台输入可用（见「五、验证方法」），应当补上。

**要验证什么**

| 交互 | 触发 | 预期行为 | 代码位置 |
| --- | --- | --- | --- |
| 单选 | 点击卡片 | 右侧详情切换到该文献 | `LiteraturePaperList.tsx:472` 的 `onSelectPaper` |
| Ctrl 多选 | `Ctrl` + 点击第二张卡 | 出现批量操作条（已选 N 篇），右栏保持最后点击项 | 同上，`modifiers.ctrlKey` |
| 拖拽排序 | 拖动行首 ⠿ 把手上下移动 | 顺序改变并持久化；未开启手动排序时把手为禁用态 | `LiteraturePaperList.tsx:307` `handleSortPointerDown` |
| 拖到分类 | 把卡片拖到左侧分类 | 该文献归入目标分类 | `LiteraturePaperList.tsx:273` `handlePaperDrop` |

**验收**：四项逐一在实机上成功一次，并在 `docs/changes/` 补一条验证记录（可并入下一次变更记录，不必单独建文件）。若发现失败，先复现再定位——本次改动只动了 class 名，理论上不应影响事件处理。

**完成情况（2026-11-02）**：四项均通过实机验证（单选切换详情；真 Ctrl+点击从「已选 1 篇」到「已选 2 篇」；手动排序下拖拽换序、重启后保留；拖到「医疗与eVTOL」后计数 13→14、重启后保留），非手动排序时把手禁用且拖拽无效。与本节描述的差异：选中 2 篇及以上时右栏是「批量操作」面板而非最后点击项详情。详细证据见 `docs/changes/2026-11-02-ui-followup-t1-t2.md`。

### T2　修两份计划文档的陈旧状态（极低风险，文档）

| 文件 | 问题 |
| --- | --- |
| `docs/plans/2026-09-23-performance-reader-outline-and-rag-context.md` | 头部写「状态：设计方案，尚未实施」，但交付物 `src/features/pdf/PdfOutlinePanel.tsx`、`src/features/reader/readerResourceBudget.ts`、`src/features/reader/mineruParseWorker.ts` 与跨页全选均已在代码中。改为「已实施」并注明核验日期 |
| `docs/plans/2026-11-01-reader-assistant-sidebar-resize-stuck.md` | 无状态行；对应修复 `b7233f2 fix(reader): end resize drag reliably and persist sizes on release` 已在 main。补状态行 |

**验收**：两份文档头部状态与实际代码一致；`grep -rln "尚未实施" docs/plans/` 不再命中已完成的计划（唯一剩余命中是本表对本条问题的引述）。

**完成情况（2026-11-02）**：两份文档状态已按代码校正——09-23 文档改「已实施」并新增「0. 实施核验」小节，11-01 文档补「状态」小节（修复提交 `b7233f2` 在 `main`）。

### T3　定义按钮级语义令牌，清理剩余状态色（中风险）

**现状**：351 处状态色 + 115 处中性色未迁移，全部集中在「实心状态按钮」与「深底浅字」两类场景。上一轮 codemod 有意跳过它们，因为机械替换会让暗色模式文字不可读（`bg-emerald-600` + `text-white` 映射到 10% 透明的 `-bg` 令牌会直接失效）。

**做法**：先补令牌，再替换。建议新增按钮级令牌（命名沿用既有 `--pq-accent-button-*` 的风格）：

```css
/* :root */
--pq-success-button-bg: #16a34a;
--pq-success-button-bg-hover: #15803d;
--pq-success-button-text: #ffffff;
--pq-danger-button-bg: #dc2626;
--pq-danger-button-bg-hover: #b91c1c;
--pq-danger-button-text: #ffffff;
/* .dark 里对应改为深底 + 浅字，逐对核算对比度 */
```

**替换范围（按文件优先级）**

| 文件 | 剩余处数 |
| --- | --- |
| `src/features/agent/AgentWorkspaceMessages.tsx` | 70 |
| `src/features/blocks/blockViewerContent.tsx` | 57 |
| `src/features/literature/components/LiteraturePaperDetails.tsx` | 30 |
| `src/features/literature/components/LiteraturePaperList.tsx` | 29 |
| `src/features/reader/readerPreferencesContent.tsx` | 27 |
| 其余 30+ 文件 | 各 ≤26 |

**约束**

- 每改一个文件，浅色与深色都要看一眼（这两类场景就是靠 `dark:` 成对覆盖实现的）。
- 按钮文字对底的对比度必须 ≥ 4.5:1，改完用公式核算（见 `docs/ui-design-system.md` 第六节）。
- 上游改过的 `DocumentReaderTab.tsx`、`assistantSidebarChat.tsx` 继续跳过，避免下次同步冲突。

**验收**：`grep -rEo '(bg|text|border)-(emerald|rose|amber|sky|indigo|teal|red|cyan|blue|green)-[0-9]{2,3}' src --include=*.tsx | wc -l` 显著下降（目标 < 50，剩余仅深底浅字这类必须保留的 `dark:` 覆盖）；浅色/深色各截 4 个主界面确认无回归。

**完成情况（2026-11-02）**：新增 9 个按钮级令牌（success / danger / warning 各 `-button-bg` / `-bg-hover` / `-text`），浅色「亮底 + 白字」、深色「深底 + 浅字」，9 组文字对底均 ≥4.5:1（最低为浅色 danger 4.83:1）；计划建议的浅色 success `#16a34a` 配白字只有 3.30:1，改用 `#15803d`（5.02:1）。26 个文件替换 338 处，目标 grep **350 → 17**：剩余 5 处是 `blockViewerContent.tsx:171` 的深底浅字实心危险小按钮（按约束保留），12 处是继续跳过的 `assistantSidebarChat.tsx`。另顺带修正 4 类深色可读性缺陷（阅读视图高亮、两个计数徽标、`ToggleRow`、4 处亮 accent 实心按钮）。映射规则、对比度数值与 8 张实机截图见 `docs/changes/2026-11-02-ui-button-tokens.md`。

### T4　把剩余自建模态迁移到 `Dialog` 原语（中风险）

`src/ui/dialog.tsx` 已提供 Portal + 焦点陷阱 + Esc + 背景滚动锁，但下列 11 个文件仍各自实现 `fixed inset-0`：

```
src/components/ContextMenu.tsx
src/features/agent/AgentWorkspaceMessages.tsx
src/features/blocks/BlockReparseModal.tsx
src/features/blocks/blockViewerContent.tsx
src/features/literature/components/ImportConfirmationDialog.tsx
src/features/literature/components/LibrarySettingsDialog.tsx
src/features/literature/components/LiteratureCategorySidebar.tsx
src/features/literature/LiteratureLibraryView.tsx
src/features/notes/NoteDistillPreviewPanel.tsx
src/features/notes/NotesContextMenu.tsx
src/features/reader/ReaderPreferencesWindow.tsx
```

**建议顺序**：先做三个「真模态」——`LibrarySettingsDialog`、`ImportConfirmationDialog`、`BlockReparseModal`（结构简单，收益直接）；`ReaderPreferencesWindow` 放最后（自带侧栏导航与多分区滚动，迁移需要单独一轮回归）。

`ContextMenu` 与 `NotesContextMenu` 属于菜单而非模态，应合并为同一套 `ui/menu` 原语（见 T5），不要套 `Dialog`。

**验收**：每个迁移后的浮层验证四点——Esc 关闭、Tab 不跑到背后界面、背景可滚动元素被锁、关闭后焦点回到触发按钮。

**完成情况（2026-11-02）**：`LibrarySettingsDialog`、`ImportConfirmationDialog`、`BlockReparseModal` 三个真模态已迁到 `Dialog`（内部滚动结构、宽度、文案、令牌与 props 均未改，调用点零改动），四项行为与 Tab 正反循环在浅色/深色下实机验证通过。迁移同时暴露并修掉 `Dialog` 两个缺陷：`onClose` 内联导致每次重渲染都重建监听并重新聚焦首个元素（阅读器计时器持续渲染时 Tab 焦点会被打回顶部），以及无 DOM 环境下 `createPortal` 抛错。z-index 统一为 `z-[120]`，顺带修掉块预览（`z-90`）盖住重识别模态的旧遮挡。细节见 `docs/changes/2026-11-02-ui-dialog-modals.md`。遗留：`LibrarySettingsDialog` 全仓无挂载点，本轮用临时探针验收（探针已删除），是否删除该组件或补回入口待定。

### T5　合并两套 ContextMenu（低到中风险）

| 文件 | 规模 |
| --- | --- |
| `src/components/ContextMenu.tsx` | 3781 字节，已有 `ContextMenuEntry` 类型与位置钳制逻辑 |
| `src/features/notes/NotesContextMenu.tsx` | 5903 字节 |

**做法**：以 `components/ContextMenu.tsx` 为基础扩展（它已有位置钳制与分隔符支持），把笔记侧的特有项（块操作、锚点）作为 entries 传入；统一后迁到 `src/ui/menu.tsx` 并与 `docs/ui-design-system.md` 的组件表对齐。

**验收**：不要用 `grep clampPosition` 当通过条件。这个命令只证明「有人写了这个函数名」。不做钳制的实现搜不到，分类侧栏因此漏过上一轮审计。文献行以前用的是另一个函数名 `clampFloatingMenuPosition`，同样会被漏掉。也不要只用 `contextMenu.(x|y)|position: 'fixed'`：调用点把坐标传给 `Menu` 也会命中，而 `paperContextMenu` 和 Tailwind `fixed` 又会漏掉。

本轮采用两条，合起来才覆盖自建菜单定位：

```bash
git grep -n -E "clampPosition|clampFloatingMenuPosition|pq-acrylic fixed" -- "src/*.tsx" "src/**/*.tsx"
git grep -n -E "Math\.min\(contextMenu\.(x|y)" -- "src/*.tsx" "src/**/*.tsx"
```

右键菜单的贴边实现只允许 `src/ui/menu.tsx` 的 `clampPosition`。其余命中必须逐条标明是不是另一套自建菜单，不能因为变量名不同就当成不存在。标签栏、笔记块、文库分类三处行为一致：打开、危险项红色、禁用态、点外部关闭、贴边钳制。原语仍没有键盘 ↑↓（合并前也没有）。

**完成情况（2026-11-02）**：两套复制品实现合并为 `src/ui/menu.tsx` 的 `Menu` / `MenuItem` / `MenuEntry`，`x`/`y`/`title`/`entries`/`onClose`/`width` 语义与分隔符、危险/强调色、贴边钳制、点外部关闭全部保持不变；`isEditableContextTarget` / `hasActiveTextSelection` 抽到 `features/notes/noteContextMenuTargets.ts`。与原计划的差异：**没有同时改 7 个调用点**，而是把 `components/ContextMenu.tsx` 与 `features/notes/NotesContextMenu.tsx` 改成薄 re-export（含类型与两个辅助函数），调用点 import 零改动；下一步可改为直接 import 新模块后删除两个 shim。同一提交删除了 T4 遗留的死代码 `LibrarySettingsDialog`（全仓零引用，13 个设置字段已在 `readerPreferencesContent` 中）。实机验证：标签栏与笔记块菜单在浅色/深色下各截一张，打开、危险项红色、禁用态、点外部关闭均通过；笔记块长菜单实测到向上钳制。**当时未覆盖**：文库分类右键仍是侧栏内的独立实现。详见 `docs/changes/2026-11-02-ui-menu-merge.md`。

**完成情况（2026-11-02 收尾）**：`LiteratureCategorySidebar` 的右键改为 `Menu` / `MenuEntry`（文案、顺序、图标、system 不显示「新建子分类」、展开/折叠动态文案均保持）。可见变化只有 acrylic 面板换成菜单面板、硬编码深色值换成令牌、贴边改由 `clampPosition` 负责（删掉 `openContextMenu` 里 12px/232/168 的手写钳制）。删除零引用的 `PdfAnnotationWorkspace.tsx`。`npm run build` 通过，`npm test` 869/869。审计输出见 `docs/changes/2026-11-02-ui-category-menu.md`。分类菜单不再是自建定位；文献行右键（`paperContextMenu` + `clampFloatingMenuPosition`）和图谱节点菜单仍是自建实现，不在本轮范围。

**完成情况（2026-11-02 文献行）**：文献行右键改为 `Menu` / `MenuEntry`。菜单标题用 `Menu` 的 `title`（文献标题）。动作项是 6 个，不是 8 个：收藏、自定义标签、解析元数据、本地知识库加入或移出、条件出现的 RAG 索引、删除文献记录。翻译版 PDF 的附加和移除在文献详情里，不在这个右键菜单。文案、顺序、图标、disabled 和「删除文献记录」的 `tone: 'danger'` 保持原样。「移出本地知识库」原来不是红色，迁移后也不是。删掉只服务这一处的 `clampFloatingMenuPosition`，坐标原样交给 `clampPosition`。图谱节点菜单仍不迁移，理由写在 `docs/ui-design-system.md` 的「浮层与菜单清单」。`npm run build` 通过，`npm test` 869/869。文献库 SHA256 前后都是 `24E68F64…`。审计输出与实机结果见 `docs/changes/2026-11-02-ui-paper-row-menu.md`。

### T6　把翻译与 RAG 长任务接入 `TaskCenter`（中风险）

**现状**：`src/ui/taskCenter.tsx` 只订阅 `documentParseTasks`（MinerU/PaddleOCR 解析）。翻译与 RAG 索引的进度仍只在各自面板可见，切走标签页就看不到。

**接入点**

| 任务 | 现有进度来源 |
| --- | --- |
| 翻译 | `src/features/pdf/PdfViewer.tsx:152-153` 的 `translationProgressCompleted` / `translationProgressTotal`（当前由 props 传入，需提升为可订阅的 store 或事件） |
| RAG 索引 | `src/features/literature/LiteratureLibraryView.tsx:161` 的 `ragIndexingDocumentKey`；实际索引状态在 RAG 任务链路上 |

**做法**：仿照 `documentParseTasks.ts` 建一个轻量的通用任务注册表（`src/services/backgroundTasks.ts`），字段为 `{ id, kind: 'translate' | 'rag' | 'parse', title, completed, total, status, error }`，`TaskCenter` 订阅它；解析任务可继续用现有注册表，在 `TaskCenter` 内部合并两个来源。

**验收**：启动一次翻译与一次 RAG 索引，切到别的标签页后仍能在右下角看到进度；完成后自动消失；失败保留 60 秒并可读。

**完成情况（2026-11-02）**：新增 `src/services/backgroundTasks.ts`。翻译按真实 `completed/total` 显示百分比，写入节流为 ≥200ms 或百分比变化 ≥2%。RAG 只显示「索引中」，不造百分比；同一文献多个来源全部结束后才完成一次。解析任务仍走 `documentParseTasks`，在 `TaskCenter` 里合并。任务条实际在左下角，没有改到右下角。工具栏原有的翻译进度没改。`npm run build` 通过，`npm test` 878/878。实机：阅读器翻译到 120/188 时任务条为 64%，切到笔记后仍在并升到 74%，完成后任务条消失，阅读器状态为「翻译完成，已生成 188 段译文」。成功 toast 没截到。RAG 没实机跑起来：唯一 pending 记录不在文献库里。详见 `docs/changes/2026-11-02-ui-task-center-translate-rag.md`。

### T7　验证 `Dialog` 的焦点陷阱边界循环（低风险，纯验证）

上一轮只做了代码级确认。需实测：打开任一 `ConfirmDialog`，连续按 `Tab` 到最后一个可聚焦元素后应回到第一个；`Shift+Tab` 反向同理；焦点不应出现在遮罩背后的界面上。

**代码位置**：`src/ui/dialog.tsx` 的 `FOCUSABLE` 选择器与 `handleKeyDown` 的循环逻辑。

**验收**：Tab 循环正反各走一轮，截图或录屏留证。

**完成情况（2026-11-02）**：在三个新迁入 `Dialog` 的模态上各走一轮——首个可聚焦元素按 Shift+Tab 跳到末位（导入确认「确认导入」、块重识别「开始重新识别」、库设置「保存设置」），末位按 Tab 回到首个「关闭」；焦点始终在 `role="dialog"` 内，未漏到遮罩背后。验证方式为临时探针 + UIA 读取焦点元素标签，浅色/深色各截图。过程中发现 `Dialog` 在父级重渲染时会重新聚焦首个元素、导致循环失效，已修复（见 T4 完成情况）。

### T8　阅读器 store 分片（高风险，建议逐刀推进）

**为什么谨慎**：`DocumentReaderTab` 62 个 props、4503 行 / 15 万字符；`Reader.tsx` 1252 行、15 个 `useState`（20 个 reader 前缀状态）。

**关于测试覆盖的准确描述（2026-11-02 修正）**：阅读器**并非**无自动化回归——`tests/` 下有十几个相关文件（`documentReaderQaSessions`、`documentReaderNotes`、`readerTranslation`、`readerRagContext`、`readerResourceBudget` 等）。但它们测的是**纯函数 helper**（如 `removeQaSession`、`resolveActiveQaSession`、`resolveQaModelPreset`、`resolveQaSessionSelection`），**没有测组件状态接线**——即 `Reader.tsx` 的状态是否正确地喂给这些 helper、再作为 62 个 props 传下去。

因此 T8 的性质是：**逻辑已抽出且有测试，缺的是状态所有权**。不是「抽逻辑 + 补测试」。

**分片候选**（按内聚度分组，`Reader.tsx:186-214` 起）

| 分片 | 状态字段 |
| --- | --- |
| 布局与面板 | `readerAssistantActivePanel`、`readerAssistantDetached`、`readerAssistantPanelWidth`、`readerAssistantPanelResizing` |
| QA 会话 | `readerQaSessions`、`readerSelectedQaSessionId`、`readerQaInput`、`readerQaAttachments`、`readerSelectedQaPresetId`、`readerQaRagEnabled`、`readerQaAnswerRenderMode`、`readerQaReasoningEffort`、`readerQaRunningSessionIds`、`readerQaError` |
| 笔记 | `readerNotes`、`readerActiveNoteId`、`readerNotesLoading`、`readerNotesSaving`、`readerNotesError` |
| 桥接 | `readerBridges`（命令式 bridge，最复杂，最后处理） |

**推进方式：一次只动一个分片**，顺序为「布局与面板 → QA 会话 → 笔记 → 桥接」。每刀完成即 build + test + 阅读器实机回归，合并后再开下一刀。第一刀（布局与面板，4 个状态）风险最低，也用来验证 store 模式是否可行。

**每刀的共同约定**：

1. 新建 `src/stores/useReader<X>Store.ts`（zustand，与 `useTabsStore` / `useThemeStore` 同风格）。
2. 下游组件**仍通过 props 接收**这些值——store 只把状态所有权上移，不改变数据流方向，这样 62 个 props 的形状不会在迁移中反复变动。
3. localStorage 的键名与 clamp 边界必须原样保留。
4. 若某组状态与 bridge / 内联回调强耦合、无法干净抽出，立即停止并报告耦合点，不要为了完成迁移而改写阅读器主流程。

**验收（每刀）**：build + 全量测试全绿；为新增 store 补测试（默认值 / setter / clamp 边界 / 持久化）；实机回归该分片涉及的所有交互，侧栏拖动后松手固定是重点（2026-11-01 修过的问题，勿退化）。

**总目标**：`DocumentReaderTab` 的 props 数从 62 降到 20 以内；打开文档、RAG 问答、笔记保存、译文切换四项核心流程行为不变。

### T9　Agent wheel delegate 触控板惯性（✗ 已关闭，2026-11-02）

**关闭理由**：该问题（`src/hooks/useWheelScrollDelegate.ts` 第 106 行手动累加 `scrollTop` 导致触控板惯性丢失）**只能在触控板设备上复现**。本项目日常在台式工作站上用鼠标滚轮，没有惯性可丢，无法构造复现条件。

自 2026-09-23 提出至今未验证，也未收到任何实际影响反馈，属于「静态推演得到、从未观察到」的疑似问题。继续挂在待办里会让清单看起来永远做不完，故关闭。

**若将来换了触控板设备且确实感到 Agent 聊天区滚动手感异常**，按以下顺序重开：先在触控板上滚聊天区确认是否有惯性丢失或内外都滚不动的死角；确认后再考虑改动 `useWheelScrollDelegate` 的委派策略，不要凭静态推演直接改滚动实现。

## 二、建议的会话切分

| 会话 | 任务 | 依赖 | 预估 |
| --- | --- | --- | --- |
| A | T1 + T2 | 无 | ✅ 已完成 |
| B | T3 | 无 | ✅ 已完成 |
| C | T4 + T5 + T7 | T3 后 | ✅ 已完成 |
| D | T6 | 无 | ✅ 已完成 |
| E | T8 第一刀：布局与面板（4 个状态） | 无 | 半天 |
| F | T8 后续刀：QA 会话 → 笔记 → 桥接 | 每刀依赖上一刀合并 | 每刀 1–2 天 |

**并行建议**：剩余只有 T8，且它是同一条链路上的逐刀推进，应串行。每刀完成即合并 + 实机回归，不要攒在一个分支里。

## 三、每会话的公共约束

1. 分支按 `fix/*`、`feat/*`、`refactor/*`、`docs/*` 命名；**一个主题一个分支，一次 FF 合并回 main**。
2. 动手前 `git fetch upstream` 看有无待合并改动；本仓库跟随 `WangQrkkk/PaperQuay`，累计已领先上游很多，避免在热点文件上叠加冲突。
3. 每会话结束必须：`npm run build` + `npm test` 全绿，并在 `docs/changes/` 留记录（格式见 `docs/changes/README.md`：现象 / 根因 / 修改 / 验证）。
4. 新界面与新样式一律按 `docs/ui-design-system.md` 审查——禁止硬编码调色板、禁止 `window.confirm`、禁止自建遮罩、禁止用 CSS 选择器补丁掩盖漂移。
5. **不要重复已决策的事项**：不做引导（`data-tour` 已删除）、不做密度开关、accent 以浅色 `#0d9488` 为基准、success 用 142° 纯绿。

## 四、已知陷阱（本项目实测，避免重踩）

1. **工作区内的可执行文件起不来**：`node_modules/electron/dist/electron.exe` 与 `release/*/win-unpacked/PaperQuay.exe` 在项目目录内启动即静默退出（rc=3，无 stderr）。必须打包后**整个复制到 `%TEMP%`** 再 `Start-Process` 启动。
2. **打包产物删不掉**：`release/local-ui-*/**/app.asar` 会被 Proma 句柄锁定，`rm`、`Remove-Item -Force`、甚至 `cp -r` 都会失败。**每次验证用完提醒用户重启 Proma 后清理**，或复用同一个输出目录。
3. **`npm run dev` 在 Agent 会话内不可用**：Vite 起得来但 Electron 静默退出并连带杀掉 Vite。UI 验收走第 1 条的打包路径。
4. **`TEMP`/`TMP` 要指到工作区目录**（如 `.tmp-build`），否则 esbuild 临时文件被锁导致 build/test 间歇失败。
5. **新建文件会被环境归一化为 LF**（1–2 秒内），写 CRLF 保留不住；`git add` 的 `LF will be replaced by CRLF` 警告可忽略，索引里存的就是 LF。但提交前要查**混合行尾**。
6. **修改颜色前先算对比度与色相距离**：语义色之间色相差应 ≥30°，正文文字对底 ≥4.5:1。上一轮就是靠这个发现 accent 与 success 只差 13°。
7. **`scripts/` 是个人未跟踪资产**，不要提交、不要清理。
8. **`ELECTRON_RUN_AS_NODE=1` 会让 Electron 静默退出（2026-11-02 实测）**：Agent 会话环境自带该变量，从中启动的 Electron 可执行文件被当作 Node 运行，进程立即以 0 退出、无窗口无输出，看起来像「可执行文件起不来」。启动前先 `Remove-Item Env:\ELECTRON_RUN_AS_NODE`。清掉该变量后，工作区目录内的 `release/*/win-unpacked/PaperQuay.exe` 仍返回 `0x80000003`（STATUS_BREAKPOINT），复制到 `%TEMP%` 才能启动，故第 1 条继续成立。
9. **改 `$env:APPDATA` 不能隔离应用数据（2026-11-02 实测）**：Electron 的应用数据路径取自 Windows Known Folder API，覆盖环境变量后临时目录始终没有写出 `.settings` 与 RAG 库，改动落在真实 `paperquay-library.sqlite`。实机验收前先备份该库，验收后按备份还原（本轮以 `Get-FileHash` 确认一致）。

## 五、验证方法

**构建与测试**

```bash
TEMP="$PWD/.tmp-build" TMP="$PWD/.tmp-build" npm run build
TEMP="$PWD/.tmp-build" TMP="$PWD/.tmp-build" npm test
```

**UI 实机验收（Cua）**

```bash
# 1) 打包到未安装目录
node electron/build.cjs --dir --config.directories.output=release/local-ui-<主题>
# 2) 复制到工作区外并启动
cp -r release/local-ui-<主题>/win-unpacked "$TEMP/pq-<主题>"
powershell -NoProfile -Command "Start-Process -FilePath \"$env:TEMP\pq-<主题>\PaperQuay.exe\""
# 3) Cua 截图与点击（cua-driver 路径见 ~/.proma/computer-use.md 的 driver_path）
```

- 该应用 UIA 树为空，只能按**截图像素坐标**点击；**像素点击前必须先对该窗口做过一次 `get_window_state` 锚定**，否则点击不生效。
- 后台不支持按键与修饰键：先发 background，收到 `background_unavailable` 后用 `delivery_mode:"foreground"` 重发（会短暂切换前台并自动恢复，**需用户授权**）。
- 验证「面板已关闭」这类状态时，用 PIL 采样关键坐标像素值对比比肉眼看图更可靠（例如面板底色 `(250,250,249)` vs 工作区 `(144,148,145)`）。
- 构建产物在受管浏览器里打开会因缺 Electron 桥接而不渲染，**不能**作为桌面 UI 验证路径。

## 六、T8 完成情况（2026-11-03）

- 五刀已分别提交并 FF 合并到 `main`：布局 `f3a91f8`、QA `771fbd4`、笔记 `7de91a7`、bridge `9c6b01f`、配置/回调打包（见最终提交）。
- `DocumentReaderTabProps`：62 → 58 → 38 → 28 → 28 → 11。
- QA 会话仍是所有阅读标签页全局共享；bridge 保留全挂载标签页登记并参与翻译保活；localStorage 键名、默认值和 clamp 边界保持原样。
- store 测试覆盖默认值、setter、函数式更新、边界、持久化、等值 no-op 与清理；最终 `npm run build` 和 `npm test` 均通过，测试 901/901。
- 桌面实机回归与截图证据在最终构建后补记；未跟踪个人资产未纳入提交。

## 六、完成后的收尾

- 本文件状态改为「已完成」，或在末尾追加逐项完成情况。
- 若 T3/T4/T5 改变了组件边界，同步更新 `docs/ui-design-system.md` 的组件表。
- 若 T8 落地，在 `docs/plans/2026-11-02-ui-logic-and-visual-refinement.md` 的阶段 3 条目里把「14 延后」改为已实施。
