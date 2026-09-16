# PaperQuay v{{VERSION}}

## Fixes and Improvements

- **Preserve prose and inline mathematics**: normal Markdown and OCR rendering no longer automatically reconstruct symbol tables from ordinary paragraphs.
- **PDF-image-based block reparsing**: the original PDF region is the primary model input, with OCR text as reference. The dialog shows the actual crop, removes unnecessary structure modes, and explicitly identifies text-only fallback. Corrections can be previewed, saved, and restored; local overrides are isolated by parse version.
- **Reliable PaddleOCR task completion**: document-level backend tasks expose submission, recognition, download, asset, and saving stages. Success is published after results are saved. Task snapshots survive reader-tab closure, while body-download timeouts, duplicate-task protection, and stale-callback guards prevent indefinite or incorrect progress states. Library parsed indicators and automatic indexing are preserved.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

## Notes

- Image-based reparsing requires a compatible vision model configured in Settings. PDF crops are sent to that model service.
- Block corrections affect the local reading view, not OCR source files, translations, or the RAG index.
- PaddleOCR uses its own configured cloud service and access token. This release was verified with mocked cloud responses; no live paid-provider end-to-end run was performed.

---

# PaperQuay v{{VERSION}} 中文说明

## 修复与优化

- **保留正文与行内公式**：普通 Markdown 和 OCR 正文渲染不再自动重建符号表，避免含变量的段落被误转为表格。
- **基于原 PDF 图片的统一区块重析**：以对应区域的切片为主要模型输入，OCR 文本作为参考。弹窗展示实际切片，移除多余结构模式，明确提示仅文本回退。修复支持预览、保存和恢复原文，并按解析版本隔离。
- **PaddleOCR 任务状态同步**：后端统一管理文献级任务，显示提交、识别、下载、资源处理和保存阶段，结果落盘后才发布成功。关闭再打开阅读标签页可恢复状态；补充响应正文超时、重复任务保护和旧回调隔离，保留文献库已解析标记与自动索引。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。

## 使用提示

- 图片重析需要在设置中配置支持视觉输入的兼容模型；PDF 切片会发送至该模型服务。
- 区块修复仅影响本地阅读视图，不改写 OCR 源文件、译文或 RAG 索引。
- PaddleOCR 使用单独配置的云服务与 Token。本次使用模拟云端响应验证任务流程，未进行真实收费服务的端到端识别。
