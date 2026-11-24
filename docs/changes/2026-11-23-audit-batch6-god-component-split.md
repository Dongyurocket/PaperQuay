# 2026-11-23 - 第 6 批：S2 巨组件与巨模块拆分

## 现象

审计计划 S2 的 7 个条目仍为 open：`ragStore.cjs`（2,097 行）与 `libraryCommands.cjs`（1,331 行）未分层；`DocumentReaderTab.tsx`（4,777 行）、`PdfViewer.tsx`（3,385 行）、`LiteratureLibraryView.tsx`（3,837 行）、`NoteEditor.tsx`（2,016 行）仍是单组件；QA 状态跨 tab 共享；`useReaderBridgeStore.ts` 已零引用但仍保留；UI 没有统一的 28/32px 按钮原语，桌面 `minWidth: 1040` 使 980px 响应式回退不可达。

## 根因

S2 此前只做了专项审计，没有按域拆分；组件内 state、ref、effect 与 useCallback 交织，缺少结构测试固定拆分边界，导致后续修改变动面持续扩大。

## 修改

### D2-14 后端分层

- 新增 `electron/backend/rag/{schema,indexing,retrieval,runs}.cjs`；`ragStore.cjs` 2,097 → 155 行，只留 facade，仍导出 `createRagStore` / `buildFtsMatchQuery` / `rrfFuse`，返回的 27 个方法名与签名不变。
- 新增 `electron/backend/libraryMetadata.cjs`（511）、`libraryAttachments.cjs`（155）、`libraryCategories.cjs`（149）；`libraryCommands.cjs` 1,331 → 564 行，`createLibraryCommands` 返回的 31 个命令键、错误码与 handler 签名不变。
- 新增 `tests/backendModuleStructure.test.mjs`；既有 `tests/ragStore.test.ts`、`tests/libraryCommands.test.mjs` 断言未改写。

### D5-12 / D4-10 阅读器拆分

- 新增 `src/features/reader/hooks/`：`readerTabContext.ts`（570，内部 `useReaderTabState` + `ReaderTabState`）、`useReaderDocument.ts`（1,817）、`useReaderSummary.ts`（762）、`useReaderNotes.ts`（1,070）、`useReaderAnnotations.ts`（622）、`useReaderQa.ts`（1,294）。
- `DocumentReaderTab.tsx` 4,777 → 628 行，只保留 props、state hook、五个领域 hook、29 个 effect 编排与 JSX；`DocumentReaderTabProps`、DOM、JSX 表达式逐字保留。
- 显式 `useEffect` 顺序保持原序（28 个移到 hook 的 effect 通过 `hook.effect_<id>` 回调在壳内原位注册，另有 1 个 locale ref 同步 effect 原样保留）。
- 新增 `tests/documentReaderHooks.test.ts`，断言六个 hook 文件、组件行数、导入关系、effect 顺序与 DAG（document → summary/notes → annotations → qa）。

### D5-13 PDF 拆分

- 新增 `src/features/pdf/hooks/{usePdfDocumentLifecycle,usePdfScrollRestore,usePdfSelection,usePdfAnnotations,usePdfThumbnails,usePdfOutline,usePdfBlockOverlay}.ts(x)`；`PdfViewer.tsx` 3,385 → 628 行，43 个 effect 全部保留（39 个移入 hook，4 个跨领域 effect 留在壳内）。
- 默认导出仍为 `memo(PdfViewer)`，props、DOM、滚动/选择/快捷键入口不变；新增 `tests/pdfViewerHooks.test.ts`。

### D4-10 文献库与笔记编辑器

- 新增 `src/features/literature/hooks/` 七个 hook（catalog 779、selection 258、import 721、metadata 758、pdf audit 59、batch 450、category 325）与 `dialogs/{MetadataParseDialog,PdfAssetAuditDialog}.tsx`；`LiteratureLibraryView.tsx` 3,837 → 1,114 行。
- `NoteEditor.tsx` 2,016 → 834 行；新增 `src/features/notes/editor/{extensions.tsx,draft.ts,images.ts,toolbar.tsx,slashMenu.ts,tableCell.tsx}`（442/126/39/521/89/260）。
- 新增 `tests/literatureHooks.test.ts`、`tests/noteEditorModules.test.ts`。

### D4-11 QA 按 tab 分片

- `useReaderQaStore.ts` 改为 `tabs: Record<tabId, ReaderQaTabState>`；会话、输入、附件、选中会话、preset、运行状态、错误均按 tabId 分片。
- 每个分片记录 `workspaceId`：同一 tab 内换文档才重置；隐藏 tab 卸载后重挂不覆盖在途回答。`removeReaderQaTab` 只删除该 tab 并中止其 AbortController。
- `DocumentReaderTab` 的恢复 effect 去掉 `isActive` 依赖，切 tab 不重置草稿、不中止流式回答；关 tab 由 `Reader.tsx` 的 tab 列表差集调用 `removeReaderQaTab`。
- 持久化前用 `stripEmptyAssistantMessages` 过滤空 assistant；`Reader.tsx` 改为按字段订阅 QA 分片，避免输入时整棵 Reader 重渲染。
- 新增 `tests/readerQaPerTab.test.ts`；更新 `tests/readerQaStore.test.ts` 到分片 API。

### D4-8 死 store

- 删除 `src/stores/useReaderBridgeStore.ts` 与 `tests/readerBridgeStore.test.ts`；`Reader.tsx` 的 `readerBridges` + `handleBridgeStateChange` + `areReaderTabBridgeStatesEqual` 成为唯一实现。
- 新增 `tests/rendererDeadModules.test.mjs`：断言全仓无 `useReaderBridgeStore` 引用、`src/stores/*.ts` 无零引用模块。

### D7-14 UI 按钮原语与响应式

- 新增 `src/ui/button.tsx`（94 行）：`Button` / `IconButton`，`size: 'sm'|'md'`，`variant: 'primary'|'secondary'|'ghost'|'danger'`；高度只用 `--pq-control-sm: 28px` / `--pq-control-md: 32px`。
- 迁移 `src/ui/dialog.tsx`、`src/components/ReasoningEffortPicker.tsx`、`src/features/blocks/BlockViewer.tsx` 的 28/32px 按钮；`src/ui/*.tsx` 不再有裸 `h-7`/`h-8` 按钮。菜单行、标签页、菜单内装饰性 span 按职责保留并登记在测试 allowlist。
- `electron/main.cjs` 的 `minWidth` 1040 → 960，使 `src/app/index.css` 的 `@media (max-width: 980px)` 在桌面可达；`docs/ui-design-system.md` 登记控件令牌与 960px。
- 新增 `tests/uiPrimitives.test.ts`、`tests/windowMinWidth.test.mjs`。

## 拆分偏差（纯移动项的如实登记）

- **D5-12**：`useDocumentTranslation` 与 `useLibraryReadingTracking` 随 document 域进入 `useReaderDocument`，其内部 effect 现在在 document hook 调用时执行，早于壳内显式 effect；29 个显式 effect 的相对顺序未变。组件 DOM/props/回调语义不变。
- **D5-13**：七个 hook 按依赖链调用，同一 hook 同时拥有过早与过晚的 effect，跨 hook 的全局注册顺序无法与原 43 个 effect 一一对应；已修正 `sourceSignatureRef` 首帧读取并补 21 个生命周期/滚动/选择行为用例。
- **D5-13 依赖数组**：文档加载 effect 增加 `sourceSignature` 依赖（HEAD 为 `[documentInit, refreshPdfViewerLayout, retryRevision]`），observer effect 与文档重置 effect 改用 ref/稳定依赖；43 个 effect 的数量与内容已逐块核对，但依赖数组非逐字一致。若后续出现换名重载或滚动恢复异常，优先复核 `usePdfDocumentLifecycle.ts:511`、`:294` 与 `usePdfBlockOverlay.tsx:403`。
- **D4-10 文献库**：跨 hook 的 effect 注册顺序有非语义调整（选择清空、拖放、宽度持久化、导入补全），逐块内容未改；已补 36 个目标测试。
- **D4-11 / D7-14**：属于计划内行为变更，不按纯移动处理。
- 关 tab 后，流式请求的迟到 abort 回调仍可能对该 tabId 写一次空分片；分片不会被读取，也不影响其他 tab，后续可在 store 增加 tombstone（已删除 tabId 拒绝写入）彻底消除。
- 结构测试与 hook 文件保留原始模块头（imports/helpers）副本，换取逐字搬移与低风险；后续可再抽共享模块。

## 验证

- `npm run typecheck`：四个项目 0 诊断。
- `npm test`：1,121 项，1,120 通过、1 跳过、0 失败。
- `npm run build`：通过（仅保留既有 `desktop.ts` 动态/静态混合导入提示）。
- 目标测试：后端 118、PDF 74/62、文献库 36、笔记编辑器 45、阅读器 hooks/QA 57+16、UI/窗口 20、死模块 3，全部通过。
- 断点：`DocumentReaderTab` 628 行（目标 ≤1,500）、`PdfViewer` 628、`LiteratureLibraryView` 1,114（≤1,800）、`NoteEditor` 834（≤1,200）、`ragStore` 155、`libraryCommands` 564。

## 未提交

第 4–6 批改动未提交、未 push（第 1–3 批已在 `fix/audit-2026-11-22` 提交为 `c3eec8d`、`a6feee0`、`315971b`，另有文档提交 `22c900b`）；未改 schema/`user_version`，未写用户数据，未触碰 `scripts/` 未跟踪资产、`.verification-*`、`.codex-temp`、`tests/knowledgeMcpFigure.test.ts`。
