# 2026-11-23 - 审计第 3 批：启动性能、设计系统、可访问性与工程化门禁

关联计划：[2026-11-22 代码、架构与 UI 专项审计](../plans/2026-11-22-code-architecture-ui-audit.md) 第 3 批（S1–S5、E2、E4–E5、F3–F5）。

本批只做「结构拆分之外」的部分：启动加载、设计系统收口、可访问性 / 国际化、工程化门禁与测试环境。
S2（巨组件拆分）、S3（桌面 / MCP 共享模块）、S4（单一设置存储）只完成现状测绘，未改代码；
S5 只落地了三处热点里风险最低的两项（图谱滑杆防抖、笔记草稿写入防抖），列表虚拟化与 fcose Worker 待排期。

## 现象

- **S1**：`App.tsx` 静态导入 Reader / Notes / Graph 并同时 `hidden` 挂载；Vite 只按少量模式分包，Tiptap、ProseMirror、lowlight、KaTeX、Cytoscape 全部落在同一个 2.5MB `vendor` 块并被 `modulepreload`，冷启动即解析编辑器与图引擎。
- **E2**：3 处原生 `window.confirm` / `window.prompt`；5 处自建 `fixed inset-0` 遮罩（未走 `Dialog`，缺焦点陷阱与滚动锁）；200 个硬编码调色板工具类 / 24 文件（其中 48 个浅色侧无 dark 配对）。
- **E4**：`index.css` 对所有 `input/textarea/select` 一律 `outline:none`，`.pq-input` 的焦点环是 10% accent（≈1.13:1）；命令面板自称 `aria-modal` 却自建遮罩、无焦点陷阱、选项不播报；`Menu` 的 Esc / 方向键只在 `keyboardAnchor` 存在时生效；标签页无 tab 语义，关闭按钮的 Space/Enter 被父级吞掉；`ConfirmDialog` 危险按钮用 `--pq-danger` 叠白字（深色 2.77:1）。
- **E5**：`<html lang>` 恒为 `zh-CN`；笔记 / 图谱标签标题硬编码中文；`NotesSidebar` 41 行中文无本地化入口。
- **F3**：渲染层依赖（React / Tiptap / Cytoscape / KaTeX 等）放在 `dependencies`，会整体复制进 asar；`temml` 全仓 0 引用；无 `engines`；MCP 的 Node 版本门禁写的是 22.5（`node:sqlite` 实际需 22.13）。
- **F4**：`tsconfig.json` 只检查 `src`；`electron/`、`bin/`、`tests/` 不参与类型检查；无 lint；CI 只有 build + test，release 标签不跑测试。
- **F5**：两个测试把 esbuild 产物写进 `%TEMP%`，本机安全软件锁住后稳定报 `Access is denied`，`npm run build` 也会在 `vite:esbuild-transpile` 阶段偶发失败。

## 修改

### S1 工作区懒加载

- `vite.config.ts` 改用 `rolldownOptions.output.codeSplitting.groups` 显式分组：`vendor-react`（react / react-dom / scheduler / zustand）、`vendor-graph`（cytoscape / fcose）、`vendor-editor`（@tiptap / prosemirror / lowlight / highlight.js）、`vendor-pdf`、`vendor-icons`、`vendor-markdown`（katex / react-markdown / remark / rehype / unified 族）、兜底 `vendor`。
  - 关键点：`vendor-react` 优先级高于 `vendor-editor`，否则 `@tiptap/react` 的递归依赖会把 react-dom 拖进编辑器块；`vendor-markdown` 同理高于编辑器块，否则 `@tiptap/extension-mathematics` 会把 KaTeX 一起带进来。
- `App.tsx`：Notes / Graph 改 `React.lazy` + `Suspense`，用 `visitedWorkspaces` 单调集合记录首次访问后保持挂载（工作区内部状态、cytoscape 实例、笔记编辑器不因切换重置）；Reader 保持同步导入。
- `AssistantSidebar.tsx`：摘录面板（经 `NotesSidebar → NoteEditor` 拉起 Tiptap/lowlight）改为首次打开后再加载并常驻挂载。
- 结果（本机实测 `npm run build` 后解析 `dist/index.html` 的静态 import 闭包）：首屏不再包含 `vendor-editor`（1.49 MB）与 `vendor-graph`（558 KB），两者只在首次打开笔记 / 图谱时按需下载。
- 新增 `tests/initialChunks.test.mjs`：从 `dist/index.html` 出发沿静态 `from"./x.js"` 求闭包，断言不含 prosemirror / lowlight / cytoscape 标识，且 `NotesWorkspace-*`、`KnowledgeGraphWorkspace-*`、`NotesSidebar-*` 不在首屏闭包内（`dist/` 缺失时跳过）。

### S5（部分）三处热点中的两项

- 知识图谱语义相似阈值滑杆增加 260ms 防抖（`debouncedEmbeddingMinSimilarity`），拖动过程中不再每次触发后端图谱重建。
- 笔记编辑器草稿写入防抖 300ms（`pendingDraftRef` + 定时器），切换笔记或卸载时立即冲刷，避免防抖窗口内丢失编辑。

### E2 设计系统收口

- 原生对话框：`NoteEditor` 的两处 `window.confirm` 改 `confirmAction()`（`refreshFromExternalUpdate` 相应改为 async，两处 onClick 包 `void`）；`NotesList` 的 `window.prompt('添加标签')` 改为新的 `src/ui/textInputDialog.tsx`（`TextInputDialog`，基于 `Dialog`，带 dialog 语义、焦点陷阱、Esc）。
- `LibraryTextInputDialog.tsx` 降级为对 `src/ui/textInputDialog.tsx` 的兼容 re-export。
- 自建遮罩迁 `Dialog`：块预览（2 处）、文库元数据对话框（原 `createPortal` + `bg-slate-950/30`）、笔记提炼预览（`dismissOnBackdrop={false}` 保持原交互）、阅读器设置窗口（去掉自建 Esc 与 `createPortal`）。
- 硬编码调色板清零：`bg-white/NN`、`bg-slate-50/NN`、`border-slate-200/NN`、`text-[#a0a0a0]` 等按语义换成 `--pq-surface-1/2/3`、`--pq-border`、`--pq-hover`、`--pq-text-muted/faint`；语义色（emerald/amber/rose）换成 `--pq-success/warning/danger(-bg)`；`text-white` 换按钮级令牌（`--pq-accent-button-text` / `--pq-danger-button-text`）。
- 新增 `--pq-window-close-bg` / `--pq-window-close-text` 令牌，替换标题栏关闭按钮的 `hover:bg-[#e81123]`。
- `tests/uiDesignTokens.test.ts` 扩展四条守卫：`window.confirm/alert/prompt` 为 0、`src/ui` 之外 `fixed inset-0` 为 0、无硬编码调色板类与任意 hex 颜色、无裸 `text-white`；并把遮罩断言改为「三处浮层都渲染 `<Dialog>` 且不再自建 `fixed inset-0`」。

### E4 可访问性

- `Dialog` 新增 `align: 'center' | 'top'`（命令面板靠上），并引入**对话框栈**：只有栈顶响应 Esc 与 Tab，解决设置窗口内嵌套密码框 / 确认框时的双焦点陷阱与 Esc 抢键。
- `CommandPalette` 改由 `Dialog` 承载，删除自建 portal 与 document 级 keydown；输入框改 `role="combobox"` + `aria-controls` + `aria-activedescendant`，列表加 `id`、选项加 `id` 且 `tabIndex={-1}`，并加 `role="status" aria-live="polite"` 播报结果数。
- `Menu`：Esc / Tab / 方向键 / Home / End 不再依赖 `keyboardAnchor`；指针打开的菜单记录触发前焦点，关闭时归还；`role="menu"` 与 `menuitem(checkbox)` 始终输出（指针打开时不抢焦点）。
- 标签页：`TabBar` 加 `role="tablist"` 与 ←/→/Home/End 导航；`TabItem` 改 `role="tab"` + `aria-selected` + `aria-controls` + roving `tabIndex`，关闭按钮 `onKeyDown` 停止冒泡；`App` 的三个工作区容器加 `role="tabpanel"` 与 `aria-labelledby`。
- 焦点：全局 `:focus-visible` 不再改 `border-radius`；只对自带焦点视觉的 `.pq-input` / `.pq-chat-composer` 内部控件抑制 outline，裸 `input/textarea/select/[contenteditable]` 恢复 2px accent 焦点环；`.pq-input` 焦点环从 10% accent 提到 45% accent（`color-mix`）。
- `ConfirmDialog` 危险按钮改用 `--pq-danger-button-bg/-text/-bg-hover`。

### E5 国际化

- 新增 `applyDocumentLanguage(locale)`，`App` 在 `uiLanguage` 变化时同步 `<html lang>`（`index.html` 的 `lang="zh-CN"` 只作水合前兜底）。
- `TabItem` 新增 `displayTabTitle()`：笔记 / 知识图谱标签在展示层本地化，文献与笔记标签保留用户标题；`TabBar` 右键菜单标题同步使用它。
- `NotesSidebar` 全量双语化：筛选与页面类型标签改为 `{zh, en}` 字典，锚点页标签 / 来源标题 / 三组右键菜单 / 头部按钮 / 抽屉标签 / 空态 / 搜索框 / 文件夹筛选 / 检索状态行 / 菜单标题全部走 `useLocaleText()`。
- 新增 `tests/uiA11yI18n.test.ts` 九条守卫，覆盖上述 E4 / E5 约定；其中 NotesSidebar 的检查用「`l(...)` 调用字符区间」判定，避免多行双语调用被误报。

### F3 依赖与打包

- `dependencies` 只保留主进程 / MCP 运行时真正 `require` 的包：`adm-zip`、`electron-updater`、`eventsource-parser`、`pdf-lib`、`sql.js`、`sqlite-vec`；React / Tiptap / Cytoscape / KaTeX / lowlight / lucide / zustand / react-markdown 族全部移入 `devDependencies`（Vite 已把它们打进 `dist/`）；删除 0 引用的 `temml`。
- 新增 `engines.node >= 22.18`；`bin/paperquay-mcp.cjs` 启动时检查 Node ≥ 22.13（`node:sqlite`）并给出可读错误；`mcpClientConfig.cjs` 的 `MIN_NODE` 从 22.5 改为 22.13（原 22.5 的说法不成立），启动提示同步。
- `build.files` 移除 `temml`，补 `builder-util-runtime`、`semver`；新增 `electron/packagingDependencies.cjs`：登记运行时依赖、渲染层专用依赖与已删除依赖，扫描 `electron/`、`bin/`、`src/shared/` 的实际 `require`，并校验 `build.files` 覆盖全部运行时依赖；`afterPack` 调用它，漂移即让打包失败。
- 新增 `tests/packagingDependencies.test.mjs`。

### F4 类型检查与 CI 门禁

- `tsconfig.node.json` 的 `moduleResolution` 改 `Bundler`。
- 新增 `tsconfig.electron.json`（`allowJs` + `skipLibCheck`，`checkJs: false`）与 `tsconfig.tests.json`（`tests/**` + `src/vite-env.d.ts`）。
  - 说明：`checkJs: true` 在 `electron/` 现有 156 处 JS 类型漂移（`Error.code`、解构参数推断、`node:sqlite` 返回类型）下无法一次清零，故本批先纳入「能被解析且不引入新错误」的范围，`checkJs` 增量清单留作后续。
- `npm run typecheck` 依次检查四个项目；`build` 改为 `npm run typecheck && vite build`。
- 修掉 tests 侧 17 处既有类型错误（补齐 `ragEnabled` / `pageKind` / `aiChatMessageIds` / `url` / `abstractText` 等 fixture 字段、`Error.code/status` 改 `Object.assign`、`as unknown as` 断言、删除已废弃的 `linkedNoteTitles` / `agentModelPresetId`），现在 `tsconfig.tests.json` 为 0 诊断。
- 修掉 `bin/paperquay-mcp.cjs` 两处把 `args` 传给零参 `listNoteFolders()` / `listCategories()` 的调用。
- `build.yml`：`npm ci` 后加 `npm run typecheck`，并在 `npm test` 后加打包冒烟 `node electron/build.cjs --win --x64 --publish never --dir`（由 `afterPack` 校验 PDF.js 资源、MCP sqlite-vec 与依赖审计）。
- `release.yml`：新增 `verify` 作业（typecheck + build + test），`build-electron` 与 `publish-release` 都 `needs: verify`，标签发布不再绕过测试。

### F5 测试与构建环境

- `tests/readerSettings.test.ts` 改 `write: false` + `data:` URL 导入，不再落盘。
- `tests/mcpClientLaunch.test.mjs` 改写到仓库内 `.tmp-test/`（已在 `.gitignore` 的 `.tmp-*` 规则内），并对 `Access is denied` / `EPERM` / `EBUSY` 做有限重试；清理同样带重试。
- `vite.config.ts` 的 `build.minify` 由 `esbuild` 改 `oxc`：Vite 8 的 oxc 压缩器不写 esbuild 临时文件，绕开本机 `%TEMP%` 锁；产物等价（本机连续多次 `npm run build` 均通过）。
- 新增 `tests/testTempHygiene.test.mjs`：禁止测试把 esbuild 产物写进系统临时目录，并断言 `.tmp-test` 被 gitignore。

## 验证

新增测试（6 个文件）：

- `tests/initialChunks.test.mjs`：冷启动静态闭包不含 prosemirror / lowlight / cytoscape；懒加载工作区块不在首屏闭包内。
- `tests/packagingDependencies.test.mjs`：依赖归类无漂移；运行时依赖留在 `dependencies`；渲染层专用与已删除依赖不得回到 `dependencies`；`engines` 与 `build.files` 覆盖运行时契约。
- `tests/testTempHygiene.test.mjs`：无测试把 esbuild 产物写进系统临时目录；`.tmp-test` 已 gitignore。
- `tests/uiA11yI18n.test.ts`（9 条）：命令面板走 `Dialog` 且有 combobox 语义；`Dialog` 有 `align` 与嵌套栈；`Menu` 键盘不再依赖 `keyboardAnchor`；标签页 tablist/tab 语义与关闭按钮不冒泡；裸控件焦点环 + `.pq-input` accent 环 + 全局焦点环不改圆角；危险按钮用按钮级令牌；`<html lang>` 跟随界面语言；静态标签标题本地化；`NotesSidebar` 无单语中文。
- `tests/uiDesignTokens.test.ts` 扩展（现 7 条）：新增原生对话框归零、`fixed inset-0` 归零、调色板与任意 hex 归零、裸 `text-white` 归零；遮罩断言改为「渲染 `<Dialog>` 且不自建遮罩」。
- 修改既有测试：`tests/readerSettings.test.ts`（内存构建）、`tests/mcpClientLaunch.test.mjs`（仓库内临时目录 + 重试）、`tests/noteEditorConflict.test.mjs`（`confirmAction` 桩）、`tests/mcpClientConfig.test.ts`（Node 下限 22.13），以及 tests 侧 17 处类型修复涉及的 fixture。

执行结果（Windows 11，Node 24.19）：

- `npm run typecheck`：四个项目全部 0 诊断（`tsconfig.json`、`tsconfig.node.json`、`tsconfig.electron.json`、`tsconfig.tests.json`）。
- `npm run build`：通过（连续多次，不再有 `%TEMP%` 失败）。
- `npm test`：928 项，927 通过、1 跳过、0 失败。
- 首屏分包实测：`dist/index.html` 静态闭包为 `index / vendor / vendor-react / vendor-pdf / vendor-icons / vendor-markdown / cn / core / rolldown-runtime`，不含 `vendor-editor`（1.49 MB）与 `vendor-graph`（558 KB）。

## 残留与边界

- **S2 / S3 / S4 未实施**：已完成现状测绘（组件职责聚类、桌面与 MCP 重复实现清单、四个设置所有者），但拆分与合并会大范围改动 `DocumentReaderTab` / `LiteratureLibraryView` / `ragStore` / `knowledgeMcpService`，且与并行会话的改动面重叠，留待单独批次。
- **S5 只做了两项**：文献列表虚拟化（5000 行目标）与 fcose 移入 Worker（10k 节点首屏 < 2s）未做；现有 CSS `content-visibility` 窗口化保留。
- **F4 的 `checkJs` 增量**：`electron/` 现有 156 处 JS 类型漂移未清零，`tsconfig.electron.json` 先以 `checkJs: false` 纳入解析范围；后续按文件逐个开 `checkJs`。
- **未引入 ESLint**：本机 `node_modules` 无 eslint 相关包，安装会改动 lockfile 与依赖树；本批改用 `node --test` 守卫测试锁住「禁用 `window.confirm` / 硬编码色」等规则，效果等价于 `no-restricted-syntax`。
- **E4 未做 axe 扫描**：仓库无 axe-core / testing-library，本批用源码断言 + 既有 jsdom 用例覆盖；真机深色 / 浅色截图人工复核仍待做。
- **E5 范围**：只覆盖计划点名的笔记侧、标签标题与文档语言；`src/services/notes.ts` 等服务层中文错误兜底、`noteEditorUtils` 斜杠模板文案未改（前者是签名变更，后者写入的是笔记数据）。
- **嵌套对话框**：`Dialog` 已按栈只让栈顶响应 Esc/Tab，但设置窗口内的 `BackupPasswordDialog` 尚未单独验证焦点行为。
- **`window.prompt` 语义变化**：笔记批量加标签从原生 prompt 改为全屏 `Dialog`，交互位置由抽屉内变为居中模态（有意为之）。
