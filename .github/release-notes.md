# PaperQuay v{{VERSION}}

Agent answers now number verified evidence fragments in first-use order and show a matching reference list immediately after the answer.

- Each answer starts at [1]. Repeated uses of the same verified fragment share a number; different fragments from the same paper and PDF page retain separate entries.
- The complete reference list includes titles, available PDF page numbers and distinguishable previews, with expandable long excerpts. Body markers and list entries open the same canonical target.
- Citation verification details use the same numbers. Failed, pending and legacy citations remain unavailable; partial streaming tokens do not expose internal IDs or enable navigation.
- Reader navigation locates only a unique original block. Missing or ambiguous blocks fall back explicitly to a reliable PDF page; missing locations, invalid pages and unavailable PDFs show clear status messages.
- Fixed persistence of citation-verification run events. Display numbering is derived from existing saved evidence; no database migration is required.

Validation: frontend build and all 690 tests passed, along with production message-component interaction checks. Full desktop acceptance remains pending: the live model verifier produced no successful bindings and subsequent desktop automation failed. The user will continue manual testing after release; verification gates have not been weakened.

## Downloads

Choose the installer for your system from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本版让 Agent 按正文首次有效引用顺序编号，并在正文后显示对应的片段级参考文献列表。

- 每条回答从 [1] 开始，同一已核验片段重复引用复用编号；同篇同页的不同片段保留独立条目。
- 完整列表包含题名、可用 PDF 页序及可区分的预览，长片段可展开；正文编号与列表入口使用同一原始定位目标。
- 核验明细共享编号；失败、待核验和历史数字引用仍不可跳转，流式半 token 不泄露内部 ID 或生成可信链接。
- 阅读器只定位唯一原结构块；失效或歧义 block 明确降级到可靠 PDF 页面，缺失位置、越界页码和 PDF 不可用均显示明确提示。
- 修复引用核验运行事件保存。编号来自既有证据快照，无需数据库迁移。

验证：前端构建与全部 690 项测试及生产消息组件交互检查通过。完整桌面验收待补测：真实模型核验未产生成功绑定，后续桌面自动化报错。用户将在发布后继续人工测试，核验门禁未放宽。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
