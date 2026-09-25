# 2026-09-25 - Word 加载项 v2：免配置连接与文档自包含模型

## 现象

- 连接要塞：想在 Word 里引文献，得先去 PaperQuay 设置里点「复制连接信息」，把 `端口:令牌` 粘到加载项顶部再连接；应用重启后 token 变了，还得再复制一次。
- 引用明细不可靠：模型的真相存在 `Office.context.document.settings` 的 `pq:*` 键里。文档另存、转换或经第三方工具处理后，设置项可能整体丢失；离线打开（PaperQuay 没运行）时也无从渲染。
- 交叉引用用 REF 域：F9 或打印预览更新域时偶发「错误！未定义书签」，导出 PDF 后链接在部分阅读器里丢失。
- 加载项源码是散装的 `office-addin/*.js`，没有类型检查，与 `src/shared/citation` 的共享真源之间容易漂移。

## 根因

- 连接方式选错了对象：加载项页面本来就由 PaperQuay 主进程的源站提供，却让用户走「跨源 + 回环端口 + Bearer token」的外部工具通道。
- 文档模型选错了容器：`document.settings` 是宿主的键值设置，不是文档结构的组成部分，可被宿主或第三方工具丢弃，也无法容纳嵌套的文献快照。
- REF 域是 Word 的「域」，其正确性依赖书签与更新时机；隐藏书签 + 内部超链接能表达同样的跳转语义，且不参与域计算。
- 加载项缺少构建管线，只能手写 ES5，靠人工同步共享真源。

## 修改

**免配置连接（同源 `/api/v1`）**

- `electron/backend/officeAddinHost.cjs` 新增 `isTrustedApiRequest`：必须带 `X-PaperQuay-Client` 自定义请求头（跨站要发自定义头必须先过 CORS 预检，而本机源站永不同意预检）；`Host` 必须是 `localhost:<port>` 或 `127.0.0.1:<port>`（挡 DNS rebinding）；带 `Origin` 时必须与之一致（`Origin: null` 直接拒绝），带 `Sec-Fetch-Site` 时必须是 `same-origin`/`none`（纵深防御）。
- 源站拦截 `/api/v1/*`，`OPTIONS` 一律 403 `FORBIDDEN_ORIGIN`，从不返回 `Access-Control-Allow-*`；去掉前缀后调用桥的进程内入口 `bridge.handleInternal`——不走网络，也不需要 token。
- `electron/backend/officeBridge.cjs` 抽出 `dispatch(req, res, url, { internal })` 供两条通道共用（直连通道仍校验 Bearer token），并新增 `POST /papers/batch`（去重后最多 500 个 id，返回 `{ papers, missing }`）与 `BRIDGE_DISABLED` 错误码。`matchRoute` 排除 `/papers/batch` 命中 `GET /papers/:id`。
- 源站记录最近一次同源请求（`lastClient`），设置页据此显示「Word 已连接」；`sw.js` 以 `Service-Worker-Allowed: /` 提供，Service Worker 拿到整源 scope。端口/令牌降级为设置页的「高级：外部工具的端口/令牌连接」，仅供外部工具与冒烟脚本使用。

**文档模型 v2（Custom XML Part）**

- `src/shared/citation/documentModel.ts`：命名空间 `urn:paperquay:word:v2`，part 内容为 `<pq:model rev="N"><![CDATA[json]]></pq:model>`，`rev` 每次保存 +1，多份 part 取 `rev` 最大者（`pickLatestModel`）。
- 模型含 `prefs`（样式、表标题、上标、标点风格、跳转链接、表排序）、`citations`（`lastText`/`lastSignature`/`manualText` 记录与手改保护）、`items`（被引文献元数据**快照**，含 `missing` 标记）。
- 迁移：`document.settings` 只留 `pq:schemaVersion` 做快速判断，v1 键按 `migrateV1Settings` 一一对应迁移（`pq:crossref` → `prefs.links`）；宿主不支持 Custom XML Part 时同一份 XML 退化存进 `pq:model`。
- 新增 `src/shared/citation/wordOoxml.ts` 承担 OOXML 解包与锚点注入；刷新仍以文档扫描为准（`extractCitationControlTagsFromOoxml` 取真实顺序），模型只当缓存，孤立记录由 `pruneModel` 清理，复制粘贴产生的重复 citeId 由 `planDuplicateSplit`/`applyDuplicateSplit` 拆分。

**跳转链接取代 REF 域**

- 文献表每条目整段包在隐藏书签 `_PQ_<hash>` 里（下划线开头不出现在 Word「书签」对话框，名称按内容稳定派生、刷新复用、条目移除时清理），正文编号是 `<w:hyperlink w:anchor="_PQ_…">`，run 属性显式「无下划线 + 自动颜色」。导出 PDF 保留链接，F9 不再出现「错误！未定义书签」。

**加载项源码 TypeScript 化**

- 迁移到 `office-addin/src/*.ts`（`core`/`taskpane`/`dialog`/`polyfills`/`sw`），新增 `scripts/build-office-addin.mjs`（esbuild bundle + tsc 降级 → ES5 产物，兼容 Word 2016 的 IE11 内核）与 `npm run build:office-addin`；`npm run build` 前置该步骤，`office-addin/dist/*.js` 与 `electron/generated/citationFormatters.cjs` 一并提交。
- 清单改用**自定义功能区选项卡**：`引用`（插入引用 / 插入参考文献表 / 刷新）与 `文档`（首选项 / 打开窗格），按钮一律只打开任务窗格，保证一篇文档只有一个写入运行时。

## 验证

- `npm test`：553 例全通过（新增 `tests/citationWordOoxml.test.ts`、`tests/officeAddinOperations.test.ts`，重写 `tests/officeAddin.test.ts` 与 `tests/officeAddinHost.test.ts`；沙箱用例直接加载 `office-addin/dist/core.js` 等 ES5 产物）。
- `npm run build`（含 `build:citation`、`build:office-addin`）全绿；重复构建 `electron/generated/citationFormatters.cjs`、`office-addin/dist/{core,taskpane,dialog}.js`、`office-addin/sw.js` 的 SHA256 不变（产物与源码一致）。
- 手工回归（Word 桌面版）：打开 0.3.x 建立的文档 → 自动迁移到 v2 且编号不变；插入 3 条 → 中间补一条 → 刷新 → 编号重排、跳转链接可点；关闭 PaperQuay 后重开文档仍能按快照刷新；F9 更新域无「错误！未定义书签」；断开后任务窗格自动重连。
