# 2026-09-09 - 修复跨页合并表格后续分片渲染空错误卡片

## 现象

打开含跨页表格（如学位论文的多页注释表/符号表）的 MinerU 解析结果时，合并后的表格内容能完整显示，但表格截图只显示第一页分片的图片，后续每个分片都渲染为一张错误卡片：「没有找到对应的表格截图」，并附带红色报错 `Error: Path is not a file: ...\.mineru-cache\document-xxx\images`。

## 根因

MinerU 云端识别时会自动把跨页表格合并进第一个分片：所有表格行并入首个分片的 `table_body`，后续分片只留下空壳块——v1 结果中 `img_path: ""` 且无 `table_body` 字段，v2 结果中写成 `image_source.path: "images/"`（只有目录、没有文件名；对应截图文件上游从未生成）。

前端 `extractMineruAssetPathFromBlock`（`src/services/mineru.ts`）只校验"非空字符串"，`"images/"` 顺利通过后由 `resolveMineruAssetPath` 拼接为图片**目录**的绝对路径，经 IPC 调后端 `ensureFile`（`electron/backend/utils.cjs`）时发现目标是目录而非文件，抛出 `Path is not a file`。由于空壳块同时没有 html、caption 和文本，整个块最终只渲染出这张错误卡片。

实证（170 页学位论文缓存 `document-d0ca83ab`）：59 个表格块 = 56 个正常块（有 html 有截图）+ 3 个空壳块（第 18/19/20 页，无 html、路径为 `images/`）；100 个图片块全部正常。

## 修改

均位于 `src/services/mineru.ts`：

1. `extractMineruAssetPathFromBlock`：拒绝没有文件名的资源路径——trim 后以 `/` 或 `\` 结尾、或路径段为空/`.`/`..` 的一律返回 `undefined`，不再把目录路径传给后端。该函数同时被 `libraryAgent.ts` 综述配图逻辑复用，一并受益。
2. `flattenMineruPages`：沿用已有"空段落续接"模式，将"无 html、无有效截图路径、无文本"的空壳表格块标记为续块（`contentSourceBlockId` 指向前一个有内容的表格块）。BlockViewer 的 `visibleBlocks` 本就会过滤续块，空壳卡片整体隐藏；PDF 侧点击后续页表格区域时经 `resolveMineruBlockContentSource` 解析到合并表格块上。空壳块之前不存在可续接表格时保持原样，不隐藏。

## 验证

- `tests/mineruContinuations.test.ts` 新增 3 个用例：跨页表格空壳块续接到首个合并分片、仅目录路径被拒绝、有 html 无截图的表格不误判；全库 285 项测试通过（0 fail）。
- 用真实缓存数据 `document-d0ca83ab` 端到端验证：3 个空壳块（page-18/19/20-block-1）均正确标记续接到 page-17-block-2（含 107 行完整表格的块），56 个正常表格截图路径不受影响。
- `npm run check`（TypeScript 构建 + 全部测试）通过。
