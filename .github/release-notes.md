# PaperQuay v{{VERSION}}

## Backup restore fixes

- **MinerU results now load after restoring a `.pqbackup`.** Imports no longer keep the package's `default/` or `custom-xxxxxxxx/` folder level, so parse caches land where the reader looks for them. The cache root that was active on the source machine takes priority; duplicate cache folders are skipped as a whole.
- **PDFs of papers you had opened on the source machine are found again.** Original and translated PDFs are rebound by attachment ID to the restored files, and reading history is rewritten to match. Stored paths written with forward slashes or different letter case also match.
- **Data already restored with 0.4.19 is repaired automatically.** On first launch after upgrading, PaperQuay moves MinerU cache folders up one level and relinks attachments marked as missing. This runs once and does not touch profiles that never imported a backup. Archives exported by 0.4.19 do not need to be re-exported and can be imported again.
- Restore folders whose parent is a junction (for example `Documents\BaiduSyncdisk`) are resolved to their real path instead of being rejected; unsafe-destination errors now explain the cause.
- The restore summary counts restored, unresolved, and not-in-package attachments. Attachment warnings are listed first in the backup preview.
- Restored attachments keep their original display file names.

## Downloads

- Windows x64: `.exe`
- Linux x64: `.AppImage`, `.deb`, `.tar.gz`
- macOS x64: `.dmg`

macOS arm64 installers are not built or published (since v0.4.18). Historical release assets remain available.

## Verification

- `npm run build` and all 944 automated tests pass, including 8 new cross-directory restore regression tests.
- Re-running the pre-fix reproduction (real export with a junction library folder, default and custom MinerU roots, five attachment variants) now restores every attachment and places MinerU results in the correct folder.
- A desktop import on November 7, 2026 restored 225 attachments with 0 unresolved, 0 missing from the package and no warnings; the 8.6 GB RAG database and MinerU caches came back with the archive. The import moved the library to another folder on the same machine.
- Not covered: `pdfPath` in MinerU's `paper_reader_manifest.json`, cross-machine migration, low-disk and power-loss drills.

---

# PaperQuay v{{VERSION}}

## 备份恢复修复

- **恢复 `.pqbackup` 后 MinerU 解析结果可以正常读取。**导入时去掉包内 `default/`、`custom-xxxxxxxx/` 这一级目录，缓存装到阅读器查找的位置；源机生效的缓存根优先，同名缓存目录整目录跳过。
- **源机上打开过的文献，PDF 可以重新找到。**原文和译文按附件 ID 改绑到恢复后的文件，阅读历史同步改写；`stored_path` 含正斜杠或大小写不同也能匹配。
- **已用 0.4.19 恢复的数据会自动修复。**升级后首次启动时一次性上移 MinerU 缓存目录，并找回标记为缺失的附件；只执行一次，不影响未导入过备份的数据。0.4.19 导出的备份包无需重新导出，可直接重新导入。
- 恢复目录父级经过 junction（如 `Documents\BaiduSyncdisk`）时解析为真实路径，不再直接拒绝；不安全目录的报错说明具体原因。
- 恢复摘要记录附件已恢复、未找回和包内缺失的数量；备份预览中附件类警告优先显示。
- 恢复后保留附件原文件名显示。

## 下载平台

- Windows x64：`.exe`
- Linux x64：`.AppImage`、`.deb`、`.tar.gz`
- macOS x64：`.dmg`

自 v0.4.18 起不再构建或发布 macOS arm64 安装包，历史版本资产保留。

## 验证

- `npm run build` 与全部 944 项自动化测试通过，其中新增 8 项跨目录恢复回归测试。
- 用修复前的复现脚本（真实导出，含 junction 库目录、默认与自定义两个 MinerU 根、5 种附件）重跑：全部附件可找回，MinerU 结果位于正确目录。
- 2026-11-07 桌面实测：0.4.20 导出的完整包导入同机另一库目录，恢复 225 个附件，0 未找回、0 包内缺失、无警告；8.6 GB 的 RAG 数据库与 MinerU 缓存随包恢复。
- 未覆盖：MinerU `paper_reader_manifest.json` 的 `pdfPath`、跨机器迁移、低磁盘与断电演练。
