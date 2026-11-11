# PaperQuay v{{VERSION}}

## PDF storage governance preview

- Added a read-only health report for registered PDF attachments, including file availability, size, and content-hash checks.
- Added a naming preview that distinguishes managed files from external paths. Previewing does not rename or move files.
- Reader PDF choices now come from registered attachments instead of treating every PDF in a project folder as a source. Translation language metadata is preserved, and replaced translations retain their attachment records and files.
- Added persistent asset and location schema foundations without automatic backfill, physical deduplication, or garbage collection.

This release does not yet apply or roll back rename plans, quarantine duplicates, or run garbage collection. Those operations remain disabled until locator migration, recovery, and backup round-trip gates are complete.

## Verification

- `npm run build` and all 955 automated tests pass.
- The registered-PDF inventory and naming preview are read-only.
- The health report and naming preview do not change existing PDFs. This version does not automatically rename, move, or delete existing PDFs.

## Downloads

- Windows x64: `.exe`
- Linux x64: `.AppImage`, `.deb`, `.tar.gz`
- macOS x64: `.dmg`

macOS arm64 installers are not built or published. Historical release assets remain available.

---

# PaperQuay v{{VERSION}}

## PDF 存储治理预览

- 新增文库登记 PDF 的只读体检，展示文件可读性、大小和内容哈希核验结果。
- 新增文件命名预览，区分 PaperQuay 管理的文件与外部路径；预览不会改名或移动文件。
- 阅读器的 PDF 来源改为读取已登记附件，不再把项目目录中的任意 PDF 当作文献来源。译版语言信息会保留，替换译版时保留旧版附件记录与文件。
- 新增资产与位置数据表及其持久化基础，尚未自动回填历史资产，也未启用物理去重或垃圾回收。

此版本尚不能执行或回滚改名计划，也不会隔离重复文件或运行垃圾回收。locator 迁移、恢复流程和备份往返门槛完成前，这些操作保持关闭。

## 验证

- `npm run build` 与全部 955 项自动化测试通过。
- 登记 PDF 体检和命名预览均为只读。
- 体检和命名预览不会修改已有 PDF；此版本不会自动重命名、移动或删除已有 PDF。

## 下载平台

- Windows x64：`.exe`
- Linux x64：`.AppImage`、`.deb`、`.tar.gz`
- macOS x64：`.dmg`

不构建或发布 macOS arm64 安装包，历史版本资产继续保留。
