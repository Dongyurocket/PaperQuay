# 2026-11-23 - 审计 4B-1 小批：启动/外壳边界、CSP 与 MinerU 资产读取（D1-8、D1-9、D1-13、D1-5、D1-6 残留）

关联计划：[2026-11-23 审计剩余工作清单](../plans/2026-11-23-audit-remaining.md)。本批只处理以下五项，不改 schema、不重构其他模块：

- D1-8：`whenReady` / `loadURL` / `loadFile` 的失败处理。
- D1-9：生产版渲染器崩溃与入口加载失败的可见性；无效 pending restore 的可读错误。
- D1-13：应用级 CSP、权限请求策略；sandbox 与 ASAR integrity 的风险登记。
- D1-5：MinerU `content_list` 的 asset 路径边界与 base64 读取。
- D1-6 残留：`backup_import_stage` 的包路径授权。

## 现象

- **D1-8**：`app.whenReady().then(...)` 没有 `.catch`，`loadFile` / `loadURL` 以 `void` 调用。Vite dev server 未启动、`dist/index.html` 缺失或初始化抛错时，窗口保持隐藏或进程悬挂；用户只看到白屏，后端与运行标记也不会清理。
- **D1-9**：`render-process-gone` / `did-fail-load` 只在 `isDev` 注册，生产版渲染器崩溃没有日志、对话框或恢复路径；无效 pending restore 在 `main.cjs` 的 catch 中被排除在错误框之外，只留下 `pending.error.json`。
- **D1-13**：无应用级 CSP；未接管权限请求策略；`sandbox:false` 与 `enableEmbeddedAsarIntegrityValidation:false` 没有风险评估。
- **D1-5**：`resolveMineruAssetPath` 把绝对路径、盘符与 URL 原样交给 `read_binary_file_base64`；pathPolicy 允许 dataDir / MinerU 缓存根内的任意文件被读为 base64。UNC 路径在 `pathPolicy.resolveForCheck` → `safeRealpathSync` 阶段会先触发 SMB 探测。
- **D1-6 残留**：`backup_import_inspect` 已绑定 `backup_select_package` 授权，但 `backup_import_stage` 仍直接使用渲染层传入的 `packagePath`；UNC 包路径可能在 stage 的容器校验前触发 SMB 探测。

## 修改

### D1-8 启动失败可见且可清理

- 新增 `electron/appLifecycle.cjs`：`describeStartupFailure`、`createStartupFailureHandler`、`loadRendererEntry`、`createRendererFailureController`。
- `electron/main.cjs`
  - 抽出 `cleanupApplicationResources()`：关闭 backend、移除 desktop run marker、释放 restore-resume 锁；初始化失败与后续窗口失败共用。
  - `app.whenReady().then(...)` 链末尾补 `.catch(handleFatalStartupError)`。
  - `createWindow` 改用 `loadRendererEntry(...)`，`.catch` 转给窗口失败控制器；`loadFile` / `loadURL` 的同步异常也会变成 rejection。
  - 失败处理器保证单次：日志 → 可读错误框 → 清理 → `app.exit(1)`。

### D1-9 生产版崩溃/白屏可见

- `electron/main.cjs`
  - `render-process-gone` 与 `did-fail-load` 不再包在 `isDev` 内；生产版同样记录日志。
  - `render-process-gone`：非 `clean-exit` 时弹出「Reload window / Quit PaperQuay」；重载失败或选择退出时走统一清理并退出。应用退出期间（`quitInProgress` / `quitFinished`）忽略。
  - `did-fail-load`：只处理主 frame，忽略 `ERR_ABORTED (-3)`；错误框后清理并退出，避免隐藏窗口悬挂。
  - `PENDING_CHECKSUM_INVALID` 改为显示可读错误框，说明数据未打开、记录已移动到 `PaperQuay-restore/pending.error.json`。
- `tests/appLifecycle.test.mjs` 覆盖一次性、同步抛错、dev/prod 加载、崩溃重载/退出、subframe 与 `ERR_ABORTED` 忽略。

### D1-13 CSP 与权限策略（sandbox / ASAR 登记为风险）

- 新增 `electron/appSecurity.cjs`
  - `buildContentSecurityPolicy({ isDev, devServerUrl })`：生产版 `default-src 'self'`、`script-src 'self' 'wasm-unsafe-eval'`（PDF.js WASM 图像解码）、`object-src 'none'`、`frame-src/frame-ancestors 'none'`、`base-uri 'self'`、`form-action 'none'`；允许 `paperquay-pdf:` / `paperquay-pdf-assets:`、`data:`/`blob:` 图片与 PDF.js 字体。开发版额外允许 Vite origin、HMR `ws:` 与内联 refresh preamble。
  - `injectContentSecurityPolicy(html, policy)`：写入或替换 `index.html` 的 CSP meta。
  - `installContentSecurityPolicy(session, ...)`：对 http 主文档响应头下发同一策略；file:// 文档不被 webRequest 拦截，由 meta 生效。
  - `createPermissionHandlers` / `installPermissionHandlers`：默认拒绝所有权限，只允许主窗口的 `clipboard-read` / `clipboard-write` / `clipboard-sanitized-write`。
- `vite.config.ts`：新增 `paperquay-csp` 插件，在 dev/build 的 `transformIndexHtml` 中注入对应策略。
- `electron/main.cjs`：在 `whenReady` 注册 `session.defaultSession` 的 CSP 与权限处理器；`sandbox:false` 处补充原因注释。
- `tests/appSecurity.test.mjs` 覆盖生产/开发策略、meta 注入/替换、仅主 frame 改写响应头、权限默认拒绝与剪贴板白名单。

### D1-5 MinerU 资产路径与读取边界

- `src/shared/mineruCachePaths.cjs` 新增 `sanitizeMineruAssetReference`：字符串层拒绝绝对路径、盘符、UNC/设备、URL、NTFS ADS、`.`/`..`、控制字符与尾部分隔符；渲染层与主进程共用。
- 新增 `electron/backend/mineruAssetPaths.cjs`：`resolveMineruAssetPath(cacheDir, assetPath)` 在字符串校验之后做 realpath 包含校验；UNC/ADS/绝对路径不会触发任何 fs 调用。
- `src/services/mineru.ts`
  - `resolveMineruAssetPath` 不再放行绝对路径/URL；只把净化后的相对引用拼到当前缓存目录。
  - `buildRenderableBlocks` 输出 `assetCacheDir` / `assetReference`，危险引用一律得到 `undefined`。
- `electron/backend/mineruCacheCommands.cjs` 新增 `read_mineru_asset_base64`：
  - `cacheDir` 必须是绝对路径、非 UNC/设备/ADS、在 pathPolicy 读根内，且目录内至少有一个解析产物（`content_list_v2.json` / `content_list.json` / `middle.json` / `full.md`）。
  - 资产经共享 resolver 做 realpath 包含校验；只允许普通文件，上限 64 MiB。
- `electron/ipcAllowlist.cjs` 登记新命令；`src/services/desktop.ts` / `src/services/assets.ts` 新增 `readMineruAssetBytes` / `loadMineruAssetDataUrl`；`blockViewerContent.tsx` 只用「缓存目录 + 相对引用」加载本地资源，不再把绝对路径交给通用文件读取。
- `electron/mcp/knowledgeMcpService.cjs` 的 `resolveMineruFigureAsset` 改为调用同一后端 resolver，删除重复实现。
- `tests/mineruAssetPath.test.ts` 覆盖缓存内外、UNC、设备路径、ADS、URL、穿越、`..`、符号链接逃逸、缺失文件、命令行读取与无 fs 探测。

### D1-6 残留 backup_import_stage 包路径授权

- `electron/backend/backupCommands.cjs`：stage 的 `packagePath` 改为 `authorizedPackagePath(args?.packagePath)`，与 inspect 共用 `backup_select_package` 的会话级登记；未登记、UNC、设备路径与 ADS 在 importer/容器读取前返回 `UNAUTHORIZED_PACKAGE`。
- `tests/backupCommands.test.ts` 新增 stage 的伪造/UNC/设备/ADS 用例与「先授权包、再授权目标」的成功路径；原有目标授权用例补选包步骤。

## 验证

- 新增 / 更新用例：
  - `tests/appLifecycle.test.mjs`：11 项（含 main.cjs 接线与无效 pending restore 文案）。
  - `tests/appSecurity.test.mjs`：7 项（含 main.cjs / vite.config 接线）。
  - `tests/mineruAssetPath.test.ts`：7 项。
  - `tests/backupCommands.test.ts`：新增 stage 包授权用例并更新目标授权用例。
- 命令与结果（2026-11-23，本机）：
  - `npm run typecheck`：四个项目 0 诊断。
  - `npm run build`：通过；`dist/index.html` 含生产 CSP meta。
  - `npm test`：987 项，986 通过、1 跳过、0 失败。4A-3 曾出现的 `knowledgeGraphCommands` Windows `EPERM` 本批未复现。

## 剩余风险

- **sandbox 仍为 false**：`preload.cjs` 还 require 本地模块（`ipcAllowlist.cjs`、`rendererStorageRestore.cjs`），sandboxed preload 不能加载本地 require；启用前需要把 preload 打成自包含文件。当前依赖 `contextIsolation:true` / `nodeIntegration:false` 与 IPC 白名单。
- **ASAR integrity 仍关闭**：`package.json` 的 `electronFuses.enableEmbeddedAsarIntegrityValidation` 仍为 `false`；安装包内的 `app.asar` 没有完整性校验，需在发布流水线单独启用并做安装版冒烟。
- CSP 的 `connect-src` 仍放开 `http:` / `https:`：渲染层需要按用户配置直接拉取远程 PDF 附件，无法枚举具体源；AI / MinerU / Zotero 网络调用都在主进程。`style-src 'unsafe-inline'` 是 Vite 注入样式、Tiptap 与现有内联样式的前提。
- 开发版 `script-src` 需要 `'unsafe-inline'`（React refresh preamble）与 dev server origin；生产版已收紧到 `'self'`。
- 生产版崩溃/加载失败对话框只做了控制器单测，未在安装版上执行真实崩溃演练；发布前仍应补一次安装包冒烟。
- MinerU 资产的 realpath 包含校验以传入的文档缓存目录为边界；`cacheDir` 本身仍受 pathPolicy 读根约束（默认 dataDir、MinerU 缓存根、对话框授权目录）。自定义 MinerU 缓存目录需要先通过设置页选择并登记。
- D1-5 只收紧由 MinerU 内容驱动的读取路径；通用 `read_binary_file_base64` 仍按 pathPolicy 读根放行（dataDir、文库/MinerU 根与对话框授权目录），这是渲染层既有的受信边界，不在本项范围内。
- 备份包与恢复目标的授权仍是会话级：跨重启断点续导需要把授权纳入持久 pathPolicy 并校验 restoreId。
