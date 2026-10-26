# PaperQuay v{{VERSION}}

Manual and batch RAG rebuilds now finish an interrupted pdf-text index.

- In hybrid mode, a paper stayed on "RAG pending" when MinerU was already indexed and a pdf-text index had stopped mid-batch.
- Library rebuild only rewrote the MinerU source, so the badge did not change.
- Forced rebuilds now read the PDF text layer and resume the missing pdf-text chunks. Automatic indexing after parsing still writes MinerU only.

Validation: the local library was checked; one paper had a ready MinerU index and a pending pdf-text index at 48/178. The full test suite was not re-run before tagging, and desktop installers were not hand-regressed. Installers are built by the `app-v{{VERSION}}` release workflow.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

手动和批量重建 RAG 索引时，会把中断的 pdf-text 索引补完。

- hybrid 模式下，MinerU 已经索引完成，但 pdf-text 停在半成品时，文献卡会一直显示「RAG 待索引」。
- 文献库重建以前只重写 MinerU，角标不会变化。
- 现在手动和批量重建会读取 PDF 文本层，并补上缺失的 pdf-text 分块。解析后的自动索引仍只写 MinerU。

验证：已核对本机文献库，一篇文献的 MinerU 为 ready、pdf-text 停在 pending 48/178。打标签前没有重跑完整测试，也没有做干净安装版手工回归。安装包由 `app-v{{VERSION}}` Release 工作流构建。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
