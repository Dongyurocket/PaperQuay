# PaperQuay v{{VERSION}}

## Fixes

- **Note citations could open the paper but never jump to the cited position**: the anchor `blockId` / `pageIndex` were dropped when the note was persisted, because the anchor whitelist in the note store only kept `pdfLocation`-style fields while AI-polish anchors carry just the block id and page index. Clicking the page button on an excerpt card (e.g. `P20`) or a location chip in the reference list therefore had no position to jump to, and the reader only showed "this citation has no bound PDF position". Anchor positions are now persisted, and existing notes need no migration: the position is recovered at click time from the explicit fields, then from the anchor id (`note-polish:<paperId>:mineru:page-20-block-3:0`), then from the page label.
- **Jump requests no longer hang on papers without structure blocks**: when a paper had no MinerU block data, a note-anchor jump waited forever instead of doing anything. Jumps now degrade gracefully — exact block, then a body block on the same page, then a whole-page highlight — and only report "no bound PDF position" when there is genuinely no location at all.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

## Notes

- Existing notes keep working with no data migration: positions are derived on the fly when you click.
- The fix applies to the note excerpt cards, the reference-list location chips, and the reader-side jump detail, which now share one position resolver.

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **笔记引用只能打开文献、无法跳转到引用位置**：锚点的 `blockId` / `pageIndex` 在笔记保存时被丢弃——锚点字段白名单只保留了 `pdfLocation` 一类字段，而 AI 润色生成的锚点只带块 id 与页下标。因此点击摘录卡片上的页码按钮（如 `P20`）或参考文献列表里的位置芯片时，跳转没有位置可用，阅读器只提示「该引用没有绑定 PDF 位置」。现锚点位置正常落库，且旧笔记无需迁移：位置按「显式字段 → 锚点 id（`note-polish:<paperId>:mineru:page-20-block-3:0`）→ 页码标签」逐级实时还原。
- **没有结构块的文献不再挂起跳转**：此前文献缺少 MinerU 结构块时，笔记跳转请求会一直等待而永不执行。现按「精确块 → 同页正文块 → 整页高亮」逐级降级，只有确实没有任何位置信息时才提示「没有绑定 PDF 位置」。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。

## 使用提示

- 旧笔记无需迁移：点击时即时推导位置，无需改动既有笔记数据。
- 本次修复覆盖笔记摘录卡片、参考文献位置芯片与阅读器跳转参数三处入口，它们现在共用同一套位置解析。
