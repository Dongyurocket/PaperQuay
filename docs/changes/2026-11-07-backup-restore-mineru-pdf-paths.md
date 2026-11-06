# 2026-11-07 - 备份恢复后 MinerU 结果读不出、部分 PDF 找不到

## 现象

用 0.4.19 的 `.pqbackup` 恢复后：

- MinerU 解析结果全部读不出，文献列表显示未解析。
- 部分 PDF 打不开，提示找不到文件。

## 根因

- **MinerU 多一级目录**：导出时缓存按 `derived/mineru/<default|custom-xxxxxxxx>/` 分根打包。导入时 `installAssets` 把整个 `derived/mineru` 复制进缓存目录，文件落到 `<cache>\default\document-xxx\`。阅读器只在 `<cache>\document-xxx\` 查找。只要包含 MinerU 数据就必然出现。
- **PDF 绑到不存在的文件名**：
  - 导出时 PDF 改名为 `<paperId>-<attachmentId>.pdf`，`deriveEntryMaps` 给出的映射本来是对的。
  - 随后 `buildRendererExactPathMap` 处理阅读历史（`lastPdfPath`、`document.localPdfPath`、滚动位置的 `local:` 键、摘要来源）时，按“新根 + 原文件名”覆盖了同一个键。
  - `updateLibraryPaths` 精确命中被覆盖的值，文件不存在，写入 `missing=1`。
  - 只有在源机打开过的文献受影响，所以是“部分”打不开。
- **次要问题**：
  - `stored_path` 含正斜杠时精确查表失败。
  - 导出时被跳过的附件，导入端没有提示。
  - 目标路径父级经过 junction（如 `Documents\BaiduSyncdisk`）时直接被拒绝，`UNSAFE_DESTINATION` 也没有中文文案。
  - preload 会对 stage 阶段已经映射过的阅读状态再映射一次。

分析与复现见 `docs/plans/2026-11-07-backup-restore-mineru-pdf-paths.md`。

## 修改

- `electron/backend/backupImport.cjs`
  - `installMineruCache`：按根展开安装，只接受 `default` 与 `custom-<8 位十六进制>`。先装源机生效的根（与导出端同一 sha256 算法），同名缓存目录整目录跳过并记 `MINERU_CACHE_CONFLICT`，不安装 `.split-tmp` 等点目录。
  - 附件改绑：`deriveAttachmentMap` 按 attachmentId 记录安装位置，并写入 pending。`updateLibraryPaths` 依次尝试包内条目、规范化路径映射（Windows 不区分大小写和分隔符）、导出端改名规则 `<paperId>-<attachmentId><ext>`、按根映射，取第一个实际存在的文件。改名规则兜底使 0.4.19 写下、未应用的 pending 也能正确改绑。
  - 恢复后保留 `file_name` 原值。
  - `buildRendererExactPathMap` 改为包内精确映射优先，按规范化键去重。
  - `finalizeRendererPayload` 按数据库最终改绑结果重写阅读历史，并清空给 preload 的 `pathMap/rootMap`，避免二次映射。
  - 恢复摘要新增 `attachmentCounts`（已恢复、未找回、包内缺失），新增 `NOT_IN_PACKAGE` 与 `ATTACHMENT_UNRESOLVED` 警告。
  - 目标路径父级的 junction 先解析为真实路径，再做全部安全校验；目标目录自身仍不得是链接。
  - `repairRestoredBackupPaths`：启动时一次性修复 0.4.19 已恢复的数据。
    - 只在存在导入摘要、且摘要无 `attachmentCounts` 和修复标记时执行。
    - MinerU：把 `default/`、`custom-*` 下的一级目录上移，根下已有同名目录则跳过。
    - PDF：`missing=1` 的附件按改名规则找回文件。
    - 完成后写 `pathRepair` 标记，不会重复执行。
- `electron/main.cjs`：在应用 pending 恢复之后、打开后端之前调用一次性修复；修复失败只记日志，不阻止启动。
- `electron/backend/backupCommands.cjs`：补 `UNSAFE_DESTINATION` 中文文案。
- `src/features/reader/BackupTransferSection.tsx`：附件类警告排在前面，常用警告显示中英文说明，超过 8 条时显示剩余数量。
- `src/shared/rendererStorageRemap.cjs`、`electron/backend/backupSources.cjs`：导出 `canonicalPath`、`safeSegment` 供导入端复用；包格式不变。

## 验证

- 新增 `tests/backupRestorePaths.test.ts` 8 项，覆盖：
  - MinerU 默认根的安装路径与 TS 端 `buildMineruCachePaths` 一致；
  - 双根冲突时活跃根优先、不做文件级混合；
  - 读过文献的原文与译文改绑，以及阅读历史与滚动键改写；
  - 正斜杠与大小写不同的 `stored_path`；
  - 0.4.19 已污染的 pending；
  - 包内缺附件的提示；
  - 一次性修复及其幂等性，以及修复不作用于未导入或修复后版本导入的数据。
- 备份相关测试 25/25 通过。
- `npm run check`：构建通过，全量 944/944 通过。
- `git diff --check`：通过。
- 用修复前的复现脚本（`%TEMP%\pq-restore-repro-20261107`，真实导出含 junction 库目录、默认与自定义两个 MinerU 根、5 种附件）重跑：
  - 全部附件 `missing=0` 且文件存在；
  - 三篇的 `<cache>\document-xxx\content_list_v2.json` 均存在；
  - 阅读历史中的 `lastPdfPath`、`localPdfPath` 均指向存在的文件；
  - junction 父级目标 stage 成功（修复前报 `UNSAFE_DESTINATION`）。
- 未覆盖：
  - 真实跨机器桌面导入，由用户在两台电脑上验收；
  - MinerU 缓存内 `paper_reader_manifest.json` 的 `pdfPath` 仍是源机路径，它只是最后一个兜底候选，本次未改写。
