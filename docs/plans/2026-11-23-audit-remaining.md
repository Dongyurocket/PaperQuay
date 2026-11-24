# PaperQuay 审计计划剩余工作清单（2026-11-23 核验）

- 日期：2026-11-23（2026-11-24 第 12R 批收口）
- 状态：**第 1–12R 批已实施；附录 fixed 92 / partial 1（D1-13 签名/发布流水线未验证）/ open 0**。第 12 批独立复核提出 7 项发布阻塞，第 12R 批已全部修复：§3 为 **8 fixed（A6、F4、E4/E1、E5、B1、S1、文档同步、S5）/ 1 partial（F2 注册式安装/备份导入，已知限制）**。0.4.38 候选的版本、CHANGELOG、release notes 与安装包验收已就绪，但 `app-v0.4.38` 的 Release verify 因 GitHub `RUNNER~1` 短路径与 CI 性能预算失败、未发布；修复后以 **0.4.39** 发布。详见[第 12R 批记录](../changes/2026-11-24-audit-batch12r-release-blockers.md)。
- 关联计划：[2026-11-22 代码、架构与 UI 专项审计](2026-11-22-code-architecture-ui-audit.md)
- 关联变更记录：[第 1 批](../changes/2026-11-23-audit-batch1-data-dev-blockers.md)、[第 2 批](../changes/2026-11-23-audit-batch2-security-reader-notes-ui.md)、[第 3 批](../changes/2026-11-23-audit-batch3-startup-design-a11y-build.md)、[4A-1 小批](../changes/2026-11-23-audit-batch4a1-main-boundaries.md)、[4A-2 小批](../changes/2026-11-23-audit-batch4a2-backend-durability.md)、[4A-3 小批](../changes/2026-11-23-audit-batch4a3-reader-notes-residuals.md)、[4B-1 小批](../changes/2026-11-23-audit-batch4b1-startup-shell.md)、[4B-2 小批](../changes/2026-11-23-audit-batch4b2-external-io-backup.md)、[4B-3 小批](../changes/2026-11-23-audit-batch4b3-mcp-consistency.md)、[第 5 批](../changes/2026-11-23-audit-batch5-settings-shared-domain.md)、[第 6 批](../changes/2026-11-23-audit-batch6-god-component-split.md)、[第 7 批](../changes/2026-11-23-audit-batch7-performance.md)、[第 8 批](../changes/2026-11-23-audit-batch8-reading-notes-correctness.md)、[第 9 批](../changes/2026-11-23-audit-batch9-ui-engineering.md)、[第 10 批](../changes/2026-11-23-audit-batch10-engineering-packaging.md)、[第 11 批](../changes/2026-11-24-audit-batch11-i18n-a11y-s5.md)、[第 12 批](../changes/2026-11-24-audit-batch12-acceptance-release.md)、[第 12R 批](../changes/2026-11-24-audit-batch12r-release-blockers.md)
- 代码基线：分支 `fix/audit-2026-11-22`，`package.json` 0.4.38。第 1–3 批已提交（`c3eec8d`、`a6feee0`、`315971b`，另有文档提交 `22c900b`），第 4–12R 批改动尚未提交；本清单所有 `文件:行号` 均指 2026-11-24 工作区状态。
- 核验方式：12 个并行审计 agent 逐条读取当前源码并交叉核对，附录 A 93 条全覆盖；第 11 批后 `npm test` 1,398 项（1,390 通过、8 跳过、0 失败）。第 12 批由 5 个实现 agent 并行落地、主控统一机械验证，随后 6 个只读 verifier 对抗复核（D1-13/F4 CONFIRMED，A6/B1/E5 各 1 个 major，已全部修复：切换文献重挂载、迁移源读校验、斜杠实时语言与英文 References、noteSystemPages 历史保留）；最终全量测试与构建结果见文末与[第 12 批记录](../changes/2026-11-24-audit-batch12-acceptance-release.md)。第 12R 批复核后重跑：`npm test` 1,492 项（1,483 通过、9 跳过、0 失败；首次全量有 1 次 retainPdf ENOTEMPTY 临时目录清理偶发，单测与第二次全量均通过），`npm run typecheck` 六项目 0 诊断，`npm run lint` 0 error/206 warning，`npm run build`、`npm run mcp:bundle`、axe 16 视图/主题 0 violations 通过；提交后用 `git -c core.autocrlf=false archive` 对 staged tree `f92fc7f` 做仓库外干净检出，`npm ci && typecheck && lint && build && test` 通过（1,489 项：1,480 通过、9 跳过、0 失败，排除未提交的 `tests/knowledgeMcpFigure.test.ts` 3 项）；首次默认 autocrlf 归档暴露 `libraryQueryPolicy.test.ts` 写死 LF 的源码正则，已改为 `\r?\n`。

> 状态口径：**fixed**＝当前代码已修复且有测试或源码证据；**partial**＝主路径已修但仍有明确缺口；**open**＝当前代码仍存在。fixed 条目的历史证据见各批变更记录，本清单不重复展开。

---

## 1. 结论

| 范围 | 结果 |
| --- | --- |
| 计划正文 32 个主题 | 第 1–12R 批全部完成（第 6 批 S2，第 9/10 批图谱 Worker 看门狗与重试，第 11 批 S5 最坏规模/768 维基准/fcose 动态加载与列表 a11y）；**S5 fixed** |
| 附录 A 93 条 P2/P3 | **fixed 92、partial 1（D1-13）、open 0**（第 12 批完成 D1-13 代码与 Windows 未签名产物验证；代码签名/发布流水线本机无法验证，按任务口径不标 fixed） |
| 「残留与边界」 | §3 共 9 行（8 项验收缺口 + S5 已 fixed）。第 12R 批后：A6/F4/E4-E1/E5/B1/S1/文档同步/S5 **fixed**，F2 **partial（已知限制）**；第 12 批复核的 7 项发布阻塞已全部关闭，0.4.38 待提交发布 |
| 仓库状态 | 第 1–3 批已提交，第 4–12R 批未提交；第 12R 批后 `npm test` 1,492 项（1,483 通过、9 跳过、0 失败），`npm run typecheck` 六个项目 0 诊断，`npm run build`、`npm run mcp:bundle`、`npm run lint`（0 error/206 warning）与 axe 16 视图/主题 0 violation 通过 |

正文 32 个主题全部完成；S5 已收口（图谱最坏规模、768 维基准、fcose 动态加载、列表虚拟化 a11y）。附录 A 93 条为 fixed 92 / partial 1（D1-13）/ open 0，并非全部 fixed。第 8 批的 13 条阅读/笔记正确性项与 S5 笔记残留重叠，已按工作项去重。

第 12 批的 6 个只读 verifier 复核：D1-13、F4 CONFIRMED；A6 发现切换文献时 in-flight start/cancel 串台，已用 `key={paper.id}` + attachment 校验修复；B1 发现 `prepare_mineru_cache_dir` 的 previousDirectory 未校验读权限，已补 `assertReadAllowed` 与迁移源用例；E5 发现斜杠 reference-list 未传英文标题、编辑器打开期间切语言仍用旧 locale、系统页切语言丢历史，已分别改为实时 `<html lang>`、按 locale 写 `References`、保留历史条目；另补 `markdownToTiptap`/`noteReferences` 的英文 References 识别。

第 8 批的 8 个独立 verifier 复核结果：D3-6/D3-12、D3-7、D5-5/D5-6、D5-9/D6-9、D6-7/S5 笔记、vault/D6-14/残留清理均 CONFIRMED；D2-5 与 D4-6 各有一处实质缺口（见 §4 对应行），故不按 fixed 计。第 9 批的 4 个 verifier 指出 D4-6 的 refreshing 未落地、D7-6 缺行为用例、图谱 worker 空返回值与迟到 onerror 两个边界；第 10 批已全部补齐。第 8 批登记的 minor 残留（笔记分页无唯一 tiebreaker、节流窗口内保存按钮不可用、`delete_text_file` 未登记 typed args、`native-library:` 空 id、`linkedPaperId` 未校验、D3-6 >2M 分支缺用例、vault 用例标题与断言口径不一致、元数据 patch 重复实现）第 10 批已全部处理。

2026-11-24 的 15 个只读 verifier 复核第 10 批：D7-4/D7-11 对比度数值（独立复算 3.4322/3.7443/8.1298/9.3497/14.3207/9.9029）、D8-4 依赖闭包（28 包、含 sax、实际 `app.asar` 逐包存在）、D8-6 六项目 typecheck、D8-10 目标测试、D3-2 worker bundle、D7-6/D7-7 与 minor 用例均 CONFIRMED；D4-6、D7-13、D3-13 各有可复现缺口，已转 partial 并并入第 11 批。

第 11 批的复核分三轮：17 个 agent（6 实施 + 构建 + 10 verifier）先把 D4-6、D7-13、D3-13、S5 图谱、768 维做到 CONFIRMED，同时指出 D4-9/D7-9/列表/fcose 的实质缺口；12 个 agent（5 修复 + 构建 + 6 verifier）修复后列表 a11y 与 D4-6 相邻残留 CONFIRMED，但仍发现未命名笔记英文哨兵、真实 IPC 错误码丢失、MCP runtime 误报、块菜单/锚点英文单语四处缺口；最终直接修复后再由 2 个只读 verifier 复核 delta，结论见[第 11 批记录](../changes/2026-11-24-audit-batch11-i18n-a11y-s5.md)。

---

## 2. 正文主题剩余

### S2 巨组件与巨模块拆分

- **状态：fixed（2026-11-23 第 6 批）**
- **阅读器**：`DocumentReaderTab.tsx` 4,777 → 628 行；新增 `src/features/reader/hooks/`（state 570 + document 1,817 + summary 762 + notes 1,070 + annotations 622 + qa 1,294）。29 个显式 effect 全部按原序注册：28 个以 `hook.effect_<id>` 回调在壳内原位注册，locale ref 同步 effect 原样保留；`DocumentReaderTabProps`、DOM 与 JSX 表达式不变。见 `tests/documentReaderHooks.test.ts`。
- **PDF**：`PdfViewer.tsx` 3,385 → 628 行；新增 `src/features/pdf/hooks/` 七个 hook；43 个 effect 全部保留（39 个移入 hook，4 个跨领域 effect 留在壳内），默认导出仍为 `memo(PdfViewer)`，滚动/选择/快捷键入口不变。见 `tests/pdfViewerHooks.test.ts`。
- **文献库与笔记**：`LiteratureLibraryView.tsx` 3,837 → 1,114 行，七个 hook 与两个对话框移入 `hooks/`、`dialogs/`；`NoteEditor.tsx` 2,016 → 834 行，拆出 `src/features/notes/editor/` 六模块。见 `tests/literatureHooks.test.ts`、`tests/noteEditorModules.test.ts`。
- **后端**：`ragStore.cjs` 2,097 → 155 行（facade + `rag/{schema,indexing,retrieval,runs}`），`libraryCommands.cjs` 1,331 → 564 行（`libraryMetadata/Attachments/Categories`）；`createRagStore` 方法名、`createLibraryCommands` 的 31 个命令键与既有导出不变。既有断言未改写。见 `tests/backendModuleStructure.test.mjs`。
- **QA 与死代码**：QA 会话/输入/附件/选中会话/preset/运行状态/错误按 tabId 分片；切 tab 不清草稿、不中止流式回答；持久化前过滤空 assistant；关 tab 只清理该 tab。`useReaderBridgeStore.ts` 与旧测试删除，`Reader.tsx` 的 bridge state 成为唯一实现。见 `tests/readerQaPerTab.test.ts`、`tests/rendererDeadModules.test.mjs`。
- **UI**：`src/ui/button.tsx` 提供 `Button`/`IconButton` 的 `size:'sm'|'md'` 与 primary/secondary/ghost/danger 四种 variant，28/32px 走 `--pq-control-sm/md`；`electron/main.cjs` 的 `minWidth` 1040 → 960，使 `@media (max-width: 980px)` 在桌面可达，并登记到 `docs/ui-design-system.md`。见 `tests/uiPrimitives.test.ts`、`tests/windowMinWidth.test.mjs`。
- **拆分偏差**：D5-12 的 `useDocumentTranslation` / `useLibraryReadingTracking` 内部 effect 随 document hook 前移；D5-13 与文献库的跨 hook effect 注册顺序无法与单文件逐字一致。均已逐块核对并补行为用例，详见 [第 6 批变更记录](../changes/2026-11-23-audit-batch6-god-component-split.md)。
- **未纳入本批**：`knowledgeMcpService`（3,346 行）仍是单类；S2 原审计把它列为巨模块，但第 6 批排期只含上述 7 条，后续如继续拆分另立条目。

### S3 桌面与 MCP 双份业务逻辑

- **状态：fixed（2026-11-23 第 5 批）**
- **已共享**：`src/shared/ragQueryUtils.cjs`、`src/shared/mineruCachePaths.cjs`、`electron/shared/libraryDomain.cjs`（查重/命名/导入记录/元数据 patch）、`electron/shared/zoteroDomain.cjs`（嵌套集合分类/未归档规划）、`electron/shared/ragSearch.cjs`（FTS/KNN/RRF/LIKE/邻居片段）、`src/shared/embeddingConfig.cjs`（唯一 embedding 配置）。
- **导入/更新/Zotero**：桌面与 MCP 共用 contentHash → DOI → 标题查重、同一 PDF 命名规则、同一导入记录字段与 `language: ''` 清空语义；MCP Zotero 同步改为嵌套分类、未归档分类与重复文献挂载，和桌面一致。
- **检索**：MCP 混合检索走共享 `ragSearch`，单次 KNN（按合格 source 数扩大 k）与批量邻居查询，去掉逐文档 KNN/逐结果邻居的 N+1；结果同时保留 MCP 公开别名与规范字段。
- **契约测试**：`tests/mcpContract.test.ts` 枚举 28 个工具的 schema/handler、默认值、required、错误码与 tools/list/call；`search_papers` 自由文本已支持 tag。
- **验收**：`tests/mcpSharedDomain.test.ts`、`tests/mcpZoteroShared.test.ts`、`tests/mcpHybridRetrieval.test.ts`、`tests/embeddingConfigShared.test.ts`、`tests/ragStore.test.ts`、`tests/knowledgeMcp.test.ts` 全部通过。

### S4 设置单一存储

- **状态：fixed（2026-11-23 第 5 批）**
- **单一所有者**：主进程 `electron/backend/appSettings.cjs` 持有 `appPaths.configPath`（文档 v2 + 单调 `revision`）；Notes/Reader 只通过 `app_settings_patch` 发送按键 patch 并与 `expectedRevision` 校验，冲突返回 `SETTINGS_CONFLICT` 由渲染层重放。
- **四个旧所有者已收敛**：Notes 不再整对象写 localStorage；Reader 移除 localStorage 与 350 ms 配置文件写回；SQLite `library_settings` 改按键 UPSERT；`zoteroLocalDataDir` 只写应用设置文档，主进程镜像到 `library_settings`，Reader 的 500 ms 双写 effect 已删除。
- **版本与迁移**：v1 配置文件升级到 v2；旧 localStorage 设置/密钥/引用样式键与 SQLite Zotero 目录在首次启动合并（Notes 专用引用样式键优先）；损坏或未来版本拒绝读取并暂停写回。
- **验收**：`tests/appSettingsStore.test.ts`、`tests/appSettingsSingleStore.test.ts`（Notes 设 apa7 → Reader 任意设置写 → 重启 hydrate 仍为 apa7；stale revision 拒绝/重放）、`tests/readerSettingsHydration.test.mjs`、`tests/librarySettingsUpsert.test.mjs`、`tests/appSettingsModuleStructure.test.mjs`。

### S5 三处性能热点

- **状态：fixed（2026-11-24 第 11 批；Worker 超时终止/重建、空 createWorker 重试、迟到 onerror、最坏边数/768 维基准、fcose 动态加载与虚拟列表 a11y 全部收口）**
- **文献列表**：`LiteraturePaperList.tsx` 抽出 `memo(LiteraturePaperRow)`；>60 行时用 `resolveVirtualWindow` 窗口渲染（ResizeObserver 实测行高 + 8px 间距，滚动 rAF 合并），保留选择/拖拽/键盘/右键与双击打开。5000 行基准在 800px 视口下最多渲染 19 行（测试断言 ≤20；1200px 视口约 22 行），875 个滚动位置累计窗口计算 15.51ms（约 0.018ms/次）。小库仍全量渲染。第 11 批补 `role=list`/`listitem`、`aria-setsize`/`aria-posinset`（全局索引）、`role=presentation` spacer、选择计数 aria-live、ArrowUp/ArrowDown/Home/End 跨虚拟窗口漫游（先滚动、rAF 等挂载后 focus）、`useStableCallback` 稳定行回调；不稳定父回调下选择只重渲染新旧两行，100 行虚拟用例 End 后挂载 8 行。
- **知识图谱**：`graphLayout.worker.ts` 在 module worker 内用 headless cytoscape + fcose 计算全局布局，主线程以 preset 应用；`graphLayoutRunner.ts` 负责请求关联、过期结果丢弃、失败回退与 dispose。第 9 批增加 per-request 超时（默认 30s）：超时终止 Worker、回退主线程布局，并允许后续请求重建 Worker；第 10 批补 `createWorker` 返回 null 后下一次请求重试、旧 Worker 迟到 `onerror` 按实例身份丢弃。布局预算按规模分档（≤500 保持 proof/2500，>7000 draft/120）；10k 节点/20k 边 998ms、10k/15k 836ms、5k 528ms、3k 321ms。后端 `applyGraphBounds` 默认 10k 节点/每节点 250 边，top-degree 确定性采样并在 `metadata` 标记；`listDocumentSimilarities` 候选默认 2000（上限 5000）、边上限 1000，top-K 堆收集；10k 文献快照 80–110ms，2500 文档相似度 41–54ms。**第 11 批基准**：默认每节点 250 边的 10k 节点分档夹具实测 125k 输入边→110k 输出约 77–131ms、500k→425k 约 652ms、1.25M→1,055,400 约 1.17–1.67s（后两档仅 `PAPERQUAY_PERF=1`）；2000 候选/768 维精确相似度 756–767ms（预算 2000ms），新增 5000 候选×32 维边界用例。fcose 已移出静态 `vendor-graph`：`vendor-graph` 435.51 kB 仅含 cytoscape，`cytoscape-fcose` 122.57 kB 为独立惰性 chunk，Worker bundle 560.31 kB 仅首次布局请求构造；首屏 10 个 chunk 不含 fcose/cose-base/layout-base。
- **笔记编辑器**：`onUpdate` 只 `markDirty()`，120ms 尾随节流计算 `contentJson+contentText`；保存/草稿/切换/卸载时 flush 完整快照（含 HTML/字数）。签名拆成「正文内容哈希（只在 revision 变化时计算）+ 标题/标签/颜色」两段；普通长文本全量哈希，内嵌 `data:` 图片采样长度、首尾与 5 个等距中段窗口。**第 8 批收口**：标题/标签/颜色按键 0.0005–0.0018ms/键且 0 次 `getJSON`（旧路径约 11ms/键）；首键后 120ms 内关闭/切笔记由 `flushLiveEditor` 用实时快照补建草稿，不再丢失；草稿持久化省略可由 `contentJson` 重建的 `contentHtml`，8×256KB 夹具（约 2.1M 字符）可落盘并回读；签名 v3，兼容 v1/v2 旧草稿。8 图节流按键路径 0.85–1.42ms。用例见 `tests/noteEditorPerf.test.ts`、`tests/noteEditorDraftWindow.test.ts`、`tests/noteEditorUtils.test.ts`、`tests/noteEditorConflict.test.mjs`。
- **隐藏工作区刷新**：阅读进度事件携带 paperId，`useLibraryQueryRefresh` 的 `handleReadingUpdated` 按 id 取列表摘要（不含 abstract/doi/keywords）合并，并用查询代次丢弃过期响应；仅 `readStatus`/`recentlyRead`/按 `lastReadAt` 排序时退回全量重查。
- **状态发现与用户筛选分流**（第 8 批）：`refreshPapers` 从最新 `queryStateRef` 读取条件且身份稳定；查询触发键、查询代次与选择清空只由用户筛选/排序/搜索/分类推进；MinerU 后台发现只合并 `paperStatuses`，仅「MinerU 已解析」筛选开启时在发现结束后补一次保留选择的尾部刷新。首屏后不再重复挂载查询。见 `tests/libraryQueryPolicy.test.ts`、`tests/selectionFilterGuard.test.ts`。
- **首屏与分页**：`library_init` 只返回 settings/categories；首屏一次 `library_query_papers` 500 条；Reader 不再拉全库构造函数 workspace 映射，持久化标签按 id 单条解析；问答/笔记候选在侧栏打开后按需加载。
- **验收缺口**：5000 行窗口、10k 节点、8 截图单键均有可重复的 Node 基准；Electron 实际 fps 与首屏视频未在安装版测量（方法已写入第 7 批变更记录）。

---

## 3. 残留与验收缺口

| # | 项 | 状态 | 证据与剩余工作 |
| --- | --- | --- | --- |
| 1 | A6 RetainPDF 任务中心 | fixed | 第 12 批接入自包含 `RetainPdfTranslationPanel`；第 12R 批补 `key={paper.id}`、`translatedAttachmentId`，刷新改为依赖 TaskCenter 的 `emitNativePaperUpdated`（避免双重刷新），阅读器入口改用 `startRetainPdfTranslationOnce`；另用事件版本号阻止加载中的旧快照覆盖已到达的 attached 事件，并新增切换文献时旧结果不覆盖新文献的集成用例。`tests/retainPdfUi.test.ts` 24 项通过。见[第 12R 批记录](../changes/2026-11-24-audit-batch12r-release-blockers.md)。 |
| 2 | F4 checkJs / lint / CI | fixed | flat `eslint.config.js` + `npm run lint` 0 error/206 warning；`build.yml` 与 `release.yml` 的 verify 都在 typecheck 前执行 ESLint（`tests/lintConfig.test.mjs` 双工作流断言）；`docs/typecheck-backlog.md` tests 合计复算为 250（自身 52 + electron 196 + `src/shared` 2）；六项目 typecheck 0 诊断。 |
| 3 | E4/E1 axe 与截图 | fixed | 第 12R 批：Graph 标签改为浅/深两套 6 位 hex（`#1f2937`/`#e5e7eb`，对画布 ≥14:1），不再向 Cytoscape 传 `rgba()`；MCP textarea 与笔记编辑器补本地化 `aria-label`（编辑器声明 `textbox`），全选按钮可见文字进入可访问名称；axe 报告保留 incomplete 的 target/html/nodes，扫描 Notes 编辑器/列表与 Settings 备份/MCP/更新，16 视图/主题 0 violations、0 serious/critical violations、0 `label-content-name-mismatch`（4 组 serious incomplete 已保留 target/html，见报告）；16 张截图与报告重新生成；截图同时脱敏文本节点、表单值与属性（整个盘符路径替换为 `C:\PaperQuayAudit`），报告不含用户目录或仓库路径。见[第 12R 批记录](../changes/2026-11-24-audit-batch12r-release-blockers.md)。 |
| 4 | E5 服务层与模板文案 | fixed | 第 12R 批：`noteVault.cjs` 导出前识别并剔除已有 `参考文献`/`References` 标题及紧邻列表（`ctx.refs` 为空时保留手写列表，标题语言沿用首个被删标题），导出→回导→再导出幂等；围栏按 CommonMark 跟踪字符/长度与 info string，列表项内代码块、嵌套围栏、后续另一份列表和多行续行不再误删或吞掉；标题后是正文时保留正文且不追加第二份列表。`noteDistill.ts` 的「我的想法」与「摘录卡」按 locale 双语并纳入 i18n 守卫，追加时识别中英标题；`noteSystemPages.ts` 保留多行 `operationSummary` 完整条目（该模块当前无生产调用方，见第 12R 批记录的已知限制）。`tests/noteVault.test.ts` 29（28 通过、1 项性能用例默认跳过）、`noteDistill.test.ts` 6、`noteDistillPreview.test.ts` 5、`noteSystemPages.test.ts` 7 项通过；`src/features/notes/noteDistill.ts` 已加入 i18n 守卫。markdown-only 笔记的英文 `References` 不映射仍为既有已知限制。 |
| 5 | B1 首次启动重新授权 | fixed | 第 12R 批：新增 `approveReadDirectory`，`select_directory`/`prepare_mineru_cache_dir` 只授权所选目录自身；`readRoots`/`writeRoots` 不再直接信任 `settings.translatedPdfDir`，状态命令与 `isReadAllowed`/`isWriteAllowed` 统一；旧 MinerU 目录未授权或 OS 拒绝列举（EPERM/EACCES）时跳过迁移并返回 `migrationSkippedReason`（设置页双语提示）；写模式状态用写权限探测；`resolveForCheck` 沿最近存在的祖先做 realpath，堵住 junction 中间目录写出；渲染层附加译版前校验目标目录授权。`tests/pathPolicyAuthorization.test.mjs` 16 项通过（父目录文件不可读、父目录 `.pdf` 不可写、readRoots 不含父目录、重启后仍不可读、junction realpath、迁移跳过、只读祖先不报可写、未授权译版目录拒绝写入、空/有附件目录的 `missing-approval`/`known-attachment`）。 |
| 6 | F2/§8 安装版冒烟 | partial（已知限制） | 第 12R 批构建 NSIS `release/PaperQuay-0.4.38-win-x64.exe`（116,159,237 字节，sha256 `0941c9c8…c26f`），afterPack/fuse/ELECTRONASAR 断言通过；payload（app.asar 50,646,364 字节，sha256 `0523dc06…edc0`）冒烟 11 pass/2 fail，覆盖启动/preload、导入、打开论文、中文 CID PDF、笔记、Vault（2 文件/1 `.md`）、RetainPDF 状态、备份导出（407,528 字节/5 条）、未授权拒绝与 MCP 28 工具读图；报告已脱敏。**已知限制（未验证，不按 fixed 计）**：本机已有同 appId 安装且其 MCP 进程占用文件，未执行 NSIS 注册式安装/卸载；原生对话框备份导入未完成。 |
| 7 | S1 性能埋点对比 | fixed | 第 12R 批用审计前 `1283d82` 重测：`--no-sandbox --disable-gpu`、before/after 交替各 3 次、记录 dist/preload SHA-256、端点定义与 min/max/σ。中位数：冷启动 577→518ms、窗口可见 259.6→194.8ms、Library 265.8→186.8ms；Notes 19→100ms、Graph 26→60ms 的上升来自第 3 批把工作区改为惰性加载（基线启动时已挂载）。口径与方差见[第 12R 批记录](../changes/2026-11-24-audit-batch12r-release-blockers.md)。 |
| 8 | 文档状态同步 | fixed | 第 12R 批统一第 12 批记录的证据口径（备份导出 407,528 字节/5 条、Vault 2 文件/1 `.md`、`read_paper_figure` 已通过）；`docs/typecheck-backlog.md` 合计 250；`docs/ui-design-system.md`、CSS 与测试注释同步 accent 5.02/5.47 与 warning 15°；§5 纳入清单含 `scripts/bundle-preload.cjs`、`eslint.config.js`、`docs/assets/audit-2026-11-24/`；新增第 12R 批记录并更新本计划。 |
| 9 | S5 笔记/图谱残留 | fixed | 笔记侧第 8 批已收口。第 9/10 批补图谱 Worker 超时终止、回退、重建、空 worker 重试与迟到 onerror；第 11 批补默认每节点 250 边最坏规模分档基准（125k/500k/1.25M 输入边）、2000 候选/768 维相似度基准（756–767ms，预算 2s）、fcose/cose-base/layout-base 移出静态 vendor-graph 并加构建守卫，以及虚拟列表 `role=list/listitem`、`aria-setsize/posinset`、跨窗口键盘漫游与行回调稳定化。见 `tests/graphSnapshotScale.test.mjs`、`tests/graphSimilarityScale.test.mjs`、`tests/initialChunks.test.mjs`、`tests/literaturePaperListA11y.test.ts`、`tests/literaturePaperListStability.test.ts`。 |

---

## 4. 附录 A 逐条状态（93 条）

**汇总**：fixed 92、partial 1（D1-13）、open 0。

- **fixed（92）**：D1-3、D1-4、D1-6、D1-2、D1-11、D1-10、D2-1、D2-6、D2-10、D3-3、D3-8、D5-11、D8-3、D5-3、D6-8、D6-10、D6-11、D4-12、D7-2、D7-3、D7-5、D7-8、D7-10、D7-12、D1-7、D8-5、D8-9、D5-7、D6-12、D4-7、D1-5、D1-8、D1-9、D2-11、D2-12、D2-13、D3-4、D3-11、D3-14、D4-5、D5-14、D3-9、D3-10、D8-12、D8-14、D1-14、D8-7、D2-14、D4-8、D4-10、D4-11、D5-12、D5-13、D7-14、D2-2、D2-8、D2-9、D3-5、D4-13、D4-14、D5-8、D5-10、D6-5、D6-6、attachment-filter-stat-storm、D3-6、D3-7、D3-12、D5-5、D5-6、D5-9、D6-7、D6-9、D6-13、D6-14、vault-autosync-main-thread、D2-5、D7-6、D7-7、D7-4、D7-11、D3-2、D8-4、D8-6、D8-10、D8-11、D8-13、D3-13、D4-6、D4-9、D7-9、D7-13
- **partial（1）**：D1-13（代码与 Windows 未签名产物已验证；签名/发布流水线未验证）。
- **open（0）**：无。

> 下表保留审计原 ID 与级别；「剩余工作」列已同步到 2026-11-24 第 11 批收口后的结论。

| ID | 级别 | 状态 | 剩余工作 / 当前证据 |
| --- | --- | --- | --- |
| D2-14 | P2 | fixed | 第 6 批完成：`ragStore.cjs` 2,097→155 行（facade + `rag/{schema,indexing,retrieval,runs}`），`libraryCommands.cjs` 1,331→564 行（`libraryMetadata/Attachments/Categories`）；27 个 rag 方法与 31 个命令键不变，既有断言未改写，结构测试见 `tests/backendModuleStructure.test.mjs`。 |
| D2-9 | P2 | fixed | 第 7 批完成：`ragWorkerHost.cjs` 增加 per-call 超时（读 30s、索引/快照/迁移 10min）、崩溃拒绝在途并使下次调用懒重建（3 次/60s 预算）、`close()` 幂等且阻止重启；错误码 `RAG_WORKER_TIMEOUT`/`RAG_WORKER_CLOSED`/`RAG_WORKER_RESTART_BUDGET`。用例见 `tests/ragWorkerHost.test.ts`。 |
| D3-10 | P2 | fixed | 第 5 批完成：embedding 配置收敛到 `src/shared/embeddingConfig.cjs`；FTS/KNN/RRF/LIKE/邻居片段收敛到 `electron/shared/ragSearch.cjs`，MCP 与 ragStore 共用；单次 KNN + 批量邻居，去掉逐文档/逐结果 N+1。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D3-3 | P2 | fixed | 已修复（本轮核验通过） |
| D3-9 | P2 | fixed | 第 5 批完成：`electron/shared/libraryDomain.cjs` 统一查重（contentHash→DOI→标题）、PDF 命名、导入记录与元数据 patch；`zoteroDomain.cjs` 统一嵌套集合分类/未归档规划；桌面与 MCP 导入/更新/Zotero/检索共用。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D4-10 | P2 | fixed | 第 6 批完成：`DocumentReaderTab` 4,777→628、`PdfViewer` 3,385→628、`LiteratureLibraryView` 3,837→1,114、`NoteEditor` 2,016→834 行；reader/pdf/literature 分别拆出五/七/七个 hook，NoteEditor 拆出 `editor/` 六模块。结构测试见 `tests/documentReaderHooks.test.ts`、`pdfViewerHooks.test.ts`、`literatureHooks.test.ts`、`noteEditorModules.test.ts`。 |
| D4-11 | P2 | fixed | 第 6 批完成：`useReaderQaStore` 按 tabId 分片（含 `workspaceId`），切 tab 不清草稿、不中止流式回答；持久化前过滤空 assistant；关 tab 只清理该 tab。`Reader.tsx` 改为按字段订阅避免整树重渲染。用例见 `tests/readerQaPerTab.test.ts`。 |
| D4-5 | P2 | fixed | 第 5 批完成：主进程 `appSettings.cjs` 持有 v2 文档与 revision，渲染层只读缓存 + patch 重放；Notes/Reader/SQLite/Zotero 四个所有者收敛；验收 Notes apa7 → Reader 写 → 重启 hydrate 仍 apa7，覆盖 localStorage/config/SQLite 迁移。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D5-12 | P2 | fixed | 第 6 批完成：`DocumentReaderTab` 4,777→628 行，新增 reader `hooks/`（state + document/summary/notes/annotations/qa 五个领域 hook）；29 个显式 effect 顺序保持，props/DOM 不变。偏差（自定义 hook 内部 effect 前移）见批次记录；结构测试 `tests/documentReaderHooks.test.ts`。 |
| D5-13 | P2 | fixed | 第 6 批完成：`PdfViewer` 3,385→628 行，新增 `src/features/pdf/hooks/` 七个模块；默认导出仍为 `memo(PdfViewer)`，43 个 effect 全部保留（39 个移入 hook、4 个跨领域留壳）。跨 hook effect 顺序偏差与 21 个行为用例见批次记录；结构测试 `tests/pdfViewerHooks.test.ts`。 |
| D1-2 | P2 | fixed | 已按 4A-1 小批修复：`will-navigate` 改用 `isTrustedRendererNavigation`，生产版只允许 `dist/index.html` 精确文档（含 hash/query），拒绝任意 file://、`dist/../evil.html` 与编码穿越；见 `docs/changes/2026-11-23-audit-batch4a1-main-boundaries.md`。 |
| D1-3 | P2 | fixed | 已修复（本轮核验通过） |
| D1-4 | P2 | fixed | 已修复（本轮核验通过） |
| D1-5 | P2 | fixed | 已按 4B-1 小批修复：新增共享 `sanitizeMineruAssetReference` 与 `resolveMineruAssetPath`（`src/shared/mineruCachePaths.cjs`、`electron/backend/mineruAssetPaths.cjs`），字符串层拒绝绝对路径/盘符/UNC/ADS/URL/`..`，realpath 必须位于当前缓存目录；渲染层改走 `read_mineru_asset_base64`（缓存目录必须是含解析产物的 MinerU 目录，只允许普通文件、上限 64 MiB），MCP `resolveMineruFigureAsset` 复用同一实现。用例见 `tests/mineruAssetPath.test.ts`。 |
| D1-6 | P2 | fixed | 已按 4A-1 小批修复：恢复目标必须来自 `backup_select_library_dir` / `backup_select_vault_dir` 的对话框返回值（并登记到 pathPolicy 写授权），导入器二次校验 `authorizedTargets`；UNC、设备路径、ADS 与未授权的非空目录一律 `UNSAFE_DESTINATION`。残留已闭环（4A-3）：`backup_import_inspect` 的 `packagePath` 只接受 `backup_select_package` 本次会话返回并登记的路径，UNC/设备/ADS 在容器读取前拒绝（`UNAUTHORIZED_PACKAGE`）。4B-1 把同一授权应用到 `backup_import_stage`，stage 不再接受未登记包路径。 |
| D1-9 | P2 | fixed | 已按 4B-1 小批修复：`render-process-gone` / `did-fail-load` 在生产版同样注册；崩溃弹「重载/退出」，加载失败与重载失败走统一清理并退出；`PENDING_CHECKSUM_INVALID` 显示可读错误框并说明 `pending.error.json`。控制器见 `electron/appLifecycle.cjs`，用例见 `tests/appLifecycle.test.mjs`。 |
| D2-1 | P2 | fixed | 已修复（本轮核验通过） |
| D2-10 | P2 | fixed | 已按 4A-2 小批修复：`writeJsonSync` 改为临时文件 + fsync + rename，并对 Windows 瞬时 `EPERM`/`EBUSY` 有界重试；关系库读取只把 `ENOENT` 当空库，JSON 损坏时保留 `.corrupt.json` 并抛出 `GRAPH_RELATION_STORE_CORRUPT`，不再静默覆盖。见 `docs/changes/2026-11-23-audit-batch4a2-backend-durability.md`。 |
| D2-11 | P2 | fixed | 已按 4B-2 小批修复：`withLocalZoteroDatabase` 改用 `node:sqlite` 只读连接 `VACUUM main INTO` 生成含 WAL 的一致性快照，失败时回退复制 `sqlite + -wal + -shm` 并 `quick_check` 重试；查询不再整库载入 sql.js/WASM，临时文件随机化，快照并发上限 2。用例见 `tests/zoteroLocal.test.ts`（WAL 未 checkpoint 行、拦截 sql.js、并发查询）。 |
| D2-12 | P2 | fixed | 已按 4B-2 小批修复：新增 `electron/backend/httpIO.cjs`，OpenAlex/Crossref/Crossref references 走 `AbortSignal.timeout`（默认 15 s）+ 8 MiB 声明/累计上限；远程 PDF 与 Zotero 附件下载按块写 `.partial` 后 rename，默认 60 s / 512 MiB 并在超时/超限/流错误时清理；本地导入 512 MiB 上限 + 流式 `hashFile`。用例见 `tests/httpIO.test.ts`、`tests/fileCommands.test.ts`、`tests/libraryCommands.test.mjs`。 |
| D2-13 | P2 | fixed | 已按 4B-2 小批修复：`publishExtractedFile` 在 FAT/exFAT/SMB 等不支持硬链接时回退同目录 `rename`；新增 `backupDatabaseWorker.cjs` / `backupDatabaseSnapshot.cjs`，library/notes/rag 的 `VACUUM`、`user_version`、`integrity_check` 与计数移入 worker，默认 120 s 超时并支持取消终止。用例见 `tests/backupContainer.test.ts`、`tests/backupDatabaseSnapshot.test.ts`。 |
| D2-5 | P2 | fixed | 第 9 批补齐 MCP 路径：FTS 查询返回 0 行时回退 LIKE；`tests/knowledgeMcpNoteStructured.test.ts` 删除 FTS 行后验证 `search_notes({mode:'keyword'})` 仍命中。陈旧 FTS 行由应用写入路径维护，MCP 只读检索不修复外部篡改索引。 |
| D2-6 | P2 | fixed | 已修复（本轮核验通过） |
| D3-4 | P2 | fixed | 已按 4B-3 小批修复：`list_note_tags` / `list_note_folders` 改用 `openReadOnlyDb` + `noteStore.queryNoteTags` / `queryNoteFolders`，notes 库缺失时返回空结果且不建库；`preview_delete_papers` 改用只读连接打开文库，库缺失返回空预览，不再触发建库/迁移。用例见 `tests/knowledgeMcpNotesWrite.test.ts`、`tests/knowledgeMcpRuntimeWrite.test.ts`。 |
| D3-6 | P2 | fixed | 第 8 批完成：`get_note` 返回 `contentJson`（`contentFormat: 'tiptap-json'`；>2M 字符降级并标记 `contentJsonTruncated`）；`update_note` 接受结构化 `contentJson`，写入前校验已有锚点全部保留（缺失返回 `NOTE_ANCHOR_MISSING`），并派生 `contentText`。富文本 round trip 与锚点拒绝用例见 `tests/knowledgeMcpNoteStructured.test.ts`。 |
| D3-7 | P2 | fixed | 第 8 批完成：`deleteFolder` 在提供 `expectedFolderVersions` 时要求覆盖目标与全部后代的 `removedIds`，缺失条目返回 `NOTE_CONFLICT` 且不删除任何文件夹；未提供版本映射的桌面路径保持兼容。partial map 用例见 `tests/noteStoreFolderVersions.test.ts`。 |
| D3-8 | P2 | fixed | 已按 4A-2 小批修复：新增 `resolveMineruFigureAsset`，字符串层拒绝绝对路径、盘符、UNC、ADS 与 `..` 段，并对缓存目录与资产做 realpath 包含校验；`read_paper_figure` 只读取校验通过的路径，越界用例见 `tests/knowledgeMcp.test.ts`。 |
| D4-6 | P2 | fixed | 第 10 批补工具栏刷新状态、首屏条件键与并发闸门；第 11 批修复复核缺口：`handleSelectCategory` 对已选分类同步早退（同步 ref 拦同 tick 双击），`unconditional` skip 改为与 `paperQueryConditionsKey` 绑定的消费式 `conditions`，条件键变化立即丢弃；`markCategoryQueryHandled` 让分类创建/删除/拖放分配也不再重复查询。用例见 `tests/libraryCategorySelection.test.ts`（esbuild + jsdom 真实挂载 hook，含双击、改筛选不吞查询、分类动作 1 次）与 `tests/libraryQueryPolicy.test.ts`。 |
| D4-7 | P2 | fixed | 已按 4A-3 小批修复：草稿改由 `createNoteEditorDraftStore` 持久化到 `localStorage`（20 条 / 4 MiB 上限，按 `updatedAt` 淘汰，配额错误逐条淘汰重试，损坏值读取时删除）；`NoteEditor` 在 `beforeunload` / `pagehide` / `visibilitychange(hidden)` 与切换笔记时同步冲刷。见 `docs/changes/2026-11-23-audit-batch4a3-reader-notes-residuals.md`。 |
| D5-3 | P2 | fixed | 已修复（本轮核验通过） |
| D5-5 | P2 | fixed | 第 8 批完成：清空译文同时删除主/备用缓存根下当前文稿的语言缓存（含旧命名与同语言其它模型缓存），并推进 item+语言 epoch 抑制在途恢复；删除失败保留会话清除标记并如实报告。新增仅允许 `.json`、走 `assertWriteAllowed` 的 `delete_text_file` IPC。用例见 `tests/readerTranslationCache.test.ts`、`tests/readerTranslationCacheDelete.test.ts`（19）。 |
| D5-6 | P2 | fixed | 第 8 批完成：缓存文件名加入模型/源语言哈希（`<lang>-<hash8>.json`），读取兼容旧 `<lang>.json`；写入在同一按路径锁内完成 read-merge-write（同块新译文优先，其余块保留），并发写入不丢块；跨进程限制已在代码注释说明。用例见 `tests/readerTranslationCache.test.ts`。 |
| D5-7 | P2 | fixed | 已按 4A-3 小批修复：新增 `documentOpenGeneration`，`openWorkspaceDocument`、`openDocumentItem`、`switchCurrentPdfFile` 与延迟 MinerU 恢复共享同一代次；旧请求不得写 `pdfSource` / `currentDocument` / `loading` / `error`，同一 workspaceId 切换 PDF 来源的竞态用例见 `tests/documentOpenGeneration.test.ts`。 |
| D5-9 | P2 | fixed | 第 8 批完成：`ReaderTabBridgeState` 增加 `qaRunning`，有运行中问答的阅读标签与翻译标签一样计入 `busyTabIds`，切走时保持挂载；复核确认切 tab（同 workspace）不中止、abort 空占位删除、持久化过滤空 assistant（第 6 批已实现）。回归用例见 `tests/readerBusyTabs.test.ts`（7）。 |
| D6-10 | P2 | fixed | 已修复（本轮核验通过） |
| D6-11 | P2 | fixed | 已修复（本轮核验通过） |
| D6-8 | P2 | fixed | 已修复（本轮核验通过） |
| D6-9 | P2 | fixed | 第 8 批完成：详情表单的 window Ctrl/Cmd+S 与 Escape 仅在面板布局可见、且事件目标/焦点位于面板内时生效；工作区隐藏或焦点在其它控件时不再保存或丢弃草稿。用例见 `tests/literatureDetailsShortcuts.test.ts`（4）。 |
| D8-7 | P2 | fixed | 第 5 批完成：`tests/electronPreloadIntegration.test.mjs` / `tests/electronMainIntegration.test.mjs` 用 vm/桩加载 preload/main，覆盖白名单拒绝、restore sync ack、will-navigate 放行与拒绝、拖放路径授权。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D2-2 | P2 | fixed | 第 7 批完成：`library_init` 只返回 `{settings, categories}`（分类计数走 SQLite 聚合）；新增 `loadLibraryFirstScreen`，首屏一次 `library_query_papers({limit:500})` 并跳过重复防抖查询；MinerU 筛选延迟补齐全库状态。用例见 `tests/libraryFirstScreen.test.ts`、`tests/libraryBatchCommands.test.mjs`。 |
| D2-8 | P2 | fixed | 第 7 批完成：`searchKnowledgeBase` 的 embedding model key 只算一次；逐命中 chunk 复核与逐结果 ready 检查合并为两条批量查询，KNN/邻居/chunk 均 O(1)；1203 chunks/62 docs 夹具三种规模均为 20 条语句/次。用例见 `tests/mcpHybridRetrieval.test.ts`。 |
| D3-5 | P2 | fixed | 第 7 批完成：`PaperQuayKnowledgeService` 增加懒加载单例 library store 与幂等 `close()/dispose()`；所有 `createLibraryStore(this.appPaths)` 调用点复用单例，按 id 读取不再 `load()` 整库；`bin/paperquay-mcp.cjs` 在退出/SIGINT/SIGTERM/stdio 关闭时释放。用例见 `tests/mcpBatchStoreLifecycle.test.ts`。 |
| D4-13 | P2 | fixed | 第 7 批完成：新增主进程只读 `pdf_read_metadata_preview({path})`，经 pathPolicy 校验后用 pdfjs legacy 解析元数据与第 1 页，只回传小 JSON（5 MB 夹具 716 B、14.1ms）；渲染层保留原有标题/作者/DOI 启发式。`package.json` extraResources 增加 `pdfjs/legacy/build`，afterPack 校验运行时文件。改标题不重载、换路径重载的回归用例见 `tests/pdfViewerPageCountLifecycle.test.ts`。 |
| D5-10 | P2 | fixed | 第 7 批完成：Reader 删除全库 `listAllLibraryPapers` 挂载 effect 与 `libraryWorkspaceItems`；`workspaceItemMap` 只合并已打开条目，持久化标签按 id 单条 `getLibraryPaper` 解析；问答/笔记候选改为侧栏打开后按需加载；概览使用按需缓存。用例见 `tests/readerWorkspaceItems.test.ts`。 |
| D5-11 | P2 | fixed | 已修复（本轮核验通过） |
| D5-8 | P2 | fixed | 第 7 批完成：流式答案移入按 session/message 分键的瞬态外部 store，delta 每帧合并，流结束/中止时一次提交到 `qaSessions`；历史消息 `React.memo` + 有界 Markdown 规范化 LRU。100 历史消息 + 200 delta 的 delta 处理 0.55ms、2 次通知、1 次提交。用例见 `tests/readerStreaming.test.ts`、`tests/readerQaPerTab.test.ts`。 |
| D6-5 | P2 | fixed | 第 7 批完成：新增 `library_batch_update_papers`（收藏/加分类单事务）与 `library_batch_delete_papers`（文件清理后单事务删除 + RAG 清理上报）；渲染层批量收藏/移动/删除改为一次 IPC，全选仍一次枚举 id。行为变化：批量写入原子化。用例见 `tests/libraryBatchCommands.test.mjs`。 |
| D6-6 | P2 | fixed | 第 7 批完成：阅读进度事件携带 paperId，`handleReadingUpdated` 按 id 取 `library_get_paper_summary`（不含 abstract/doi/keywords）合并，`papersQueryGenerationRef` 丢弃过期响应；仅阅读筛选/排序依赖时全量重查。用例见 `tests/libraryQueryRefresh.test.ts`、`tests/libraryIncrementalRefresh.test.ts`。 |
| D6-7 | P2 | fixed | 第 7 批完成 library 侧；第 8 批完成 Notes 侧：`NotesWorkspace` folder 计数改为一次遍历 `countNotesInFolderTree`（O(notes+folders)，嵌套/未知 folder 语义不变）；`useNotesStore` 与 `useReaderNotes` 移除 1000 条静默上限，按 5000/页拉取到短页（`notes_list` 命令层 offset、代次守卫、渐进写回）。5000 条计数与分页用例见 `tests/notesFolderCounts.test.ts`、`tests/noteStoreSelection.test.mjs`。 |
| D8-3 | P2 | fixed | 已修复（本轮核验通过） |
| attachment-filter-stat-storm | P2 | fixed | 第 7 批完成：`libraryAttachmentAvailability.cjs` 增加按路径的 stat 缓存（正 5s/负 1.5s，并发共享一次 stat），导入/删除/附件增删/迁移显式失效；同路径多附件只 stat 一次。行为变化：外部移动文件最多滞后 TTL。用例见 `tests/attachmentAvailabilityCache.test.mjs`。 |
| vault-autosync-main-thread | P2 | fixed | 第 8 批完成：`syncNow` 接受 `shouldCancel`/`AbortSignal`，取消后不写 manifest/不删文件并返回 `cancelled:true`；新增 `background:true` 从异步驱动起步、chunk 8 并每段 `setImmediate` 让出；禁用自动同步时 hook cleanup 调用 `cancelNotesVaultAutoSync()`，`notes_vault_update_settings` 可中止在跑的调度器同步。1000 文件假 IO 驱动最大停顿 3.98ms（<16ms 断言，假 IO 用例允许最多 3 次有界重试；2026-11-24 复核实测首轮可达 39.32ms），真实 fs 隔离 9.3–15.9ms、全套并行负载下 ≤17.97ms（真实路径用 24ms 回归阈值）。用例见 `tests/noteVaultCancel.test.ts`、`tests/noteVaultPerf.test.ts`。 |
| D1-7 | P2 | fixed | 已修复（本轮核验通过） |
| D3-2 | P2 | fixed | 第 10 批完成：`bundleMcp` 增加 `ragWorker.cjs` 入口并打全依赖，afterPack 断言 worker 存在；`tests/mcpRagWorkerBundle.test.ts` 把安装版布局复制到仓库外临时目录启动 worker，`indexNote` 经本地假 embedding 服务写入向量、`getDocumentIndexStatus` 返回 ready、`close` 正常，证明笔记向量索引依赖闭包完整。 |
| D8-4 | P2 | fixed | 第 10 批完成：根依赖改为扫描实际 require，按 Node 规则展开嵌套传递闭包（当前 28 个包），用 `build.files` glob 逐包校验；补上真实漂移 `sax`。afterPack 用 `@electron/asar` 对实际 `app.asar` 逐包断言 `package.json` 存在。用例见 `tests/packagingDependencies.test.mjs`、`tests/mcpPackaging.test.ts`。 |
| D8-5 | P2 | fixed | 已修复（本轮核验通过） |
| D8-6 | P2 | fixed | 第 10 批引入 allowlist 型 `tsconfig.checkjs.json` 与 `tsconfig.tests.mjs.json`，均加入 `npm run typecheck`（六个项目）。第 12R 批现状：`tsconfig.checkjs.json` 29 个文件（27 个 clean 的 electron 文件 + 2 个被相对导入的 `src/shared` 实现），`tsconfig.tests.mjs.json` 22 个 clean 的 `.mjs` 测试；"clean" 指当前 `strict:false`。剩余全量 checkJs 错误按 `docs/typecheck-backlog.md` 为 electron/bin 281、tests mjs 52；未用 any 掩盖，新增代码用 JSDoc 标明形状。 |
| D4-12 | P2 | fixed | 已修复（本轮核验通过） |
| D4-9 | P2 | fixed | 第 11 批完成：NotesWorkspace/NoteEditor/NoteEditorToolbar/editor 右键与表格菜单/NoteCard/建议菜单/锚点卡/块菜单/slash 命令的用户可见文案全部双语；未命名笔记不再写中文或英文哨兵（落库空标题，展示层与 noteHealth 兼容 `''`、`未命名笔记`、`Untitled Note`）；i18n 守卫覆盖 20 个 notes UI/服务文件并解码 `\uXXXX`，负向自测真实失败；en 渲染用例覆盖空态、vault 确认框、工具栏、右键菜单与体检徽标。见 `tests/notesI18n.test.ts`、`tests/uiA11yI18n.test.ts`、`docs/changes/2026-11-24-audit-batch11-i18n-a11y-s5.md`。 |
| D7-10 | P2 | fixed | 已修复（本轮核验通过） |
| D7-2 | P2 | fixed | 已修复（本轮核验通过） |
| D7-3 | P2 | fixed | 已修复（本轮核验通过） |
| D7-4 | P2 | fixed | 第 10 批完成：`tests/uiContrast.test.ts` 解析浅/深令牌并计算 `.pq-input` 3px 环与 `:focus-visible` 2px outline 对相邻表面的对比度；浅色最低 3.43:1、深色最低 8.13:1；焦点环数值写入 CSS 注释与测试，kicker/深色下限在测试与设计文档（2026-11-24 复核指出 CSS 注释未含 kicker）。 |
| D7-6 | P2 | fixed | 第 9 批从 Dialog 焦点陷阱选择器排除 `tabindex=-1` 元素；第 10 批补 `tests/dialogFocusTrap.test.mjs`（jsdom 行为：打开聚焦首项、Tab/Shift+Tab 双向循环、option 不参与边界）。 |
| D7-7 | P2 | fixed | 第 9 批菜单改由 document capture keydown 处理 Esc/Tab/方向/Home/End；从背景焦点按 Down/Home 进入首项、Up 进入末项，关闭恢复焦点。所有调用共享 `src/ui/menu.tsx`；`tests/uiA11yI18n.test.ts` 以源码守卫锁定该监听。 |
| D7-8 | P2 | fixed | 已修复（本轮核验通过） |
| D7-9 | P2 | fixed | 第 11 批完成：`NoteServiceError` 17 个稳定码，store 只存码，渲染层经 `noteErrorMessage` 映射且不回显后端原文；`noteErrorCode` 剥离真实 Electron IPC/多层 Error 前缀，`noteTargetError` message 带 CODE 前缀使 `PAPER_NOT_FOUND`/`FOLDER_NOT_FOUND` 在 IPC 下仍可识别；Sidebar 的后端中文 warning 改为固定双语映射；阅读侧提炼错误改 `NOTE_DISTILL_*` 稳定码并统一映射；noteHealth 五类标签与描述双语。见 `tests/notesErrorCodes.test.ts`、`tests/notesSidebarSearch.test.mjs`、`tests/noteHealth.test.ts`。 |
| D1-14 | P3 | fixed | 第 5 批完成：`electron/ipcCommandRegistry.cjs` 为 15 个关键命令登记 args/result schema，`createCommandInvoker` 在 handler 前校验；`src/services/ipcCommands.ts` 提供类型联合；未登记命令仍受白名单约束。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D5-14 | P3 | fixed | 第 5 批完成：backup/MCP/updates 组件、设置原语与类型移到 `src/app/settings/`；`AppSettingsWindow` 由 App 常驻挂载，Reader/Notes/Graph 都可打开，Reader 完整设置复用同一组件。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D7-14 | P3 | fixed | 第 6 批完成：新增 `src/ui/button.tsx`（`Button`/`IconButton`，`size:'sm'|'md'`，primary/secondary/ghost/danger，高度走 `--pq-control-sm/md`），迁移 `dialog`、`ReasoningEffortPicker`、`BlockViewer`；`minWidth` 1040→960 使 980px 回退可达并登记到设计文档。测试 `tests/uiPrimitives.test.ts`、`tests/windowMinWidth.test.mjs`。 |
| D1-10 | P3 | fixed | 已按 4A-2 小批修复：`noteIndexer.closeWhenIdle` 停止接收新任务并等待队列（含执行中任务）排空，超时返回摘要；`before-quit` 先 `preventDefault`，等待 `backend.shutdown({ timeoutMs: 2500 })` 后再 `app.exit(0)`，保留 3 秒强制退出兜底。残留已闭环（4A-3）：`shutdown` 在总预算内等待 `ragStore.close({ timeoutMs })`，worker 不响应时终止线程；笔记索引超时与 `close()` 会 abort 在途 embedding（worker 执行单元由 terminate 取消）。见 `docs/changes/2026-11-23-audit-batch4a2-backend-durability.md`、`docs/changes/2026-11-23-audit-batch4a3-reader-notes-residuals.md`。 |
| D1-11 | P3 | fixed | 已按 4A-1 小批修复：preload 恢复逻辑抽到 `src/shared/rendererStorageRestore.cjs`，按 `restoreId` 写 `paperquay-restore-state-v1` 完成标记；重复加载/ack 丢失不再清空，写失败保留 `failedKeys` 供 ack 重试，clear 失败不落标记。 |
| D1-13 | P3 | partial | 代码已落地：新增 `scripts/bundle-preload.cjs` 把 preload 及其依赖打成自包含 `electron/preload.bundle.cjs`，`main.cjs:196-204` 启用 `sandbox:true` 并加载 bundle；sandbox 不可用的 clipboard 改为受主窗口/白名单/20 万字符上限约束的 `clipboard_read_text`/`clipboard_write_text` IPC。`package.json build.electronFuses` 启用 `enableEmbeddedAsarIntegrityValidation` 与 `onlyLoadAppFromAsar`；`afterPack.cjs:229-341` 先翻转 fuse 再断言 ENABLE，并用 resedit 校验 `ELECTRONASAR` 的 app.asar/SHA256/64-hex，另断言 asar 内存在 `electron/preload.bundle.cjs`。Windows unpacked 产物复核 fuse 49/49、资源哈希与 asar 头一致、CDP 桥/IPC/拖放全通。**阻塞点**：本机无发布证书且未运行 GitHub release 流水线，代码签名/公证、签名后完整性、macOS/Linux 载体未验证；按任务口径不标 fixed。见[第 12 批记录](../changes/2026-11-24-audit-batch12-acceptance-release.md)。 |
| D1-8 | P3 | fixed | 已按 4B-1 小批修复：`whenReady` 链补 `.catch`，`loadURL`/`loadFile` 改用 `loadRendererEntry` 并处理 rejection；失败时错误框 + 清理 backend/运行标记/恢复锁 + `app.exit(1)`，不悬挂或白屏。实现与用例见 `electron/appLifecycle.cjs`、`tests/appLifecycle.test.mjs`。 |
| D3-11 | P3 | fixed | 已按 4B-3 小批修复：外部写入标记从 JSON 快照改为 SQLite 库，写入在 `BEGIN IMMEDIATE` 事务内执行 `revision = revision + 1` UPSERT，双进程并发不再丢失递增；旧 `.paperquay-external-writes.json` 仅作首次迁移基线，目录 watch 兼容主库与 `-journal/-wal` 边车。双进程各 40 次并发写用例见 `tests/externalWriteMarker.test.ts`。 |
| D3-14 | P3 | fixed | 已按 4B-3 小批修复：`noteStore` 在写事务内校验 folder 存在（`FOLDER_NOT_FOUND`），`createNote` 通过 MCP 注入的 `assertPaperExists` 校验 paper（`global-notes` 除外，`PAPER_NOT_FOUND`）；`updateNote` 仅在显式移动文件夹时校验，历史 dangling folder 不阻塞其他字段更新。用例见 `tests/noteStore.test.ts`、`tests/knowledgeMcpNotesWrite.test.ts`。 |
| D6-12 | P3 | fixed | 已按 4A-3 小批修复：草稿持久化到 `localStorage`（容量上限/淘汰/配额重试，损坏值清理），`beforeunload`、`pagehide`、`visibilitychange(hidden)` 与切换笔记时冲刷；跨实例恢复、配额与超大草稿用例见 `tests/noteEditorUtils.test.ts`。 |
| D6-13 | P3 | fixed | 第 8 批完成：查询触发键只含用户筛选/排序/搜索/分类，MinerU 状态发现不推进查询代次；选择清空与 select-all 守卫移除 `mineruIdKey`，状态发现不再清空选择；仅当「MinerU 已解析」筛选开启时，在发现结束后做一次尾部刷新（`source:'status'`、保留选择）。用例见 `tests/libraryQueryPolicy.test.ts`、`tests/selectionFilterGuard.test.ts`。 |
| D6-14 | P3 | fixed | 第 8 批核验：`buildManualMetadataUpdateRequest` 已把 publisher/volume/issue/pages/issn 纳入 `changed` 判断（第 7 批顺带完成，本次补证据）；函数移到 `src/features/literature/manualMetadataPatch.ts` 并补「五项均写入 / trim 相同不写 / 单字段变化」用例，见 `tests/metadataManualPatch.test.ts`（3）。 |
| D3-12 | P3 | fixed | 第 8 批完成：`search_notes` schema 的 `pageKind` 允许 `''`（清除筛选），并声明 `tag`/`type`/`noteIds`/`linkedPaperId`；`searchNotesKeyword` 同步支持四类过滤（keyword 降级路径不再忽略）。契约与行为用例见 `tests/knowledgeMcpNoteStructured.test.ts`、`tests/mcpContract.test.ts`。 |
| D4-8 | P3 | fixed | 第 6 批完成：删除零引用的 `src/stores/useReaderBridgeStore.ts` 与 `tests/readerBridgeStore.test.ts`；`Reader.tsx` 的 `readerBridges` + `handleBridgeStateChange` 成为唯一实现。新增 `tests/rendererDeadModules.test.mjs` 断言无引用且 `src/stores` 无零引用模块。 |
| D7-13 | P3 | fixed | 第 10 批完成 MinerU 表格/滚动条语义令牌与零引用清理；第 11 批把 `tailwind.config.ts` 三个悬空映射改到现有令牌（`elevated→--pq-bg-elevated`、`text-quaternary→--pq-text-faint`、`accent-text→--pq-accent`），守卫解析配置的 46 个 `var(--pq-*)` 引用、要求随主题令牌在 `:root`/`.dark` 双声明，并用合成配置负向断言删除最后一个引用所在声明必须失败。见 `tests/uiDesignTokens.test.ts`。 |
| D8-10 | P3 | fixed | 第 10 批完成：translationBatch/notesSidebarSearch/readerSettingsHydration/knowledgeGraphCommands/readerTranslationCache 的固定延时改为轮询断言或 `setImmediate` 让出；保留临时目录重试守卫。`readerSettingsHydration` 实际从 500ms 固定等待改为 `waitFor`（记录原写 100/50ms，2026-11-24 复核按 `git show HEAD` 更正）。 |
| D8-12 | P3 | fixed | 第 5 批完成：TOOLS/handler 抽到 `electron/mcp/mcpTools.cjs`，`tests/mcpContract.test.ts` 枚举 28 个工具的 schema/handler、默认值、required、tools/list/call 与错误码。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D8-14 | P3 | fixed | 第 5 批完成：新增 `scripts/bundleMcpConfig.cjs`，`bundleMcp({outDir})` 与测试共用同一 esbuild 配置；`tests/mcpBundleConfig.test.ts` 不再复制配置。见 `docs/changes/2026-11-23-audit-batch5-settings-shared-domain.md`。 |
| D4-14 | P3 | fixed | 第 7 批完成：阅读进度事件携带 paperId，列表按 id 取摘要原位合并 + 代次守卫；分类不再重查，只有 `readStatus`/`recentlyRead`/按最近阅读排序时才全量刷新。用例见 `tests/libraryQueryRefresh.test.ts`、`tests/libraryIncrementalRefresh.test.ts`。 |
| D3-13 | P3 | fixed | 第 10 批完成 `bundle-manifest.json`、afterPack stale 拒绝与 APPIMAGE 稳定目录；第 11 批补 `prepareMcpRuntimeDirectory` 的 `reason`（missing-target/missing-source/entry-missing）、`resolveMcpRuntimeMount`/`shouldPrepareMcpRuntime`（APPDIR-only 也准备稳定目录）、只有 `prepared:true` 才用稳定入口、失败时 console.warn 并明确回退挂载；`mcpRuntime.mode` 区分 stable/appdir/mount/installed/source，设置页只对 appdir/mount 显示双语告警，普通安装包不误报。用例见 `tests/mcpClientConfigEnv.test.ts`、`tests/mcpRuntimeNotice.test.ts`。 |
| D8-11 | P3 | fixed | 第 10 批完成：afterPack 与 `Build-Local.ps1` 对 Windows 非 x64 显式拒绝并说明 sqlite-vec 0.1.9 仅有 `sqlite-vec-windows-x64`；Build-Local 删除重复的 `npm run build`（`electron:build` 已包含）。 |
| D8-13 | P3 | fixed | 第 10 批完成：`devDependencies` 显式声明 `builder-util`、`app-builder-lib`、`electron-winstaller`（另加 afterPack 使用的 `@electron/asar`），`package-lock.json` 已离线同步。 |
| D8-9 | P3 | fixed | 已修复（本轮核验通过） |
| D7-11 | P3 | fixed | 第 10 批完成：`tests/uiContrast.test.ts` 计算 kicker（`--pq-text-primary` on `--pq-accent-bg` 合成到 `--pq-bg-secondary`）对比度；浅色 14.32:1、深色 9.90:1，均 ≥4.5:1；数值写入测试与设计文档（CSS 注释只覆盖焦点环，2026-11-24 复核更正）。 |
| D7-12 | P3 | fixed | 已修复（本轮核验通过） |
| D7-5 | P3 | fixed | 已修复（本轮核验通过） |

---

## 5. 建议批次

前置动作：第 1–3 批已提交（`c3eec8d`/`a6feee0`/`315971b`，另有文档提交 `22c900b`），第 4–12R 批仍在工作区。发布 0.4.38 前按以下清单暂存：只排除 `scripts/` 下未跟踪个人脚本与数据（87 个）、`.verification-*`、`.codex-temp`、`tests/knowledgeMcpFigure.test.ts`；必须纳入已跟踪的 `scripts/bundle-mcp.cjs`、`scripts/Build-Local.ps1`，以及新增的 `scripts/bundleMcpConfig.cjs`、`scripts/bundle-preload.cjs`（`package.json` 的 `build`/`dev`/`electron:build` 直接调用，缺失会让干净检出的 `npm run build`、`npm run mcp:bundle` 与测试失败）、`eslint.config.js`（`npm run lint` 与 `build.yml` 依赖）、`electron/mcpBundleManifest.cjs`、`tsconfig.checkjs.json`、`tsconfig.tests.mjs.json`、`docs/typecheck-backlog.md`、脱敏后的 `docs/assets/audit-2026-11-24/`、全部测试与文档。提交前先做干净检出验证：因改动未提交，第 12R 批用 `git ls-files -co` 逐文件复制到仓库外临时目录（排除个人脚本与 `tests/knowledgeMcpFigure.test.ts`），再执行 `npm ci && npm run typecheck && npm run lint && npm run build && npm test`；提交后可改用 `git archive`。不得使用 `git add -A`；建议在 `.gitignore` 增加 `.verification-*/` 与 `.codex-temp/`。

**已完成的小批**：4A-1（2026-11-23）完成 D1-2、D1-6、D1-11 三项主进程边界，详见 [变更记录](../changes/2026-11-23-audit-batch4a1-main-boundaries.md)；4A-2（2026-11-23）完成 D1-10、D2-10、D3-8 三项后端耐久性与资产边界，详见 [变更记录](../changes/2026-11-23-audit-batch4a2-backend-durability.md)；4A-3（2026-11-23）完成 D5-7、D6-12、D4-7 三项阅读/笔记正确性并闭环 D1-6、D1-10 的两个残留，详见 [变更记录](../changes/2026-11-23-audit-batch4a3-reader-notes-residuals.md)；4B-1（2026-11-23）完成 D1-8、D1-9、D1-5 三项启动/外壳与资产边界，D1-13 转 partial（CSP/权限已补，sandbox/ASAR 登记为风险），并闭环 D1-6 的 stage 残留，详见 [变更记录](../changes/2026-11-23-audit-batch4b1-startup-shell.md)；4B-2（2026-11-23）完成 D2-11、D2-12、D2-13 三项外部 I/O 与备份（Zotero WAL 一致快照、元数据/下载/导入限额、硬链接回退与 worker 校验），详见 [变更记录](../changes/2026-11-23-audit-batch4b2-external-io-backup.md)；4B-3（2026-11-23）完成 D3-4、D3-11、D3-14 三项 MCP 数据一致性（读工具不建库、外部写标记原子递增、笔记目标校验），第 4 批收口，详见 [变更记录](../changes/2026-11-23-audit-batch4b3-mcp-consistency.md)；第 5 批（2026-11-23）完成 D4-5、D5-14、D3-9、D3-10、D8-12、D8-14、D1-14、D8-7 八项单一设置存储与桌面/MCP 共享域，详见 [变更记录](../changes/2026-11-23-audit-batch5-settings-shared-domain.md)；第 6 批（2026-11-23）完成 D2-14、D4-8、D4-10、D4-11、D5-12、D5-13、D7-14 七项 S2 巨组件/巨模块拆分，详见 [变更记录](../changes/2026-11-23-audit-batch6-god-component-split.md)；第 7 批（2026-11-23）完成 D2-2、D2-8、D2-9、D3-5、D4-13、D4-14、D5-8、D5-10、D6-5、D6-6、D6-7、attachment-filter-stat-storm、vault-autosync-main-thread 十三项性能与 S5 三处热点，详见 [变更记录](../changes/2026-11-23-audit-batch7-performance.md)；第 8 批（2026-11-23）完成 D3-6、D3-7、D3-12、D5-5、D5-6、D5-9、D6-7（Notes 侧）、D6-9、D6-13、D6-14、vault-autosync-main-thread，并收口 S5 笔记残留与第 7 批的 D6-5/D2-2/D5-13 残留；D2-5 与 D4-6 经复核转 partial，详见 [变更记录](../changes/2026-11-23-audit-batch8-reading-notes-correctness.md)。第 9 批（2026-11-23）完成 D2-5、D7-6、D7-7，补图谱 Worker 超时看门狗，D7-4/D7-11/D4-9/D4-6 仅增量，详见 [变更记录](../changes/2026-11-23-audit-batch9-ui-engineering.md)。第 10 批（2026-11-23）完成 D4-6、D7-4、D7-11、D7-13、D3-2、D3-13、D8-4、D8-6、D8-10、D8-11、D8-13 与第 8/9 批 minor 残留；2026-11-24 复核后 D4-6、D7-13、D3-13 转 partial，详见 [变更记录](../changes/2026-11-23-audit-batch10-engineering-packaging.md)。后续批次按下表第 12 批起排期。

| 批次 | 主题 | 条目 | 目标 |
| --- | --- | --- | --- |
| 第 4 批（已完成） | 安全与数据收尾（D1 边界由 4A/4B-1 完成；D2-11/12/13 由 4B-2 完成；D3-4/11/14 由 4B-3 完成） | D3-4、D3-11、D3-14 | 已收口：Zotero 快照与元数据超限、并发修订覆盖、MCP 读建库与笔记目标校验 |
| 第 5 批（已完成） | 设置与共享域（S4 → S3） | D4-5、D5-14、D3-9、D3-10、D8-12、D8-14、D1-14、D8-7 | 已收口：单一 settings store + 迁移；embedding/检索/导入共享；28 工具契约测试；IPC registry；Electron 集成测试 |
| 第 6 批（已完成） | 巨组件拆分（S2） | D2-14、D4-8、D4-10、D4-11、D5-12、D5-13、D7-14 | 已收口：rag/library 分层、reader/pdf/literature 目标 hook、notes editor 六模块、QA 按 tab 分片、死 store 删除、按钮原语与 960px 响应式；显式 effect 顺序保持，跨 hook 顺序偏差与行为用例见变更记录 |
| 第 7 批（部分收口） | 性能（S5 + 附录性能项） | D2-2、D2-8、D2-9、D3-5、D4-13、D4-14、D5-8、D5-10、D6-5、D6-6、D6-7、attachment-filter-stat-storm、vault-autosync-main-thread | 已收口：首屏分页与 Reader 按需解析、MCP 批量 KNN/worker 超时重建、PDF 主进程解析、阅读进度增量刷新、单事务批量命令、5000 行虚拟化、fcose Worker + top-degree/相似度上限、笔记节流签名、附件 stat 缓存；D6-7 仅完成 library 部分（Notes folder 计数/1000 条上限未改），vault 转 partial（in-flight 取消与 stall 断言待补） |
| 第 8 批（部分收口） | 阅读/笔记正确性 | D3-6、D3-7、D3-12、D5-5、D5-6、D5-9、D6-7、D6-9、D6-13、D6-14、vault-autosync-main-thread | 已收口：笔记结构化 round trip、文件夹版本全覆盖、search_notes 契约补齐、翻译缓存键与清除/合并锁、QA busy 标签、Notes 计数与分页、隐藏详情快捷键、筛选/状态发现分流、元数据字段证据、vault 取消与 <16ms 让步；并清理 D6-5 文件/RAG 事务顺序、D2-2 死回调与整库 load、D5-13 data 签名。复核发现 D2-5 的 MCP keyword 0 行回退与 D4-6 的 `papersRefreshing`/首屏窗口仍有缺口，转 partial 并入第 9 批 |
| 第 9 批（部分收口） | UI 与工程化收尾 | D4-9、D7-4、D7-6、D7-7、D7-9、D7-11、D7-13、D3-2、D3-13、D8-4、D8-6、D8-10、D8-11、D8-13、D2-5、D4-6 | 完成 D2-5、D7-6、D7-7；D7-4、D7-11 只改实现而缺对比度计算用例；D4-9 与 D4-6 仅做增量并保留 partial；补图谱 Worker 看门狗。明细见[第 9 批记录](../changes/2026-11-23-audit-batch9-ui-engineering.md) |
| 第 10 批（已完成，复核后 3 项转 partial） | 工程化、打包与状态收尾 | D4-6、D7-4、D7-11、D7-13、D3-2、D3-13、D8-4、D8-6、D8-10、D8-11、D8-13 + 第 8/9 批 minor 残留 | 初版收口：工具栏刷新状态与首屏竞态、对比度计算、语义令牌、MCP worker/manifest/AppImage、依赖闭包与 asar 断言、checkJs allowlist、确定性测试、arm64 拒绝/构建清理/devDependencies、笔记 tiebreaker/节流保存/typed IPC/linkedPaperId/2M 截断/元数据 patch 去重/焦点陷阱与图谱看门狗用例。2026-11-24 复核将 D4-6、D7-13、D3-13 转 partial，其余 CONFIRMED；初版计数 fixed 90 / partial 3 / open 0。详见[第 10 批记录](../changes/2026-11-23-audit-batch10-engineering-packaging.md) |
| 第 11 批（已完成） | i18n、列表 a11y、S5 图谱基准与第 10 批复核残留 | D3-13、D4-6、D4-9、D7-9、D7-13（+ S5 图谱/虚拟列表） | 已收口：NotesWorkspace/编辑器/服务层错误码与 vault 文案全量双语，未命名笔记不再写哨兵；列表 `role=list/listitem`、aria-setsize/posinset、跨虚拟窗口键盘漫游与行回调稳定化；S5 默认每节点 250 边分档基准、2000 候选/768 维基准（756–767ms）、fcose/cose-base/layout-base 动态 chunk；同分类点击残留 skip、tailwind 三处悬空令牌、AppImage prepared:false 告警/APPDIR 稳定目录与 MCP 设置页 runtime 告警全部闭环。结果 fixed 92 / partial 1（D1-13）/ open 0，详见[第 11 批记录](../changes/2026-11-24-audit-batch11-i18n-a11y-s5.md) |
| 第 12 批（已完成，复核后 5 项转 partial） | §3 验收缺口 | A6、B1、E5、S1、E4/E1、F2/§8、F4、D1-13 | 初版收口：RetainPDF 详情面板、mineruCacheCommands 统一 pathPolicy + 重新授权引导、模板/系统页/聚合稿本地化、3 次中位数对比、axe 10 视图双主题、NSIS 构建 + payload 冒烟、ESLint/CI/checkJs、sandbox + 自包含 preload + ASAR 完整性。2026-11-24 独立复核：A6/F4 CONFIRMED；B1（父目录授权扩散、译版目录状态矛盾）、E4/E1（Graph 深色标签、axe incomplete 误判/覆盖不足）、E5（vault 参考文献重复、摘录卡中文）、S1（基线已含第 3 批 S1、量化误差）、文档同步转 partial；F2 保持 partial；D1-13 保持 partial。详见[第 12 批记录](../changes/2026-11-24-audit-batch12-acceptance-release.md) |
| 第 12R 批（已完成） | 第 12 批复核阻塞项 | B1、E4/E1、E5、S1、F2/§8、文档同步、D1-13 验证补强 | 已收口：目录授权只登记自身并补父目录回归、vault 参考文献去重与摘录卡本地化、Graph 标签改双 hex、axe 16 视图保留 incomplete 详情、审计资产与冒烟报告脱敏、§5 纳入清单、0.4.38 版本/CHANGELOG/release-notes；A6 补切换文献集成测试、F4 补 release.yml lint 与 250 合计；以 `1283d82` 重测 S1 并记录哈希/方差。详见[第 12R 批记录](../changes/2026-11-24-audit-batch12r-release-blockers.md) |

第 12R 批后：A6、F4、E4/E1、E5、B1、S1、文档同步回到 fixed；F2/§8 保持 partial（注册式安装与备份导入未验证）；D1-13 保持 partial（签名/发布流水线未验证）。0.4.38 待核验方复核后提交发布。本批未改数据层（schema / `user_version`）。

---

## 6. 验收要求

1. **每批改动**：`npm run build` + `npm test` 通过；新增用例覆盖「触发条件 + 负向路径」；UI 改动补浅色/深色截图。
2. **安全类**（第 4 批）：每个边界补越权/越界用例，不接受仅文档说明；恢复目标必须绑定主进程授权。
3. **S4**：验收「Notes 设 apa7 → Reader 任意设置写/重启 hydrate → 仍为 apa7」，并覆盖版本迁移与冲突。
4. **S3**：枚举 28 个 MCP 工具的 schema/handler 契约；同一输入桌面与 MCP 返回一致结构；删除重复实现后覆盖率不下降。
5. **S2**：只移动代码与改内部接口，不同时改行为；每步独立提交，保持测试全绿；补结构/契约测试证明拆分边界。
6. **S5**：用 `PAPERQUAY_PERF=1` / `localStorage['pq.perf']='1'` 记录改造前后数据；验收 5000 行列表 ≥50fps、10k 节点首屏 <2s、8 截图笔记单键 <50ms。第 7 批结果：5000 行在 800px 视口下最多渲染 19 行、窗口计算 16.92ms/875 个滚动位置；10k 节点 headless fcose 998ms；8 张 256KB 截图单键 0.85–1.08ms。第 8 批笔记结果：元数据按键 0.0005–0.0018ms/键且 0 次 `getJSON`，8 图节流按键 0.85–1.42ms，8 图草稿可持久化；vault 1000 文件假 IO 最大停顿 3.98ms。Electron 实际 fps 未测，保留为验收缺口。
7. **发布前**：安装版冒烟覆盖中文 CID 字体 PDF、Vault 同步、RetainPDF、MCP `read_paper_figure` 与备份恢复。

---

## 7. 明确不做

- 不改文库、RAG、笔记 schema 与 `user_version`；不回写用户数据。
- 不重做 Agent/检索/笔记架构；S2/S3 只做结构拆分与共享模块抽取。
- 不把已登记的设计例外（图谱节点菜单、语义令牌未覆盖的 `dark:*`、accent/success 对比度约束）当作缺陷。
- 不删除或提交 `scripts/` 下的未跟踪个人脚本与数据。
- 不把已 fixed 的条目重新排期；如需回归，只补测试，不重复改动。

---

## 8. 核验限制

- 本清单基于 2026-11-24 工作区源码逐条阅读；第 12 批已执行真实 Electron axe 扫描（10 视图 0 violations）、NSIS 构建、安装包 payload 冒烟与性能对比。注册式 NSIS 安装、安装版备份导入、代码签名/公证、mac/Linux 仍未验证，相关限制见 §3 第 6 行与第 12 批记录。
- `npm test` 全绿只证明现有测试集合通过，不证明每个条目都没有运行时复现；第 10 批先写失败/基准用例并用只读 verifier 复核；2026-11-24 的 15 个只读 verifier 发现 D4-6 同分类点击、D7-13 tailwind 悬空引用、D3-13 静默回退三处缺口。第 11 批经过多轮复核（10 verifier → 6 verifier → 2 delta verifier → 2 residual recheck），把未命名笔记哨兵、真实 IPC 错误码、MCP runtime 误报、块菜单/锚点/图谱画布与选中边旧标题、阅读侧定位文案等残留逐一关闭。第 12 批的 6 个只读 verifier 复核出 A6 跨文献串台、B1 迁移源读校验、E5 斜杠英文标题/实时语言/系统页历史三处 major，均已修复并补用例；最终 `npm test` 1,463 项（1,454 通过、9 跳过、0 失败），`npm run typecheck` 六项目 0 诊断，`npm run build`、`npm run mcp:bundle`、`npm run lint`（0 error/206 warning）通过。第 12 批全量测试曾出现 1 次 retainPdf ENOTEMPTY 与 3 次 afterPack 夹具缺失（后者为真实回归，已修），单测复跑与最终全量通过。第 12R 批全量首次出现 1 次 retainPdf ENOTEMPTY（Windows %TEMP% 清理偶发，单测复跑通过）与 1 次 knowledgeGraphCommands EPERM（同属临时目录锁，单测复跑通过），最终全量 1,492 项 0 失败。第二轮 8 个只读 verifier 又发现 E5 围栏/列表边界、B1 OS 不可读与写校验、A6 加载快照覆盖等缺口，已修复并补用例；checkJs 全量仍有 281（electron/bin）与 52（tests mjs）个错误，allowlist 之外的代码未纳入类型门禁。
- 第 4–12R 批改动未提交（第 1–3 批已提交）；提交后行号可能位移，实施前以当时源码复核为准。
- 第 7–8 批性能数字在 Node 24.19 / Windows 11 上测得；第 12R 批性能对比改用审计前 `1283d82`，同机 before/after 交替各 3 次，记录 `--no-sandbox --disable-gpu --disable-crash-reporter --disable-breakpad`、dist/preload 哈希与方差；Notes/Graph 首次打开因工作区惰性加载高于基线（100/60ms vs 19/26ms），已如实记录；第 11 批图谱分档基准中 500k/1.25M 两档需 `PAPERQUAY_PERF=1`，普通 `npm test` 只跑 125k 档；渲染层 fps 与安装版首屏仍未测。
- 附录 A 93 条已全部覆盖，无遗漏项。
