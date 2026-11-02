# 2026-11-02 - 按钮级语义令牌与剩余状态色清理（T3）

交接计划 `docs/plans/2026-11-02-ui-followup-handoff.md` 的 T3。前置基线：`main` = `02e341d`，构建通过、`npm test` 869 项全绿、状态硬编码 350 处。

## 现象

1. `src` 里仍有 350 处 Tailwind 状态色调色板类（`bg-emerald-600`、`text-rose-200`、`border-indigo-100` 等），集中在「实心状态按钮」「深底浅字」与「带透明度的叠加层」三类场景。
2. 实心状态按钮没有可用的令牌：直接映射到 `var(--pq-{semantic}-bg)`（10% 透明度）按钮会消失；映射到 `var(--pq-{semantic})` 又只适合文字/图标。
3. 深色主题下，亮 accent 当实心按钮底再叠浅字，对比度只有 1.48–1.86:1（如 `#99f6e4` on `#2dd4bf`）。

## 根因

上一轮 codemod 有意收紧映射范围，只处理了「浅色软底 + 深字」；令牌表里也只有 accent 一组按钮级令牌，success/danger/warning 缺少「浅色亮底白字 / 深色深底浅字」的成对取值。深色主题里 `--pq-{semantic}` 是亮色，不能直接当实心底或文字色使用。

## 修改

### 新增 9 个按钮级令牌（`src/app/index.css` 的 `:root` 与 `.dark`）

| 令牌 | 浅色 | 深色 | 文字对底 |
| --- | --- | --- | --- |
| `--pq-success-button-bg` | `#15803d` | `#14532d` | 浅 5.02:1（白字）/ 深 8.30:1（`#dcfce7`） |
| `--pq-success-button-bg-hover` | `#166534` | `#166534` | 浅 7.13:1 / 深 6.49:1 |
| `--pq-success-button-text` | `#ffffff` | `#dcfce7` | — |
| `--pq-danger-button-bg` | `#dc2626` | `#7f1d1d` | 浅 4.83:1（白字）/ 深 8.20:1（`#fee2e2`） |
| `--pq-danger-button-bg-hover` | `#b91c1c` | `#991b1b` | 浅 6.47:1 / 深 6.80:1 |
| `--pq-danger-button-text` | `#ffffff` | `#fee2e2` | — |
| `--pq-warning-button-bg` | `#b45309` | `#78350f` | 浅 5.02:1（白字）/ 深 8.15:1（`#fef3c7`） |
| `--pq-warning-button-bg-hover` | `#92400e` | `#92400e` | 浅 7.09:1 / 深 6.37:1 |
| `--pq-warning-button-text` | `#ffffff` | `#fef3c7` | — |

浅色 success 未用计划建议的 `#16a34a`：白字配它只有 3.30:1，不满足验收的 4.5:1，改用同色系更深的 `#15803d`。深色一律「深底 + 浅字」，与浅色的「亮底 + 白字」相反。

### 替换（26 个文件，338 处；跳过 `assistantSidebarChat.tsx` 12 处）

| 文件 | 处数（前→后） |
| --- | --- |
| `src/features/agent/AgentWorkspaceMessages.tsx` | 62 → 0 |
| `src/features/blocks/blockViewerContent.tsx` | 45 → 5（有意保留，见下） |
| `src/features/literature/components/LiteraturePaperDetails.tsx` | 30 → 0 |
| `src/features/literature/components/LiteraturePaperList.tsx` | 29 → 0 |
| `src/features/reader/readerPreferencesBackupSection.tsx` | 22 → 0 |
| `src/features/agent/AgentExecutionCards.tsx` | 21 → 0 |
| `src/features/agent/AgentWorkspaceView.tsx` | 16 → 0 |
| `src/features/pdf/PdfPageOverlay.tsx` | 16 → 0 |
| `src/features/reader/readerPreferencesContent.tsx` | 15 → 0 |
| `src/features/pdf/PdfViewerToolbar.tsx` | 14 → 0 |
| `src/features/literature/LiteratureLibraryView.tsx` | 13 → 0 |
| `src/features/blocks/BlockReparseModal.tsx` | 10 → 0 |
| `src/features/pdf/PdfViewer.tsx` | 6 → 0 |
| `src/features/reader/readerPreferencesUpdateSection.tsx` | 6 → 0 |
| `src/features/reader/TranslatedPdfPane.tsx` | 5 → 0 |
| `src/features/pdf/PdfOutlinePanel.tsx` | 4 → 0 |
| `src/features/reader/ReaderWorkspace.tsx` | 4 → 0 |
| `src/features/reader/assistantSidebarPrimitives.tsx` | 4 → 0 |
| `src/features/reader/readerPreferencesPrimitives.tsx` | 3 → 0 |
| `src/components/ReasoningEffortPicker.tsx` | 3 → 0 |
| `src/features/literature/components/LiteratureCategorySidebar.tsx` | 2 → 0 |
| `src/features/pdf/PdfThumbnailSidebar.tsx` | 2 → 0 |
| `src/features/reader/readerWorkspaceHeader.tsx` | 2 → 0 |
| `src/features/reader/AgentMemorySettingsSection.tsx` | 2 → 0 |
| `src/features/reader/readerWorkspaceOverview.tsx` | 1 → 0 |
| `src/features/notes/NoteDistillPreviewPanel.tsx` | 1 → 0 |

映射规则：

- `dark:` 状态色覆盖全部删除——浅色侧已是 `var(--pq-*)`，深色主题由令牌自身取值提供，不再需要成对调色板。
- 浅色软底 `*-50/100` → `var(--pq-{semantic}-bg)`；边框 `*-100~400` → `color-mix(… 28%/34%/40% …)`；浅色文字 `*-500~900` → `var(--pq-{semantic})`。
- 带透明度的叠加层保留原透明度：`bg-amber-200/18` → `bg-[color-mix(in_srgb,var(--pq-warning)_18%,transparent)]`，`bg-indigo-300/14`、`bg-teal-400/[0.04]` 同理。
- 实心按钮 → `-button-bg` / `-button-text` / `-button-bg-hover`：`AgentWorkspaceMessages.tsx:40`（success）、`AgentExecutionCards.tsx:103`（accent 勾选圆点）、`blockViewerContent.tsx:861`、`BlockReparseModal.tsx:176`（accent）、`readerPreferencesContent.tsx:1384`（danger）、`PdfPageOverlay.tsx:109/141`（warning 批注序号）。
- 进度条、状态圆点、分割线等无文字的场景映射到 `var(--pq-{semantic})` 实色，不占用按钮令牌。
- indigo 没有对应语义令牌，其用途（AI 重析按钮、结构化面板、阅读高亮框、进度条）统一归入 accent；代码里这些位置本来就混用 accent 文字色，属既有漂移。

### 有意保留

- `src/features/blocks/blockViewerContent.tsx:171`：深色下「重试」实心危险小按钮（`dark:border-rose-800 dark:bg-rose-900/60 dark:text-rose-100`）。这是需求里明确保护的「实心状态底」，映射到 10% 透明的 `-bg` 会失去按钮形态，保留 5 处调色板类并在计划文档中记录。
- `src/features/reader/assistantSidebarChat.tsx`（12 处）与 `DocumentReaderTab.tsx`（0 处）：上游近期改动文件，按计划跳过，避免下次同步冲突。

### 顺带修正（范围外但影响验收界面可读性）

1. `readerWorkspaceHeader.tsx:144`：阅读视图模式高亮只写了 `bg-white`，深色下白底白字看不见；补 `dark:bg-[var(--pq-surface-2)]`（与同文件第 84 行一致）。
2. `BlockViewer.tsx:897/900`：两个计数徽标 `bg-white` → `var(--pq-surface-1)`，深色下由白底改为面板色。
3. `readerPreferencesPrimitives.tsx:29`（`ToggleRow`）：`bg-white/90` + `border-slate-200/80` + `hover:bg-white` → 令牌，深色设置页的白底卡片消失。
4. 四处深色实心 accent 按钮（亮底浅字 1.48–1.86:1）改走 `-button-*` 令牌：`BlockViewer.tsx:917`、`PdfViewerToolbar.tsx:310`、`readerPreferencesContent.tsx:644`、`readerPreferencesBackupSection.tsx:441`。

以上 1–3 属计划基线里「剩余 115 处中性色」的一部分，只修了这 4 个文件里直接影响本轮截图可读性的位置，其余中性色未动。

## 验证

- `npm run build` 通过；`npm test` **869 项全绿**。
- 目标 grep：`grep -rEo '(bg|text|border)-(emerald|rose|amber|sky|indigo|teal|red|cyan|blue|green)-[0-9]{2,3}' src --include=*.tsx | wc -l` 从 **350 → 17**（目标 < 50），剩余为上面「有意保留」的 5 + 跳过文件的 12。
- 构建产物核对：`dist/assets/index-*.css` 内 `pq-success-button-bg` 12 次、`pq-danger-button-bg` 8 次、`pq-warning-button-bg` 8 次，`color-mix(… 18%/14%/10% …)` 各叠加层类均已生成，说明 Tailwind 没有丢弃这些任意值。
- 对比度（WCAG 2.1 公式，见上表）：9 个新令牌的文字对底全部 ≥ 4.5:1，最低为浅色 danger 4.83:1。
- 实机截图（打包 `win-unpacked`、复制到 `%TEMP%` 后启动；浅色/深色各 4 屏，共 8 张，路径见报告）：文库、设置、Agent、阅读器工具栏的实心按钮文字可读；文库卡片三个徽标仍是绿（MinerU）/ 青（RAG）/ 蓝（概览）三种可区分色相。
- 数据安全：运行前备份 `paperquay-library.sqlite`、`paperquay-notes.sqlite`、`.settings/paperquay.config.json` 并记录 SHA256；验收后关闭应用整体还原，三个库与设置文件哈希与运行前**完全一致**（RAG 库 8 GB 仅记录哈希、未复制，前后一致；其 0 字节 `-wal` 与 `-shm` 由应用正常关闭时清理，下次打开自动重建）。
