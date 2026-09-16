# 2026-09-16 - 拆分合并图片引用修复、强制重新识别与 PaddleOCR-VL 1.6 引擎

## 现象

打开超 200 页、走 MinerU 自动拆分合并的长文档（例如《Comprehensive Multi-Disciplinary Design of an Electric Vertical Take-Off and Landing Aircraft》）时，右侧结构阅读器出现大量「没有找到对应的图片资源」，并伴随 IPC 报错：

```
Error invoking remote method 'paperquay:invoke':
Error: ENOENT: no such file or directory, stat
'...\.mineru-cache\document-9ba2a1b0\images\9e068cdc…f08d8.jpg'
```

同一文档内所有图、表、公式截图都受影响，但正文文字完整。用户同时提出：需要能重新执行 PDF 识别（忽略已有缓存），并把 PaddleOCR-VL 1.6 作为可选的识别引擎。

## 根因

报错请求的 `images/9e068cdc….jpg` 在磁盘上实际以 `images/part_1_9e068cdc….jpg` 存在 —— **图片没有丢，是引用名与文件名不一致**，由 `electron/backend/mineruMerge.cjs` 的两个缺陷造成。

### 缺陷 A：形状假设（主因）

`mergeMineruParseResults` 假定 `content_list_v2.json` 是「扁平 block 数组」：

```js
const parsed = JSON.parse(extracted.contentJsonText);
if (Array.isArray(parsed)) {
  for (const block of parsed) { … }   // block 被当成单个结构块
```

但 MinerU v2（`model_version: 'vlm'`）返回的是**页数组 + 每页块字典**：`[{ "0": block, "1": block }, …]`。实测报错文档：外层长度 261，每个元素都是数字键对象，`page_idx` 字段数量为 **0**。

于是循环拿到的 `block` 是一整页字典，`block.img_path` / `block.image_source` 恒为 `undefined`，**图片改写一次都没执行**，原封不动 push 进合并结果。

### 缺陷 B：字段层级（对 v2 从未生效）

即使形状是扁平数组，v2 的资源路径位于 `content.image_source.path`（嵌套），而旧代码只检查**顶层**的 `img_path` / `image_source`。全库实测 8955 条资产引用**100% 是嵌套形状，顶层 `img_path` 为 0 条** —— 说明该改写逻辑对 v2 产物从未生效过。

### 为什么只有图片坏、文字没事

合并流程第一步「复制并重命名图片」与第四步「改写 `full.md`」都基于字符串、不依赖 JSON 形状。因此图片被改名为 `part_N_`、Markdown 也改对了，唯独 `content_list_v2.json` 里的引用没改。

### 全库对账证据

| 缓存形状 | 文档数 | 缺失引用 |
|---|---|---|
| 页字典（超 200 页拆分产物） | 9 | **2859** |
| 扁平（≤200 页，未拆分） | 53 | 0 |

缺口 100% 落在 9 份页字典文档上。扁平文档之所以健康，只是因为它们根本没走拆分、文件名没被改名。

### 为什么测试没拦住

`tests/mineruSplitMerge.test.ts` 用的是 `{ img_path: 'images/fig1.jpg' }`（v1 顶层形状），恰好绕开了这两个缺陷；解析侧的页字典兼容已在 0.1.43 补齐（见 CHANGELOG），但**合并写入侧**一直缺失。

## 修改

### 1. 修复合并阶段的图片改写

- 新增 `electron/backend/mineruContentList.cjs`：`mapContentListBlocks` 结构保持地识别 flat / pages / dict 三种形状（页字典保持对象形状与键顺序，阅读器 `parseMineruPages` 依赖它还原分页）；`remapStringValuesDeep` 递归改写任意深度的字符串值；`collectBlockAssetPaths` 只收集结构性资源字段，不扫描正文。
- `electron/backend/mineruMerge.cjs`：改用上述工具逐块改写图片路径；`page_idx` 偏移仅对扁平块生效（页序由数组顺序保持）。`remapImagePath` 增加扩展名约束，避免把正文里恰好出现的同名字符串一并改写。

### 2. 存量缓存自愈（无需重新识别、不消耗额度）

实测 2859 条缺失引用**全部**能唯一匹配到 `part_<N>_<basename>`（歧义 0、真缺失 0），因此可原地修复。

- 新增 `electron/backend/mineruCacheCommands.cjs`：`repairMineruCacheImages` 把指向不存在文件的引用改写为实际存在的 `part_<N>_` 文件；多候选或真缺失时保持原样并计入 `unresolved`（不猜）；原子写回；按 content_list 的 mtime+size 做进程内记忆化，命中时不再解析大 JSON，且不重复上报修复条数。
- 阅读器加载缓存前自动自愈（`documentReaderCache.loadSavedMineruPages` 新增可选 `repairCacheImages` 钩子，`DocumentReaderTab` 注入）。
- 设置 →「文档解析」→ 缓存目录新增「修复图片引用」按钮，可对全库执行一次扫描。

### 3. 允许强制重新识别

- 新增 `prepare_mineru_reparse` / `finish_mineru_cache_reparse`：重新识别前把 `translations` / `summaries` / `images` 重命名为 `*.bak-<时间戳>` 并清理上一次的解析产物；成功后清理备份代，失败则保留以便回退。译文按 `page-N-block-M` 索引，重新识别后顺序会变，必须隔离否则会静默错配到别的段落。
- 阅读器解析动作拆为 `runDocumentParse({ force })`：`force` 时跳过「复用已有结果」分支。`useReaderLibraryActions` 的文献库解析动作同样接受 `force`，不再无条件复用缓存。
- 入口：阅读器工具栏菜单「重新解析（忽略缓存）」、概览页「重新识别」按钮。

### 4. 新增 PaddleOCR-VL 1.6 识别引擎

核心设计决策：**适配层把 PaddleOCR-VL 输出归一化成现有 MinerU 缓存契约**，而不是在渲染层新增第二条解析路径。阅读器、图片渲染、PDF↔块 bbox 联动、翻译、RAG、缓存自愈全部零改动复用。

- 新增 `electron/backend/paddleOcrCommands.cjs`：走官方云端异步 Jobs API（`POST {base}/api/v2/ocr/jobs` multipart 上传 → 轮询 `pending/running/done/failed` → 下载 JSONL 汇总 `layoutParsingResults`），默认模型 `PaddleOCR-VL-1.6`，鉴权 `Authorization: bearer <token>`。超过 100 页时复用现有切分与合并流程；返回页数少于实际页数时显式报错而不是静默丢页。资产支持 Base64 与预签名 URL 两种返回形态，并做图片魔数校验。
- 新增 `electron/backend/paddleOcrNormalize.cjs`：`block_label` → MinerU 兼容类型映射（图/表/公式/标题/正文）；`figure_title` / `table_title` 并入紧邻的视觉块作为 `image_caption` / `table_caption`；`prunedResult.width/height` 作为 `bboxPageSize` 输出 `pdf` 坐标系 bbox，保住几何联动；`markdown.images` 落盘到 `images/` 并把 `full.md` 中的引用改写为本地路径。
- 设置新增 `parseProvider`（`mineru` | `paddleocr-vl`）与 `paddleOcrApiBaseUrl`，凭据新增 `paddleOcrApiToken`；阅读器、文献库、批量任务三条解析链路统一走 `runDocumentParseWithFallback` 分发。
- 设置分区「MinerU」更名为「文档解析」，顶部提供引擎选择器。

## 验证

- `tests/mineruSplitMerge.test.ts` 新增 2 个用例：页字典形状的图片改写与分页形状保持、扁平数组下的嵌套 `content.image_source.path` 改写（含图注文本不被破坏）。
- 新增 `tests/mineruCacheRepair.test.ts`（6 个用例）：唯一命中改写、幂等与记忆化、多候选拒绝猜测、正文/远程/绝对路径不动、重新识别前的备份与清理、失败时保留备份。
- 新增 `tests/paddleOcrNormalize.test.ts`（6 个用例）：标签映射与 bbox/页尺寸、图注表注并入宿主块、Markdown 引用改写、顺序兜底匹配资产、资产下载失败时降级为段落而不留死引用、图表识别默认关闭。
- `npm test`：315 项通过，0 失败。`npm run build`：tsc + vite 构建通过。
- 真实缓存端到端：对本地 `.mineru-cache` 62 份 `content_list_v2.json` 执行修复，缺失引用由 **2859 → 0**，涉及 9 份文档（`document-2d52055a` 340、`document-41411cff` 249、`document-446c2460` 501、`document-5ac5d4db` 244、`document-665f861a` 231、`document-80135edb` 202、`document-9ba2a1b0` 447、`document-9cd75055` 358、`document-f845a8fa` 287），0 条无法解析；第二次执行固定为 0 条，确认幂等。

## 边界与未覆盖

- PaddleOCR-VL 云端 Jobs API 的字段口径依据官方异步调用示例与 PaddleOCR 官方 SDK 实现核对；本机未持有 Token，**未做真实端到端调用验证**，首次使用需以实际返回为准。
- PaddleOCR-VL 的图表识别（`useChartRecognition`）默认关闭，以与 MinerU 的「chart 作为截图渲染」保持一致；开启后图表转 Markdown 表格的路径在适配层已有分支，但未做质量对比。
- 未改动 `middle.json` 中的资产路径（MinerU 合并阶段同样不处理），实测缓存中该文件不承载图片引用。
- 强制重新识别会重新上传 PDF 并消耗云端额度，界面未加二次确认弹窗，仅按钮文案与提示说明。

## 追加修复（v0.1.47 热修，2026-09-16）

### 现象

v0.1.46 发布后，用户在应用中启用 PaddleOCR-VL 引擎时报错：

```
Error invoking remote method 'paperquay:invoke':
Error: PaddleOCR-VL 提交失败（errorCode=undefined）：unknown error
```

### 根因

对真实端点做只读探测（伪造 Token，不发送任何真实数据），抓到异步 Jobs API 的实际错误信封：

| 场景 | 真实响应体 |
|---|---|
| 401 未授权 | `{"traceId":"f952a5c8-…","code":401,"msg":"Unauthorized"}` |
| 404 路径重复 | `{"timestamp":"2026-09-16 23:19:57","status":404,"error":"Not Found","path":"/api/v2/ocr/jobs/api/v2/ocr/jobs"}` |

**异步 Jobs API 使用 `code` / `msg`**，与官方**同步服务**文档记载的 `errorCode` / `errorMsg` 并不一致。实现照文档写死了：

```js
if (envelope.errorCode !== 0) {
  throw new Error(`PaddleOCR-VL 提交失败（errorCode=${envelope.errorCode}）：${envelope.errorMsg || 'unknown error'}`);
}
```

`envelope.errorCode` 恒为 `undefined`，`undefined !== 0` 恒为真 —— **提交成功也会被判为失败**，并且已经拿到的 `data.jobId` 被直接丢弃。另一个佐证：`utils.readRequestJson` 在非 2xx 时会抛出 `HTTP <status>`，而用户看到的是本实现的文案，说明该请求实际返回了 2xx。

定位过程中的一个干扰项：`gh` CLI 在该检出目录默认解析到 `upstream`（`WangQrkkk/PaperQuay`），使 `gh run list` / `gh release list` 显示上游数据（最新 release 停在 v0.1.25），一度看起来像 Actions 未运行；加 `-R Dongyurocket/PaperQuay` 后确认 fork 的发布链路一直正常。

### 修改

均位于 `electron/backend/paddleOcrCommands.cjs`：

1. `submitPaddleOcrJob` 改为**以 `data.jobId` 是否存在判定成功**，不再依赖任何信封字段名。
2. 新增 `readPaddleResponse` / `pickPaddleErrorCode` / `pickPaddleMessage` / `pickPaddleTraceId` / `describePaddleFailure`：失败时输出 HTTP 状态、真实 `code`/`msg`、`traceId` 与原始响应片段，并按状态码给出定向提示（401 → Token 失效、404 → 地址填错、429 → 限流、5xx → 服务端）。
3. 新增 `resolvePaddleApiBaseUrl`：百度控制台给出的 `API_URL` 是完整作业地址，整段粘贴时自动剥离 `/api/v2/ocr/jobs` 后缀，避免双路径 404。
4. 轮询 `pollPaddleOcrJob` 与结果下载 `downloadPaddleOcrLayoutResults` 按同一口径改造。

### 验证

- 新增 `tests/paddleOcrEnvelope.test.ts`（7 例），把上述**实测真实响应体**固化为回归用例，含两条直接锁死本次症状的断言：成功信封无 `errorCode` 时必须被接受（旧实现会抛错）、401 的报错文案中不得出现 `undefined`；另覆盖 Base URL 归一化、`code`/`errorCode` 双命名探测、成功码 `0` 不被误判。
- `npm run check`：322 项测试通过，0 失败；构建通过。
- 未使用用户真实 Token 做端到端调用；修复后的实际提交行为待用户首次成功解析确认。

