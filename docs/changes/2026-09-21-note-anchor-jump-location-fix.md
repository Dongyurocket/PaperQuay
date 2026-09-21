# 2026-09-21 - 笔记引用芯片跳转定位修复

## 现象

笔记正文里的原文摘录卡片（右下角 `P20` 之类的页码按钮）点击后只打开了对应文献，阅读器停在原处，不滚动到引用位置；右侧参考文献列表里的位置芯片同样只打开文献。

## 根因

- 锚点位置在持久化层被丢弃：`electron/backend/noteStore.cjs` 的 `normalizeAnchors` 是字段白名单，只保留 `id / paperId / label / sourceTitle / excerpt / source / pdfLocation / createdAt`，把 `blockId` 与 `pageIndex` 过滤掉了。
- 润色产生的引用锚点（`src/features/notes/notePolish.ts` 的 `buildNotePolishAnchor`）恰好**只带** `blockId` 与 `pageIndex`，没有 `pdfLocation`。于是保存再重载后，锚点的位置信息全部为空（用户库中 `note_mub7u4fz_31a327b8` 的 6 条锚点实测只有 id/label 有值）。
- 阅读器侧 `applyNoteAnchorJump` 在位置为空时只弹「该引用没有绑定 PDF 位置」，而文献已在 `openNoteAnchorJump` 里打开 → 表现为「能打开文献，但不能跳转」。
- 次要隐患：该文献若没有结构块（`flatBlocks` 为空），旧的 `if (detail.blockId && flatBlocks.length === 0) { setPendingBlockAnchorJump(detail); return false; }` 会让跳转永久挂起。

## 修改

- `noteStore.cjs`：`normalizeAnchors` 保留 `blockId`（非空字符串）与 `pageIndex`（非负安全整数），其余非法值仍按原规则丢弃。
- 新增 `src/features/notes/noteAnchorLocation.ts`：`resolveNoteAnchorLocation` 按可靠性降级补齐位置——锚点自带 `blockId`/`pageIndex`/`pdfLocation` → 锚点 id 里的 MinerU 分块（`note-polish:<paperId>:mineru:page-20-block-3:0`）→ 页码标签 `P20`。历史笔记无需迁移即可跳转。
- `documentReaderNotes.ts`：`buildNoteAnchorJumpDetail` 改用该解析器；新增纯函数 `resolveNoteAnchorJumpTarget(detail, blocks)`，把「精确块 → 引用所在页正文块 → 整页高亮」的降级决策集中到一处。
- `DocumentReaderTab.tsx`：`applyNoteAnchorJump` 改用上述决策；只有「确有结构块但尚未加载、且没有页码兜底」时才挂起等待，不再永久挂起。
- `NotesWorkspace.tsx` 与 `noteReferences.ts`：emit 跳转（笔记卡片、参考文献位置芯片）时统一走同一解析器。

## 验证

- `npx tsc --noEmit` 通过；`npm run build` 通过；`npm test` 387 项全绿。
- 新增 `tests/noteAnchorLocation.test.ts`、`tests/noteStore.test.ts`；补充 `tests/documentReaderNotes.test.ts`（降级定位与跳转目标决策）、`tests/noteReferences.test.ts`（参考文献位置芯片）。
- 用用户真实数据库（只读）验证：`note_mub7u4fz_31a327b8` 的 6 条锚点全部从「位置为空」解析出块与页，例如 `P20 → blockId=page-20-block-3, pageIndex=19`，目标文献《民用飞机总体设计》(`paper_muazt87m_b0cd8e32`) 存在。
