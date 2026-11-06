# 加密备份包恢复：MinerU 结果与 PDF 路径失效修复计划

- 日期：2026-11-07
- 状态：**已实施**（2026-11-07，随 0.4.20 发布）。F1–F5 全部落地，R5 采用“解析 junction 后允许”；F4 的 `hasDerived=false` 导入提示沿用预览中已有的“含解析缓存”标签，未另加文案；MinerU manifest `pdfPath` 改写（附带问题）未做。实施与验证见 `docs/changes/2026-11-07-backup-restore-mineru-pdf-paths.md`。下文保留审阅时的原因分析与方案。
- 基线：`main` 的 `e7c206a`（0.4.19，`feat(backup): replace WebDAV with encrypted archives`）。
- 用户反馈：用 `.pqbackup` 恢复后，(1) MinerU 解析结果读不出，像是路径错了；(2) 部分 PDF 打不开，提示找不到文件。
- 证据：在 `%TEMP%\pq-restore-repro-20261107\` 用仓库真实模块（`createLibraryStore`、`runBackupExport`、`stageBackupImport`、`applyPendingBackupRestore`）构造源 profile，导出后导入到另一个 userData 与库目录。两个症状都复现。另有一份独立复现脚本 `..\.scratch-mineru-repro\repro.cjs`。仓库文件与用户真实数据均未改动。
- 未验证：没有拿到用户实际的 `restore-summary.json` 与恢复警告；本机未找到 PaperQuay 的生产数据目录，故 173 篇中具体哪些附件受影响未逐条核对。

## 一、结论

| 编号 | 症状 | 根因 | 触发范围 | 级别 |
| --- | --- | --- | --- | --- |
| R1 | MinerU | 安装缓存时多了一级 `default\` 或 `custom-xxxxxxxx\` 目录 | 所有含 MinerU 的包（迁移预设默认含） | P0 |
| R2 | PDF | 阅读历史推导的路径映射覆盖了附件的精确映射，附件被绑到不存在的原文件名 | 在源机打开过的文献（原文和译文） | P0 |
| R3 | PDF | `stored_path` 按原文精确查表，写法不规范时查不到 | 含正斜杠、`..` 等非规范路径的附件 | P2 |
| R4 | PDF | 导出时被跳过的附件不在包内，导入端无提示 | 源机已缺失、正在同步或刚写入的文件 | P2 |
| R5 | 体验 | 目标路径经过 junction 即被拒绝，错误无中文文案 | 选 `Documents\BaiduSyncdisk\...` 作目标 | P2 |

R1、R2 同时解释了两个症状：MinerU 全部失效；PDF 只是“部分”打不开，因为只有读过的文献受 R2 影响。

两项 P0 只需修导入端。0.4.19 已导出的包不用重新导出，修好后重新导入即可；已经导入过的数据也可以就地修复（见第五节）。

## 二、R1：MinerU 缓存多一级目录

因果链：

1. 导出时每个缓存根有一个 key：`default` 或 `custom-<sha256(mineruCacheDir) 前 8 位>`（`electron/backend/backupSources.cjs:498-501`），条目写成 `derived/mineru/<key>/<相对路径>`（`backupSources.cjs:513`）。
2. 暂存时 `entryOutput` 对 mineru 条目执行的是把 `derived/mineru/` 换成 `derived/mineru/`，等于没改，`<key>` 层保留（`electron/backend/backupImport.cjs:235`）。
3. `installAssets` 把整个 `<暂存>\derived\mineru` 复制到 `targets.mineruCacheDir`（`backupImport.cjs:790`、`:800`）。文件最终落在 `<cache>\default\document-xxxxxxxx\content_list_v2.json`。
4. 阅读器只查根下一层：`buildMineruCachePaths` 返回 `<root>\document-<fnv1a(workspaceId)>`（`src/utils/mineruCache.ts:100-104`），另两个候选也在根下一层（`mineruCache.ts:106-142`）。`loadSavedMineruPages` 全部读不到，返回 null（`src/features/reader/documentReaderCache.ts:130-181`）。文献列表的“已解析”状态用同一套候选（`src/features/literature/literatureLibraryUtils.ts:478-487`），所以列表也显示未解析。
5. 导入代码前后不一致：`deriveEntryMaps` 计算新路径时去掉了 `<key>` 层（`backupImport.cjs:352-354`），恢复后的 `lastMineruPath` 指向 `<cache>\document-xxx\...`，而文件在 `<cache>\default\document-xxx\...`。

复现输出：目标缓存为 `custom-68ce6335\{document-0b8950a8, document-0c89523b}` 与 `default\document-0e895561`；三篇的 `<cache>\document-xxx\content_list_v2.json` 均不存在。

同机原路径恢复同样触发：旧 dataDir（含旧 `.mineru-cache`）会被整体移到 `.pre-import-*`（`backupImport.cjs:917`）。

已排除：
- 读文件 IPC 没有路径白名单（`electron/backend/fileCommands.cjs:411-430`）。
- 缓存修复守卫读的是恢复后的新 config（`mineruCacheCommands.cjs:257-283`）。
- `workspaceId = native-library:<paperId>` 的哈希与机器无关（`literatureLibraryUtils.ts:452`、`mineruCache.ts:68-77`）。
- 恢复后 config、`paper-reader-settings-v3` 与安装根三者的 `mineruCacheDir` 一致，都是新机默认 `.mineru-cache`（`backupImport.cjs:609`、`:684-690`）。

## 三、R2：阅读历史映射覆盖附件精确映射

因果链：

1. 导出时 PDF 改名为 `library/<paperId>-<attachmentId><ext>`（`backupSources.cjs:482-487`），条目 metadata 记录 `attachmentId`、`sourceAbsolutePath = path.resolve(storedPath)`（`:488-489`）。
2. 导入时 `installAssets` 把 PDF 装到 `<新库>\<paperId>-<attachmentId>.pdf`（`backupImport.cjs:788`、`:798`）。`deriveEntryMaps` 正确地把旧路径映射到这个新文件名（`:345-369`）。
3. `stageBackupImport` 随后调用 `buildRendererExactPathMap(packageState, rootMap, deriveEntryMaps(...))`（`:674`）。该函数先复制精确映射（`:280`），再遍历 `paper-reader-paper-history-v1`：
   - `addMappedPath` 处理 `document.localPdfPath`、`translatedPdfPath`、`lastPdfPath`、`lastMineruPath` 和问答附件（`:285-290`），无条件写 `pathMap[value] = mapByRoot(value)`（`:276`）。
   - `addMappedLocalSource` 处理 `paperSummarySourceKey`、`pdfScrollPositions`、`pdfReadingHeatmaps` 的 `local:<路径>` 键（`:291-297`），同样无条件写入（`:341`）。
   - `mapByRoot` 只换根、保留原文件名（`:498-518`）。精确映射被改成“新库 + 原文件名”。
4. 被污染的 `pathMap` 写入 pending（`:701`、`:724`）。`updateLibraryPaths` 优先查 `pathMap[stored_path]`（`:473`），文件不存在，于是写入 `missing=1`、`relative_path=NULL`（`:474-481`）。
5. 渲染层 `resolveAttachmentPdfPath` 在 `relativePath` 为空时回退到错误的 `storedPath`（`src/utils/libraryPaper.ts:33-43`）。preload 用同一 `pathMap` 再映射一次阅读历史（`electron/preload.cjs:17-22`），`lastPdfPath`、`document.localPdfPath` 也指向不存在的文件。阅读器候选全部失败，报“PDF 文件不存在”（`src/features/reader/DocumentReaderTab.tsx:1278-1284`、`:1479-1489`）。

两个路径为什么文本相同：应用内导入的 `stored_path` 是 `path.join(storageDir, '<paperId>-<fileName>')`（`electron/backend/libraryCommands.cjs:713`）；阅读器的 `localPdfPath` 也由 storageDir 拼出（`libraryPaper.ts:22-43`）。两者在 Windows 下文本一致，所以历史键正好命中附件的精确键。`<paperId>-<fileName>` 与包内名 `<paperId>-<attachmentId>.pdf` 几乎不可能相同，因此只要文献被打开或滚动过，就一定出错。

复现输出（带阅读历史）：

| 附件 | 恢复后 stored_path | missing | 实际文件 |
| --- | --- | --- | --- |
| a1 | `tgt-lib\paperq\p1.pdf` | 1 | `p1-a1.pdf` |
| a2 | `tgt-lib\paperq\Sub\p2.pdf` | 1 | `p2-a2.pdf` |
| a3 | `tgt-lib\paperq\p3.pdf` | 1 | `p3-a3.pdf` |
| a4（库外） | `tgt-lib\paperq\p4-a4.pdf` | 0 | 存在 |

去掉阅读历史后 a1、a3 恢复正常，a2 仍失败，原因是 R3。恢复警告里没有任何附件未绑定的提示。

现有测试没发现这个问题：`tests/backupPackage.test.ts:269` 唯一的往返用例 `packagePath = library/paper.pdf`，与原文件名相同，且目标目录等于源目录，`mapByRoot` 回退恰好命中。

## 四、次要问题

- **R3 非规范 `stored_path`**：`:473` 是区分大小写与分隔符的精确查找。键 `sourceAbsolutePath` 经过 `path.resolve`，会把 `/` 规范成 `\`，但不改大小写。所以含正斜杠、`..` 或重复分隔符的 `stored_path` 查不到，回退 `mapByRoot` 后同样 `missing=1`。仅大小写不同不会失配。应用内路径都经 `path.join`，命中概率低。
- **R4 导出跳过的附件**：`missing=true` 或路径为空直接跳过（`backupSources.cjs:476-479`）。`statRegularFile` 遇到链接、stat 失败、不稳定后缀或 10 秒内修改的文件也会跳过（`:134-155`）。百度同步盘中仅在线的占位文件可能落在这里。检查包时只显示前 8 条警告（`src/features/reader/BackupTransferSection.tsx:803`），MinerU 的大量警告可能把附件警告挤掉。导入端也没有“包内无此附件”的提示。
- **R5 junction 目标被拒**：`assertNoLinkPath` 从盘符逐级 `lstat`，Node 对 junction 返回 `isSymbolicLink() = true`，于是报 `UNSAFE_DESTINATION`（`backupImport.cjs:185-198`、`:631-634`）。`backupCommands.cjs:7-25` 没有这个错误码的文案，用户只看到通用失败。用户的库在 `Documents\BaiduSyncdisk`（junction）下，原路径恢复会被拒绝，只能改选其他目录。
- **附带问题**：
  - 恢复后 `file_name` 被改成包内名，两个分支写的是同一个值（`backupImport.cjs:481`）。这只影响显示。
  - MinerU `paper_reader_manifest.json` 的 `pdfPath` 未改写（`documentReaderCache.ts:185-222`）。它是最后一个兜底候选，跨机后失效，不直接导致打不开。
  - 源机同时有默认根与自定义根时两个根都会导出（`backupSources.cjs:498-505`），修好 R1 后可能出现同名 `document-*` 冲突。

## 五、修复方案

原则：只改导入端；包格式不变；0.4.19 的包与 0.4.19 写下、尚未应用的 `pending.json` 都要能正确恢复。`pending.json` 有校验和（`sealPending`），里面被污染的 `pathMap` 不能改写，所以 R2 的兜底必须放在 apply 阶段。

### F1（R1，P0）按缓存根展开安装

改 `installAssets`（`backupImport.cjs:787-802`）：
- 不再整棵复制 `derived\mineru`，改为枚举其下子目录。只接受 `default` 与 `^custom-[0-9a-f]{8}$`，其他名字记警告并跳过。
- 先装活跃根，再装另一个根。活跃根的 key 用导出端同一算法计算：`custom-` + `sha256(String(manifest.sourceRoots.mineruCacheDir)).slice(0, 8)`（`backupSources.cjs:500`）。包里没有这个 key 时，活跃根就是 `default`。为此 pending 需要保存 `sourceRoots`，或者在 stage 阶段算好活跃 key 写入 pending。
- 按一级目录合并：目标已有同名 `document-*`、`<title>-<hash>` 目录时整目录跳过，并记 `MINERU_CACHE_CONFLICT` 警告，避免同一目录混入两个根的文件。`.split-tmp` 等临时目录不安装。
- `entryOutput`（`:235`）不改，各根在暂存阶段分开存放，解包时不会互相覆盖。

### F2（R2、R3，P0）附件按 attachmentId 改绑

1. `deriveEntryMaps` 额外产出 `attachmentMap: { [attachmentId]: newPath }`，来源是 manifest 条目的 `attachmentId`。0.4.19 的包已含此字段，`backupContainer.cjs:338-341` 只删 `sourcePath`/`data`。把它存进 pending。
2. 精确映射优先：
   - `buildRendererExactPathMap` 末尾执行 `Object.assign(pathMap, entryMap)`，一处修改覆盖 `addMappedPath` 和 `addMappedLocalSource` 两个写入点。
   - 去重按 canonical 键判断：Windows 下统一分隔符并转小写。把 `src/shared/rendererStorageRemap.cjs:18-28` 的 `canonicalPath` 抽成主进程与 preload 共用的函数。原因是 `createPathMapper` 转 canonical Map 时后写覆盖先写（`rendererStorageRemap.cjs:35-39`），只做文本去重时，大小写变体仍会让历史推导值胜出。
3. `updateLibraryPaths`（`:470-484`）的 SELECT 增加 `paper_id`、`kind`，按以下顺序取第一个实际存在的文件：
   1. `attachmentMap[id]`；
   2. canonical 化后的 `pathMap` 查找；
   3. 改名候选：按 kind 取 `<libraryStorageDir 或 translatedPdfDir>\<safeSegment(paper_id)>-<safeSegment(id)><ext>`，`ext` 与导出端一致：`path.extname(stored_path).slice(0, 12) || '.pdf'`；
   4. `mapByRoot`。

   全部不存在才写 `missing=1`，同时推 `ATTACHMENT_UNRESOLVED` 警告（含 attachmentId）。第 3 步对 0.4.19 已污染的 pending 同样有效。`importMode=keep` 的库外附件依赖第 1、2 步精确命中，所以不能删除 `mapByRoot` 回退。
4. `file_name` 保留数据库原值，不再改成包内名（`:481`）。

### F3（R2 渲染端）恢复后的阅读历史与数据库一致

- preload 不再对 `restorePayload.state` 二次映射（stage 时已映射一次，`backupImport.cjs:677`、`:696-701`；preload 又映射一次，`electron/preload.cjs:17-21`）。映射不是幂等的：源根与目标根嵌套时，第二次映射会多嵌一层。
- apply 结束后，用最终的 `attachmentMap` 结果改写 `paper-reader-paper-history-v1` 中的 `document.localPdfPath`、`translatedPdfPath`、`lastPdfPath` 与 `local:` 键；无法确认的路径清空，让阅读器回落到数据库路径。这样首次打开不会先报一次错。

### F4（R4、R5，P2）提示与文案

- 恢复摘要（`backupImport.cjs:938-951`）增加 `attachmentsRestored`、`attachmentsUnresolved`、`attachmentsNotInPackage` 计数，UI 显示。
- 导入端对 manifest 中无条目的附件记 `NOT_IN_PACKAGE`。导出与检查包的警告按 kind 汇总，附件警告不被 MinerU 警告挤出前 8 条。
- `backupCommands.cjs` 补 `UNSAFE_DESTINATION` 中文文案，提示改选真实路径，例如 `C:\BaiduSyncdisk\paperq`。
- 可选：父级 junction 先 `fs.realpathSync.native` 解析，再用真实路径做 `:617-634` 的全部校验与写入，目标目录自身仍不得是链接。
- 导入预检 `hasDerived=false` 时提示“此备份不含 MinerU 解析结果”（`backupImport.cjs:161`）。

### F5 已恢复数据的就地修复

新增一次性修复命令，例如 `backup_repair_restored_paths`。只在 `.settings\restore-summary.json` 存在、且来源版本为 0.4.19 时允许执行，执行前备份 `paperquay-library.sqlite`，执行时应用不得持有该库的写连接。

- MinerU：把 `<cache>\<活跃 custom-key>\*` 和 `<cache>\default\*` 的一级目录上移到 `<cache>\`。根下已有同名目录则整目录跳过，不做文件级合并，因为用户恢复后可能已重新解析。只删除空的 `default`、`custom-*` 目录。
- PDF：对 `missing=1` 的附件按 F2 第 3 步的改名候选查找。存在则更新 `stored_path`、`relative_path`（文件在 storageDir 内时才写，口径同 `:480`）、`file_size`、`missing=0`。`file_name` 从 `.pre-import-*` 旧库或包 manifest 的 `entry.fileName` 回填。
- 同步按 F3 改写 localStorage 阅读历史。

在修复命令发布前，可以手工处理：
1. 关闭 PaperQuay。
2. MinerU：在 `%APPDATA%\PaperQuay\PaperQuay\.mineru-cache` 下，把 `custom-xxxxxxxx\` 与 `default\` 里的 `document-*` 目录剪切到上一级，已存在同名目录的跳过。
3. PDF：少量文献用“重新定位附件”（`libraryCommands.cjs:850-866`）逐个指向 `<库目录>\<paperId>-<attachmentId>.pdf`。
4. 也可以等 F1/F2 修好后，用原 `.pqbackup` 重新导入。

## 六、测试

在 `tests/backupPackage.test.ts` 新增真实容器往返用例。源与目标库目录不同，userData 也不同。

| 用例 | 构造 | 断言 |
| --- | --- | --- |
| T1 MinerU 默认根 | 条目 `derived/mineru/default/document-<hash>/content_list_v2.json` 及 `images/` | `<cache>\document-<hash>\content_list_v2.json` 存在；`<cache>\default` 不存在；路径等于 TS 端 `buildMineruCachePaths(cache, {workspaceId:'native-library:p1'})` |
| T2 MinerU 双根冲突 | `default` 与活跃 `custom-<hash>` 下同名目录，内容分别为 old、new | 结果为 new；有 `MINERU_CACHE_CONFLICT`；无 `custom-*` 残留 |
| T3 读过的文献 | 包名 `library/p1-a1.pdf`；历史 `localPdfPath`、`lastPdfPath`、`pdfScrollPositions['local:'+旧路径]`、`translatedPdfPath` 均引用旧 `stored_path` | `stored_path` 为 `<lib>\p1-a1.pdf`，`missing=0`，`relative_path` 非空，`file_name` 不变；恢复后历史路径指向存在的文件 |
| T4 非规范路径 | `stored_path` 含正斜杠；另一条仅大小写不同 | 两条都 `missing=0` |
| T5 0.4.19 旧 pending | 用当前代码 stage 出含污染 `pathMap` 的 pending，再用修复后的 apply 执行 | 附件经改名候选命中，`missing=0` |
| T6 包内缺附件 | 一个附件 `missing=true` 导出 | 导入后有 `NOT_IN_PACKAGE`，摘要计数正确 |
| T7 就地修复 | 构造 0.4.19 已恢复的目录与数据库 | 修复后 MinerU 与 PDF 均可解析；重复执行无变化 |

每个用例的验证都至少要跑这几项：`npm run check`、`npm test` 全量、`git diff --check`。本机默认 `%TEMP%` 有 esbuild 权限问题，构建与测试需把子进程 `TMP/TEMP` 指向仓库内临时目录。

桌面复验在隔离 userData 进行，不用生产数据：用迁移预设导出一个含 MinerU、含阅读历史的小库，导入到另一个 userData 与库目录，打开读过与未读过的文献各两篇，确认 PDF 与结构块都能加载。

## 七、实施顺序与工作量

| 阶段 | 内容 | 估计 |
| --- | --- | --- |
| 1 | F1 + T1、T2 | 0.5 天 |
| 2 | F2 + F3 + T3、T4、T5 | 1 天 |
| 3 | F5 修复命令 + T7 | 0.5 天 |
| 4 | F4 提示与文案 + T6 | 0.5 天 |
| 5 | 全量测试、隔离桌面复验、变更记录 | 0.5 天 |

阶段 1、2 修好后即可让用户用原包重新导入。阶段 3 面向不想重新导入的已恢复数据。

## 八、待确认

1. 用户本次恢复是跨机器、同机换目录，还是同机原路径。提供 `.settings\restore-summary.json` 或恢复警告可核对受影响附件数。
2. 是否需要 F5 修复命令，还是直接用修好的版本重新导入。
3. R5 选“解析 junction 后允许”还是“保持拒绝并给出明确文案”。
