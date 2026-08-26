# 2026-08-26 - MinerU 图表/表格渲染、翻译污染与 PaddleOCR-VL-1.6 调研

> 状态（2026-08-26）：调查与修复实施记录。调查阶段未修改代码；修复已于 2026-08-26 GMT+8 实施并通过验证，详见文末「修复实施记录」。

## 范围与安全边界

- 本记录覆盖结构阅读器中 MinerU 图表/表格显示、图文翻译输入被资源路径或 HTML 污染，以及 PaddleOCR-VL-1.6 作为 PDF 解析候选的可行性。
- 用户提供的截图、PDF 原件、解析缓存中的完整路径，以及示例中的 Bearer Token 均不写入仓库。Token 不应硬编码到源码、文档或测试中；已在对话中暴露的 Token 应视为需要轮换的凭据。
- 本次只读取了与问题直接相关的本地 MinerU 缓存和源代码，不改动应用数据或已有缓存。实施阶段同样未改动解析缓存与翻译缓存文件。

## 当前技术路线决定

> 决定时间：2026-08-26 23:05 GMT+8。当前阶段**暂不切换或接入 PaddleOCR-VL**，优先修复现有 MinerU 结果在类型映射、图注提取、表格/图表渲染和翻译输入上的兼容问题。

PaddleOCR-VL 的本次调研结论和验证清单保留在本文，供未来重新评估时使用；该决定不否定其 PDF 解析能力，也不代表已启动任何 PaddleOCR 集成工作。

## 现象

用户提供的截图中，PDF 左侧可见 Fig. 7 和 Fig. 8 两张曲线图；右侧结构阅读器却只显示两段连续图注文本，没有图片卡片，也没有“没有找到对应的图片资源”占位态。

这表明问题不是图片组件加载失败后的空态，而是对应结构块没有进入图片组件。

## 已验证的本地证据

截至 2026-08-26，对当前本地 MinerU 缓存做了只读对账：28 个含 `content_list_v2.json` 的文档共有 1,464 个 `image_source.path` 引用，所有引用的本地资源文件均存在（缺失 0）。该批资源块的类型分布为 `image` 335、`chart` 406、`table` 191、`equation_interline` 532。

与截图内容匹配的缓存输出中：

- Fig. 7 / Fig. 8 属于同一个 `type: "chart"` 结构块，而非 `type: "image"`；其 `content.image_source.path` 指向 `images/*.jpg`，文件实际存在。
- 该文档包含 8 个 `chart`、8 个 `image` 和 6 个 `table` 块；所有具有资源路径的块在本地均可解析到文件。
- 因此，这个截图所示的问题是**已有本地图片资源未被作为图像块渲染**，不是 MinerU ZIP 下载或本地缓存把图片文件弄丢。

MinerU 云端解析仍会上传 PDF；完成后应用下载 `full_zip_url`，并由 `readZipWithAdm` 将 ZIP 中的所有非目录条目（包括 `images/`）解压到本地缓存目录。上面的文件对账只证明“解析结果已落本地”，不改变 PDF 曾发送至 MinerU 云服务的事实。

## 已确认根因：`chart` 类型没有走图片渲染分支

根因在项目对 MinerU 结构类型的兼容范围，而非资源缺失：

1. `src/services/mineru.ts` 的 `normalizeRawBlockType` 只会把类型名包含 `image` 的块归一化为 `image`；`chart` 保留为 `chart`。
2. `buildRenderableBlocks` 能从 `chart.content.image_source.path` 解析本地资源路径，但不改变其块类型。
3. `src/features/blocks/blockViewerContent.tsx` 只有 `block.type === 'image'` 时调用 `ImageContent` / `AssetFigure`；`chart` 会进入通用 `MarkdownContent` 分支。
4. 所以图表的 caption 被显示为普通文本，图片资源虽然存在，却没有被传给图片组件加载和显示。

截图中的“Fig. 7 … Fig. 8 …”正符合这个路径：两张图在 MinerU 输出中被合并为一个 `chart` block，其 `chart_caption` 被普通 Markdown 分支展示。

## 关联问题：图表翻译输入会混入图片路径

另一个已证实的问题发生在全文翻译的输入组装：

1. `renderInlineMarkdownContent` 的优先字段包含 `image_caption` 和 `table_caption`，但不包含 `chart_caption`。
2. 对 `chart` block，该函数会退回递归拼接对象所有字段；`image_source.path` 因而作为普通字符串参与结果。
3. `extractTranslatableMarkdownFromMineruBlock` 优先使用这个结构化 Markdown，最终把形如 `images/<hash>.jpgFig. 7 ...` 的字符串发给翻译模型。

本地历史翻译缓存中已检出 109 条带 `images/<hash>.jpg` 前缀的译文，说明这不是仅靠代码推演得出的风险，而是已有缓存被污染。该问题会同时造成无效 token 消耗、译文显示污染和图表图注处理不稳定。

## 建议的后续修复（已于 2026-08-26 实施）

- [x] 将 `chart` 与 `figure` 在 `normalizeRawBlockType` / `mapFlatContentType` 中统一归一化为 `image`，自动进入 `ImageContent` / `AssetFigure` 图片渲染分支。
- [x] 新增共享的 `STRUCTURAL_CONTENT_KEYS`，文本提取与 Markdown fallback 忽略 `image_source`、`img_path`、`image_path`、`path` 等结构性资源字段；`renderInlineMarkdownContent` 支持 `chart_caption` / `chart_footnote`，并补充 `table_footnote` / `image_footnote`。
- [x] 只有存在图注或 OCR 正文时视觉块才产生翻译输入；无文本的 image/table 返回空字符串，`buildTranslatableBlockInput` 据此跳过，纯资源路径不再成为翻译单元。
- [x] 为 `image`、`chart`、`table` 三类实际 MinerU JSON 样本补回归测试：本地资源路径解析、图片渲染分支类型、干净翻译输入、存量污染译文的定点失效。

## 新增问题：Table 2 的 HTML 裸露与表头拆分

### 截图中的三个不同现象

用户提供的第二张截图中，右侧结构阅读器依次出现了表格截图、字面量 `<table>...</table>`、以及重排后的结构化表格。它们不是同一个错误：

1. **裸 HTML 字符串是前端 bug**：它不应作为图注显示。
2. **表格截图和结构化表格并列是当前组件的既定设计**：`TableContent` 会先显示原始表格截图，再显示经过 `sanitizeMineruTableHtml` 处理的可读 HTML 表格；如果产品希望避免重复，需要增加“原图 / 结构化表格”切换或默认折叠策略。
3. **原 PDF 的标题、深色配置表头和两张飞行器图未进入结构化表格**：这是 MinerU 将同一物理表拆成多个 block 的解析边界，不能靠 HTML 消毒或 CSS 修复。

### 已验证的 Table 2 缓存证据

截图所示论文第 5 页的 Table 2 在原始 `content_list_v2.json` 中被拆为三个相邻资源块：

- 一个 `image` block：包含 `TABLE 2 Comparison for lift + cruise and tiltrotor eVTOL configurations.` 图注和第一张飞行器图；
- 一个无图注的 `image` block：包含第二张飞行器图；
- 一个 `table` block：包含表格主体截图和 `html`，但 `table_caption` 为空。其 HTML 第一行已从 `MTOW / 1,013 kg / 964 kg` 开始，缺失 PDF 中的“Configuration”视觉表头和配置图。

三个引用的本地资源都存在。因此这既不是资源下载失败，也不是表格 HTML 没有被安全渲染。当前本地缓存的 191 个 `table` block 中，190 个含结构化 HTML；其中 8 个同时满足“HTML 存在、图注为空、表格截图资源存在”，都会触发同一类裸 HTML 图注风险。

### 已确认根因：空图注会错误回退到完整表格内容

根因位于 `src/services/mineru.ts` 与 `src/features/blocks/blockViewerContent.tsx` 的组合：

1. `extractCaptionFromMineruBlock` 对表格调用 `extractTypedContentText(block, ['table_caption', 'caption'])`。
2. 当 `table_caption` 是空数组时，`extractTypedContentText` 没有返回空字符串，而是回退调用 `collectTextParts(block.content)`。
3. `collectTextParts` 会忽略 `image_source` 和 `path`，但没有忽略 `html`；于是整个 `<table>...</table>` 被当成 caption 文本返回。
4. `TableContent` 在安全渲染 `tableHtml` 之前直接输出 `captionText`。React 会转义该字符串，所以截图中出现字面量 HTML；随后同一份 `tableHtml` 又被 `sanitizeMineruTableHtml` 正确地渲染为下方的结构化表格。

截图中“裸 HTML 位于表格截图和结构化表格之间”的顺序与这条代码路径完全一致。安全 HTML 消毒器没有失效，问题在于把 HTML 误送进了图注字段。

### 建议的修复分级（P0 已于 2026-08-26 实施，P1/P2 未实施）

1. [x] **P0，修复裸 HTML（已实施）**：图注提取改为严格字段提取——`extractTypedContentText` 新增 `allowFallback` 选项，`extractCaptionFromMineruBlock` 关闭回退，空 `table_caption` / `caption` 返回空字符串。`collectTextParts` 仅新增忽略 `img_path` / `image_path`，未全局忽略 `html`，摘要、RAG 和翻译路径不受影响。
2. [x] **P0，补回归测试（已实施）**：新增表格用例断言空 caption 不返回 HTML 文本、`tableHtml` 仍完整可用；含真实 caption 的表格另有一条正向用例。
3. **P1，保留被拆分的表头语义**：当无图注的 `table` 前方存在同页、相邻 bbox、且图注匹配 `TABLE <编号>` 的 `image` block 时，建立显式的“表格上下文/表头附件”关系。界面可以将标题和关联图片放在结构化表格之前，而不能简单把所有相邻图片盲目合并。
4. **P2，追求 PDF 外观一致性时使用源页区域**：Table 2 的“Configuration”文字和深色表头背景没有完整地出现在当前结构 JSON 中。若需还原原版表头，应基于 PDF 页面和相关 bbox 生成/显示合并后的源页裁剪，而不是凭空从不完整 HTML 重建表头。
5. **产品取舍**：保留“截图 + 结构化表格”有利于核验解析质量和复制数据；若以紧凑阅读为目标，应添加默认显示结构化表格、按需展开原始截图的控制，而不是删除其中一种表示。

P0 修复仅改变前端从现有 JSON 提取图注的规则。当前缓存会在打开时重新解析，因此不需要删除 MinerU 缓存、重新上传 PDF 或重新调用云端解析即可消除裸 HTML；P1/P2 则需要额外的块关联或 PDF 裁剪能力。

## PaddleOCR-VL-1.6 调研（当前不接入）

### 结论

**可行，但不能作为 MinerU 的零改动替换。**

- PaddleOCR-VL-1.6 官方文档明确支持 PDF 输入，并按 PDF 页返回 `layoutParsingResults`；每页都有 Markdown、结构化 `prunedResult`、`outputImages` 和 `inputImage` 等结果字段。
- 用户提供的 `https://paddleocr.aistudio-app.com/api/v2/ocr/jobs` 示例是异步**云端** Jobs API：本地 PDF 会以 multipart 上传，客户端轮询 `pending` / `running` / `done` / `failed`，再下载 JSONL 结果。因此，采用这条 API 路线并不满足“完全落在本地”。
- PaddleOCR 开源项目也提供本地 Python pipeline（`PaddleOCRVL()`）和完整 HTTP 服务部署路径；这才是可保持 PDF 不离开设备的路线，但需要额外部署 Python / Paddle 运行时、模型和适合的硬件，当前没有在本机做安装、性能或兼容性验证。
- 当前仓库没有 PaddleOCR/PaddleX 集成代码。现有流程只认识 MinerU 的 `content_list_v2.json`、`middle.json` 和 Markdown 回退格式，必须增加一个解析提供方与结果适配层。

### 与当前缓存/阅读器的兼容性

PaddleOCR-VL 的输出有两条可选接入路径：

1. **Markdown 快速预览路径**：把每页 Markdown 合并/持久化，将 `markdown.images` 的内容下载或解码到缓存目录，并确保 Markdown 使用相对的 `![](...)` 路径。现有 `parseMineruMarkdownPages` 已能识别 Markdown 图片并生成 `image` block，因此可较快恢复右侧结构阅读和本地图片显示。
2. **完整结构适配路径**：将 `prunedResult` 中的布局元素、类别、文本、坐标、图表/图片关联关系适配到当前 `MineruPage` / `MineruBlockBase` 模型，再把图片写入本地缓存。只有这一条路径能保留左侧 PDF 与右侧块的 bbox 同步、点击定位、图表/表格的专门渲染和可靠的翻译输入。

第一条路径不会自动产生 bbox；因此可用于离线阅读预览，但不能等价替代当前 MinerU 的页面几何联动。第二条路径不是“把接口 URL 换成 PaddleOCR”即可完成的改动。

### 图像和图表处理的关键点

- 官方文档说明：`markdown.images`、`outputImages`、`inputImage` 等二进制字段默认可以是 Base64；服务启用 URL 返回模式时才会是预签名 URL。用户示例中的 `requests.get(img)` 假定拿到 URL，因此未来适配器必须同时处理 URL 与 Base64，不能只照搬示例下载逻辑。
- 用户示例显式设置 `useChartRecognition: False`。若目标是改善 Fig. 7 / Fig. 8 这类图表的解析、图注关联或图内信息提取，A/B 评估应开启图表识别；官方 pipeline 的 `use_chart_recognition` 默认也是关闭的。
- 官方 pipeline 还将 `use_ocr_for_image_block` 默认设为关闭。若需求包含翻译图内文字，需要在确认云端 Jobs API 的对应参数名后显式开启并评估误识别成本；仅翻译 Markdown 图注无法翻译曲线图、流程图中的位图文字。
- PaddleOCR-VL 产出图片资源并不自动避免当前截图问题：适配层仍必须把 chart/figure 类块统一映射到可调用图片组件的视觉类型，且不能把资源路径混入文本/翻译输入。

### 若未来重新评估的验证顺序（当前不实施）

1. 用本截图对应 PDF 做同一份输入的对照实验，分别记录 MinerU 与 PaddleOCR-VL 的页数、耗时、失败率和云端调用成本。
2. Paddle 路线开启图表识别，并核对每个 `markdown.images` / `outputImages` 资产是否已经下载或解码到本地；对“结果引用数”和“本地文件存在数”做同样的缺失对账。
3. 验证 Fig. 7 / Fig. 8 是否生成独立视觉块、是否保留/拆分图注、是否能在离线重开后显示，避免只看 Markdown 文本正常就判定成功。
4. 对图表、图片、表格、公式、扫描页各取样本，比较阅读顺序、bbox、表格 HTML/Markdown、公式、图内 OCR 与图注质量。
5. 在决定接入前明确提供方契约：缓存目录、原子写入和失败清理、图片 URL 过期后的本地副本、取消/超时/重试、Token 存储、云端数据外发提示，以及旧 MinerU 缓存的兼容策略。

### 参考资料（访问于 2026-08-26）

- [Baidu AI Studio：PaddleOCR-VL 服务化部署与 API 说明](https://ai.baidu.com/ai-doc/AISTUDIO/Cmkz2m0ma)
- [PaddleOCR-VL 官方 Pipeline 文档](https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/PaddleOCR-VL.html)
- [PaddleOCR 官方仓库与本地部署入口](https://github.com/PaddlePaddle/PaddleOCR)

> 调研阶段未调用用户提供的云端 Token、未向 PaddleOCR/MinerU 上传任何新文件、未写入或清理现有解析缓存。PaddleOCR-VL 当前不在本项目的接入计划内。实施阶段未改动解析缓存与翻译缓存文件。

## 修复实施记录

实施时间：2026-08-26 GMT+8。修改范围仅限源码、测试与本调查文档；未改动解析缓存或翻译缓存文件。

### 修改文件

- `src/services/mineru.ts`
  - `normalizeRawBlockType` / `mapFlatContentType`：`chart` / `figure` 归一化为 `image`，走图片渲染分支。
  - 新增模块级 `STRUCTURAL_CONTENT_KEYS`；`collectTextParts` 忽略 `img_path` / `image_path` 等资产字段。
  - `renderInlineMarkdownContent`：优先字段补充 `chart_caption` / `chart_footnote` 及脚注字段；fallback 忽略结构性字段与 `html`。
  - `extractTypedContentText`：新增 `allowFallback` 选项；`extractCaptionFromMineruBlock` 以严格模式提取图注，空 `table_caption` / 空图注返回空字符串，不再回退到完整 `content`。
  - `extractTextFromMineruBlock`：image 分支支持 chart 系列字段。
  - `toMarkdownFragment`：无文本的 image/table 返回空字符串，不再生成占位说明，也不产生翻译单元。
  - `pickFlatContent`：补充 `chart_caption` / `chart_footnote`。
- `src/features/reader/readerTranslation.ts`
  - `normalizeTranslationMap` 丢弃以 `images/<hash>.<ext>` 开头的历史污染译文（可能带“图片说明”等前缀）；缓存读取与写入统一生效，对应块自动进入待翻译列表，下次全文翻译自动重翻，无需删除缓存文件。
- `tests/mineruVisualBlocks.test.ts`：新增 9 个回归用例。

### 验证

- `node --test tests/mineruVisualBlocks.test.ts`：9/9 通过。
- `npm test`：204/204 通过。
- `npm run build`：tsc + vite 构建通过。

### 效果与边界

- Fig. 7 / Fig. 8 等 chart 块现在作为图片块显示本地截图，图注取自 `chart_caption`。
- 表格空图注不再显示转义的 `<table>` 源码；结构化 HTML 仍正常渲染。
- 历史翻译缓存中的受污染条目在读取时被定点丢弃，重新翻译后写入干净结果；无需删除整个语言缓存。
- 实施未覆盖 P1（表头图片区块关联）与 P2（源页区域还原表头）：Table 2 的视觉表头与配置图仍未并入结构化表格；表格“截图 + 结构化表格”双视图的显示取舍也未调整。
