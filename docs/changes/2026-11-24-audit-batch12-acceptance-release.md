# 第 12 批：验收缺口与发布前收口

日期：2026-11-24。未提交、未 push；本批未改 SQLite schema / `user_version`，未写用户真实数据；未动 `.verification-*`、`.codex-temp`、`tests/knowledgeMcpFigure.test.ts`。`scripts/rag-embed-probe.mjs` 与 `scripts/inspect-library.cjs` 的 mtime/ctime 落在本批时段，无法证明未被读取/改动，仍保持未跟踪且不提交；请用个人备份核对。文献元数据仍走 UPSERT，含摘录卡锚点的笔记正文未被覆盖。

本批目标：附录 A 达到 fixed 93 / partial 0 / open 0（D1-13 收口），并逐项关闭计划 §3 的 8 项验收缺口（§3 表共 9 行，另 1 行为已 fixed 的 S5）。初版结果：A6、B1、E5、F4、E4/E1、S1 收口；D1-13 的代码与 Windows 未签名产物验证完成，但本机无发布证书且未运行 release 流水线，签名/公证与 mac/Linux 载体未验证，**按任务口径保留 partial**；F2/§8 的 NSIS **安装**动作因本机已有同一 appId 的 PaperQuay 安装被阻塞，改用安装包 payload 做同等的打包产物冒烟，安装注册、卸载与备份导入列为已知限制（见第 8 节）。附录 A 最终 fixed 92 / partial 1（D1-13）/ open 0。**2026-11-24 独立复核后，B1、E4/E1、E5、S1、文档同步转 partial，A6/F4 保持 fixed；7 项发布阻塞见第 4 节，修复前不发 0.4.38。** 第 12R 批已修复这 7 项阻塞并把除 F2 外的 §3 项恢复为 fixed；本文件第 4 节保留当时的复核结论作为历史记录，最终状态见计划头部与[第 12R 批记录](2026-11-24-audit-batch12r-release-blockers.md)。

## 一、逐项结果

### 1. D1-13 sandbox、自包含 preload 与 ASAR 完整性（代码与 Windows 未签名产物已验证；签名/发布流水线未验证，状态 partial）

- `electron/main.cjs:196-204`：`webPreferences.preload` 改为 `electron/preload.bundle.cjs`，`sandbox:true`，保留 `contextIsolation:true` / `nodeIntegration:false` / `webSecurity:true`。
- 新增 `scripts/bundle-preload.cjs`：esbuild 把 `electron/preload.cjs` 及其本地依赖打成单个 CJS，`platform:'node'`、`target:'node24'`、`external:['electron']`；构建后断言无本地相对 `require`，且只允许 `electron` / `events` / `timers` / `url`（含 `node:` 变体）。`npm run build`、`npm run dev`、`electron:build` 均前置执行。
- sandbox preload 不再 `require('electron').clipboard`：新增 `clipboard_read_text` / `clipboard_write_text` 主进程命令（`electron/main.cjs:314-336`，字符串 + 20 万字符上限），同步读取走 `paperquay:invoke-sync` 的 `SYNCHRONOUS_RENDERER_COMMANDS` 白名单（仅 `clipboard_read_text`），仍受 `assertTrustedIpcWebContents` + `assertTrustedIpcSender` 双重校验。
- `package.json` `build.electronFuses` 启用 `enableEmbeddedAsarIntegrityValidation` 与 `onlyLoadAppFromAsar`。`electron/afterPack.cjs:229-341` 先用构建器同一份 `generateFuseConfig` 主动 `addElectronFuses`，再 `getCurrentFuseWire` 断言两项 `ENABLE`，并用 `resedit` 断言 `ELECTRONASAR` 含 `app.asar`、`alg=sha256`、64 位 hex；断言失败即抛错。electron-builder 随后会以同配置再翻一次（幂等），打包日志出现两次 `executing @electron/fuses`，最终产物复核为 49/49。
- afterPack 额外断言 `app.asar` 内存在 `electron/preload.bundle.cjs`（D1 复核缺口），避免构建脚本漏跑时窗口拿不到 `window.paperquay`。
- 打包实测（`release/win-unpacked/PaperQuay.exe`）：fuse 4/5 = ENABLE；`ELECTRONASAR` 的 SHA256 与 `app.asar` 头哈希一致；`app.asar` 内 bundle 与磁盘生成物字节一致；CDP 验证 `window.paperquay`、`library_init`、剪贴板往返、白名单拒绝、`paperquay:event`、真实文件拖放 `approve-read-paths`、窗口控制均正常。
- 本机限制：不带 `--no-sandbox` 时 Chromium 在 app ready 前崩溃（0x80000003，`--version` 同样），属宿主环境；验收命令统一加 `--no-sandbox`，渲染器仍由 `webPreferences.sandbox` 限制 preload 的 Node 访问（真实探针 `require('node:fs')`/`require('fs')` 均失败）。
- 未验证：macOS/Linux 打包与完整性载体、代码签名/公证、篡改 `app.asar` 后的拒绝加载失败模式、Windows arm64。

### 2. A6 RetainPDF 状态、取消与重试

- 新增 `src/features/literature/retainPdfUiState.ts`：把 `job+status` 归一为 `idle/unavailable/running/failed/canceled/ready`，映射进度、阶段、错误种类与页数不一致；错误只暴露固定 kind，不回显后端原文。
- 新增 `src/features/literature/components/RetainPdfTranslationPanel.tsx`：自包含，只收 `paperId/hasPdf/translatedAttachmentId`；挂载时 `get_status` + `get_translation` 各一次，优先单篇查询、失败回落 `status.jobs`，之后监听 `RETAINPDF_TRANSLATION_EVENT` 增量刷新；进行中显示阶段/进度并可取消，失败可重试，取消后可重新开始，未安装/缺配置/缺 PDF 显示不可用原因，`statusUnknown`/未安装等状态提供“重新检测”。
- `LiteraturePaperDetails.tsx` 在状态栏下方挂载，并用 `key={paper.id}` 强制切换文献时重挂载，消除跨文献的 busy/结果串台；`translatedAttachmentId` 不匹配时把旧 `attached` 记录视为可重新开始。
- `src/services/retainPdf.ts` 新增 `startRetainPdfTranslationOnce`，按 paperId 合并并发启动，finally 清理；`useMetadataJobs` 与面板共用，避免双启动。
- 用例：`tests/retainPdfUi.test.ts` 21 项通过（第 12R 批后为 24 项；纯状态映射、未安装不显示开始、失败重试、取消后重试、进度事件不重复拉取、翻译附件移除、并发启动去重、英文文案）。

### 3. B1 升级后目录重新授权与 pathPolicy 统一

- `electron/backend/pathPolicy.cjs` 新增只读 `isApprovedPath` / `getAuthorizationStatus`（`default/configured/dialog-approved/missing-approval/missing/unsafe`）；未授权路径不再 `existsSync`，避免渲染层把状态命令当存在性探针。
- `writeRoots` 显式加入默认 `appPaths.mineruCacheDir`，但不加入渲染层可写的 `settings.mineruCacheDir`；自定义 MinerU 目录只有 `approveWritePath` 后才可写。
- `mineruCacheCommands.cjs` 删除读取 `configPath` 的旧 guard；`repair/prepare/finish` 只认默认根或对话框授权，读目录仍要求 MinerU 产物标记 + pathPolicy 读权限。`prepare_mineru_cache_dir`（`electron/backend/fileCommands.cjs:354-370`）在迁移前对 `previousDirectory` 与每个源条目执行 `assertReadAllowed`，堵住“任意目录复制进缓存根再读出”的路径。
- 新增只读 IPC `path_authorization_status`（`electron/ipcAllowlist.cjs:117`），返回 `storageDir/translatedPdfDir/mineruCacheDir` 的 `{path,exists,authorized,reason}`；`storageDir` 按既有 pathPolicy 语义视为受信，译版目录保留“升级后需重新选择”提示。
- Reader 设置页（`readerPreferencesContent.tsx:148-190,403-421,582-624,1072`）在已配置但未授权/目录不存在时显示双语警告与“重新选择目录”，复用 `selectDirectory` 写回设置并刷新状态。
- 用例：`tests/pathPolicyAuthorization.test.mjs` 7 项通过（默认/授权/缺失/UNC、未授权路径不 stat、升级配置、repair/prepare/finish/读资产拒绝、渲染层写 `C:\` 不能提权、迁移源越界拒绝）。

### 4. E5 模板正文、系统页与聚合稿本地化

- `noteEditorUtils.ts` 的 11 个 `NOTE_TEMPLATES` 增加与 `content` 结构一致的 `contentEn`，新增 `templateContentForLocale`；工具栏与斜杠命令都按界面语言插入正文。斜杠命令执行时读取 `<html lang>` 实时语言（`slashMenu.ts`），编辑器打开期间切换语言不再插入旧语言模板。
- `noteSystemPages.ts` 支持 `locale`（默认 zh 保持旧调用）；英文生成英文标题/摘要/空态；managed marker/hash 机制不变，旧中文系统页仍识别；语言切换时只重写标题与固定文案，保留历史日期条目（历史是数据，不因界面语言丢失）。
- `noteAggregation.ts` 支持 `locale`（默认 zh），英文输出英文小节与提示，引用编号、来源链接、锚点保持原文；`buildNoteHealthRepairInstruction` 是发给外部 Agent 的指令，保留中文并在注释说明理由。
- 参考文献标题：新增 `referenceListHeadingForLocale` / `isReferenceListHeading`，工具栏与斜杠 `reference-list` 按语言写 `参考文献`/`References`；`src/shared/markdownToTiptap.cjs` 的参考文献小节正则同时识别中英文标题，英文聚合稿的 `[n]` 可映射为 `paperReference`。
- i18n 守卫扩到 `noteEditorUtils.ts`、`noteReferences.ts`、`slashMenu.ts`、`noteSystemPages.ts`、`noteAggregation.ts`；模板正文改为 `{zh,en}` 成对数据后移除整块豁免，仅保留锚点旧数据、搜索别名、Agent 指令标题等逐行豁免。
- 用例：`notesTemplateLocale.test.ts`、`noteSystemPages.test.ts`（6；第 12R 批后 7）、`noteAggregation.test.ts`、`noteReferences.test.ts`、`markdownToTiptap.test.ts`、`uiA11yI18n.test.ts`（16）、`notesI18n.test.ts`（16）通过。

### 5. F4 ESLint、CI 与 checkJs 扩大

- 新增 `eslint.config.js`（flat config）：`@eslint/js` recommended + `typescript-eslint` recommended + `react-hooks`；`src` 浏览器 globals、`electron/scripts/bin` Node+CommonJS、`tests` Node+jsdom；只忽略构建产物、`docs/assets`、临时目录、生成的 `electron/preload.bundle.cjs` 与本机两个未跟踪脚本，未整目录忽略源码。
- `npm run lint` = `eslint . --max-warnings 206`：当前 0 errors / 206 warnings（全部 `react-hooks/exhaustive-deps`）；首次基线 3080 errors / 207 warnings，清零过程中移除未使用导入/死声明约 60 个文件，22 处逐行 disable 均带原因（`PdfJsLoose` 别名、`no-control-regex`、`no-misleading-character-class`）。发现并回退了 lint 清理误激活的 drop-cap 隐式改写：`sanitizeFakeSuperscripts` 仍只做伪上标清洗，Drop Cap 由 `sanitizeDropCapArtifacts` 显式调用（新增作者缩写 `J SMITH` 回归用例）。
- `.github/workflows/build.yml:33-37` 在 typecheck 前新增 `Run ESLint`。
- `tsconfig.checkjs.json` 28 → 29 个文件（新增 `electron/preload.cjs`），`tsconfig.tests.mjs.json` 11 → 21 个；`npm run typecheck` 六项目 0 诊断。`docs/typecheck-backlog.md` 记录剩余 electron/bin 38 文件 281 错误、tests mjs 19 文件 52 错误，并注明扫描范围不含 `src/shared`/`scripts` 的 `.cjs`。
- 守卫：`tests/lintConfig.test.mjs`、`tests/checkjsAllowlist.test.mjs` 校验 lint 步骤存在、allowlist 文件存在且不丢基线、backlog 无漂移。

### 6. E4/E1 axe 扫描与双主题截图

- 新增 devDependency `axe-core@4.14.1` 与 `tests/axeAudit.test.mjs`（默认跳过，`PAPERQUAY_AXE=1` 运行）：通过 CDP 连接真实 Electron 渲染（非 jsdom），对 Library、Notes、Graph、Settings、Reader 五个主界面做浅色/深色两套 axe 扫描；规则集 `wcag2a/wcag2aa/wcag21a/wcag21aa`。
- 结果：10 个视图/主题 **0 violations**；但报告只取 violations，6 个 `incomplete` 的 `nodes` 被 axe 截为 1、target 丢失。复核确认其中 2 个是 serious 的 `label-content-name-mismatch`（不是对比度），4 个是 `color-contrast`；且 Notes 只扫空态、Settings 只扫通用页。报告 `docs/assets/audit-2026-11-24/axe-report.json`，截图 10 张 `library|notes|graph|settings|reader-{light,dark}.png`。详见第 4 节。
- 修复的实质问题：`--pq-text-faint` 浅色 `#a8a29e` → `#6b6a66`、深色 45% → 55%；`--pq-accent` 浅色 `#0d9488` → `#0f766e`、hover `#115e59`；主按钮底改用 `#0f766e`；`--pq-warning` 浅色 `#d97706` → `#9a3412`；选中分类/阅读模式文字改用 `--pq-accent-strong`；排序按钮 aria-label 包含可见排序值；问答模型选择器 aria-label 包含模型名；Graph 视角 select 增加 aria-label；Settings 的界面语言/MCP 客户端 select 增加 aria-label。
- Tab 结构：`role=tab` 内不再包含可聚焦的关闭按钮（改为 tab 的兄弟，鼠标可点），消除 `nested-interactive`；关闭按钮对读屏隐藏，键盘/读屏用户通过标签右键菜单“关闭标签”关闭。`aria-required-children` 由 `role=presentation` 包装层满足。
- 设计文档 `docs/ui-design-system.md` 同步更新 token 值与对比度说明。

### 7. S1 改造前后性能对比

方法：用 `git archive 22c900b` 在仓库外 `paperquery/.tmp-perf/` 构建基线，node_modules 以 junction 复用；同一 Electron 42.2.0 二进制、同一份夹具库（1 篇 PDF）与同机环境，基线/当前各跑 3 次取中位数。冷启动为进程启动到窗口可见（外部计时）加主进程 `startup:window-visible`；Library 为首屏行渲染时的 `performance.now()`；Notes/Graph 为点击导航到工作区就绪的墙钟时间。`PAPERQUAY_PERF=1` 打开主进程埋点。**本表是第 12 批初测（22c900b 基线，已含第 3 批 S1 改动），已被第 12R 批以审计前 `1283d82` 为基线的重测取代，最终数据见第 12R 批记录 §1.5。**

| 指标 | 改造前（22c900b）中位数 | 当前工作区中位数 | 变化 |
| --- | ---: | ---: | ---: |
| 冷启动（外部计时） | 595 ms | 552 ms | -43 ms（-7.2%） |
| 窗口可见（主进程埋点） | 271.1 ms | 217.1 ms | -54 ms（-19.9%） |
| Library 首屏渲染 | 244.6 ms | 209.4 ms | -35.2 ms（-14.4%） |
| Notes 首次打开 | 86 ms | 113 ms | +27 ms（+31.4%） |
| Graph 首次打开 | 56 ms | 49 ms | -7 ms（-12.5%） |

3 次原始数据：基线 cold 592/595/625、window 271.1/253.5/326.5、library 244.6/236.1/268、notes 107/86/77、graph 68/54/56；当前 cold 552/585/535、window 225.9/209.1/217.1、library 195/219/209.4、notes 163/106/113、graph 78/48/49。完整 JSON 在 `.tmp-perf/pq-perf-*/perf-results.json`（临时目录，不入库）。Notes 首次打开变慢与第 11 批加入的笔记体检/本地化分支有关，未做进一步优化；结论按实测记录，不用估算替代。

### 8. F2/§8 安装包与安装版冒烟

- NSIS 构建：`npm run electron:build -- --win --x64 --publish never` 成功，产物 `release/PaperQuay-0.4.37-win-x64.exe`（116,156,494 字节，2026-11-24 16:18；这是第 12 批发包时点，最终 0.4.38 产物见第 12R 批记录）。afterPack 通过 fuse/ELECTRONASAR、asar 内 preload、MCP sqlite-vec、bundle manifest、PDF.js、28 个运行时包断言。
- 安装阻塞：本机 `%LOCALAPPDATA%\Programs\PaperQuay` 已有同一 appId 的安装。NSIS 静默安装会先卸载旧版本，因旧安装的 MCP server 进程（PaperQuay.exe，14:40 启动）占用文件而失败，弹出 “Failed to uninstall old application files. Please try running the installer again.: 2”。继续安装会卸载/覆盖用户现有安装，故本批**未执行注册式安装**；不使用改注册表/杀用户进程的方式绕过。
- 替代冒烟：用 7-Zip 解出安装包 payload 到 `.tmp-audit/nsis-extract`，对该 payload（与安装后文件同一 `app.asar`/`resources`）用空 `--user-data-dir` 逐项验收。最近一次结果（`docs/assets/audit-2026-11-24/installer-smoke/smoke-results.json`）为 **11 pass / 2 fail**：
  - 通过：启动与 preload 桥、导入 PDF、打开论文与 PDF 渲染、**中文 CID PDF 导入与渲染**（画布 ink ratio > 0.002）、笔记创建与读取、Vault 同步（生成 2 个文件：1 个 `.md` + 1 个 `.paperquay-vault.json`）、RetainPDF 状态（本机 `installed:true`）、备份导出（407,528 字节，5 个条目）、**未授权包路径被拒绝**（中文错误“请通过应用的文件对话框选择备份包”）、**MCP `read_paper_figure`（安装版 server 返回 28 工具并读到 page-1-block-2）**。
  - 失败 1：`backup_select_package` 的原生文件对话框未被 UIAutomation 找到（`file dialog window not found for pid …`），因此备份导入的“选择包”未完成。
  - 失败 2：依赖上一步的 `backup_import_stage`（选择恢复目标 + 恢复）未执行。备份导出、未授权拒绝、密码/包格式检查已验收；恢复路径的安装版验收列为已知限制。
  - 修复的安装器缺陷：`installer.nsh` 的 `customCheckAppRunning` 原先在 PowerShell 检测失败时按进程名 `KillProcess`，会误杀其它安装目录的 PaperQuay/MCP 进程，并让临时目录安装在无关进程存在时反复重试/退出。现改为仅按 `$INSTDIR` 路径检测与结束；PowerShell 不可用时按未运行处理。
- 已知限制：注册式 NSIS 安装/卸载、开始菜单快捷方式、覆盖升级未验证；备份导入的原生对话框自动化未通过；MCP `read_paper_figure` 已在安装包 payload 上通过（28 工具、page-1-block-2，见 `smoke-results.json` results[11]）。`installer.nsh` 仍用 `StartsWith('$INSTDIR')` 前缀匹配，同前缀目录（如 `PaperQuay Beta`）可能误判，待实机验证。这些不影响打包 payload 的启动/阅读/中文 PDF/笔记/Vault/导出验收结论。
- **第 12R 批补记（2026-11-24）**：`installer.nsh` 已改为 `[IO.Path]::GetDirectoryName($_.Path) -ieq '$INSTDIR'` 的目录边界匹配；以最终 0.4.38 源码重建安装包并重跑 payload 冒烟，结果为 11 pass / 2 fail（两项均为原生备份导入对话框），备份导出为 407,528 字节/5 条，报告含 installer/app.asar SHA-256 且已脱敏。详见[第 12R 批记录](2026-11-24-audit-batch12r-release-blockers.md)。

### 9. 文档

- 新增本文件；更新 `docs/plans/2026-11-23-audit-remaining.md` 头部、§1 汇总表、§3 每行、§4 D1-13 行、§5 第 12 批行。
- 更新 `docs/ui-design-system.md` 的 accent/faint/warning 令牌值与对比度说明。
- 更新 `docs/typecheck-backlog.md` 的扫描范围说明。

## 二、验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 六个 tsc 项目 0 诊断 |
| `npm test` | 1,463 项（1,454 通过、9 跳过、0 失败） |
| `npm run lint` | 0 errors / 206 warnings（`--max-warnings 206`） |
| `npm run build` | 通过（preload bundle + typecheck + vite） |
| `npm run mcp:bundle` | 通过（28 工具，server + ragWorker + sqlite-vec） |
| `npm run electron:build -- --win --x64 --publish never` | 通过；afterPack 全部断言通过 |
| `PAPERQUAY_AXE=1 node --test tests/axeAudit.test.mjs` | 10 个视图/主题 0 violations，10 张截图 |
| `node tests/support/perfAudit.mjs --baseline-ref 22c900b` | 3+3 次中位数见上表 |
| `node tests/support/installerSmoke.mjs --app-dir <payload>` | 见第 8 节；注册式安装阻塞 |
| `node scripts/bundle-preload.cjs` | 22,913 字节，自包含检查通过 |
| `git diff --check` | 通过 |

## 三、已知限制与未验证项

1. **NSIS 注册式安装**：本机已有同一 appId 安装且其 MCP server 在运行，静默安装会卸载旧版本；未执行以免破坏用户安装。注册表、快捷方式、覆盖升级与卸载路径未验证。
2. **代码签名/公证**：本机 `CSC_IDENTITY_AUTO_DISCOVERY=false`；未验证签名后的 ASAR 完整性、SmartScreen 与 macOS hardened runtime。macOS/Linux 的 fuse/完整性载体未验证。
3. **安装版备份导入**：原生文件/目录对话框的 UIAutomation 在本机不稳定，导入未跑通；导出、密码校验、未授权拒绝已验收。
4. **安装版 `read_paper_figure`**：已在安装包 payload 上通过（28 工具、page-1-block-2），见 `smoke-results.json` results[11]；打包 MCP server 的 28 工具与 D3-2/D10 的 worker 索引证据仍有效。
5. **RetainPDF 真机联调**：本机 `retainpdf_get_status` 返回 installed:true，但未实际发起远端翻译任务；失败/取消/重试为 jsdom + 服务 mock 验收。
6. **E4 的 6 个 axe incomplete**：2 个 serious `label-content-name-mismatch` + 4 个 `color-contrast`；报告只取 violations 导致 `nodes` 截断、target 丢失，需按第 4 节重跑并保留 target；Notes 仅空态、Settings 仅通用页，未覆盖编辑器/备份/MCP/更新页。
7. **性能**：单机单次会话测量，字体/杀软/磁盘缓存可能影响绝对值；`22c900b` 基线已含第 3 批 S1 改动，数据实际是第 4–12 批 vs 第 3 批后；“冷启动”外部计时结束于 Library 首行，不是窗口可见；验收统一使用 `--no-sandbox --disable-gpu`；Notes 首次打开 +31.4% 未优化。未测 Electron 实际 fps。
8. **E5 markdown-only 笔记**：`noteContentToTiptap` 不传 `papers`，仅 markdown 正文的英文 `References` 不会在编辑器加载时映射为 `paperReference`；中文路径同样存在此限制，属既有行为，聚合稿正常路径（写入 contentJson）不受影响。
9. **平台**：Windows x64 之外未验证；Windows arm64 仍被 sqlite-vec 0.1.9 限制显式拒绝。

## 四、独立复核（2026-11-24）

9 个只读领域 verifier + 41 项对抗复核 + 发布完整性批评（共 51 个 agent）。结论：8/9 领域 PARTIAL；39 项发现为真、7 项阻塞 0.4.38；releaseReady=false。**这是第 12R 批修复前的历史结论；7 项阻塞已由第 12R 批关闭，最终状态见第 12R 批记录。**

### 发布阻塞（第 12R 批修复）

1. **B1 目录授权扩散**：`pathPolicy.cjs:326-346` 的 `approveReadPaths` 把所选目录的父目录加入 `approvedReadPaths` 并持久化，同时加入 `approvedSiblingPdfWriteDirs`；`fileCommands.cjs:330/345` 以目录本身调用，选 `D:/cache` 后 `D:/` 整棵树可读、父目录 `.pdf` 可写。HEAD 已有该实现，但 B1 新流程直接复用。需新增只授权目录自身的入口并补回归。
2. **vault 参考文献重复**：`noteVault.cjs:537-558` 在 `ctx.refs` 非空时无条件追加 `## 参考文献`，不识别已有 `## References` + 列表；英文笔记导出同时出现两段，回导再导出会增长。需去重并补幂等用例。
3. **Graph 深色标签不可读**：`KnowledgeGraphWorkspace.tsx:186` 硬编码 `#1f2937`，`:1170-1174` 从 `--pq-text` 取 rgba 并回退 `#1f2937`；`graph-dark.png` 标签在深色画布上近黑，对比约 1.2:1，axe 对 canvas 无结果。
4. **axe incomplete 误判与覆盖不足**：`electronCdp.mjs:251-253` 只取 `resultTypes:['violations']`，6 个 incomplete 的 `nodes` 被截为 1、target 丢失；其中 2 个是 serious `label-content-name-mismatch`；Notes 只扫空态、Settings 只扫通用页，未覆盖状态已复现 `McpSettingsSection.tsx:171` 与 `NoteEditor.tsx:317` 的 aria-label 缺口。
5. **审计资产含个人路径/测试口令**：`library-light/dark.png` 显示 `C:\Users\yusen\...` 夹具路径；`installer-smoke/smoke-results.json:5` 有 `password: PaperQuay-Smoke-12345`，同文件与 `smoke-summary.md:3` 有绝对路径。提交前必须脱敏。
6. **§5 纳入清单不完整**：`docs/plans/2026-11-23-audit-remaining.md:205` 未列 `scripts/bundle-preload.cjs`、`eslint.config.js`、`docs/assets/audit-2026-11-24/`；干净检出会在 `npm run build`、`npm run lint`、`npm test` 失败。
7. **发布工程未就绪**：版本仍 0.4.37、CHANGELOG 无 0.4.38、`.github/release-notes.md` 仍是 0.4.37 RAG 说明、第 4–12 批无提交、HEAD=`22c900b` 是审计前代码；不完成提交与版本递增就打 tag 会发布错误版本/旧代码。

### 状态修正

- A6、F4 维持 fixed；B1、E4/E1、E5、S1、文档同步转 partial；F2、D1-13 保持 partial。**（第 12R 批后：A6、F4、B1、E4/E1、E5、S1、文档同步均为 fixed；仅 F2、D1-13 为 partial。）**
- 附录 A 仍为 fixed 92 / partial 1（D1-13）/ open 0。

### 次要发现（第 12R 批顺手修）

- A6：集成测试未覆盖 `key={paper.id}`/`translatedAttachmentId` 切换；Panel 的 `onChanged` 生产未传，刷新依赖 TaskCenter 旁路；Reader 入口仍直接调用 `startRetainPdfTranslation`，绕过 Once。
- F4：`docs/typecheck-backlog.md` tests 合计数 248，复算 250；`release.yml` 的 verify 未执行 `npm run lint`。
- F2：第 8 节备份导出数字已按证据改为 407,528 字节/5 条、Vault 2 个文件/1 个 `.md`；`installer.nsh` 仍用前缀匹配 `$INSTDIR`，同前缀目录（如 `PaperQuay Beta`）可能误判。
- S1：基线 `22c900b` 已含第 3 批 S1 改动；冷启动端点、`--disable-gpu`、样本方差已写入已知限制，第 12R 批用 `1283d82` 重测或改口径。
- 文档：`docs/ui-design-system.md:94/187` 与 CSS/测试注释仍留旧 accent 3.43/3.74 与 warning 色相 32°；需按实际 `#0f766e` 5.02/5.47、`#9a3412` 色相 15° 更新。
- `scripts/rag-embed-probe.mjs` 与 `scripts/inspect-library.cjs` 的 mtime/ctime 落在本批时段，无法证明未被改动；仍保持未跟踪、不提交，请用个人备份核对。
