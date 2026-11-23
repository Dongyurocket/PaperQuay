# PaperQuay 代码、架构与 UI 专项审计与修复计划

- 日期：2026-11-22（审计执行 2026-11-22 至 2026-11-23）
- 状态：**第 1 批（A1–A4、F1–F2）、第 2 批（A5–A7、B1–B5、C1–C5、E1、E3）与第 3 批（S1、S5 部分、E2、E4–E5、F3–F5）已实施**（2026-11-23，见[第 1 批](../changes/2026-11-23-audit-batch1-data-dev-blockers.md)、[第 2 批](../changes/2026-11-23-audit-batch2-security-reader-notes-ui.md)、[第 3 批](../changes/2026-11-23-audit-batch3-startup-design-a11y-build.md)变更记录）。
- 复核（2026-11-23）：**S2 未开始、S3 部分完成、S4 未开始、S5 部分完成；附录 A 93 条中 21 条已修、16 条部分修复、56 条开放；E4/E5/F4 仍有验收残留。**逐条状态、证据与建议批次见[剩余工作清单](2026-11-23-audit-remaining.md)。
- 代码基线：`main`，`package.json` 版本 `0.4.37`
- 范围：仅代码、架构、UI 与工程化；不含产品路线、文档措辞与发布安排
- 审计方式：两轮多 agent 并行审计 + 对抗性源码核验。候选 112 条：110 条保留、2 条否定；完整性复核另补 4 条（2 条并入正文 A1/A6，2 条入附录 A）。正文收录 32 个修复主题（覆盖全部 19 条 P1 与部分 P2/P3），附录 A 为 93 条 P2/P3 清单
- 证据口径：**实测**＝本机运行或直接读源码确认；**源码核验**＝两条独立审计与对抗核验一致；**待复现**＝逻辑成立、尚未运行复现
- 关联文档：[AGENTS.md](../../AGENTS.md)、[UI 设计系统](../ui-design-system.md)、[核心工作流优化](2026-11-18-agent-chat-retrieval-notes-and-review-removal.md)

> 级别沿用审计的 P1/P2/P3；A1 属数据丢失类 P1，实际按最高优先处理。修复时不改文库 / RAG / 笔记 schema，不写用户数据；新增测试优先使用隔离临时目录。

---

## 1. 摘要

功能密度和文档水平都不错，当前风险集中在五处：

1. **数据安全**：Vault 同步、分类移动、配置读取、超千篇文库四条边缘路径会丢数据、丢密钥或挂死主进程。
2. **安全边界**：渲染进程可通过单一 IPC 通道读写任意本地文件；叠加 `sandbox:false`、无 CSP、任意 `file://` 导航，任一 XSS 即升级为宿主代码执行。
3. **功能正确性**：MCP 图表读取与阅读器缓存键不一致；翻译 IPC 忽略批处理/超时/取消；QA 上下文预算算完即丢；整库 `save()` 覆盖并发 MCP 写入。
4. **架构债务**：四个 2k–4.7k 行前端组件、三个 1.2k–3.3k 行后端模块；桌面与 MCP 双份业务逻辑已开始漂移。
5. **UI 与工程化**：深色主题白底白字、手写遮罩与硬编码色回归；`npm run dev` 已断、安装包缺 PDF.js 资源、类型检查与打包校验存在盲区。

### 1.1 修复批次

| 批次 | 事项 | 目标 |
| --- | --- | --- |
| 第 1 批 | A1–A4、F1–F2 | 止住数据丢失、主进程挂死、开发与安装版阻断 |
| 第 2 批 | A5–A7、B1–B5、C1–C5、E1、E3 | 安全收口与阅读/翻译/RAG/笔记正确性 |
| 第 3 批 | S1–S5、E2、E4–E5、F3–F5 | 架构拆分、性能、设计系统清理与工程化 |

### 1.2 审计量化基线

- **IPC**：`src/` 中 135 个 `invoke(...)` 命令字面量（134 个不同命令），共用 1 个 `paperquay:invoke` 通道；0 处 `senderFrame` 校验、0 个参数 schema。
- **组件规模**：`DocumentReaderTab.tsx` 4,719 行 / 222 个 hook 调用（50 useState、28 useEffect、95 useCallback、19 useMemo、30 useRef）；`LiteratureLibraryView.tsx` 3,850 行 / 46 个 useState（`:368-442`）；`PdfViewer.tsx` 3,383 行 / 43 个 useEffect；`NoteEditor.tsx` 1,946 行。
- **后端规模**：`knowledgeMcpService.cjs` 3,279 行；`ragStore.cjs` 2,461 行；`libraryDatabaseStore.cjs` 1,660 行；`backupImport.cjs` 1,582 行；`libraryCommands.cjs` 1,255 行。
- **UI**：`text-[10px]` 0 处（合规）；硬编码调色板类 51 处 / 19 个文件；非 `src/ui` 的自建 `fixed inset-0` 遮罩 5 处。
- **类型**：`as any` / `: any` / `@ts-ignore` 共 24 处 / 6 个文件。
- **测试**：140 个测试文件、24,494 行；13 个测试文件在运行期调用 esbuild，其中 2 个把产物写入 `%TEMP%`（`readerSettings`、`mcpClientLaunch`）。
- **打包**：`electron-builder.files` 共 28 条模式（23 条 `node_modules` 包含、1 条排除，另有 4 条应用路径）；生产依赖仍整体进入 asar。`pdfjs-dist` 因是 devDependency 未被打包，但运行时协议仍从 `node_modules/pdfjs-dist` 取资源。

---

## 2. 先修：数据与阻断问题

### A1. Vault 同步在超过 500 篇笔记时删除用户的 Markdown 文件

- **级别**：P1（数据丢失，按最高优先处理）
- **证据**：`electron/backend/noteVault.cjs:574,638-649`、`electron/backend/noteStore.cjs:960`（源码核验）
- **现状**：阶段 2 在 `noteVault.cjs:574` 调用 `noteStore.listNotes({ includeDeleted: false })`，默认 `limit = 500`；阶段 3（`:638-649`）复用这份列表，把「不在列表里」的 manifest 条目一律视为笔记已删除，执行 `fs.rmSync(..., { force: true })` 并删除 manifest 记录。`listNotes` 只返回按 `is_pinned DESC, updated_at DESC, created_at DESC` 排序的前 500 条（`noteStore.cjs:960,994-1000`），而阶段 1 已为每篇新笔记写入 manifest（`:566`）。首次导入 501+ 文件时，窗口外（较早创建）的新笔记文件会在导入后当场被删除；后续同步中，被编辑挤出 500 条窗口的笔记同样会被删。
- **影响**：开启 Vault 同步且笔记超过 500 篇时，用户 Obsidian vault 中的文件名、目录与双链永久丢失（正文仍留在 PaperQuay 数据库）。
- **修法**：导出前分页取全量（`listNotes` 支持到 5000，或新增内部 `listAllNoteIds()`）；阶段 3 改为按 id 存在性判断，不基于截断列表；增加删除熔断（单次删除超过文件总数的 5% 或超过 20 个文件时要求显式确认）。
- **验收**：新增测试：501+ 笔记与 501+ 既有文件，同步后文件数量不减少、内容逐字一致；再跑全量 `npm test`。

### A2. 分类可拖成环，递归 CTE 挂在主线程且重启后仍存在

- **级别**：P1（主进程挂死）
- **证据**：`electron/backend/libraryCommands.cjs:672-695`（`parentId` 无祖先校验）、`src/features/literature/components/LiteratureCategorySidebar.tsx:215-243`（拖拽直接提交）；隔离复现：2 行分类互设父子后，生产同形的 `WITH RECURSIVE ... UNION ALL` 查询 8 秒未返回（源码核验 + 隔离复现）
- **现状**：`library_update_category` / `library_move_category` 只写 `parentId`，随后同步调用 `store.listCategoriesWithCounts()`；环一旦写入数据库，每次分类计数或分类过滤查询都会在主线程无限展开。
- **影响**：一次正常拖拽即可让整个应用冻结，重启后仍然冻结，只能手工修库。
- **修法**：写入前校验「新父节点不能是自己或自己的后代」（MCP 侧已有循环检测可复用）；CTE 改用 `UNION` 去重以自然终止；增加深度列或 `LIMIT` 作纵深防御；启动时检测并修复既有环。
- **验收**：单元测试覆盖 A→B→A、自指、跨层循环；构造环后分类列表接口在 100ms 内返回；启动修复测试。

### A3. 配置读取失败被当作首次运行，覆盖 API Key 并可能回退设置

- **级别**：P1（数据丢失）
- **证据**：`src/services/readerConfig.ts:9-20`、`src/features/reader/useReaderSettings.ts:286-372,423-455`（源码核验）
- **现状**：`readReaderConfigFile` 对 `JSON.parse` 与文件读取异常直接抛出；`useReaderSettings` 在 `catch {}`（`:331`）吞掉异常后，以 localStorage 中的 `paper-reader-settings-v3` 与默认值合并（`:299-304`），`configHydrated` 置真；350ms 防抖后（`:428-444`）把这份回退配置写回 `paperquay.config.json`。写入成功后又删除旧 `paper-reader-secrets-v1`（`:439`），因此 API Key 没有 localStorage 副本可回退。
- **影响**：文件被手工改坏，或 Windows 上 `EACCES/EBUSY` 瞬时占用，都会在用户无感知的情况下用 localStorage 回退值重写配置文件，覆盖文件中的全部 API Key；设置会回退到 localStorage 的上次值，仅当 localStorage 也为空（换机、清空配置后只恢复配置文件）时才被默认值覆盖。
- **修法**：区分 `ENOENT`（真首次运行）与读取/解析失败；失败时不 hydrate 默认值、不启动持久化，向用户显示可恢复错误；覆盖前保留时间戳 `.bak`；只有读回新文件成功后再删除旧 localStorage。
- **验收**：测试「配置损坏」「读取抛 EACCES」「读取成功」三条路径，断言损坏时文件内容不变、密钥仍可读。

### A4. 超过 1000 篇的文库：Reader 用截断快照覆盖完整文库

- **级别**：P1（功能错误）
- **证据**：`src/features/reader/Reader.tsx:613` 请求 `limit: 5000`，`electron/backend/libraryCommands.cjs:725` 将其夹到 1000；`Reader.tsx:286-316` 用该列表构建 `workspaceItemMap`；`LiteratureLibraryView.tsx:885-892,2178-2184` 的完整快照经 `onAllPapersChange` 送到 `Reader.tsx:1006`，会被 `Reader.tsx:606-628`（以及跳转处的 `:722`、`:788`）用 1000 条截断列表覆盖（源码核验）
- **现状**：文库超过 1000 篇时，较早的文献不在 `workspaceItemMap` 中；从图谱节点或笔记内文献引用跳转报 `No paper was found for this reference`（`Reader.tsx:794`），从笔记锚点跳转报 `No openable PDF was found for this reference`（`Reader.tsx:730`），尽管文献确实存在。
- **影响**：大文库用户的跨文献导航在 1000 篇之外静默失效；由于覆盖方向是「截断覆盖完整」，切换到文库工作区后问题持续存在。
- **修法**：改用既有分页 helper 取全量，或新增 `library_get_paper(id)` 单条查询；IPC 返回 `total` 与 `truncated` 标志；禁止截断结果覆盖完整快照。
- **验收**：用 1200 条合成数据（隔离目录）验证第 1199 篇可通过锚点打开；接口返回 `truncated: true` 时前端不发覆盖写。

### A5. paperHistory 是无界的整表 localStorage 文档，滚动时同步写入且不处理配额

- **级别**：P1（性能 / 稳定性）
- **证据**：`src/utils/paperHistory.ts:50-61,95-153,220-300,306-331`、`src/features/reader/DocumentReaderTab.tsx:741-820`（源码核验）
- **现状**：每次滚动位置保存都会解析并重新序列化整个多 MB 的 map；写入是同步的；`QuotaExceededError` 未被捕获。
- **影响**：重度用户会耗尽 5–10MB origin 配额，历史记录静默停止保存，异常还可能从 React effect 逃逸；滚动期间主线程周期性卡顿。
- **修法**：迁移到 IndexedDB 或后端，按论文一行；限制每篇会话数与全局记录数；只写变更的论文；所有 localStorage 写入统一走带降级与提示的 helper。
- **验收**：合成 5000 条历史记录，滚动保存单次耗时 < 5ms；配额耗尽时 UI 有提示且不崩溃。

### A6. RetainPDF 的 starting/uploading 僵死记录永久阻塞重译

- **级别**：P1（功能阻断）
- **证据**：`electron/backend/retainPdfIntegration.cjs:21-36,806-809,884-888,898-901,915-934`（源码核验）
- **现状**：启动或上传阶段崩溃/强制退出后，记录永久停留在 active 状态；6 小时超时只覆盖轮询循环存活的情况；再次翻译返回误导性的「任务已在运行」；UI 不显示、不可取消。
- **影响**：用户必须手工编辑 `%APPDATA%\PaperQuay\PaperQuay\.retainpdf-jobs.json` 才能恢复。
- **修法**：把 `starting`/`uploading` 视为可恢复（重启流水线或标记为可重试失败）；加载时按 `updatedAt` 过期 active 记录；现有 status/cancel 命令接入文献详情状态与任务中心。
- **验收**：模拟进程在 starting 阶段退出，重启后状态可重试或可取消；连续两次翻译不会误报 already running。

### A7. 笔记外部更新与搜索会干扰当前编辑器

- **级别**：P1（数据一致性 / 交互）
- **证据**：`src/features/notes/NotesWorkspace.tsx:1146-1177`（`:1154-1157` 遍历所有打开的笔记标签并逐个置为外部更新）；`:1109-1143` 的 `NOTE_CHANGED` 处理是按 `noteId` 定向的，不产生全量标记；`:831-838` 搜索/标签过滤把编辑器重绑到第一条结果（源码核验）
- **现状**：MCP 或另一窗口只改了一篇笔记，所有打开的笔记标签都显示「外部更新」；脏编辑器可能弹假冲突。搜索时当前编辑中的笔记被替换为搜索结果第一条。
- **影响**：用户可能误点覆盖、丢失未保存编辑；搜索成为破坏性操作。
- **修法**：外部写入按 `noteId` 定向失效；只有命中当前笔记且版本不一致时才提示冲突；搜索/过滤不改变当前编辑器绑定。
- **验收**：两篇笔记同时打开，外部只改 B，A 不显示冲突；在笔记 A 中搜索后编辑器仍为 A。

---

## 3. 安全边界

### B1. 渲染进程是无限 IPC 主体：任意文件读写

- **级别**：P1（宿主代码执行）
- **证据**：`electron/main.cjs:202-204`、`electron/preload.cjs:130-134`、`electron/backend/fileCommands.cjs:473,529,545,550,555`（源码核验）
- **现状**：preload 暴露 `invoke(command, args)`；main 直接按命令名分派，不校验 `event.senderFrame.url`；`fileCommands` 提供 `approve_write_path`、`read_text_file`、`write_text_file`、`read_binary_file_base64`、`write_binary_file_base64`，其中 `approve_write_path` 允许渲染进程自行批准任意路径。
- **影响**：任意渲染层脚本（XSS、恶意依赖）可读取 `paperquay.config.json`（明文 API Key）、SSH/凭据文件，并写入启动目录或 shell 配置，形成用户级代码执行。叠加 `sandbox:false`（`main.cjs:140`）与无应用级 CSP，防护只剩 `contextIsolation`。
- **修法**：preload 改为按域暴露方法并维护显式命令白名单；main 校验 `senderFrame.url` 必须是应用自身文档；写权限改为「主进程对话框返回的不透明句柄」，不再接受任意路径；读操作增加允许根目录（dataDir、文库、译版、MinerU 缓存）与 realpath 包含校验。
- **验收**：新增 IPC 安全测试：非白名单命令被拒；非应用来源帧被拒；越界路径读写被拒；`approve_write_path` 不可由渲染直接调用。

### B2. `run_mineru_cloud_parse` 信任前端传入的 PDF 路径、API 主机与解压目录

- **级别**：P1（任意文件外传 / 任意目录写）
- **证据**：`electron/backend/mineruCommands.cjs:162-197,95`（源码核验）
- **现状**：命令接受任意 `pdfPath`、任意 `apiBaseUrl`、任意 `extractDir`，并把下载的 zip 解压到该目录；无条目数、总大小、单条目大小限制。
- **影响**：可把任意本地文件上传到攻击者主机，并把攻击者控制的 `.bat/.lnk` 写入启动目录；zip 炸弹可打满内存或磁盘。
- **修法**：只接受文件选择器返回的路径或主进程已批准的文件；解压目录固定到 `mineruCacheDir` 下的受控子目录；`apiBaseUrl` 与配置端点比对；zip 校验条目数与解压后大小，拒绝 Windows 保留名与 ADS。
- **验收**：越界路径、非白名单主机、超大 zip 三条用例均被拒绝并返回明确错误码。

### B3. MinerU 表格 sanitizer 可被不允许标签的子节点绕过

- **级别**：P1（XSS）
- **证据**：`src/utils/safeHtml.ts:25-83`、`src/features/blocks/blockViewerContent.tsx:451-454,482-488`（源码核验）
- **现状**：`sanitizeElement` 遇到不在白名单的标签时，把子节点搬到父节点后删除自身，但不再递归清洗被搬出的子节点；被搬出的 `<img onerror>` 等会保留。
- **影响**：构造过的 MinerU JSON（导入的 `.pqbackup`、用户选择的本地 JSON、来自不可信 PDF 的解析产物）可在渲染表格时执行脚本；结合 B1 即本地数据全读写与网络外传。
- **修法**：改用 DOMPurify 并配置表格标签/属性白名单；或修正 unwrap 逻辑：搬出后递归清洗、遍历活动子节点列表；补两条 payload 回归测试；应用壳层加 CSP 作纵深防御。
- **验收**：`<table><div><img src=x onerror=alert(1)></div></table>` 与嵌套 `<script>` 两条 payload 渲染后无事件属性、无脚本节点。

### B4. `paperquay-pdf` 协议可读取任意 `.pdf`（含 UNC）

- **级别**：P1（本地文件读取）
- **证据**：`electron/localPdfProtocol.cjs:119-150,13-36`（源码核验）
- **现状**：只校验 `hostname === 'local'` 与扩展名 `.pdf`，不校验路径是否位于允许根目录，也不做 realpath/UNC 拦截。
- **影响**：渲染层可读取任意可访问的 PDF（含网络共享），并把内容带回应用上下文；UNC 路径还会触发 SMB 探测。
- **修法**：维护允许根目录（文库、译版、MinerU 缓存、用户显式打开的文件），解析 realpath 后做包含校验；拒绝 UNC 与设备路径；协议处理器校验方法与来源。
- **验收**：`?path=C:\Windows\...\*.pdf`、`?path=\\server\share\x.pdf`、`..\` 穿越三类请求返回 400/404。

### B5. API Key 明文保存在 reader 配置文件

- **级别**：P1（凭据泄露）
- **证据**：`src/features/reader/useReaderSettings.ts:428-455`、`src/services/readerConfig.ts:22-28`；全仓无 `safeStorage`（源码核验）
- **现状**：`writeReaderConfigFile` 把 `secrets: readerSecrets` 以 JSON 明文写入用户目录，包含翻译、总结、嵌入、Zotero、MinerU 等 Key。
- **影响**：任何本地进程、同步盘或备份副本都能直接读到全部 Key；与 B1 组合时泄露面更大。
- **修法**：使用 Electron `safeStorage`（Windows DPAPI）加密 `secrets` 字段，或整体加密配置文件；保留对旧明文配置的读取迁移；`.pqbackup` 继续使用既有密码加密。
- **验收**：写入后磁盘文件不含明文 Key；旧配置首次加载可迁移且不丢 Key。

---

## 4. 功能正确性

### C1. `read_paper_figure` 的缓存键与阅读器不一致

- **级别**：P1（Agent 证据缺失）
- **证据**：`electron/mcp/knowledgeMcpService.cjs:2233,2254`（`fnv1a(paperId)`，只读 `content_list_v2.json`）；`src/features/literature/literatureLibraryUtils.ts:530`（`native-library:<paperId>`）、`src/utils/mineruCache.ts:96-131`（按 `workspaceId` 哈希，接受三种 JSON）（源码核验）
- **现状**：当前阅读器解析的论文缓存目录名为 `document-<hash("native-library:<id>")>`，MCP 查找 `document-<hash(id)>`，匹配不到；即使目录名吻合，也只读 `content_list_v2.json`。
- **影响**：Agent 对当前版本解析的论文调用 `read_paper_figure` 返回 `found:false`，静默丢失图表证据，尽管 `read_paper_content` 能返回 blockId。
- **修法**：把缓存路径构造抽到 Node 可用的共享模块，阅读器与 MCP 共用；MCP 同时接受三种 JSON 候选；新增测试必须通过阅读器的路径构造器写缓存，而不是复制哈希算法。
- **验收**：用真实 MinerU 缓存样本（只读副本）调用 MCP，能按 `read_paper_content` 返回的 blockId 取到图。

### C2. 翻译 IPC 忽略批处理、超时、取消与限流

- **级别**：P1（配额与体验）
- **证据**：`electron/backend/aiCommands.cjs:488-507`、`electron/backend/utils.cjs:823-845`（源码核验）
- **现状**：按块逐个请求，500 块即 500 次串行 HTTP；无重试/退避、无请求超时；界面「停止」只停止消费当前 IPC，后端继续发请求；`requestsPerMinute` 设置未生效。
- **影响**：长文献翻译慢且易触发限流，停止后仍消耗配额；请求挂起时界面永久停在 translating。
- **修法**：在 `aiCommands.cjs` 内真正合批（或受限并发队列）；为请求加 deadline 与重试退避；引入 per-request id 与 `translate_cancel` 命令，取消时 abort `AbortController`；实现或移除每分钟限流设置。
- **验收**：500 块文献的请求数 ≤ 批大小×块数策略上限；取消后 1s 内不再有新请求；超时返回可重试错误。

### C3. QA 上下文预算计算后被丢弃

- **级别**：P1（上下文溢出）
- **证据**：`src/features/reader/DocumentReaderTab.tsx:2085-2163,3674-3771`、`src/features/reader/readerRag.ts:1313-1334`（源码核验）
- **现状**：模型预设的 `contextWindow` 参与预算计算，但结果未传入最终上下文拼装；全文回退路径不受约束；内部的约 6000 token 预算只限制邻居扩展，不限制最终 section 集合。
- **影响**：8k/32k 本地模型出现 400 或服务端静默截断；tokens 被超长提示词消耗；承诺的「已丢弃证据计数」从不出现。
- **修法**：将 `tokenBudget` 从 `handleSubmitQa` 贯穿 `resolveQaRequest` → `resolveLocalRag` / `resolveLibraryPaperRagContext`；在 `buildRagContextText` 做最终硬裁剪；MinerU/PDF 全文回退同样按剩余预算裁剪。同时在 `resolveLocalRag` 的 `kind: 'retrieved'` 返回中补 `budgetSkippedCount: contextDocument.budgetSkippedCount`（`src/services/localRag.ts:603-612`，对齐库检索分支 `:1028`），否则 `qaContext.budgetSkippedCount` 恒为 `undefined`（`readerQaContext.ts:121`），验收无法成立。
- **验收**：构造超预算上下文，断言 `budgetSkippedCount > 0` 且最终提示词 token 数低于预算。

### C4. 数据一致性：删除论文不清 RAG；整库 `save()` 覆盖并发 MCP 写入

- **级别**：P1（数据不一致）
- **证据**：`electron/backend/libraryCommands.cjs:1029-1044`（删论文）、`:638,668,683,719,771,897` 与 `electron/backend/noteVault.cjs:406`（笔记 Vault 设置更新，非 sync）（源码核验）
- **现状**：删除论文只删文库记录，RAG 的 chunks、indexes 与文档向量保留；六个写路径与 `notes_vault_update_settings` 都执行「整库 DELETE + 重新插入」，在桌面与 MCP 并发时会用旧快照覆盖对方刚提交的记录。`notes_vault_sync_now` 本身不执行整库保存。
- **影响**：已删论文继续被检索命中；`allowWhileAppRunning` 的版本检查只保护 MCP 一侧，桌面侧仍可静默回滚 MCP 写入。
- **修法**：删除论文时调用 `ragStore.removeDocumentIndex({ documentKey: paperId })`（`electron/backend/ragStore.cjs:2405-2428`；实际表为 `rag_chunks`、`rag_indexes`、`rag_document_vectors`，不存在 `rag_vectors` / `rag_index_status`）；整库保存改为按记录 UPSERT/补丁写；桌面与 MCP 共用同一写护栏与版本检查。
- **验收**：删除后检索不再命中；模拟桌面与 MCP 交替写同一论文，双方提交均不丢失。

### C5. 未绑定 PDF 身份的文本提取 promise 会串篇

- **级别**：P1（错误证据）
- **证据**：`src/features/reader/DocumentReaderTab.tsx:418-422,2015-2043,2542-2572,2574-2619`（源码核验）
- **现状**：PDF 文本提取 promise 未携带 `pdfSource/generation`。同一 `workspaceId` 内切换 PDF（原始版/批注版/项目 PDF）时，`switchCurrentPdfFile`（`:2542-2572`）只改 `pdfSource/currentDocument`，不重置 `pdfTextCacheRef`/`pdfTextPendingRef`；`loadCachedPdfDocumentText`（`:2027-2042`）会把旧 PDF 的 pending promise 直接返回给新 PDF 的 QA/概览。跨论文切换会在 `:4298-4310` 清空 refs，但旧提取未 abort，其 `.then/.finally`（`:2030-2039`）仍会回写共享 refs。
- **影响**：同一论文的不同 PDF 版本之间会串用正文证据，问答/概览基于错误文本。
- **修法**：提取请求携带 `pdfSource + generation`，返回时校验；切换 `pdfSource` 时 abort 旧请求并重置 refs。
- **验收**：在同一 `workspaceId` 下切换 `pdfSource`（而非切换论文）复现：旧结果不得进入新上下文；补竞态测试。

---

## 5. 架构与性能

### S1. 三个工作区启动即全部挂载，且无工作区级懒加载

- **级别**：P1（启动性能 / 内存）
- **证据**：`src/app/App.tsx:15-17,478-494`；全仓 0 处 `React.lazy`/`Suspense`（实测源码）。现有分割仅为 `vite.config.ts:4-56,95-102` 的 vendor manualChunks 与少量局部动态导入（`pdfPageCount.ts:15`、`PdfViewer.tsx:2195`、`readerTranslationCache.ts:13-26`），工作区边界没有懒加载。
- **现状**：Reader、NotesWorkspace、KnowledgeGraphWorkspace 静态导入并同时渲染，只用 `hidden` 切换可见性；Tiptap/ProseMirror、lowlight、KaTeX、Cytoscape 在用户未打开时即初始化，且永不卸载。
- **影响**：冷启动主线程解析/布局与 IPC 竞争高；内存不会随工作区切换回落。
- **修法**：三个入口改 `React.lazy` + `Suspense`；用 `hasVisited` 记录首次访问后再挂载并保持；Cytoscape 创建由 `workspaceActive` 门控；笔记编辑器在 Notes 首次访问后再渲染。
- **验收**：冷启动不加载 Tiptap/Cytoscape chunk；首次打开 Notes/Graph 的延迟可接受（记录性能埋点对比）。

### S2. 巨组件与巨模块拆分

- **级别**：P2（可维护性）
- **证据**（实测行数）：`DocumentReaderTab.tsx` 4,719 行、222 个 hook（50 useState、28 useEffect、95 useCallback、19 useMemo、30 useRef）；`LiteratureLibraryView.tsx` 3,850 行、46 个 useState（`:368-442`）；`PdfViewer.tsx` 3,383 行、43 个 useEffect；`NoteEditor.tsx` 1,946 行、22 个 Tiptap 扩展；`ragStore.cjs` 2,461；`knowledgeMcpService.cjs` 3,279；`libraryCommands.cjs` 1,255（源码核验）
- **影响**：任一流程改动都触发整页重渲染；回归面无法用测试聚焦；新增功能只能继续堆进同一文件。
- **修法**（按优先级）：
  - `LiteratureLibraryView` 拆 `useLibraryCatalog`、`usePaperSelection`、`useImportFlow`、`useMetadataJobs`、`usePdfAssetAudit`、`useBatchOperations`、`useCategoryActions`，对话框各自独立组件。
  - `DocumentReaderTab` 拆 document/open、QA、summary、notes 四个 hook，保留一个薄壳负责布局与 tab 生命周期。
  - `PdfViewer` 拆 PDF.js 生命周期、滚动/恢复、选择与批注、缩略图、目录、块覆盖层六个模块。
  - `ragStore` 拆 schema/迁移、索引、检索、运行记录四层；`knowledgeMcpService` 抽领域服务层（见 S3）。
- **约束**：拆分只移动代码与改内部接口，不同时改行为；每一步保持 `npm run build` + `npm test` 通过。

### S3. 桌面与 MCP 双份业务逻辑且已漂移

- **级别**：P2（一致性）
- **证据**：`electron/mcp/knowledgeMcpService.cjs`（3,279 行）重复实现文库导入/更新、Zotero 同步、混合检索；embedding 配置构造存在 3 份（`src/services/rag.ts:49-68`、`knowledgeMcpService.cjs:550-573`、`noteEmbedding.cjs:22-24`）；缓存键已在 C1 漂移（源码核验）
- **影响**：同一语义在桌面与 MCP 产生不同结果；修一处漏一处，测试无法覆盖两份实现。
- **修法**：抽 `electron/shared/` 领域模块：缓存路径、embedding 配置、检索管线、写护栏/版本检查、导入更新；`bin/paperquay-mcp.cjs` 的工具 schema 与 handler 做契约测试（参数、默认值、错误码）。
- **验收**：同一输入在桌面与 MCP 返回一致结构；删除重复实现后覆盖率不下降。

### S4. 设置存在四个所有者，优先级冲突

- **级别**：P2（数据一致性）
- **证据**：`src/features/notes/bibliography.ts:22-53`（Notes 侧合并写 localStorage）、`src/features/reader/useReaderSettings.ts:73,393-396,423-444`（整对象回写 localStorage 与配置文件）、`electron/backend/libraryCommands.cjs:604-615`（library settings 独立存储）；重叠字段 `zoteroLocalDataDir` 见 `src/types/library.ts:3-16` 与 `src/types/reader.ts:684-690`。`readerShared.ts:896-915` 仅支撑默认值合并（源码核验）
- **现状**：Notes-only 写入会被任意 Reader 设置变更回滚；迁移与默认值合并逻辑分散。
- **修法**：单一 settings store（主进程持久化 + 渲染层只读缓存），带 `version` 与迁移函数；写入走 patch + 版本校验。
- **验收**：Notes 改设置后触发 Reader 任意设置写，Notes 值保持不变。

### S5. 三处性能热点

- **级别**：P2（卡顿）
- **证据**：
  - 文献列表：`src/features/literature/components/LiteraturePaperList.tsx:505-529`（`.pq-paper-list` 滚动容器 + `papers.map` 全量行渲染，行组件未 memo；全仓无虚拟化依赖）。已有 CSS 级窗口化 `src/app/index.css:495-501`（`.pq-paper-row { content-visibility: auto; contain-intrinsic-size: auto 132px; }`），DOM 仍为全量。隐藏时刷新由事件驱动：`LiteratureLibraryView.tsx:793-820`（refreshPapers）、`:906-913`（外部写入）、`src/features/literature/useLibraryQueryRefresh.ts:14-57`（更新事件、100ms 防抖）。
  - 知识图谱：`src/features/graph/KnowledgeGraphWorkspace.tsx:424-459,707-768`（fcose 主线程；相似度滑杆无防抖，`:1416-1417,759`）；后端为全部 `library.papers` 建节点并读取最多 5000 条笔记，仅 `embeddingEdgeLimit`（≤300）限制边，`electron/backend/knowledgeGraphCommands.cjs:509-559`。
  - 笔记编辑器：`src/features/notes/NoteEditor.tsx:977-980,1271-1277`（每次按键全量 JSON 序列化 + 深拷贝；图片为 base64 放大成本）。
- **修法**：列表用 tanstack-virtual 并 memo 行（明确替换或保留 `content-visibility` 机制，避免双重窗口化）；隐藏工作区只在外部写入/更新事件时刷新，事件按 paperId 增量更新；图谱服务端做 top-degree 采样 + 展开按需，fcose 放 Worker 或分块，滑杆防抖；编辑器用事务计数判断脏状态，草稿写入防抖 250–500ms，粘贴图片落盘。
- **验收**：5000 篇列表滚动帧率 ≥ 50fps，并记录 DOM 行数与 `content-visibility` 是否保留；10k 节点图谱首屏 < 2s；含 8 张截图的笔记单键输入延迟 < 50ms。

---

## 6. UI 与设计系统

### E1. 深色主题白底白字

- **级别**：P1（不可读）
- **证据**：`src/features/notes/NoteDistillPreviewPanel.tsx:43`（`bg-white`）与 `:51`（`text-[var(--pq-text)]`），旁证 `:63,67`。同类受影响位置：`src/features/reader/readerPreferencesPrimitives.tsx:92`（`bg-slate-50/80` + `text-[var(--pq-text)]`，无 dark 配对）、`readerPreferencesContent.tsx:1258,1409,1434,1546`；`bg-white` 无 dark 配对的还有 `readerPreferencesContent.tsx:950,999,1600,1639,1698`、`readerPreferencesModelsSection.tsx:338,349,371,385,599`；块预览弹窗标题/关闭按钮与空态图标见 `blockViewerContent.tsx:386,412,416,653,659`（源码核验）
- **影响**：深色模式下笔记提炼预览与阅读器设置卡片大片不可读；PDF 块预览仅预览弹窗标题、关闭按钮与空态图标受影响，内容区已使用主题色。
- **修法**：所有手写表面改用 `var(--pq-surface-1/2)` 或补齐 `dark:bg-[var(--pq-surface-*)]`；把「`bg-white` / `bg-slate-50` 无 dark 配对」纳入检索检查；补深色截图回归。
- **验收**：深色下上述界面文字对比度 ≥ 4.5:1；截图人工复核。

### E2. 设计系统违规批量清理

- **级别**：P2（一致性）
- **证据**：
  - `window.confirm`：`NoteEditor.tsx:1565,1636`；`window.prompt`：`NotesList.tsx:74`。
  - 自建遮罩 5 处：`blockViewerContent.tsx:401,642`、`LiteratureLibraryView.tsx:3485`、`NoteDistillPreviewPanel.tsx:38`、`ReaderPreferencesWindow.tsx:64`。
  - 硬编码调色板类 51 处 / 19 文件（`blockViewerContent` 13、`readerPreferencesContent` 5、`assistantSidebarChat` 4）。
- **修法**：确认类操作改用 `confirmAction()`；输入类统一改用 `Dialog`（如需复用 `LibraryTextInputDialog`，先按 D7-12 补齐 dialog 语义、焦点陷阱与关闭按钮语义）；遮罩统一 `Dialog`；硬编码色按 `docs/ui-design-system.md` 令牌替换；新增检查脚本或 lint 规则阻断回归。
- **验收**：全仓 `window.confirm/alert/prompt` 为 0；非 `src/ui` 的 `fixed inset-0` 为 0（图谱节点菜单为登记例外）；调色板类计数降为 0。

### E3. Tailwind 非标准透明度不生成 CSS，浅色遮罩消失

- **级别**：P2（视觉缺陷）
- **证据**：`src/ui/dialog.tsx:148-149`（`bg-slate-950/62`、`/28`）、`ReaderPreferencesWindow.tsx:64`（`/62`）、`LibraryTextInputDialog.tsx:53`（`/28`）、`blockViewerContent.tsx:401,642`（`/76`）；另有 15 处非 5 倍数的 `bg-white/{6,8,14,32,54,58,62,72,78,88,92,96}`（如 `LiteratureCategorySidebar.tsx:338-339,368,392`、`LiteraturePaperList.tsx:515,600`、`PdfThumbnailSidebar.tsx:138`、`PdfReadingHeatmapBar.tsx:91`、`LiteratureReadingTimeChart.tsx:54`、`assistantSidebarDrawers.tsx:338`、`readerSelectionQuickActions.tsx:369`）。`/35` 在默认刻度内，正常渲染，不是缺陷（实测编译）
- **现状**：Tailwind 默认透明度刻度为 0–100 每 5 一档，上述非 5 倍数值不产出 CSS；相关表面只剩 `backdrop-blur` 或完全透明。只修 Dialog 会留下其余透明表面。
- **修法**：新增遮罩令牌（如 `--pq-overlay-soft/strong`）并以 `bg-[var(--pq-overlay-strong)]` 引用，避免继续使用硬编码调色板类（与 E2 的零计数验收一致）；统一收口到 `Dialog` 的 `overlay` 变体；构建后断言关键类存在。
- **验收**：浅色与深色下上述遮罩均可见；生成 CSS 中包含对应规则；`bg-(palette)-NNN/NN` 非标准透明度计数降为 0。

### E4. 可访问性（A11y）

- **级别**：P2（可用性）
- **证据**：
  - `src/ui/commandPalette.tsx:69-103` 声称 `aria-modal` 但未走 `Dialog`，焦点可逃逸、选项无播报。
  - `src/ui/menu.tsx:77-100,115-142`（`keyboardAnchor` 为空时直接返回，role/tabIndex 仅在键盘打开时设置；注释 `:13-17` 记录该约束）。
  - `src/components/tabs/TabItem.tsx:54-64` 无 tab 语义，关闭按钮的键盘激活被吞。
  - `src/app/index.css:44,455-460`（`.pq-input` 焦点阴影使用 10% accent，叠白约 1.13:1；深色令牌见 `:136`，`:457` 同时把边框改为 accent，约 3.74:1）；24 个原生表单控件无可见焦点。
  - `src/ui/dialog.tsx:256-268` 危险实心按钮深色对比 2.77:1。
- **修法**：命令面板复用 `Dialog`；菜单键盘处理不区分打开方式；TabBar 补 `role="tablist"/tab/tabpanel` 与键盘；焦点环改为 ≥3:1 的 accent 外环；危险按钮改用按钮级令牌。
- **验收**：键盘可完整操作命令面板、菜单、标签页；axe 扫描无 aria/对比度告警（允许登记例外）。

### E5. i18n 覆盖不完整

- **级别**：P2（一致性）
- **证据**：`src/features/notes/NotesSidebar.tsx:61-72`（筛选/页面类型标签）与 `:176,468,502`（检索错误与状态文案）仅中文；标签页标题硬编码在 `src/stores/useTabsStore.ts:82,90,156,185`（首页标签已通过 `getHomeTabTitle` 本地化，见 `:58-60` 与 `Reader.tsx:218-219`）；`index.html:2` 固定 `lang="zh-CN"`（源码核验）
- **修法**：英文界面补齐 `l()` 或明确「仅中文」的产品范围；`lang` 随 `uiLanguage` 更新；新增文案必须双语。
- **验收**：切到 en-US 后可见区域无中文（登记的品牌名与论文原文除外）。

---

## 7. 工程化与打包

### F1. `npm run dev` 已断：shared CJS 未被转换为 ESM

- **级别**：P1（开发阻断，实测）
- **证据**：`src/features/reader/readerRag.ts:17` 从 `../../shared/ragQueryUtils.cjs` 具名导入；`vite.config.ts:64-79` 只对 `markdownToTiptap.cjs` 做字符串替换；实测 `transformRequest('/src/shared/ragQueryUtils.cjs?import')` 输出仍含 `module.exports`、无 `export`（实测）
- **影响**：浏览器链接期报「does not provide an export named …」，Vite dev 渲染层启动失败；`npm run build` 与 `node --test` 因 Rollup/Node 的 CJS 互操作而通过，CI 无法发现。
- **修法**：把 dev 转换插件通用化到 `src/shared/*.cjs`（按文件生成显式 `export`），或提供 ESM wrapper 并让 Electron 侧改用动态 `import()`；增加一条测试对每个 shared CJS 的 `transformRequest` 结果断言不含 `module.exports`。
- **验收**：`npm run dev` 能打开 Reader 并加载 QA；新增转换测试通过。

### F2. 安装包缺 PDF.js 资源（cmaps / standard_fonts / image_decoders）

- **级别**：P1（安装版功能缺失）
- **证据**：`package.json:72`（pdfjs-dist 仅 devDependency）、`:134-162`（files 白名单不含 pdfjs-dist）；`electron/localPdfProtocol.cjs:10` 从 `node_modules/pdfjs-dist` 提供资源；`electron/afterPack.cjs` 只校验 sqlite-vec（源码核验）
- **影响**：安装版对 CID 字体（中文论文常见）与非内嵌标准字体的 PDF 丢字/乱码；开发模式下 `node_modules/pdfjs-dist` 存在、`paperquay-pdf-assets` 可取到资源（dev 渲染层另有 F1 的启动阻断），故该问题长期不可见。
- **修法**：用 `extraResources` 打包 `pdfjs-dist/{cmaps,standard_fonts,image_decoders}`；协议根目录在 `app.isPackaged` 时改 `process.resourcesPath`；`afterPack` 增加文件数量断言。
- **验收**：打包安装后打开中文 CID 字体 PDF，文字完整；afterPack 在缺资源时失败。

### F3. 依赖与打包归类

- **级别**：P2（体积与一致性）
- **证据**：`package.json` 无 `engines`；`@tiptap/*`、`cytoscape`、`cytoscape-fcose`、`temml`、`lowlight` 在 `dependencies`（生产依赖会被 electron-builder 复制进 asar，而渲染层已由 Vite 打包；0.4.31 打包 asar 实测渲染层专用依赖约 28MB，形成约 28–32MB 冗余）；React、pdfjs-dist、katex、zustand、lucide-react 在 `devDependencies`；`temml` 全仓 0 引用；`files` 共 28 条模式，但不实际限制生产依赖进入 asar（源码核验 + 0.4.31 打包实测）
- **修法**：渲染层依赖移入 `devDependencies`；删除 `temml`；补 `"engines": { "node": ">=22.18" }` 并在 MCP 启动时检查 `node:sqlite` 可用性；`files` 改为 glob + 显式排除，配 afterPack 校验运行时必需模块。
- **验收**：asar 体积下降且安装版功能回归通过；Node 版本过低时给出明确错误。

### F4. 类型检查、Lint 与 CI 门禁

- **级别**：P2（质量门禁）
- **证据**：`tsconfig.json:21-22` 仅 `include: ["src"]`，`electron/**/*.cjs`、`bin/paperquay-mcp.cjs`、`tests/*.test.ts` 不参与检查；无 ESLint/Biome/Prettier 配置；`.github/workflows/build.yml` 仅 `npm run build` + `npm test`（windows-latest），`release.yml` 由 `app-v*` 标签触发、只构建不跑测试，且不校验 PDF.js 资源（现有 afterPack 仅断言 MCP sqlite-vec 资源）（源码核验）
- **修法**：逐步把 `electron/`、`bin/`、`tests/` 纳入 `checkJs`（先 `allowJs` + `checkJs` 的增量清单）；引入 ESLint（至少 `react-hooks`、`no-restricted-syntax` 禁止 `window.confirm`/硬编码色）；CI 增加 lint、打包冒烟（`electron:build --dir`) 与 afterPack 断言；release 前要求 build workflow 成功。
- **验收**：PR 上 lint 与类型检查必过；发布 tag 无法跳过测试；打包冒烟能发现 F2 类资源缺失。

### F5. 测试与构建环境依赖 esbuild 临时目录

- **级别**：P2（开发体验）
- **证据**：13 个测试文件在运行期 `import { build } from 'esbuild'`，其中 2 个把产物写入 `%TEMP%`：`tests/readerSettings.test.ts:10-27`（`mkdtemp` + `write: true`）与 `tests/mcpClientLaunch.test.mjs:90-94`（outfile 位于 `os.tmpdir()`）；其余 11 个使用 `write: false` 在内存构建。本机实测前两者报 `Failed to write to output file ...: Access is denied`；`npm run build` 也因 `remove ...esbuild-...: Access is denied` 失败（实测；属本机 Windows 环境，GitHub runner 未复现）
- **影响**：本机 `npm test` / `npm run check` 不能稳定全绿，掩盖真实回归；开发者倾向于忽略失败。
- **修法**：`readerSettings` 改用 esbuild `write: false` + `data:` URL 导入（无磁盘写入）；`mcpClientLaunch` 需要真实 bundle 供子进程启动，改用仓库内 `.tmp-test/` 并对 EACCES 重试；构建侧评估 Vite 8 的 `minify: 'oxc'` 以绕开 esbuild 临时二进制清理；统一提供 `npm run check:local` 说明。
- **验收**：连续 10 次本机 `npm test` 全绿；`npm run build` 不再偶发临时目录失败。

---

## 8. 验收与回归要求

1. **每批改动前**：在隔离数据目录复现对应问题，记录失败现象；不接触用户真实文库、笔记 vault 与 `%APPDATA%`。
2. **每批改动后**：`npm run build` + `npm test` 通过；新增用例覆盖「触发条件 + 负向路径」；涉及 UI 的补浅色/深色截图。
3. **数据类修复**（A1–A4、C4）：必须有不丢数据/不覆盖的回归测试，且测试数据量超过触发阈值（500 / 1000 篇）。
4. **安全类修复**（B1–B5）：每个入口补越权/越界用例；不接受仅文档说明。
5. **架构拆分**（D2、D3）：只移动代码不改行为；每步独立提交，保持测试全绿。
6. **发布前**：安装版冒烟覆盖中文 CID 字体 PDF、Vault 同步、RetainPDF、MCP 图表读取与备份恢复。

## 9. 明确不做 / 不改

- 不改文库、RAG、笔记的 schema 与 `user_version`；不回写用户数据。
- 不重做 Agent/检索/笔记架构；S2/S3 只做结构拆分与共享模块抽取。
- 不把已登记的设计例外（图谱节点菜单的容器内定位、语义令牌未覆盖的 `dark:*` 成对覆盖、accent/success 对比度约束）当作缺陷处理。
- 不删除 `scripts/` 下的未跟踪个人脚本与数据。
- 附录 A 中未在正文展开的 P2/P3 为待排期清单；与正文条目重叠的部分随对应批次实施。

---

## 附录 A：P2/P3 清单（93 条，含正文已展开条目）

> 标题保留审计原文，便于与审计数据核对；级别沿用审计结果。附录是原始条目清单，正文把相关条目合并为 32 个主题，因此同一问题可能同时出现在正文与附录；与正文重叠的部分随对应正文批次实施，不重复排期，未在正文展开的条目为待排期。

| ID | 级别 | 类型 | 问题 | 主要位置 |
| --- | --- | --- | --- | --- |
| D2-14 | P2 | 架构 | God modules: ragStore.cjs (2461 lines) and libraryCommands.cjs (1255 lines) mix schema, indexing, retrieval and transport concerns | `electron/backend/ragStore.cjs:529-663,710-844,870-912,1114-1412,1414-1899,1900-2028,2029-2295,2297-2352,2429-2457` |
| D2-9 | P2 | 架构 | RAG worker has no restart or per-call timeout; one crash disables RAG for the session | `electron/backend/ragWorkerHost.cjs:33-103` |
| D3-10 | P2 | 架构 | MCP hybrid retrieval is a private fork of ragStore with divergent embedding config and N+1 query behavior | `electron/mcp/knowledgeMcpService.cjs:923-948,1039-1045,1431-1434,454-545,671-680,1075,1201,1227,986-1029` |
| D3-3 | P2 | 架构 | allowWhileAppRunning 'checked parallel writes' are one-directional; desktop whole-library saves still erase MCP commits | `electron/mcp/knowledgeMcpService.cjs:593-595,1988-2030` |
| D3-9 | P2 | 架构 | MCP reimplements library import/update/Zotero sync/search with concrete drift from the desktop commands | `electron/mcp/knowledgeMcpService.cjs:2494-2725,2579-2602,1754-1933` |
| D4-10 | P2 | 架构 | Four feature components have grown into multi-thousand-line god components with unmanageable effect graphs | `src/features/reader/DocumentReaderTab.tsx` |
| D4-11 | P2 | 架构 | Per-tab reader UI state lives in app-global Zustand stores; switching tabs clears drafts and aborts streaming answers | `src/stores/useReaderQaStore.ts` |
| D4-5 | P2 | 架构 | Settings have four owners with conflicting precedence; a Notes-only write is silently reverted by any Reader settings change | `src/features/reader/readerShared.ts:896-915` |
| D5-12 | P2 | 架构 | DocumentReaderTab is a 4.7k-line component with 12 unrelated responsibilities; decompose into document/QA/summary/notes hooks | `src/features/reader/DocumentReaderTab.tsx:314-4719` |
| D5-13 | P2 | 架构 | PdfViewer mixes PDF.js lifecycle, scrolling, selection, annotations, thumbnails, outline and block overlay in one 3.4k-line component | `src/features/pdf/PdfViewer.tsx:314-3383` |
| D1-2 | P2 | 缺陷/安全 | will-navigate accepts every file:// URL, giving attacker HTML the preload bridge | `electron/main.cjs:180-193` |
| D1-3 | P2 | 缺陷/安全 | paperquay-pdf protocol serves any .pdf on disk, including UNC shares | `electron/localPdfProtocol.cjs:13-36` |
| D1-4 | P2 | 缺陷/安全 | run_mineru_cloud_parse uploads any local file to a renderer-chosen host and extracts ZIPs into any directory | `electron/backend/mineruCommands.cjs:162-196` |
| D1-5 | P2 | 缺陷/安全 | Untrusted MinerU asset paths drive arbitrary local reads and UNC SMB probes | `src/services/mineru.ts:395-446` |
| D1-6 | P2 | 缺陷/安全 | backup_import_stage trusts renderer-supplied restore targets and renames/overwrites them on restart | `electron/backend/backupCommands.cjs:245-262` |
| D1-9 | P2 | 缺陷/安全 | Renderer crash/load failure is invisible in production; invalid pending restore exits silently | `electron/main.cjs:135-149` |
| D2-1 | P2 | 缺陷/安全 | Whole-library store.save() rewrites every paper from a stale snapshot and wipes concurrent MCP writes | `electron/backend/libraryCommands.cjs:609-638` |
| D2-10 | P2 | 缺陷/安全 | Custom knowledge-graph relations use a non-atomic JSON write and a corrupt file is treated as empty | `electron/backend/utils.cjs:65-73` |
| D2-11 | P2 | 缺陷/安全 | Zotero import copies a live zotero.sqlite without its WAL and loads the whole DB into sql.js WASM memory | `electron/backend/zoteroLocal.cjs:197-217` |
| D2-12 | P2 | 缺陷/安全 | External artifact I/O has no request timeouts or size caps; whole PDFs/zips are buffered and extracted unbounded | `electron/backend/libraryCommands.cjs:491-507,566-574,1206,1243` |
| D2-13 | P2 | 缺陷/安全 | Backup extraction fails on filesystems without hard links, and backup validation blocks the main thread with synchronous VACUUM/integrity_check | `electron/backend/backupContainer.cjs:911-919` |
| D2-5 | P2 | 缺陷/安全 | Notes missing from notes_fts are silently unsearchable; empty FTS results never fall back to LIKE | `electron/backend/noteStore.cjs:161-173` |
| D2-6 | P2 | 缺陷/安全 | Deleting a paper never removes its RAG index, chunks, vectors or status | `electron/backend/libraryCommands.cjs:1029-1044` |
| D3-4 | P2 | 缺陷/安全 | MCP read tools create databases, and MCP-created library DBs stay 'uninitialized' so the desktop can rewrite them from legacy JSON | `electron/mcp/knowledgeMcpService.cjs:384-394,642-643,2364-2385,2983-2993` |
| D3-6 | P2 | 缺陷/安全 | get_note returns flattened content_text, so the documented get→edit→update_note round trip destroys rich text and inline anchors | `electron/mcp/knowledgeMcpService.cjs:1389-1423,2147-2170` |
| D3-7 | P2 | 缺陷/安全 | delete_note_folder accepts a partial expectedFolderVersions map, silently skipping descendant version checks | `electron/mcp/knowledgeMcpService.cjs:2423-2455,45-47` |
| D3-8 | P2 | 缺陷/安全 | read_paper_figure trusts content_list asset paths, enabling base64 exfiltration of arbitrary local files | `electron/mcp/knowledgeMcpService.cjs:253-279,2207-2214,2312-2361,181` |
| D4-6 | P2 | 缺陷/安全 | Notes list has one global loading flag and duplicate startup loads; background refreshes blank the list | `src/stores/useNotesStore.ts:47-75` |
| D4-7 | P2 | 缺陷/安全 | Note editing relies on a manual Save with no unload guard; drafts live only in an unbounded in-memory Map | `src/features/notes/NoteEditor.tsx` |
| D5-3 | P2 | 缺陷/安全 | Unkeyed PDF text extraction promise can feed the previous PDF's text into the new PDF's QA/summary | `src/features/reader/DocumentReaderTab.tsx:418-422,2015-2043,2542-2572,2574-2619,4298-4310` |
| D5-5 | P2 | 缺陷/安全 | Clear Translation Cache immediately repopulates from disk and the library snapshot | `src/features/reader/useDocumentTranslation.ts:904-912,262-300,302-374` |
| D5-6 | P2 | 缺陷/安全 | Translation cache key omits model/source, and whole-map overwrites let concurrent writers regress the cache | `src/utils/mineruCache.ts:144-163` |
| D5-7 | P2 | 缺陷/安全 | PDF open/switch commits state without a generation guard, so stale async opens win | `src/features/reader/DocumentReaderTab.tsx:1334-1404,1407-1530,1556-1660,2542-2572,2574-2619` |
| D5-9 | P2 | 缺陷/安全 | Switching tabs/workspaces aborts QA and persists an empty assistant placeholder; hidden tabs can be evicted mid-work | `src/features/reader/DocumentReaderTab.tsx:3637-3655,3773-3798,3818-3853,4090-4119` |
| D6-10 | P2 | 缺陷/安全 | Any external note write marks every open note tab as externally updated and can show a false conflict banner on dirty editors | `src/features/notes/NotesWorkspace.tsx:1109-1143` |
| D6-11 | P2 | 缺陷/安全 | Searching or tag-filtering notes silently rebinds the open editor to the first search result | `src/features/notes/NotesWorkspace.tsx:831-838` |
| D6-8 | P2 | 缺陷/安全 | Moving a category under its own descendant creates a cycle that makes the categories disappear from the sidebar | `src/features/literature/components/LiteratureCategorySidebar.tsx:215-243` |
| D6-9 | P2 | 缺陷/安全 | Hidden library details form still handles window-level Ctrl+S/Escape, saving or discarding an invisible draft from another workspace | `src/features/literature/components/LiteraturePaperDetails.tsx:232-238` |
| D8-7 | P2 | 代码质量 | Electron shell and protocol code has no automated tests | `electron/preload.cjs:130-134` |
| D2-2 | P2 | 性能 | library_init still hydrates and ships the entire library at startup, defeating SQL pagination | `electron/backend/libraryCommands.cjs:593-602` |
| D2-8 | P2 | 性能 | Note hybrid search executes one KNN query per note and re-chunks/hashes the whole corpus twice per query | `electron/backend/noteHybridSearch.cjs:14-51` |
| D3-5 | P2 | 性能 | create_note/update_note leak a library SQLite connection and reload the whole library on every note write | `electron/mcp/knowledgeMcpService.cjs:2083-2103,2163-2170,2046-2060` |
| D4-13 | P2 | 性能 | PDF metadata preview reads the entire PDF as base64 into the renderer before parsing only page 1 | `src/services/pdfMetadata.ts` |
| D5-10 | P2 | 性能 | Library bootstrap fans out full-file reads for every paper (up to 5000) on each library/language change | `src/features/reader/Reader.tsx:313-316,606-625` |
| D5-11 | P2 | 性能 | Every scroll position save rewrites the entire paper-history localStorage map, with no quota handling | `src/utils/paperHistory.ts:220-297,306-331` |
| D5-8 | P2 | 性能 | Each QA stream delta re-renders the whole reader and re-parses every chat message's markdown | `src/features/reader/DocumentReaderTab.tsx:3705-3728,3750,4152-4295,4500-4533` |
| D6-5 | P2 | 性能 | Batch and mass library actions issue one IPC and SQLite transaction per selected paper; select-all can target the whole library | `src/features/literature/LiteratureLibraryView.tsx:600-637` |
| D6-6 | P2 | 性能 | Every note save or external mutation reloads up to 1,000 full note bodies over IPC, with no request-generation guard | `src/features/notes/NotesWorkspace.tsx:1109-1143` |
| D6-7 | P2 | 性能 | Notes folder counts and tree rendering scale quadratically and silently cap the vault at 1,000 notes | `src/features/notes/NotesWorkspace.tsx:140-152` |
| D8-3 | P2 | 性能 | Renderer-only libraries are duplicated into app.asar (~28–32 MB) and temml is unused | `package.json:29-47` |
| attachment-filter-stat-storm | P2 | 性能 | Attachment-presence filters fs.stat every attachment in the whole library on every query, keystroke and select-all page | `electron/backend/libraryAttachmentAvailability.cjs:20-55` |
| vault-autosync-main-thread | P2 | 性能 | Vault auto-sync runs synchronous full-vault scans on a timer and keeps running after it is disabled | `src/features/notes/NotesWorkspace.tsx:884-918` |
| D1-7 | P2 | 工具/依赖 | Packaged app omits pdfjs-dist assets that paperquay-pdf-assets serves at runtime | `package.json:72` |
| D3-2 | P2 | 工具/依赖 | Packaged MCP cannot spawn ragWorker.cjs, so MCP-created notes are never vector-indexed in installed builds | `electron/backend/ragWorkerHost.cjs:33-36` |
| D8-4 | P2 | 工具/依赖 | The hand-maintained node_modules allowlist neither controls nor covers the asar contents | `package.json:139-162` |
| D8-5 | P2 | 工具/依赖 | Node.js version gate is wrong and unenforced (MCP accepts 22.5; node:sqlite needs 22.13; tests need 22.18) | `package.json:1-13` |
| D8-6 | P2 | 工具/依赖 | TypeScript never checks electron/, bin/, tests/ or the referenced config projects | `tsconfig.json:21-22` |
| D4-12 | P2 | UI/交互 | Settings dialog is a hand-rolled overlay without dialog semantics or a focus trap | `src/features/reader/ReaderPreferencesWindow.tsx` |
| D4-9 | P2 | UI/交互 | i18n coverage is incomplete: Chinese remains hardcoded in user-visible Notes UI and tab titles | `docs/ui-design-system.md` |
| D7-10 | P2 | UI/交互 | Tab bar has no tab semantics and keyboard activation of the close button is swallowed | `src/components/tabs/TabItem.tsx:54-64` |
| D7-2 | P2 | UI/交互 | Out-of-scale Tailwind opacity modifiers silently emit no CSS, removing every light-theme dialog scrim | `src/ui/dialog.tsx:144-150` |
| D7-3 | P2 | UI/交互 | ConfirmDialog danger button violates the solid-button token rule and drops to 2.77:1 in dark mode | `src/ui/dialog.tsx:256-268` |
| D7-4 | P2 | UI/交互 | Keyboard focus is invisible on 24 raw form fields and the .pq-input ring is only 1.13:1 | `src/app/index.css:44` |
| D7-6 | P2 | UI/交互 | CommandPalette claims aria-modal but bypasses Dialog, so focus escapes and options are not announced | `src/ui/commandPalette.tsx:69-103` |
| D7-7 | P2 | UI/交互 | Menu's Escape/arrow handling is disabled for all pointer-opened context menus | `src/ui/menu.tsx:17` |
| D7-8 | P2 | UI/交互 | Document language is hardcoded to zh-CN while the app supports en-US | `index.html:2` |
| D7-9 | P2 | UI/交互 | Notes workspace and service errors remain Chinese-only in the English UI | `src/features/notes/NotesSidebar.tsx:61-72` |
| D1-14 | P3 | 架构 | Single stringly-typed IPC channel: 135 invoke literals / 134 commands, no schema, no shared registry, not type-checked | `electron/preload.cjs:130-134` |
| D5-14 | P3 | 架构 | App-level Settings (including backup/MCP/updates) live under features/reader and can only be opened from the Reader workspace | `src/features/reader/readerPreferencesContent.tsx:43,1038-1041` |
| D7-14 | P3 | 架构 | No size/variant API on UI primitives produces 28px/32px drift and the only responsive fallback is unreachable under Electron's minWidth | `src/features/blocks/BlockViewer.tsx:894` |
| D1-10 | P3 | 缺陷/安全 | Shutdown drops queued note embeddings and can bypass teardown entirely | `electron/backend.cjs:189-198` |
| D1-11 | P3 | 缺陷/安全 | Renderer restore clears all localStorage on every load until ack succeeds | `electron/preload.cjs:4-45` |
| D1-13 | P3 | 缺陷/安全 | Security baseline around the renderer is weakened (no CSP, default permission policy, sandbox off, ASAR integrity off) | `electron/main.cjs:124-143` |
| D1-8 | P3 | 缺陷/安全 | whenReady and loadFile promises have no error handling; startup failures exit/crash without cleanup or dialog | `electron/main.cjs:260-348` |
| D3-11 | P3 | 缺陷/安全 | external write marker uses unlogged read-modify-write across processes, so concurrent MCP servers can clobber revisions and stall desktop refresh | `electron/backend/externalWriteMarker.cjs:71-113` |
| D3-14 | P3 | 缺陷/安全 | Note writes accept nonexistent paperId/folderId, leaving notes attached to no visible target | `electron/mcp/knowledgeMcpService.cjs:2066-2104,2106-2141` |
| D6-12 | P3 | 缺陷/安全 | Unsaved note edits live only in renderer memory; quitting or crashing the app loses them with no prompt | `src/features/notes/noteEditorUtils.ts:41` |
| D6-13 | P3 | 缺陷/安全 | Background MinerU status discovery is treated as a user filter change, clearing selections and re-querying repeatedly | `src/features/literature/useLibraryFilters.ts:14-21` |
| D6-14 | P3 | 缺陷/安全 | Import auto-fill discards remote matches that only supply publisher, volume, issue, pages or ISSN | `src/features/literature/LiteratureLibraryView.tsx:1693-1713` |
| D3-12 | P3 | 代码质量 | Tool schemas contradict handlers and hide supported filters (pageKind '', search tags, note filters) | `bin/paperquay-mcp.cjs:257-261,63-72,160-189,614,780-781,846-871,902-918` |
| D4-8 | P3 | 代码质量 | Dead modules and duplicated renderer plumbing give false test coverage and obscure the live architecture | `src/stores/useReaderBridgeStore.ts` |
| D7-13 | P3 | 代码质量 | index.css bypasses the token system for MinerU tables/scrollbars and documents 12 dead tokens and 3 dead classes | `src/app/index.css:795-876` |
| D8-10 | P3 | 代码质量 | Two test patterns are timing- and environment-fragile; `npm test` exits 1 on a restricted Windows host | `tests/notesSidebarSearch.test.mjs:70` |
| D8-12 | P3 | 代码质量 | MCP tool schema and handler parity is maintained by hand and only partially asserted | `bin/paperquay-mcp.cjs:63` |
| D8-14 | P3 | 代码质量 | The real MCP bundler is unexercised; tests duplicate its esbuild configuration | `scripts/bundle-mcp.cjs:24-56` |
| D4-14 | P3 | 性能 | Every reading-position flush triggers a full library re-query and re-render | `src/features/pdf/PdfViewer.tsx` |
| D3-13 | P3 | 工具/依赖 | AppImage MCP snippets point into the ephemeral mount, and the generated bundle can ship stale or unverified | `electron/backend/mcpClientConfig.cjs:38-48,95-143` |
| D8-11 | P3 | 工具/依赖 | Build-Local -Architecture arm64 cannot succeed, and the script builds the frontend twice | `scripts/Build-Local.ps1:3-4` |
| D8-13 | P3 | 工具/依赖 | Build and test scripts depend on undeclared transitive packages | `electron/afterPack.cjs:5` |
| D8-9 | P3 | 工具/依赖 | Release tags bypass every test gate and there is no packaging verification job | `.github/workflows/build.yml:3-9` |
| D7-11 | P3 | UI/交互 | --pq-accent-text is used as text on a 10% accent background, making the note component kicker invisible in light mode | `src/app/index.css:33-34` |
| D7-12 | P3 | UI/交互 | Hand-rolled modals beyond the known five lack dialog semantics, focus trapping, and accessible close buttons | `src/features/literature/components/LibraryTextInputDialog.tsx:52-73` |
| D7-5 | P3 | UI/交互 | Global :focus-visible sets border-radius:4px, mutating the geometry of every focused element | `src/app/index.css:245-249` |

## 附录 B：被对抗核验否定的候选（2 条，不必修）

1. **D1-12 restore-resume 锁可能锁死 24 小时** — 否定。锁只在 `process.argv` 含 `--paperquay-restore-resume`（内部自动重启）时获取；锁文件损坏时 `modifiedAt` 为 0、PID 判定为 `null`，条件不成立，锁会被删除；正常手动启动完全不经过该锁，仍会执行 pending restore。
2. **D8-8 asar 内 Worker 不可用导致安装版 RAG 失效** — 否定。Electron 17.3 起支持在 asar 内初始化 worker；在 Electron 42.2.0 下实测可从打包 asar 加载 worker 并 `require` 归档内依赖。残留问题仅是 Worker 报错是异步的、崩溃后本会话不再重试，已归入附录 A 的 D2-9。

## 附录 C：复现与证据口径

以下为本次在本机执行的验证命令与结果（Windows 11，Node 24.19）：

1. **构建失败（实测）**：`npm run build` 在 `vite:esbuild-transpile` 阶段报
   `Error: remove C:\Users\yusen\AppData\Local\Temp\esbuild-...: Access is denied`。属本机临时目录权限问题；GitHub Actions `windows-latest` 未复现，故 CI 可能为绿。
2. **测试失败（实测）**：`npm test` 中 `tests/readerSettings.test.ts` 报
   `error: Failed to write to output file: open C:\Users\...\Temp\paperquay-reader-settings-test-...\readerShared.mjs: Access is denied`；同类报错出现在多个使用 esbuild 的测试。
3. **Vite dev 断链（实测）**：用 Vite `createServer({ server: { middlewareMode: true } })` 对
   `/src/shared/ragQueryUtils.cjs` 与 `...?import` 调用 `transformRequest`，两次输出均含 `module.exports`、无 `export`；`/src/features/reader/readerRag.ts` 的转换结果仍保留对该模块的具名静态导入。
4. **行数统计（实测）**：`wc -l` 得到 `DocumentReaderTab.tsx` 4,719、`LiteratureLibraryView.tsx` 3,850、`PdfViewer.tsx` 3,383、`NoteEditor.tsx` 1,946、`ragStore.cjs` 2,461、`knowledgeMcpService.cjs` 3,279、`libraryCommands.cjs` 1,255；测试 140 个文件、24,494 行。
5. **Vault 删除机制（源码核验）**：`noteStore.cjs:960` 默认 `limit=500`；`noteVault.cjs:574` 未传 limit；`:638-649` 以该列表判断并 `rmSync(force)`；`:566` 在阶段 1 为新笔记写 manifest。
6. **分类环（源码核验 + 隔离复现）**：`libraryCommands.cjs:672-695` 无祖先校验；隔离脚本用 2 行互设父子的数据执行同形 `WITH RECURSIVE ... UNION ALL`，8 秒未返回。
7. **MCP 图表键（源码核验）**：`knowledgeMcpService.cjs:2233` 哈希 `targetId`；`literatureLibraryUtils.ts:530` 生成 `native-library:<id>`；`mineruCache.ts:96-104` 以 `workspaceId` 哈希。

其余条目为两轮审计与对抗核验的源码结论；建议在动手前按对应「验收」小节先写失败用例复现。
