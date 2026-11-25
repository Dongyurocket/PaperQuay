# 2026-11-26 - 侧边栏问答接入多文献检索范围

## 现象

阅读器右侧问答面板提供“当前文献 / 选定文献 / 全库”三个检索范围，但选择“选定文献 / 全库”后，实际仍只检索当前文献；当前文献没有证据时直接报“所选范围没有证据”，不会去查选中的其他文献或已就绪的全库索引。

## 根因

- `resolveQaRequest()` 始终调用 `resolveLocalRag({ item: currentDocument, ... })`。
- `resolveScopedLocalRag()` 只有测试引用，没有生产调用点。
- `qaScopePaperIds` 只进入侧边栏 props，没有进入检索。
- `qaScopeMode` 不在 `resolveQaRequest` 的 `useCallback` 依赖数组里，切换范围后可能读到旧值。

## 修改

- `src/features/reader/hooks/useReaderQa.ts`
  - 按 `qaScopeMode` 分支：`current` 保持原单文献路径；`selected` 逐篇加载选中文献的结构块 / PDF 文本后调用 `resolveScopedLocalRag()`；`library` 构建全库文献身份后只读已就绪索引。
  - `selected` 支持懒建索引、逐篇预算、跨文献引用编号整体后移；`library` 不触发整库建索引。
  - 多文献范围失败时列出未就绪 / 被排除 / 无正文 / 缺 PDF 的文献，不再回退到当前文献全文。
  - 把 `qaScopeMode`、`qaScopePaperIds`、`libraryStorageDir`、`loadLibraryPreviewBlocks`、`notePaperCandidates` 加入依赖；`AbortSignal` 传入检索。
  - 非 current 范围不再因当前文献缺 PDF / MinerU 而提前报错；Markdown 缓存缺失时用结构块重建。
- `src/features/reader/readerQaScope.ts`（新增）
  - 选中文献加载与缓存（`workspaceId + updatedAt + PDF 路径`）。
  - 全库 `WorkspaceItem` 构造（没有 PDF 也保留身份与 `ragEnabled`）。
  - 范围失败文案与跳过文献摘要。
- `src/services/localRag.ts`
  - `selected` 有文献被跳过时 `partialSources = true`。
  - `library` 只接受当前文库内的已就绪索引；空文库返回 `no-sources`，全部排除返回 `excluded`。
- 测试
  - 新增 `tests/readerQaScope.test.ts`。
  - `tests/readerScopedRag.test.ts` 增加 library 全排除 / 空文库、selected 部分来源断言。
  - `tests/documentReaderHooks.test.ts` 增加 scope 接线与依赖数组断言。

## 验证

- `npm run typecheck` 通过。
- `node --test tests/readerQaScope.test.ts tests/readerScopedRag.test.ts tests/documentReaderHooks.test.ts`：16 项通过。
- `npm test`：1506 项，1497 通过，0 失败，9 跳过。
- `npm run build` 通过。
