# PaperQuay v{{VERSION}}

## What's Fixed

- Reader QA and the local knowledge base can now retrieve the formula blocks themselves. Before this release, a mixed Chinese/English question such as "公式(6)，cm的计算公式是哪里来的" matched nothing in the keyword channel, so the model only saw the sentence that cites the equation, not the equation.
- Keyword search now splits Chinese/English queries at character boundaries and expands equation numbers (`公式(6)`, `Eqs. 5-7`), reference numbers (`[18]`) and short symbols (`cm`) into equivalent forms such as `\tag{6}`, `(6)` and `C _{m}`. Paper-scoped retrieval adds an exact equation/reference channel so 1-2 character tokens are no longer limited by the trigram index.
- Context expansion is no longer fixed to one chunk before and after a hit: it now bridges short sub-figure captions (`(a)`, `(b)`, ...) and keeps contiguous equation groups together, so equations are no longer cut off by figure captions.
- New cross-reference hydration: when the question or a retrieved paragraph cites `Eqs. 5-7`, `公式(6)` or `[18]` and the corresponding equation block or bibliography entry is missing, it is fetched from the same paper; these sections are kept preferentially when the token budget is tight.
- Fixed mixed-retrieval score mixing: `mineru-markdown` and `pdf-text` results are filtered within each source before ranking, so exact (`fts`) hits are no longer dropped by a vector-distance threshold.
- MinerU chunking is upgraded to `mineru-chunks-v3`: consecutive caption fragments, contiguous equation groups and their variable definitions are merged within a section, equations are wrapped in `$$...$$` with a section hint, and legacy indexes stay usable until reopened or manually rebuilt.
- LaTeX cleanup now repairs MinerU OCR spacing such as `C _ {m}`, `0. 5`, `0. 1 1` and `1. 1 7 5`.
- QA prompts now ask the model to check `$$...$$` / `\tag{n}` equations and bibliography entries in the context; citations gain an `equation` evidence kind and preview truncation no longer cuts a formula in half. The MCP `search_knowledge_base` tool receives the same formula/short-token retrieval and caption-bridging behavior.

## Notes

- No schema or `user_version` change. Existing local RAG indexes remain readable; the new `mineru-chunks-v3` chunking is applied lazily when a paper is opened for QA or manually re-indexed, so the whole library is not silently re-embedded.
- Database, PDF, MinerU cache and library data are untouched by this release.

## Verification

- `npx tsc --noEmit` and `npm run build` passed. `npm test` ran 816 tests with 815 passing, 1 optional benchmark skipped and 0 failed. Build and tests used a repository-local temporary directory to avoid the local `%TEMP%` write lock.
- Verified against a read-only copy of a real paper (Conceptual Design of an AAM Tiltrotor via Aircraft-Level Weight-Performance Feedback): with the legacy index, the question already returns both equation (6) and reference `[18]`; after `mineru-chunks-v3` re-chunking the index shrank from 175 to 133 blocks and equations (5)-(7) became one section-tagged formula block.
- Per-page click-through QA of the installed build was not performed before release.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 修复内容

- 阅读器问答与本地知识库现在能直接检索到公式块。此前「公式(6)，cm的计算公式是哪里来的」这类中英混合提问在关键词通道 0 命中，模型只能看到引用公式的那句话，看不到公式本体。
- 关键词检索按中英边界切分查询，并把公式编号（`公式(6)`、`Eqs. 5-7`）、参考文献编号（`[18]`）和短物理量（`cm`）扩展为 `\tag{6}`、`(6)`、`C _{m}` 等等价写法；单篇范围新增精确公式/文献通道，1~2 字符短词不再受 trigram 限制。
- 上下文扩展不再固定前后各 1 片：遇到 `(a)`、`(b)` 等子图题注碎片或连续公式组时会继续桥接，公式不再被插图题注挡断。
- 新增交叉引用补全：提问或命中段落引用 `Eqs. 5–7`、`公式(6)`、`[18]` 而对应公式块或参考文献条目缺失时，自动从同一篇补齐；预算紧张时优先保留这些段落。
- 修复混合检索分数混排：`mineru-markdown` 与 `pdf-text` 先在各自来源内过滤再统一排序，精确（`fts`）命中不再被向量阈值误杀。
- MinerU 分块升级为 `mineru-chunks-v3`：同小节内合并连续图注碎片、连续公式组及其变量说明，公式包裹 `$$...$$` 并附带小节锚点；旧索引继续可用，打开文献或手动重建时才升级。
- LaTeX 清洗补充 MinerU OCR 空格修复：`C _ {m}`、`0. 5`、`0. 1 1`、`1. 1 7 5` 等断字自动归一。
- 问答提示词要求在上下文中核对 `$$...$$` / `\tag{n}` 公式与参考文献条目；引用证据类型新增 `equation`，预览截断不再从公式中间腰斩。MCP `search_knowledge_base` 同步获得公式/短编号检索与跨图注邻域能力。

## 说明

- 未修改数据库 schema 或 `user_version`。已有本地 RAG 索引继续可读；新的 `mineru-chunks-v3` 分块在打开文献问答或手动重建索引时才生效，不会静默重嵌整库。
- 本版本不触碰数据库、PDF、MinerU 缓存与文库数据。

## 验证

- `npx tsc --noEmit` 与 `npm run build` 通过；`npm test` 816 项中 815 通过、1 项可选基准跳过、0 失败。构建与测试使用仓库内临时目录，规避本机 `%TEMP%` 写入锁。
- 使用真实论文《Conceptual Design of an AAM Tiltrotor via Aircraft-Level Weight-Performance Feedback》的只读副本验证：沿用旧索引时该提问即可同时取到式 (6) 与参考文献 `[18]`；按 `mineru-chunks-v3` 重分块后索引块由 175 降至 133，式 (5)–(7) 合并为一个带小节锚点的公式块。
- 发布前未执行安装版逐页界面点击验收。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
