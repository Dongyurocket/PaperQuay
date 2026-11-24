# 第 12R 批：复核阻塞项与 0.4.38/0.4.39 发布准备

日期：2026-11-24。未提交、未 push、未打 tag；本批未改 SQLite schema / `user_version`，未写用户真实数据；未动 `.verification-*`、`.codex-temp`、`tests/knowledgeMcpFigure.test.ts` 与 `scripts/` 未跟踪个人资产。文献元数据仍走 UPSERT，含摘录卡锚点的笔记正文未被覆盖。

本批目标：修复第 12 批独立复核列出的 7 项发布阻塞，把 B1、E4/E1、E5、S1、文档同步从 partial 恢复到 fixed（每项附测试或源码证据），并完成 0.4.38 版本、CHANGELOG、release notes 与安装包验收。F2 的注册式安装/备份导入仍按已知限制保留 partial。

**发布记录（2026-11-24/25）**：`app-v0.4.38` 标签推送后，Release 的 Windows verify 在 GitHub 8.3 短路径（`RUNNER~1`）与 CI 性能预算上失败，0.4.38 未发布；修复短路径 canonicalization、附件 stub 与两个 real-fs 计时用例后，以 **0.4.39** 重新发布。0.4.39 的安装包与 payload 冒烟已用 `8fd9cd6` 之后的源码重建并重跑（见 §1 F2 与 §二），0.4.38 本地安装包已过期，不作为发布资产。

## 一、逐项结果

### 1. B1 目录授权不再扩散到父目录（fixed）

- `electron/backend/pathPolicy.cjs` 新增 `approveReadDirectory(directory)`：只把所选目录自身（realpath）加入 `approvedReadPaths` 并持久化，不加入父目录、不加入 `approvedSiblingPdfWriteDirs`。`approveReadPath` 保留文件选择语义（文件 + 所在目录 + 同目录 `.pdf` 写回）。
- `readRoots()` / `writeRoots()` 删除对 `settings.translatedPdfDir` 的直接信任；自定义译版目录必须与自定义 MinerU 目录一样经目录对话框授权，默认译版目录仍由 `storageDir`/`dataDir` 覆盖。
- `electron/backend/fileCommands.cjs`：`select_directory` 与 `prepare_mineru_cache_dir` 改用 `approveReadDirectory`。`prepare_mineru_cache_dir` 在旧目录未授权（`previous-not-authorized`）或 OS 拒绝列举（EPERM/EACCES/EBUSY，`previous-unreadable`）时跳过迁移，不再让整次目录选择失败；单个条目指向读根之外时跳过并计入 `errors`，也不中断。
- `electron/backend/mineruCacheCommands.cjs` 的 `path_authorization_status` 对 `translatedPdfDir` 使用与 pathPolicy 相同的信任根（`dataDir` + `storageDir`）；`getAuthorizationStatus` 的写模式用 `isWriteAllowed` 探测，只读祖先授权不再把未授权目录报成 `known-attachment`。`translatedPdfAttachments.cjs` 在创建目录前用同一策略校验目标目录，渲染层不能借 `library_add_attachment` 把文件写进未重新授权的自定义译版目录。
- `pathPolicy.getAuthorizationStatus` 未授权时返回 `path.resolve(raw)` 而不是 realpath，状态命令不再成为路径规范化探针；`resolveForCheck` 对不存在的写入目标改为沿父目录找到最近存在的祖先做 realpath，堵住 `approved\link\newdir\file` 跟随 junction 写出读根的路径。
- Reader 设置页在跳过迁移时显示双语警告（`src/features/reader/useReaderLibraryActions.ts`）。
- 用例：`tests/pathPolicyAuthorization.test.mjs` 16 项通过，新增「目录自身授权、父目录文件不可读、父目录 `.pdf` 不可写、readRoots 不含父目录、重启后仍不可读」「translatedPdfDir 状态与真实策略一致（空目录 missing-approval、已有附件 known-attachment）」「未授权不返回 realpath（junction 用例）」「旧目录未授权/OS EPERM 时跳过迁移且目标 marker 正常写入」「只读祖先不报可写」「未授权自定义译版目录拒绝附加」「不存在的中间目录经 junction 不可写」「select_directory/prepare 源码使用目录专用入口」。

### 2. E5 Vault 参考文献去重、摘录卡本地化与系统页多行摘要（fixed）

- `electron/backend/noteVault.cjs` 的 `stripExistingReferenceSections`：导出前识别 `## 参考文献` / `## References` 标题（含行内强调、链接与 ATX 结尾 `##`），只删除其后紧邻的列表；`ctx.refs` 为空时完全不剔除。围栏按 CommonMark 跟踪字符与长度、忽略 info string 的伪关闭行，并识别列表项内的 `- ``` ` 围栏，代码块内的同名标题不误删；列表扫描区分有序/无序标记，后续另一份列表不再被吞掉；多行续行作为同一条目整体删除。标题后是正文时保留正文且不追加第二份规范列表。规范列表标题沿用首个被删标题的语言，避免英文笔记被写成中文标题。**语义说明**：笔记已有内联 `paperReference` 时，参考文献小节按应用管理的规范列表重建（手写条目会被替换）；无内联引用时保留手写列表。后者是既有契约，前者是 E5 去重的设计行为。
- `src/features/notes/noteDistill.ts`：`💭 我的想法：` 与 `摘录卡` 改为 `pickLocaleText` 双语；创建请求接受 `locale`（默认 `zh-CN`），英文界面写 `💭 My thoughts:` 与 `Excerpt card`；追加时同时识别中英两种「我的想法」标题。`noteDistillPreview.ts` 与 `useReaderNotes.ts` 传递当前 `locale`。`src/features/notes/noteDistill.ts` 已加入 i18n 守卫的 `NOTES_I18N_GUARDED_FILES`（此前只登记了同名的 `src/services/noteDistill.ts`，守卫未覆盖真正输出文案的文件）。
- `src/services/noteSystemPages.ts`：多行 `operationSummary` 的续行缩进为同一条日志项；`lastLogEntry` 从最后一条 `- ` 开始取完整多行块，语言切换合并时不再只保留末尾两行。**已知限制**：该模块自 `00fae8d` 移除独立 Agent 工作区后没有生产调用方，多行行为目前由 `tests/noteSystemPages.test.ts` 覆盖；重新接线后即生效。
- 用例：`tests/noteVault.test.ts` 29 项（28 通过、1 项性能用例默认跳过；英文/中文 References、手写列表保留、中英并存只留一份、导出→解析→再导出幂等、带行内强调标题、嵌套围栏/列表项内代码块、后置另一份列表、多行续行、正文小节保留）；`tests/noteDistill.test.ts` 6 项、`tests/noteDistillPreview.test.ts` 5 项、`tests/noteSystemPages.test.ts` 7 项、`tests/uiA11yI18n.test.ts` 16 项通过。

### 3. E4/E1 Graph 标签、aria-label 与 axe 覆盖（fixed）

- `src/features/graph/KnowledgeGraphWorkspace.tsx`：新增 `GRAPH_TEXT_COLORS = { light: '#1f2937', dark: '#e5e7eb' }`；主题切换按 `document.documentElement.classList` 选 6 位 hex，不再读取深色 `rgba()` 的 `--pq-text`。两色对 `--pq-surface`（`#ffffff`/`#1a1a1a`）对比分别约 14.7:1 / 14.1:1。
- `src/app/settings/McpSettingsSection.tsx` 的只读 textarea 增加本地化 `aria-label`；`src/features/notes/NoteEditor.tsx` 的 contenteditable 增加 `role="textbox"`、`aria-multiline` 与本地化 `aria-label`；`src/features/literature/components/LiteratureToolbar.tsx` 的全选按钮可见文字改为「全选 N / Select all N」，与可访问名称一致。
- `tests/support/electronCdp.mjs` 的 `runAxe` 请求 `resultTypes: ['violations','incomplete']`，两者都保留 `target`/`html`/`nodes`。`tests/axeAudit.test.mjs` 扩展到 Notes（新建并打开编辑器）、Library、Graph、Settings 通用/备份/MCP/更新、Reader 共 8 个视图 × 浅/深 = 16 个视图；扫描前等待 700ms 让入场动画结束；断言 0 serious/critical violations、0 serious `label-content-name-mismatch`，并只允许 `color-contrast` 作为 serious incomplete。截图前把文本节点、textarea/input 的值与 title/aria-label/alt/placeholder 中的整个盘符路径（不只是用户名）替换为 `C:\PaperQuayAudit`（MCP 配置片段含双反斜杠转义路径），报告写入前再次按整段路径脱敏。
- 结果：`docs/assets/audit-2026-11-24/axe-report.json` 16 视图 0 violations、0 seriousCritical violations、4 组 serious incomplete（文献全选按钮图形在浅/深各 1 组；PDF canvas 文本层在浅/深 reader 各 1 组 30 节点）；16 张截图重新生成，含 MCP 表单值在内的用户路径均已脱敏。incomplete 详情完整保留，作为 axe 对 canvas/动画的边界记录。
- 用例：`tests/uiContrast.test.ts` 新增 graph 标签对比度与「不得把 `--pq-text` 传给 Cytoscape」断言；`tests/uiA11yI18n.test.ts` 继续覆盖 i18n。

### 4. 审计资产脱敏（fixed）

- axe 报告与截图：夹具 profile 仍在仓库内（本机安全软件锁住 `%TEMP%` 与 `C:\Users\Public` 的 ACL，Electron profile 无法创建），截图前 DOM 文本脱敏，报告字符串再次脱敏；`axe-report.json` 不含 `C:\Users\...`。
- `tests/support/installerSmoke.mjs`：报告新增 installer 的 `name/sha256/bytes` 与 payload `resources/app.asar` 的 `sha256/bytes`；`password` 固定写 `***`；结果、错误与 app 日志统一把 `workRoot`→`<temp>`、installer→`<installer>`、`projectRoot`→`<repo>`、其余 `C:\Users\...`→`<user>`。
- `docs/assets/audit-2026-11-24/installer-smoke/` 在 0.4.39 payload 冒烟后重新生成；`docs/assets` 全目录复查无个人路径、真实文库标题或测试口令。

### 5. S1 性能对比重测（fixed）

- `tests/support/perfAudit.mjs` 默认基线改为审计前 `1283d82`；`extraArgs` 固定 `['--no-sandbox','--disable-gpu']`；基线构建使用工作区内 esbuild 临时目录（规避本机 `%TEMP%` 写入锁）。
- 测量改为交替执行 before/after 各 3 次（奇数轮 before→after，偶数轮 after→before），避免固定先测基线的缓存偏差；记录 `dist` 目录与 preload 的 SHA-256、每项指标的 min/max/stddev 与端点定义。
- 结果（2026-11-24，同机 Windows 11 / Electron 42.2.0，3+3 次中位数）：

| 指标 | 1283d82 中位数 | 当前 0.4.38 中位数 | 变化 |
| --- | ---: | ---: | ---: |
| 冷启动（进程启动→Library 首行） | 577 ms（569–714，σ 66.5） | 518 ms（516–535，σ 8.5） | -59 ms（-10.2%） |
| 窗口可见（主进程 `startup:window-visible`） | 259.6 ms（255.7–284.5，σ 12.8） | 194.8 ms（191.1–227.4，σ 16.3） | -64.8 ms（-25.0%） |
| Library 首屏渲染（renderer `performance.now()`） | 265.8 ms（258.4–363.8，σ 48） | 186.8 ms（186.7–189.8，σ 1.4） | -79 ms（-29.7%） |
| Notes 首次打开（点击→新建按钮可见） | 19 ms（13–23，σ 4.1） | 100 ms（93–101，σ 3.6） | +81 ms（+426.3%） |
| Graph 首次打开（点击→放大按钮可见） | 26 ms（23–27，σ 1.7） | 60 ms（46–64，σ 7.7） | +34 ms（+130.8%） |

- 产物哈希：基线 `dist` 76 文件 sha256 `33275b59…88cd`，preload `electron/preload.cjs` sha256 `9c5eaf1c…86be`；当前 `dist` 87 文件 sha256 `80429b6f…31d3`，preload `electron/preload.bundle.cjs` sha256 `607af8ab…a7fa`。
- 解读：Notes/Graph 的“变慢”来自第 3 批把工作区改为惰性加载——基线在启动时就挂载了这两个工作区，点击只是显示；当前把成本移到首次点击。冷启动、窗口可见与 Library 首屏的收益则来自同一改动。两组数据不能当作“相同工作量”的纯优化/回归对比，但口径与哈希已完整记录。
- 原始数据、方差与哈希见 `.tmp-perf/pq-perf-VdsmF7/perf-results.json`（临时目录，不入库）。口径说明：对比对象是审计前代码 `1283d82`，即第 1–12R 批整体结果，不是理论上的「仅 S1」差值；冷启动端点止于 Library 首行，窗口可见是独立埋点。有效启动参数为 `--no-sandbox --disable-gpu --disable-crash-reporter --disable-breakpad`。冷启动使用 100 ms 轮询，59 ms 差值低于该分辨率且低于基线 σ=66.5，只作方向性参考；窗口可见（-25.0%）与 Library 首行（-29.7%）是更稳的效果量。

### 6. A6/F4/F2 收尾（A6/F4 fixed；F2 partial）

- A6：`LiteraturePaperDetails.tsx` 的 `RetainPdfTranslationPanel` 已用 `key={paper.id}`、`translatedAttachmentId={translatedPdf?.attachment.id ?? null}`；不传 `onChanged`，附加完成后由 `TaskCenter` 绑定的 `bindRetainPdfBackgroundTasks` 经 `emitNativePaperUpdated` 统一刷新文库，避免一次附加触发两次刷新（Panel 仍保留可选回调供独立宿主使用）。Reader 的 `useReaderDocument.ts` 改用 `startRetainPdfTranslationOnce`。另修复加载中的旧快照覆盖已到达 attached 事件的竞态（事件版本号守卫）。`tests/retainPdfUi.test.ts` 24 项通过，新增「key/附件 id/TaskCenter 刷新依赖源码接线」「切换文献后旧任务迟到结果不覆盖新文献」与「加载中的旧快照不覆盖 attached」。`
- F4：`.github/workflows/release.yml` 的 verify 在 typecheck 前增加 `Run ESLint`（`tests/lintConfig.test.mjs` 同时断言 build.yml 与 release.yml）；`docs/typecheck-backlog.md` 的 tests 合计复算为 250（自身 52 + electron 196 + `src/shared` 2）；新增 `tests/installerScript.test.mjs` 为 0 诊断，`tsconfig.tests.mjs.json` 纳入文件数由 21 增至 22。
- F2：`installer.nsh` 的 PowerShell 过滤改为 `[IO.Path]::GetDirectoryName($_.Path) -ieq '$INSTDIR'`，不再用 `StartsWith` 前缀匹配；新增 `tests/installerScript.test.mjs` 两条守卫。`installerSmoke.mjs` 记录 installer/app.asar 哈希并脱敏。
- F2 仍为 partial：本机已有同 appId 安装且 MCP 进程占用文件，未执行 NSIS 注册式安装/卸载；原生对话框备份导入未验证（UIAutomation 找不到文件对话框）。0.4.39 payload 冒烟 11 pass / 2 fail（两项均为备份导入），覆盖启动/preload、导入、打开论文、中文 CID PDF、笔记、Vault（2 文件/1 `.md`）、RetainPDF 状态、备份导出（407,528 字节/5 条）、未授权拒绝与 MCP 28 工具读图。安装包 `PaperQuay-0.4.39-win-x64.exe` sha256 `8bb7a2f439f1cd0dca089718eaa6d6bb1837f8c5d1c6abe6e94f1fad7de0046d`（116,158,517 字节），payload app.asar sha256 `87bb3ce361ea66f83ca6ace093149a3d1565855afc34465b9c7a7188ab3155c3`（50,664,048 字节）。（过期的 0.4.38 本地包为 116,159,237 字节、sha256 `0941c9c8…c26f`，不发布。）

### 7. 发布准备（fixed）

- `package.json` / `package-lock.json` 升至 `0.4.38`。
- `CHANGELOG.md` 新增 0.4.39：审计范围、第 12R 批修复、CI 短路径修复、已知限制与验证；0.4.38 标为未发布。
- `.github/release-notes.md` 重写为中英双语，列 D1-13 未签名/sandbox/tamper、F2 注册式安装/备份导入、S1 口径与 axe 边界。
- `docs/ui-design-system.md` 与 `src/app/index.css`、`tests/uiContrast.test.ts` 注释同步到实际 accent `#0f766e`（白底 5.47:1、`--pq-bg-secondary` 5.02:1）与 warning 色相 15°。
- 计划 `docs/plans/2026-11-23-audit-remaining.md` 头部、§1、§3、§4、§5 按证据更新；§5 纳入清单已含 `scripts/bundle-preload.cjs`、`eslint.config.js`、`docs/assets/audit-2026-11-24/`。

## 二、验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 六个 tsc 项目 0 诊断 |
| `npm test` | 1,492 项（1,483 通过、9 跳过、0 失败）；首次全量 1 次 retainPdf ENOTEMPTY 临时目录清理偶发，单测与第二次全量通过 |
| `npm run lint` | 0 errors / 206 warnings（`--max-warnings 206`） |
| `npm run build` | 通过（preload bundle + typecheck + vite） |
| `npm run mcp:bundle` | 通过（28 工具，server + ragWorker + sqlite-vec） |
| `PAPERQUAY_AXE=1 node --test tests/axeAudit.test.mjs` | 16 视图/主题 0 violations，16 张截图 |
| `node tests/support/perfAudit.mjs --baseline-ref 1283d82` | 3+3 次交替；中位数与方差见 §1.5 |
| NSIS 0.4.39 构建 + afterPack/fuse/ELECTRONASAR | 通过（installer 116,158,517 字节，sha256 `8bb7a2f4…046d`；app.asar 50,664,048 字节，sha256 `87bb3ce3…55c3`） |
| `node tests/support/installerSmoke.mjs --installer release/PaperQuay-0.4.39-win-x64.exe --app-dir release/win-unpacked` | 11 pass / 2 fail（备份导入对话框，已知限制） |
| 干净检出（staged tree `f92fc7f`）+ `npm ci && typecheck && lint && build && test` | 通过；`git -c core.autocrlf=false archive` 到仓库外目录，1,489 项（1,480 通过、9 跳过、0 失败，排除未提交的 `tests/knowledgeMcpFigure.test.ts` 3 项）。首次以默认 autocrlf 归档时 `libraryQueryPolicy.test.ts` 的源码正则按 LF 写死而失败，已改为 `\r?\n` 后重跑通过。 |
| 0.4.39 干净检出（提交 `ad4b7b0`，tree `1aaaf87`）+ `npm ci && typecheck && lint && build && test` | 通过；`git -c core.autocrlf=false archive` 到仓库外目录，typecheck 0 诊断、lint 0 errors / 206 warnings、build 通过，1,489 项（1,480 通过、9 跳过、0 失败，排除未提交的 `tests/knowledgeMcpFigure.test.ts` 3 项）。 |
| `main` Build workflow | `8fd9cd6`（run 45434216580）全绿；此前 `92d9f5c` 唯一失败为 `mineruAssetPath.test.ts` stub 的 8.3 短路径比较，已修。 |
| `git diff --check` | 通过（仅 LF/CRLF 提示，退出码 0） |

## 三、独立复核与处置（2026-11-24）

第 12R 批实现后由 4 个只读 reviewer（B1、E5、E4/E1+A6、发布工程）独立复核当前工作区，发现并已处置：

- **B1**：`translatedPdfDir` 已有译版附件时，附件锚点让 `isReadAllowed`/`isWriteAllowed` 返回 true，但状态仍报 `missing-approval`。已在 `getAuthorizationStatus` 增加 `known-attachment` 原因并补 populated-dir 回归（第二轮扩充至 16 项通过）。reviewer 同时指出原测试 stub 永远返回 false；已改为可注入已知附件目录/文件的 stub。
- **E5**：i18n 守卫登记的是 `src/services/noteDistill.ts`，真正输出「我的想法」/「摘录卡」的 `src/features/notes/noteDistill.ts` 未被扫描；已加入守卫并通过。`stripExistingReferenceSections` 会误删代码围栏内的同名标题，且不识别带行内强调的标题；已加围栏状态与标题纯文本归一化，补两条用例（第二轮扩充至 29 项，28 通过/1 跳过）。`noteSystemPages.ts` 自 `00fae8d` 后无生产调用方，已作为已知限制写入 §1.2。
- **E4/E1**：MCP 设置截图里的 textarea 值未被 DOM 文本脱敏，仍显示真实用户目录；已同时脱敏文本节点、textarea/input 值与 title/aria-label/alt/placeholder，并重出 16 张截图（已目检 settings-mcp）。axe 断言增加「除 color-contrast 外不允许 serious/critical incomplete」。
- **A6**：一次 `attached` 同时触发 Panel `onChanged` 与 TaskCenter 的 `emitNativePaperUpdated`，造成双刷新；已移除 Panel 的显式回调接线，改为依赖 TaskCenter 事件（源码测试断言该依赖），Panel 仍保留可选 `onChanged` 供独立宿主使用。
- **发布工程**：S1 记录原先引用了旧的 `FvqPeW` 目录；已改为最终 `VdsmF7` 并同步最终中位数/哈希。`src/app/index.css` 焦点环注释仍是 3.43/3.74，已改为 5.02/5.47。计划 §4 D8-6 的 298/233/26 旧计数已更新为 281/52/29。冒烟复现命令补上 `--installer`。

### 第二轮只读核验与修复（2026-11-24）

第 12R 批记录完成后，主控又用 8 个只读 verifier 复核 B1、E5、E4/E1、S1、A6、发布工程、文档与对抗性 diff，确认了 4 类仍需修复的问题并已落地：

- **E5**：`stripExistingReferenceSections` 原实现按任意 3 个反引号切换围栏，嵌套围栏、列表项内代码块、后续另一份无序列表和多行续行会被误删或吞掉。现按 CommonMark 跟踪围栏字符/长度与 info string，列表扫描区分有序/无序标记和缩进，多行续行整体处理；标题后是正文时保留正文且不追加第二份列表。`tests/noteVault.test.ts` 增至 29 项（28 通过、1 跳过）。**语义**：有内联 `paperReference` 时仍按应用管理的规范列表重建；无内联引用时保留手写列表。
- **B1**：旧 MinerU 目录在策略内但 OS 拒绝列举（EPERM/EACCES）时仍会中止选择；现跳过并返回 `previous-unreadable`。写模式状态改用 `isWriteAllowed` 探测；渲染层 `library_add_attachment` 在写自定义译版目录前校验授权；`resolveForCheck` 沿最近存在的祖先做 realpath，堵住中间目录 junction 写出。`tests/pathPolicyAuthorization.test.mjs` 增至 16 项。
- **A6**：加载中的旧 `getTranslation` 快照可能覆盖已到达的 attached 事件；现用事件版本号守卫，旧快照不覆盖新事件。`tests/retainPdfUi.test.ts` 增至 24 项。
- **E4/E1 资产**：截图原先只去掉用户名，仍保留仓库绝对路径；现替换整个盘符路径并重新生成 16 张截图，`axe-report.json` 无路径残留。
- **S1 记录**：Notes/Graph 的基线方差原先取自另一次运行（PkdqXT），已改为最终 VdsmF7 的 13–23/σ4.1 与 23–27/σ1.7；冷启动端点更正为 100ms 轮询，并注明 59ms 差值低于分辨率、仅作方向性参考；记录默认的 `--disable-crash-reporter --disable-breakpad`。
- **文档**：修正 E5/A6 测试计数、axe serious incomplete 分组、README/用户手册/MCP 指南版本号与 `docs/RELEASE.md` 的 lint 步骤；第 12 批记录补充历史标注，避免与 12R 最终状态混淆。

## 四、状态汇总

- §3 9 行：A6、F4、E4/E1、E5、B1、S1、文档同步、S5 共 8 项 fixed；F2 1 项 partial（已知限制）。
- 附录 A：fixed 92 / partial 1（D1-13）/ open 0，本批未改变 D1-13 的签名/发布流水线未验证结论。
- 第 4–12R 批已提交（`415ce9b`）；`app-v0.4.38` Release verify 因 GitHub `RUNNER~1` 短路径与 CI 性能预算失败，未发布；`b64865a`、`92d9f5c`、`8fd9cd6` 修复后升 0.4.39 发布。
