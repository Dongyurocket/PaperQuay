# PaperQuay v{{VERSION}}

Agent retrieval follows the selected paper scope, preserves resumable research coverage, and keeps streamed drafts out of final answers.

- Scope validation and local source registration prevent silent expansion and invalid citation navigation. Single-tilde ranges and citations inside formulas render correctly across four Markdown surfaces.
- Tool results remain valid JSON within their budget. Long paper context supports version-bound offset continuation; RAG uses deterministic topK batches and source deduplication, without cursor pagination.
- Surveys track abstract screening, retrieved passages, focused reading, citations and unresolved questions. Cancellation preserves completed work and a checkpoint for continuation; token and time budgets use measured usage.
- Delivery checks detect missing sections and incomplete output. Optional content checks prioritize risky claims and keep failed or invalid responses unknown; note evidence and write approval remain independent.
- Stream completion and recovery no longer restore tool-call drafts into the answer. Reader page counts and consecutive citations to different pages of the same PDF stay synchronized.

Validation: frontend build and all 828 tests passed. Isolated Electron checks covered a single-paper engineering question and a 13-paper, four-section survey cancelled and resumed. The original 176-paper request was not reproduced; a fixture verifies its scheduling contract only. Reading excerpts does not imply full-paper reading, and structural checks do not guarantee scientific correctness.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本版统一 Agent 检索范围，补齐可继续的综述覆盖记录，并修复流式草稿、数学引用和阅读器来源跳转。

- 检索遵循所选文献范围，校验本地来源后才注册引用；四个 Markdown 入口正确显示单波浪号数值范围和公式内引用。
- 工具预算保持合法 JSON；长正文支持版本绑定的 offset 续取。RAG 使用确定性 topK 批次与来源去重，没有游标分页。
- 综述分别记录摘要筛选、正文检索、重点摘段、实际引用与未解决问题；取消保留已完成结果，可从 checkpoint 继续，预算依据实际 token 与耗时。
- 交付检查识别章节缺项与未完成输出；可选内容检查优先核验高风险主张，失败或无效响应保持未知，笔记证据门禁与写入审批独立。
- 修复终态竞态和恢复时工具前草稿混入正文；阅读器页数与 PDF 生命周期同步，同篇不同页引用可连续定位。

验证：前端构建与全部 828 项测试通过。隔离 Electron 实测单篇工程问答，以及 13 篇四节综述取消后继续。原 176 篇任务未原样复现，fixture 仅验证调度契约；摘段阅读不代表全文通读，结构检查不保证学术结论正确。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
