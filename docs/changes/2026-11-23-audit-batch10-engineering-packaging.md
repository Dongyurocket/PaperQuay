# 第 10 批：工程化、打包与状态收尾

日期：2026-11-23。未提交、未 push；本批未改 SQLite schema / `user_version`（工作区第 4B-3 批已有 `external_writes` 表；`PRAGMA user_version = 1` 从 `backupSources.cjs` 移到 `backupDatabaseWorker.cjs`，值未变），未写用户数据；未动 `scripts/` 未跟踪资产、`.verification-*`、`.codex-temp`、`tests/knowledgeMcpFigure.test.ts`。

## 本批已完成

### D4-6 首屏与刷新状态（初版 fixed；2026-11-24 复核转 partial）

- `LiteratureToolbar` 现在实际渲染 `refreshing`：常驻 `role="status"` + `aria-live="polite"` 区域，刷新时显示「正在刷新…」，空闲时为空；列表仍只在 `loading`（首屏）时显示加载提示卡片，后台刷新保留旧行。
- 首屏跳过条件改为按键比较：初始化完成后用 `loadLibraryFirstScreen` 解析出的 `initialCategoryId`（以及本次查询的筛选/排序/搜索快照）记录条件键——挂载时的分类是 `null`，不能直接用它。`skipNextDebouncedQueryRef` 支持两种模式：首屏键相同才跳过；分类点击因已直接查询而无条件跳过。初始化期间用户改筛选/搜索/排序/分类时，防抖查询照常执行，不再被吞掉。
- 并发刷新改为闸门计数：`refreshGateRef`（`begin()`/`end()`）只在最后一个刷新结束时清除 `papersRefreshing`，先结束的 `finally` 不会提前关闭状态提示。
- 用例：`tests/literatureToolbarRefresh.test.mjs` 用 esbuild + `react-dom/server` 实际渲染工具栏与列表——刷新时保留 `Retained paper` 行且显示「正在刷新…」，首屏 loading 才显示加载卡片；`tests/libraryQueryPolicy.test.ts` 覆盖首屏条件变化、分类无条件跳过、并发闸门，并用源码守卫锁定 `initialCategoryId` 与两种 skip 模式的接线。
- **复核缺口（2026-11-24）**：点击已选分类或双击分类时，`handleSelectCategory` 仍写入 `{kind:'unconditional'}`，但 `selectedCategoryId` 与条件键不变，防抖 effect 不会重跑消费该 skip；下一次筛选/搜索/排序变化会被陈旧 skip 吞掉（jsdom 动态复现查询数 +0），双击还会对同一分类发两次请求。现有测试为 SSR 静态渲染与源码正则，未捕获该路径；D4-6 转 partial，修复与行为用例并入第 11 批。

### D7-4 / D7-11 对比度计算（fixed）

- 新增 `tests/uiContrast.test.ts`：解析 `index.css` 的 `:root` / `.dark` 令牌与 `var()` 链，按 WCAG 相对亮度公式计算并合成 rgba。
- `.pq-input` 3px 实心 accent 环：浅色对 `--pq-bg-secondary` 3.43:1、对白底 3.74:1；深色 8.13:1 / 9.35:1，均 ≥3:1。全局 `:focus-visible` 2px outline 最低为浅色 3.43:1、深色 8.13:1。
- kicker（`--pq-text-primary` on `--pq-accent-bg` 合成到 `--pq-bg-secondary`）：浅色 14.32:1、深色 9.90:1，均 ≥4.5:1。焦点环数值写入 `index.css` 注释；kicker 数值与深色下限（8.1/9.3/9.8）写入测试与 `docs/ui-design-system.md` §1.7（2026-11-24 复核指出 `index.css` 注释未含 kicker，§1.7 未逐列 3.74/9.35）。
- 本轮令牌无需加深；测试对浅/深主题都设有明确下限（深色输入环 ≥8.1、outline ≥8.1、kicker ≥9.8），令牌或环宽变化导致明显回退时失败。

### D7-13 语义令牌（初版 fixed；2026-11-24 复核转 partial）

- `.mineru-table` 的硬编码 hex/rgba 全部改为 `--pq-table-*`（text/head-text/head-bg/border/row-alt-bg/row-hover-bg），滚动条改为 `--pq-scrollbar-thumb(-hover)`；浅/深各一组，删除仅用于覆盖颜色的 `.dark .mineru-table` 重复规则。
- 删除 12 个令牌，其中 9 个全仓零引用；`--pq-surface-elevated`、`--pq-text-quaternary`、`--pq-accent-text` 仍被 `tailwind.config.ts:17/26/38` 的 `paper.elevated`/`paper.text-quaternary`/`paper.accent-text` 映射以 `var()` 引用（2026-11-24 复核发现），这 3 个删除属悬空引用，D7-13 转 partial。其余删除：`--pq-accent-light`、`--pq-teal`、`--pq-success-button-bg/-bg-hover/-text`、`--pq-motion`、`--pq-motion-slow`、`--pq-bg-solid`、`--pq-bg-subtle`；同步删除零引用类 `.pq-chat-bubble-assistant`、`.pq-agent-workspace`、`.pq-agent-pane`、`.pq-chat-pane`（`.pq-focus-ring-reset` 只存在于注释，已改写）。
- `tests/uiDesignTokens.test.ts` 新增两条守卫：所有已声明令牌必须被引用（含令牌间引用）；MinerU 表格与滚动条规则不得出现裸 hex/rgba，且表格/滚动条令牌必须在两套主题都定义。`docs/ui-design-system.md` 删除已删令牌、新增 §1.6 表格与滚动条、§1.7 焦点环/kicker 对比度。

### D3-2 MCP bundle 携带 ragWorker（fixed）

- `scripts/bundleMcpConfig.cjs` 新增 worker 入口 `electron/backend/ragWorker.cjs` → `packaging/mcp/ragWorker.cjs`，与 server 共用 external/target（`sqlite-vec` 仍外置）。
- `scripts/bundle-mcp.cjs` 同时构建 server 与 worker；`electron/afterPack.cjs` 断言 `ragWorker.cjs` 存在。
- `tests/mcpBundleConfig.test.ts` 新增 worker 入口/产物/自带依赖用例；`tests/mcpRagWorkerBundle.test.ts` 用 `bundleMcp` 生成安装版布局并复制到仓库外临时目录，直接 spawn 该 worker：`indexNote` 走本地假 embedding 服务写入向量、`getDocumentIndexStatus` 返回 ready、`close` 正常，证明笔记向量索引依赖闭包完整；临时目录隔离，不读写用户数据。

### D3-13 AppImage 与 bundle manifest（初版 fixed；2026-11-24 复核转 partial）

- 新增 `electron/mcpBundleManifest.cjs`：`bundle-manifest.json` 记录 schema、版本、源入口 `bin/paperquay-mcp.cjs` 的 sha256、`server.cjs`/`ragWorker.cjs` 产物 sha256 与工具数（28）。`bundleMcp` 写入；`afterPack` 复核，stale（入口/产物/版本/工具数不一致）直接拒绝打包。
- `mcpClientConfig` 优先使用 `process.env.APPIMAGE` 作为 command，`APPDIR` + 可执行文件名次之；AppImage 下用 `prepareMcpRuntimeDirectory` 把 bundle 复制到用户数据目录 `mcp-runtime`（以 manifest 判断是否需重拷，并在入口缺失时回退），`createMcpClientConfigCommands` 在准备成功时传入稳定 `installedEntry`，APPIMAGE 主路径的 snippet command/args 不再指向 `/tmp/.mount_*`。**复核缺口（2026-11-24）**：`prepareMcpRuntimeDirectory` 返回 `{prepared:false}`（源入口缺失或目标入口丢失）时无告警，handler 仍把挂载路径当 `installedEntry`；仅设 `APPDIR` 时 command 走稳定路径但 args 仍指向挂载目录。D3-13 转 partial，告警/条件安装目录与用例并入第 11 批。
- 用例：`tests/mcpBundleManifest.test.ts`（fresh/stale/缺 worker/版本变更）、`tests/mcpClientConfigEnv.test.ts`（APPIMAGE/APPDIR/稳定目录复制且只复制一次）。

### D8-4 依赖闭包（fixed）

- `electron/packagingDependencies.cjs` 改为：扫描 `electron/`、`bin/`、`src/shared/` 的实际 require 得到运行时根；按 Node 解析规则（含包内嵌套 `node_modules`）展开 `dependencies` + `optionalDependencies`；用 `build.files` glob（支持 `**` 跨目录、`sqlite-vec-*` 通配与负模式）逐个包验证覆盖。`RUNTIME_DEPENDENCIES` 仅作期望根清单，反向核对扫描结果，单独保留 `sql.js`（MCP 复制其 wasm 资产）。
- 审计发现真实漂移：`builder-util-runtime` 依赖的 `sax` 未被 `build.files` 覆盖，已补 `node_modules/sax/**/*`。运行时闭包当前 28 个包；`pdf-lib` 的嵌套 `pako`/`tslib`、`electron-updater` 的嵌套 `semver`/`builder-util-runtime` 均能正确解析与覆盖。测试覆盖“缺 build.files 覆盖”和“正向覆盖 + 后置负模式”两条失败路径。
- `afterPack` 增加真实安装目录断言：用 `@electron/asar` 读取 `resources/app.asar`（`uncacheAll` 防止同进程重建缓存），逐个闭包包断言 `package.json` 存在；`app.asar` 不存在时退回检查 `resources/app/`。electron-builder 会把包内嵌套依赖提升到 app 根（`pdf-lib/node_modules/pako` → `node_modules/pako`），断言同时接受精确路径与提升路径。`tests/mcpPackaging.test.ts` 用临时 asar 验证“完整通过 / 删包后拒绝”。

### D8-6 checkJs 增量（fixed）

- 新增 `tsconfig.checkjs.json`：`allowlist` 型 checkJs 项目，收录 26 个已清理的 `electron/` 文件（含本批新增 `mcpBundleManifest`、改动的 `mcpClientConfig`/`packagingDependencies`/`afterPack`/`mcpTools`）与 2 个被相对导入的 `src/shared` 实现（`mineruCachePaths.cjs`、`zoteroItemMetadata.cjs`；它们的 `.d.ts` 会遮蔽实现，必须显式纳入），依赖闭包内的文件全部 clean。
- 新增 `tsconfig.tests.mjs.json`：`allowJs + checkJs`，收录 11 个 `.mjs` 测试（含新增 `literatureToolbarRefresh`），其 import 闭包 clean。
- `npm run typecheck` 现为 6 个项目（原 4 个 + checkjs + tests.mjs）。
- “clean”指项目当前 `strict:false` 配置；同一 allowlist 在 `strict:true` 下仍有 354 个诊断（隐式 any 等），未宣称 strict-clean。
- 剩余并已记录：全量 `electron/` + `bin/` checkJs 仍有 298 个错误（knowledgeMcpService 53、libraryDomain 37、backupSources 17、ragSearch 14、noteStore 14、backupImport 13 等；`scripts/` 的 11 个错误由 `electron/build.cjs` 依赖拉入，不计入 allowlist）；`tests/**/*.mjs` 全量 checkJs 仍有 233 个错误（多数来自其 import 的 electron 模块）。未用 `any` 掩盖；新增代码以 JSDoc 明确形状。

### D8-10 测试确定性（fixed）

- `translationBatch`：取消后用一次 `setImmediate` 断言不再发起请求，去掉 150ms 固定等待。
- `notesSidebarSearch`：300ms 固定等待改为 `waitFor(calls.length === N)` 轮询（10ms/次，3s 超时）。
- `readerSettingsHydration`：500ms 固定等待改为 `waitFor(状态条件)` 轮询（记录原写 100/50ms，2026-11-24 复核按 `git show HEAD` 更正）。
- `knowledgeGraphCommands`：写进程观察循环的 4ms 定时改为 `setImmediate` 让出 I/O。
- `readerTranslationCache`：并发写用例的 `delay(5)` 改为 `setImmediate` 让出，锁负责串行化。
- 保留 `mcpClientLaunch`、`mcpBundleConfig`、`mcpRagWorkerBundle` 的临时目录创建/清理重试守卫（`mcpPackaging` 的 `mkdtemp` 清理仍是一次性 `rm`，不宣称有重试）。

### D8-11 / D8-13 构建（fixed）

- D8-11：`sqliteVecPlatformPackage` 对 `win32` 非 x64 显式抛错，说明 sqlite-vec 0.1.9 只有 `sqlite-vec-windows-x64`、需 `--x64` 或先做进程内回退；`scripts/Build-Local.ps1` 同样在参数层拒绝 arm64。
- Build-Local 删除重复的 `npm run build`（`electron:build` 已包含 `npm run build`）。
- D8-13：`devDependencies` 显式声明 `@electron/asar ^3.4.1`、`app-builder-lib ^26.8.1`、`builder-util ^26.8.1`、`electron-winstaller ^5.4.0`；`package-lock.json` 已离线同步（`npm install --package-lock-only --ignore-scripts --offline`）。

### 第 8/9 批 minor 残留

- `noteStore.listNotes` / `listAllNotes` 的 `ORDER BY` 增加 `id ASC` 唯一 tiebreaker；新增相同排序键下 a/b/c 确定性用例。
- NoteEditor：正文首键立即 `setLiveDirty(true)`，`dirty` 合并 live 标记；节流提交/保存成功/切换笔记时清除。Ctrl+S 与保存按钮在 120ms 窗口内可用；当前以源码守卫锁定接线（未做组件级行为测试）。
- `delete_text_file` 登记 typed args（`{ path: string }`，结果 boolean）并进入渲染层 `TYPED_IPC_COMMANDS`；补必填/类型负向用例。
- `native-library:` 空 id 现在返回 `false`（不再当成 global-notes）；`paperExists` 导出并补空 id/文库命中/查询失败用例。
- `updateNote` 在 `linkedPaperId` 显式变化时与 `paperId` 同样校验；`createNote` 也走同一 `assertNoteTargets`；`PAPER_NOT_FOUND` 负向用例覆盖 `updateNote` 的 `linkedPaperId`，`createNote` 的用例走 `paperId`（2026-11-24 复核指出没有 createNote + linkedPaperId 专用用例）。
- D3-6 补 >2M 字符用例：`get_note` 返回 `contentJson: null`、`contentJsonTruncated: true`、`contentFormat: 'text'`，分页文本仍可用。
- vault 性能用例标题改为「真实 fs 上限 24ms；16ms 假 IO 断言允许最多 3 次有界重试」，避免把单次测量写成确定性保证（2026-11-24 复核实测首轮可达 39.32ms）。
- 元数据 patch 去重：`manualMetadataPatch.ts` 成为手动/识别 patch 的唯一合并实现（复用 `metadataUpdateForPaper` + draft 标题/DOI + `expectedUpdatedAt`）；`paperMetadataRecognition.ts` 只 re-export；`useMetadataJobs` 的手动/识别路径与识别对话框共用；批量自动任务仍直接调用 `metadataUpdateForPaper`（2026-11-24 复核限定措辞）。
- D7-6 补 jsdom 行为用例 `tests/dialogFocusTrap.test.mjs`：打开聚焦首项、Tab/Shift+Tab 双向循环、`tabindex=-1` 选项被排除；保留源码选择器守卫。
- S5 看门狗：`createWorker` 返回 null 后下一次请求重试创建；旧 Worker 的迟到 `onerror` 按实例身份丢弃，不会终止新 Worker；`tests/graphLayout.test.ts` 补两组用例。

## 明确保留

- 附录 A 初版为 fixed 90 / partial 3 / open 0；2026-11-24 复核后为 **fixed 87 / partial 6 / open 0**，新增 partial：
  - **D1-13**：渲染器 `sandbox:true` 与 `enableEmbeddedAsarIntegrityValidation` 仍未启用（发布流水线/安装版冒烟）。
  - **D3-13**：`prepareMcpRuntimeDirectory` 的 `prepared:false` 静默回退；仅 APPDIR 时 args 仍指向挂载目录。
  - **D4-6**：同分类点击/双击残留 `unconditional` skip，吞下一次筛选/搜索/排序查询。
  - **D4-9 / D7-9**：Notes i18n 与服务层错误码/模板文案未全量收口，留第 11 批。
  - **D7-13**：`tailwind.config.ts` 仍引用 3 个已删除令牌。
- 第 11 批：D3-13/D4-6/D4-9/D7-9/D7-13、列表虚拟化 a11y（aria-setsize/posinset、键盘漫游）、S5 图谱最坏边数/768 维基准与 fcose 动态加载；完成后目标 fixed 92 / partial 1（D1-13）/ open 0。
- 第 12 批补 §3 验收缺口：A6 RetainPDF UI、B1 首次启动重新授权、E5 模板、S1 性能对比、axe/双主题截图、安装版 §8.6 冒烟、F4 剩余 checkJs（298 electron/bin、233 tests mjs）分批开放与 lint/CI、D1-13 的 sandbox/ASAR 完整性。
- 本批未运行安装包/真机 UI/axe；`npm run mcp:bundle` 只验证 bundle 产物与 manifest，不证明 NSIS/AppImage 实机启动。

## 独立复核（2026-11-23）

7 个只读 verifier（6 个技术领域 + 1 个状态核对）复核本批声明，发现并修复：

- **D4-6（实质缺陷）**：首屏记录的条件键用了挂载时的 `selectedCategoryId`（`null`），而首屏查询实际使用 `loadLibraryFirstScreen` 解析出的 `system-all`，键永远不相等，跳过逻辑失效且分类点击会重复查询。已改为记录 `initialCategoryId`，并把 skip 建模为 `first-screen`（键相等才跳过）/`unconditional`（分类点击）两种模式；工具栏/列表用例改为实际渲染列表并断言旧行保留；新增条件键、分类跳过与闸门计数用例。
- **D8-4**：`RUNTIME_DEPENDENCIES` 注释误称“动态得出”，已改为“期望根清单”并增加反向核对（`sql.js` 例外）；`build.files` 覆盖改为正/负模式同时生效，补“缺覆盖”和“正向 + 后置负模式”失败用例；`afterPack` 同时接受 electron-builder 的嵌套依赖提升布局，并补 `resources/app/` 回退用例。
- **D8-6**：补入被 `.d.ts` 遮蔽的 `src/shared/mineruCachePaths.cjs`、`zoteroItemMetadata.cjs` 实现；明确“clean”仅指项目当前 `strict:false`（strict 下仍有 354 个诊断）。
- **D3-13**：补 toolCount 漂移用例、稳定目录重拷与入口缺失回退用例；worker 回归改为复制到仓库外临时目录启动，避免回退到仓库 `node_modules` 解析 external。
- **D7-4/11/13**：为深色主题增加明确下限（输入环 ≥8.1、outline ≥8.1、kicker ≥9.8）；滚动条规则也禁裸 hex；令牌“两套主题都定义”改为分别解析 `:root` 与 `.dark` 块（先剥离注释，避免 `--pq-{semantic}` 的 `}` 截断块）。
- **D8-10/minor**：焦点陷阱用例把 `tabindex=-1` 选项移到 Last 之后，使 Shift+Tab 的断言真正证明它被排除，并把固定 30ms 等待改为轮询；修正 scratch 重试守卫的表述；liveDirty 明确为源码守卫而非组件行为测试。
- **状态核对**：附录 93 条计数与逐行状态一致（fixed 90 / partial 3 / open 0），未发现 schema/user_version 改动，也未发现把安装版/真机结论写进记录；strict 诊断数按当前 28 文件 allowlist 重新实测为 354（原写 322 是加 `src/shared` 实现前的旧值），已修正；F4 checkJs/lint 原先未列入第 12 批，已补入。

## 独立复核（2026-11-24）

15 个只读 verifier（8 个领域 + 非 CONFIRMED 对抗复核 + 完整性批评）复核第 10 批；机械验证在本机重跑：`npm run typecheck` 六项目 0 诊断、`npm test` 1,315 项（1,309 通过、6 跳过、0 失败）、`npm run build`、`npm run mcp:bundle` 通过，`git diff --check` 通过。

- **CONFIRMED**：D7-4/D7-11 对比度独立复算（3.4322/3.7443/8.1298/9.3497/14.3207/9.9029）；D8-4 依赖闭包（28 包、含 sax，实际 `app.asar` 1709 条目中 28 包全部可解析）；D8-6 六项目 typecheck 与 allowlist 计数（26 electron + 2 src/shared、11 mjs）；D8-10 目标测试去固定延时；D3-2 worker bundle 在仓库外启动；D7-6/D7-7 与 minor 用例；D4-6 的 A1/A2/A4/A5 子项。
- **转 partial**：D4-6（同分类点击/双击残留 skip，吞下一次筛选/搜索/排序查询，双击重复请求；现有测试为 SSR 静态渲染与源码正则，未捕获）；D7-13（`tailwind.config.ts:17/26/38` 仍引用已删除的 `--pq-surface-elevated`、`--pq-text-quaternary`、`--pq-accent-text`，守卫只扫 `src/`/`electron/`）；D3-13（`prepared:false` 静默回退，handler 仍把挂载路径当 `installedEntry`；仅 APPDIR 时 args 仍指向挂载目录）。
- **记录更正**：`readerSettingsHydration` 实际是 500ms（不是 100/50ms）；kicker 数值只在测试/文档、不在 `index.css` 注释；`createNote` + `linkedPaperId` 无专用负向用例；`manualMetadataPatch` 的“唯一实现”仅指手动/识别 patch；vault 16ms 断言允许有界重试。
- **打包补证**：只读调用 afterPack 四项断言（MCP sqlite-vec、bundle manifest、PDF.js、28 个运行时包）全部通过；`app.asar` 内嵌 `dist/index.html` 与磁盘 sha256 一致；`PaperQuay.exe` + `ELECTRON_RUN_AS_NODE=1` 启动 server 返回 0.4.37/28 工具；release 副本 `ragWorker.cjs` 的临时 RAG 库冒烟未做。
- **提交提醒**：`scripts/bundleMcpConfig.cjs`、`electron/mcpBundleManifest.cjs`、`tsconfig.checkjs.json`、`tsconfig.tests.mjs.json` 等仍是未跟踪文件，且被已跟踪代码/测试依赖；暂存时不能按目录一刀切排除 `scripts/`，只排除未跟踪个人资产。

## 验证

- `npm run typecheck`：6 个项目 0 诊断（tsconfig.json / node / electron / checkjs / tests / tests.mjs）。
- `npm test`：1,315 项，1,309 通过、6 跳过、0 失败（第 9 批基线 1,281；+34）。
- `npm run build`：通过（Vite；仅有既有动态导入警告）。
- `npm run mcp:bundle`：通过；`packaging/mcp` 含 `server.cjs`、`ragWorker.cjs`、`sql-wasm.wasm`、`bundle-manifest.json`、`node_modules/sqlite-vec(-windows-x64)`；manifest 版本 0.4.37、工具数 28。
- 额外运行 `node electron/build.cjs --dir --win --x64 --publish never`（unpacked 打包冒烟）：afterPack 的 MCP sqlite-vec、bundle manifest、PDF.js 与 28 个运行时包 asar 断言全部通过。首次运行暴露了 electron-builder 的嵌套依赖提升布局，已按真实布局修正断言；未生成/安装 NSIS 安装包，未做真机 UI 验收。
- 打包产物额外冒烟：`release/win-unpacked/PaperQuay.exe` + `ELECTRON_RUN_AS_NODE=1` 启动 `resources/paperquay-mcp/server.cjs`，`initialize` 返回 `paperquay-knowledge-mcp 0.4.37`、`tools/list` 返回 28 个工具；`resources/paperquay-mcp/ragWorker.cjs` 能打开临时 RAG 库并响应 `listIndexStatuses`/`close`。
- 6 项跳过仍为环境变量控制的性能/本地模型基准；安装包与真机 UI 未验收。
