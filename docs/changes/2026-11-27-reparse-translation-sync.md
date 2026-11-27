# 2026-11-27 - AI 重析后译文同步失效与重译

## 现象

对某个结构块执行「AI 重析」并保存修复后，双语视图仍显示旧 OCR 文本生成的译文；右键「重新翻译此块」也不会改变结果，因为该操作仍把原始 MinerU 文本送去翻译。全文翻译同样跳过该块：只要 `blockId` 有译文，就被视为已翻译。

## 根因

- **两套数据源**：重析结果只写入 `localStorage` 的 `paperquay:block-reparse:v1:*` 覆盖表（`src/services/blockReparseOverrides.ts`），不进入 `PositionedMineruBlock`，也不进入 MinerU 缓存。翻译输入 `buildTranslatableBlockInput` 只读原始 block，看不到覆盖。
- **缓存键没有源文本信息**：内存与磁盘译文都是 `Record<blockId, string>`，缓存文件只按目标语言、模型地址、模型名和源语言命名。`getPendingTranslationBlocks` 只判断 `blockId` 有无非空译文，`mergeReaderTranslations` 按 `blockId` 覆盖合并，因此源文本变了也无法区分新旧译文。
- **旧译文会从两个方向复活**：磁盘缓存（`tryLoadSavedTranslations`）和文库页快照（`translationSnapshot`）都会在打开文献或续译时合并回内存。
- **重析保存没有失效信号**：`persistReparse` 只写覆盖表并更新组件状态，不通知翻译层。

既有设计在 `docs/changes/2026-09-17-reader-reparse-ocr-state.md` 中明确写着「覆盖只影响本地阅读视图，不改写原 OCR 缓存、RAG 索引或已有译文」，双语块也标注「译文（基于原始识别）」。但同一块同时显示修复后的英文和旧 OCR 的中文，且手动重译无法纠正，是实际可用性缺陷。

## 修改

### 1. 重析覆盖提升为阅读器级唯一状态

- 新增 `src/features/blocks/useBlockReparseOverrides.ts`，在 `useReaderDocument` 中按 `documentSource + mineruPath + blocks` 加载覆盖表，向 `BlockViewer` 与翻译流程提供同一份 `BlockReparseOverrideApi`（`overrides` / `storageReady` / `storageError` / `getOverrideMarkdown` / `saveOverride`）。
- `BlockViewer` 改为受控：删除组件内部的 `localStorage` 读写，改用传入的覆盖表；保存或恢复后触发 `onBlockReparseApplied`。
- `getOverrideMarkdown` 读取同步 ref，保证「刚点保存、尚未重渲染」时也能按新文本重译。

### 2. 翻译以「有效源文本」为准

- 新增 `src/features/reader/translationSource.ts`：
  - `resolveBlockTranslationText`：有 AI 覆盖时用覆盖文本，否则用 `extractTranslatableMarkdownFromMineruBlock`。
  - `buildBlockTranslationInput`：同时产出 `text` 与 `sourceHash`，保证送去翻译的文本与之后判定有效性用的指纹一致。
  - `hashTranslationSourceText`：3 × 32 位混合 + 长度的同步指纹，仅用于本地缓存失效，不承担安全用途。
  - `reconcileTranslations`：逐块校验译文是否仍对应当前源文本。
- 全文翻译、单块重译、续译统一使用这套入口（`useDocumentTranslation`）。

### 3. 缓存带块级源文本指纹（v2，向后兼容）

- `TranslationCacheEnvelope` 新增可选 `sourceHashes`，写入版本号改为 2；读取 v1 文件时 `sourceHashes` 为空表。
- `writeTranslationCache` 接受 `sourceHashes`：按块覆盖，重写但没有指纹的块会丢掉旧指纹；写入前后都剪掉没有译文的块。
- 读取时按候选缓存合并指纹，`TranslationCacheReadResult` 返回 `sourceHashes`。
- 文库页翻译与文库页快照（`useReaderLibraryActions`、`useReaderLibraryPreview`、`readerLibraryPreview`、`ReaderDocumentTranslationSnapshot`）同步携带指纹。

### 4. 失效规则

`reconcileTranslations` 的判定：

- 有指纹：必须与当前源文本指纹一致；
- 无指纹（旧版缓存）：视为基于原始 OCR。该块没有 AI 覆盖时有效并补写当前指纹；有覆盖时一律过期；
- 文档中已不存在的 `blockId`：阅读器传入 `knownBlockIds` 时丢弃。

覆盖变化或文档源文本变化后，`useDocumentTranslation` 的剪枝 effect 立即移除过期译文并提示「N 段译文对应的原文已更新」。翻译进行中跳过剪枝，结束后再校验，避免进度写入与失效互相拉扯。

### 5. 自动重译

保存或恢复重析结果后，若已配置翻译模型，`handleBlockReparseApplied` 立即按新的有效源文本重译该块；未配置时不弹设置页，只保留「待重新翻译」状态。打开已有修复的文献时，旧版缓存里这些块的译文会判为过期，恢复提示中给出待重译数量。

## 验证

- `npm run typecheck` 六套 tsconfig 全部通过。
- `npm run build` 生产构建通过（仅既有动态导入告警）。
- `npm test`：1587 项，1577 通过，0 失败，10 跳过。
- 新增 `tests/translationSource.test.ts`（11 项）：指纹稳定性、覆盖文本进入翻译输入、子块跳过、旧缓存规则、覆盖前后与恢复原始的失效、消失块丢弃、`reparse → retranslate → reopen` 端到端。
- `tests/readerTranslationCache.test.ts` 新增 v2 指纹往返、重写丢旧指纹、v1 兼容用例。
- 新增 `tests/blockReparseOverrides.test.ts`：在 jsdom + React 中渲染覆盖层 hook，验证按解析版本持久化、重新挂载恢复，以及保存后同步读取立即拿到新文本。
- 新增 `tests/reparseTranslationSync.test.ts`：用真实的 `useDocumentTranslation` 与内存缓存、模拟翻译接口跑完整场景——旧版缓存译文 → 应用重析覆盖 → 译文立即失效 → 按修复文本重译 → v2 缓存写入新译文与修复文本指纹。

## 未验证与边界

- 未使用真实 AI 模型和真实论文执行 Electron 实机流程（未消耗 API 额度）：自动重译的端到端表现仅由纯函数与缓存层测试覆盖，UI 交互仍需一次桌面验收。
- 指纹不覆盖 `sourceLanguage` / 模型身份，这两项仍由缓存文件名隔离。
- 重跑 MinerU 导致 `blockId` 漂移时，阅读器按 `knownBlockIds` 丢弃不存在块；若新解析仍产生相同 `blockId` 但内容变化，指纹失配会触发重译，不会套用旧译文。
- 覆盖仍只影响本地阅读视图，不写入 MinerU 缓存、RAG 索引、摘要与导出。
