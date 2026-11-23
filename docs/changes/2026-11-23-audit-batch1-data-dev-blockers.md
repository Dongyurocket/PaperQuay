# 2026-11-23 - 审计第 1 批：数据丢失、主进程挂死与开发/安装阻断修复

关联计划：[2026-11-22 代码、架构与 UI 专项审计](../plans/2026-11-22-code-architecture-ui-audit.md) 第 1 批（A1–A4、F1–F2）。

## 现象

- 笔记超过 500 篇时，Vault 同步会把窗口外的 Obsidian Markdown 文件当作已删除并清理（A1）。
- 分类拖成环后，分类计数与分类过滤的递归查询在主线程无限展开，重启后仍存在（A2）。
- `paperquay.config.json` 读取/解析失败被当作首次运行，回退配置在 350ms 后写回文件，覆盖其中的 API Key（A3）。
- 文库超过 1000 篇时，阅读器用 `library_list_papers` 的 1000 条截断结果覆盖全库快照，窗口外文献无法从图谱/笔记跳转（A4）。
- `npm run dev` 下 `src/shared/*.cjs` 未被转换为 ESM，渲染层链接期报缺少具名导出（F1）。
- 安装包未携带 `pdfjs-dist` 的 `cmaps` / `standard_fonts` / `image_decoders`，中文 CID 字体 PDF 丢字（F2）。

## 修改

### A1 Vault 同步

- `noteStore` 新增内部 `listAllNotes()`（不套 500/5000 上限），`listNotes` 保持原分页语义。
- `noteVault.syncNow()` 的阶段 1/2 与阶段 3 存在性判断全部改用全量列表；阶段 1 导入后原地更新内存列表与 id 索引，不再每次重查或重建 O(N) Map（原先在每篇笔记上重建标题索引，1 万篇时单次同步会卡住主线程十余秒）。
- 阶段 3 改为先收集待删除项，再按「超过受管文件总数 5% 或超过 20 个」熔断；未确认时保留文件与 manifest，返回 `removalConfirmationRequired` / `pendingRemovals`。
- `notes_vault_sync_now` 接受 `options.confirmRemoval`；笔记工作区手动同步弹共享确认框，确认后重试，自动同步只暂缓不删除。

### A2 分类环

- `library_update_category` / `library_create_category` 写入前校验父级：不能是自身、后代、系统分类或不存在的分类（带 visited 集合，历史环也能终止）。
- `saveCategoryToDb`（MCP 单行写入）在父级变化时做同样的校验；重命名不受历史 dangling parent 影响。
- 两处递归 CTE（分类计数、分类过滤）改为 `UNION` 去重，环存在时自然终止。
- `createLibraryDatabaseStore` 启动时执行环检测：只摘除真正位于环上的节点（取 id 最小者，结果确定），环外的正常子分类保持原父子关系；不修改 `updated_at`，避免触发版本冲突。

### A3 配置读取

- `readerConfig` 增加三态读取（loaded / missing / error）与可注入 IO 依赖；只有 ENOENT 视为首次运行，存在但为空/只有空白的文件按损坏处理。
- `resolveReaderConfigForHydration` 在读取/解析失败时返回 `persistenceEnabled=false`；`useReaderSettings` 保留 localStorage 中的上次设置与密钥供本次会话使用，但禁用配置写回，并通过常驻 toast（`duration: 0`）与 `configLoadError` 显示带配置路径的可恢复错误。
- 读取失败时仍用文库里的 `zoteroLocalDataDir` 回填状态，避免 Reader 的 500ms 同步 effect 把空值写回文库、抹掉用户已配置的 Zotero 目录。
- `writeReaderConfigFile` 覆盖前写一份固定名 `<config>.bak`（内容未变则不写），写入后读回校验；校验成功才删除旧 `paper-reader-secrets-v1`。

### A4 大文库快照

- 新增 `library_get_paper` IPC 与 `getLibraryPaper()`，跨文献跳转改为单条查询，不再拉取或覆盖全库快照。
- 新增 `listAllLibraryPapers()`（`library_query_papers` 分页取全量，按 id 去重、按 `total` 终止）；阅读器初始 `workspaceItemMap` 与文献库全库后台任务共用该 helper。
- 删除两处 `setAllLibraryPapers(截断结果)` 覆盖。
- 笔记工作区的文献候选改为首次激活时才分页拉取，不再为隐藏工作区在每次启动时加载全库。

### F1 开发态 shared CJS

- 新增 `vite.sharedCjs.ts`：把 `src/shared/*.cjs` 末尾的 `module.exports = { ... }` 统一转换为显式 `export { ... }`；支持 `local: exported` 别名写法，其他不支持的写法直接报错。
- `vite.config.ts` 的 dev 插件改为覆盖全部 shared CJS；Electron 侧仍直接 `require` CJS，生产构建不变。

### F2 PDF.js 资源

- `package.json` 的 `extraResources` 增加 `pdfjs-dist/{cmaps,standard_fonts,image_decoders}` → `resources/pdfjs/*`。
- 新增 `electron/pdfJsAssets.cjs`：开发态路径保持 `node_modules/pdfjs-dist`，安装版解析 `process.resourcesPath/pdfjs`。
- `afterPack` 校验三个目录、代表文件，并与源目录文件数比对（部分复制会失败）；缺任一资源即打包失败。

## 验证

新增/更新测试：

- `tests/noteVault.test.ts`：520 个既有 vault 文件首次导入后文件数不减少、每篇内容逐字保留；520 篇数据库笔记全部导出；编辑窗口外笔记不触发删除；删除熔断确认前后行为。
- `tests/libraryCommands.test.mjs`：自指、直接/跨层后代、系统父级、缺失父级均被拒绝；手工写入 A↔B 环后分类列表与分类过滤查询均在 100ms 内返回；重启后环被断开且环外子分类保持挂载；1200 篇文库中第 1199 篇可被 `library_get_paper` 读取，分页第 2 页返回 200 条。
- `tests/readerConfig.test.ts`：loaded / missing / 损坏 JSON / 空文件 / EACCES 路径；失败时文件字节不变、API Key 仍可读；固定名备份、内容未变不备份、读回校验与写入截断拒绝。
- `tests/readerSettingsHydration.test.mjs`：真实 `useReaderSettings` + 假 bridge：损坏配置不写回、显示错误 toast、Zotero 目录不被清空；正常配置能 hydrate 并写回；空文件按损坏处理。
- `tests/libraryPaperPaging.test.mjs`：`listAllLibraryPapers` 跨页取回 1200 篇且无重复；文库在分页中途变小时能终止；`getLibraryPaper` 能取到 1000 条窗口外的文献。
- `tests/sharedCjsDevExport.test.ts`：每个 shared CJS 的转换结果与 `module.exports` 键一致；别名写法生成 `as`；真实 Vite `transformRequest` 对三个模块均无 `module.exports`、含 `export {}`。
- `tests/mcpPackaging.test.ts`：extraResources 清单包含 PDF.js 三目录；安装版资源根指向 `resources/pdfjs`；缺目录/代表文件时断言失败；仅有代表文件的部分复制也会失败；仓库内 `pdfjs-dist` 具备全部代表文件。

执行结果（Windows 11，Node 24.19）：

- `tsc`：通过。
- `npm test`：841 项，833 通过、7 失败。7 项均为计划 F5 记录的本机 `%TEMP%` esbuild 写入/清理 `Access is denied`（`tests/readerSettings.test.ts` 6 项、`tests/mcpClientLaunch.test.mjs` 1 项），与本次改动无关；本次涉及的全部测试通过。
- `vite build`：本机仍因同一 F5 的 esbuild 临时目录清理问题在 `vite:esbuild-transpile` 阶段失败；跳过 esbuild transpile（`target: esnext`、`minify: false`）时 Rollup/Oxc 打包输出 `BUNDLE OK`，确认源码与打包图无类型/解析错误。
- `npm run dev` 链路：用真实 Vite `transformRequest` 验证 `markdownToTiptap.cjs`、`ragQueryUtils.cjs`、`rendererStorageRemap.cjs` 均返回 ESM 导出。
- 安装包：本机未执行完整 `electron-builder`（受同一 F5 构建阻断）；`extraResources` 与 `afterPack` 断言已由单元测试覆盖，安装版 PDF 实机验收留待可打包环境。
