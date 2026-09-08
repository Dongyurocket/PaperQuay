# 首字下沉与术语表排版自动修复，新增不满意区块 AI 大模型重析功能

## 背景与问题

用户在使用 PaperQuay 阅读学术文献的 MinerU 结构化排版时，遇到两类典型排版破坏问题：
1. **首字大写/下沉（Drop Cap）识别怪异**：例如 IEEE/AIAA 论文开头的下沉首字母 `U` 跨两行高度，导致紧随其后的首行文本被版面模型和基线检测误判为微缩悬浮上标（如 `U<sup>RBAN ...</sup>` 或 `U^{RBAN ...}`），右侧大片空白且次行错位脱节。
2. **术语表（Nomenclature）无框表格坍缩**：学术论文开头的变量表在排版上为双栏无框对齐，版面模型因无实线边框将其误判为普通段落；在去除排版软换行时，数十条独立变量定义被强行压平拼接成一团密集的乱码长段落，等号丢失，符号与文字严重粘连（如 `Bnumber`、`C_Bbattery`、`mmass`、`cchord`）。

用户要求：
- 均采用快速后处理对策自动解决上述问题；
- 增加一个能够选择识别不满意的区块、调用用户自选 AI 大模型进行重新识别处理的功能，并对 Prompt 施加严格约束，坚决不生成任何多余废话。

## 解决方案

### 1. 快速后处理自动修复

- **`sanitizeDropCapArtifacts` (`src/utils/markdown.ts`)**：
  - 自动识别段首或行首单个大写字母后紧接的 HTML `<sup>` 或 LaTeX `^{...}` 伪上标；
  - 将大写首字母与词干还原为标准大小写词汇（如 `U` + `RBAN` $\to$ `Urban`），保留后续同行句子，消除异常留白与次行断层；
  - 自动修复单字母与大写词干之间的排版空格断裂（如 `U RBAN` $\to$ `Urban`）。
- **`reconstructNomenclature` (`src/utils/markdown.ts`)**：
  - 智能检测 Nomenclature / 符号表语境与密集符号粘连特征；
  - 解耦粘连符号：单字母粘连（`Bnumber` $\to$ `$B$` 与 `number`）、双写粘连（`cchord` $\to$ `$c$` 与 `chord`、`mmass` $\to$ `$m$` 与 `mass`）、下标变量（`C_Bbattery` $\to$ `$C_B$` 与 `battery`、`C_{D_p}parasitic` $\to$ `$C_{D_p}$` 与 `parasitic`）及 LaTeX 希腊字母；
  - 将坍缩段落重构为优雅的两列 Markdown 变量定义表（`| 符号 (Symbol) | 说明与单位 (Description) |`），数学符号自动包裹 LaTeX 行内公式并通过 KaTeX 矢量渲染。
- **全链路集成**：在 `normalizeMarkdownMath` 与 `mineru.ts` 的 `buildRenderableBlocks` 中全局注入，文献一经加载即呈现排版美观的表格和连贯正文。

### 2. 不满意区块 AI 大模型重新识别功能

- **后端 IPC 命令 `reparse_block_openai_compatible` (`electron/backend/aiCommands.cjs`)**：
  - 支持调用任意 OpenAI 兼容模型对单块进行重析；
  - 提供超强负向约束的 Prompt：严禁任何客套问候、开场白、解释分析或代码块外框包裹；
  - 服务端防御性清洗：过滤 `<think>...</think>` 思考标签、剥离最外层代码块 fences 与可能逃逸的前置/后置废话。
- **前端服务 `src/services/blockReparse.ts`**：
  - 读取用户配置的所有模型 presets（GPT-4o、Claude 3.5、DeepSeek-V3、Qwen 等），支持下拉自由选择模型。
- **交互组件 `BlockReparseModal.tsx` & `BlockViewer.tsx`**：
  - 在每个结构块悬浮操作条（「✨ AI 重析」）和右键菜单（「✨ AI 重新识别此块」）中均提供触发入口；
  - 支持「智能排版纠错」、「表格/术语表结构化」、「数学公式提取」三种模式与补充要求输入；
  - 提供渲染效果与 Markdown 原文对比，一键应用覆盖当前区块，并在区块头部标示「AI 已修复」；支持随时一键恢复原始 MinerU 识别。

## 验证与测试

- 新增 `tests/blockReparse.test.ts` 与更新 `tests/superscript.test.ts`；
- 全量 271 项测试用例全部通过（pass 271, fail 0）；
- `npm run build` TypeScript 编译与 Vite 生产构建零错误。
