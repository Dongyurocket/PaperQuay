# PaperQuay v{{VERSION}}

PaperQuay is an open-source AI paper workspace for literature management, PDF reading, paper overview generation, full-text translation, inline notes, Zotero import, Agent workflows, and local RAG.

## Downloads

Download the native installer for your operating system from the Assets section below.

| Platform | Recommended asset |
| --- | --- |
| Windows | `.exe` installer or `.msi` package |
| macOS | `.dmg` package for Apple Silicon or Intel |
| Linux | Electron desktop package such as `.AppImage`, `.deb`, or `.tar.gz` |

## Highlights

- **PaddleOCR-VL 1.6 as an Alternative Structure Recognition Engine**: Settings → Document Parsing now offers an engine selector between MinerU and PaddleOCR-VL 1.6 (Baidu AI Studio cloud async Jobs API), applied uniformly across the reader, library, and batch parsing paths. The adapter **normalizes PaddleOCR-VL output into the existing MinerU cache contract** (`content_list_v2.json` + `images/` + `full.md`), so structured reading, image rendering, PDF↔block geometry linking, translation, RAG, and cache self-healing are all reused with zero changes. Layout coordinates and page sizes map to `pdf`-space bounding boxes, figure/table captions attach to the adjacent visual block, assets support both Base64 and presigned URLs with image magic-byte validation, and documents above 100 pages are split and merged automatically — with an explicit error instead of silent page loss if the service returns fewer pages.
- **Forced Re-parsing That Ignores the Cache**: The reader toolbar and the overview page now expose "Re-parse (ignore cache)", and library parsing no longer unconditionally reuses previous results. Before re-parsing, `translations` / `summaries` / `images` are backed up to `*.bak-<timestamp>` and the previous parse outputs are cleared; on success the backup generation is removed, on failure it is retained for rollback. Translations are keyed by `page-N-block-M`, so without this isolation they would silently attach to the wrong paragraphs after block order changes.
- **Idempotent Image Reference Self-Healing**: A new backend command repoints image references that target missing files to the volume files that actually exist, without re-uploading the PDF or spending any quota. It is memoized by the content list's mtime+size, runs automatically when a document is opened, and Settings offers a full-library scan. It refuses to guess when several candidates exist or when a file is genuinely absent.

## Fixes

- **PaddleOCR-VL submits were wrongly reported as failures (`errorCode=undefined`)**: the async Jobs API error envelope actually uses `code` / `msg` (a real 401 returns `{"traceId":"…","code":401,"msg":"Unauthorized"}`), but the implementation checked `errorCode` / `errorMsg` as documented for the **synchronous** service. Since `envelope.errorCode !== 0` was always true, even a **successful** submit raised an error and discarded the returned `jobId`, making the engine unusable. Success is now determined by the presence of `data.jobId`, independent of envelope field naming, and the polling and result-download paths were hardened the same way.
- **Actionable PaddleOCR-VL error messages**: failures now report the HTTP status, the real `code` / `msg`, `traceId`, and a raw response snippet, with targeted hints by status code (401 → invalid token, 404 → wrong base URL, 429 → rate limited, 5xx → server side) instead of an undiagnosable `errorCode=undefined：unknown error`.
- **Pasting the console API URL no longer breaks the base URL**: Baidu AI Studio hands out the full job URL (`…/api/v2/ocr/jobs`); pasting it into the Base URL field previously produced a doubled path and a 404. The suffix is now stripped automatically.
- **All images broken after split/merge of oversized documents**: `mergeMineruParseResults` assumed `content_list_v2.json` was a flat block array, but MinerU v2 (`vlm`) returns a "page array + per-page block dictionary" (`[{ "0": block, … }, …]`), so the loop received a whole page dictionary and never rewrote a single image path. The same code also looked for `img_path` / `image_source` at block top level, while 100% of the 8,955 asset references in a real cache live in the nested `content.image_source.path` — meaning the rewrite had never applied to v2 output at all. Because image copying and `full.md` rewriting are string-based and shape-independent, images were renamed with a `part_N_` prefix and the Markdown was updated, but the structured JSON kept stale references — the reader therefore showed a flood of "No matching image asset was found" cards while the text looked perfectly fine. References are now rewritten at any depth while preserving all three real-world shapes. Full-library reconciliation: **2859 broken references across 9 oversized documents reduced to 0**, with the 53 non-split documents unaffected.

## Notes

- AI features require your own compatible model endpoint and API key in Settings.
- PaddleOCR-VL requires its own access token; the PDF is uploaded to that cloud service when this engine is selected.
- Release assets are generated automatically by GitHub Actions.

---

# PaperQuay v{{VERSION}} 中文说明

PaperQuay 是一个开源 AI 论文工作台，覆盖文献管理、PDF 阅读、论文概览生成、全文翻译、内联笔记、Zotero 导入、Agent 工作流和本地 RAG。

## 下载说明

请在下方 Assets 区域选择与你的操作系统对应的安装包。

| 平台 | 推荐安装包 |
| --- | --- |
| Windows | `.exe` 安装包或 `.msi` 安装包 |
| macOS | Apple Silicon 或 Intel 对应的 `.dmg` 安装包 |
| Linux | `.AppImage`、`.deb` 或 `.tar.gz` 桌面安装包 |

## 本次更新

- **新增 PaddleOCR-VL 1.6 结构识别引擎**：设置 →「文档解析」新增引擎选择器，可在 MinerU 与 PaddleOCR-VL 1.6（百度 AI Studio 云端异步 Jobs API）之间切换，阅读器、文献库与批量解析三条链路统一生效。适配层把 PaddleOCR-VL 输出**归一化为现有 MinerU 缓存契约**（`content_list_v2.json` + `images/` + `full.md`），因此结构阅读、图片渲染、PDF↔块几何联动、翻译、RAG 与缓存自愈全部零改动复用；布局坐标与页尺寸映射为 `pdf` 坐标系 bbox，图注/表注并入紧邻视觉块，资产同时支持 Base64 与预签名 URL 并做图片魔数校验；超过 100 页自动切分合并，返回页数不足时显式报错而非静默丢页。
- **强制重新识别（忽略缓存）**：阅读器工具栏新增「重新解析（忽略缓存）」，概览页新增「重新识别」按钮，文献库解析不再无条件复用已有结果。重新识别前会把 `translations` / `summaries` / `images` 备份为 `*.bak-<时间戳>` 并清理上一次解析产物，成功后清理备份代、失败则保留以便回退 —— 译文按 `page-N-block-M` 索引，重新识别后顺序会变，不隔离会静默错配到别的段落。
- **幂等的解析缓存图片引用自愈**：新增后端命令，把所有指向不存在文件的图片引用重新指向实际存在的分卷文件，无需重新上传 PDF、不消耗任何额度；按 content_list 的 mtime+size 记忆化，打开文档时自动执行，设置 →「文档解析」另提供「修复图片引用」按钮可对全库扫描一次。多候选或真缺失时保持原样、不做猜测。

## 修复

- **PaddleOCR-VL 提交成功却被误判为失败（报 `errorCode=undefined`）**：异步 Jobs API 的错误信封实际使用 `code` / `msg`（实测 401 返回 `{"traceId":"…","code":401,"msg":"Unauthorized"}`），而实现按官方**同步服务**文档的 `errorCode` / `errorMsg` 判定，`envelope.errorCode !== 0` 恒为真 —— 即使提交成功也会抛错并丢弃已经拿到的 `jobId`，导致该引擎完全不可用。现改为**以 `data.jobId` 是否存在判定成功**，不再依赖任何信封字段名；轮询与结果下载同步改造。
- **PaddleOCR-VL 错误信息改为可操作**：失败时输出 HTTP 状态、真实 `code`/`msg`、`traceId` 与原始响应片段，并按状态码给出定向提示（401 → Token 失效、404 → 地址填错、429 → 限流、5xx → 服务端），不再出现 `errorCode=undefined：unknown error` 这类无法定位的提示。
- **容忍从百度控制台整段粘贴 API URL**：控制台给出的是完整作业地址（`…/api/v2/ocr/jobs`），此前粘进 Base URL 会拼成双路径并返回 404；现自动剥离该后缀。
- **超页文档拆分合并后图片全部失效（界面大量「没有找到对应的图片资源」）**：`mergeMineruParseResults` 假定 `content_list_v2.json` 是扁平 block 数组，但 MinerU v2（`vlm`）返回的是「页数组 + 每页块字典」（`[{ "0": block, … }, …]`），导致循环拿到一整页字典、图片改写从未执行；同时该逻辑只在块顶层查找 `img_path` / `image_source`，而真实缓存中 8955 条资产引用 100% 位于嵌套的 `content.image_source.path`，对 v2 产物从未生效。由于图片复制与 `full.md` 改写基于字符串、不依赖 JSON 形状，最终表现为图片被改名为 `part_N_` 前缀、Markdown 正确，唯独结构化 JSON 仍是旧引用，文字正常而图片全部 404。现改为结构保持地识别三种真实形状并递归改写任意深度的资源路径。全库对账：9 份超页文档共 **2859 条失效引用 → 0**，其余 53 份未拆分文档不受影响。

## 使用提示

- AI 功能需要在「设置」中配置兼容的模型服务地址和 API 密钥。
- PaddleOCR-VL 需要单独配置访问 Token；选择该引擎时 PDF 会上传到对应云服务。
- Release 安装包由 GitHub Actions 自动构建与发布。
