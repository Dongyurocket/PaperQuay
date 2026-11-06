# PaperQuay v{{VERSION}}

## Encrypted backup and migration

- Export and import a password-protected, single-file `.pqbackup` archive. Archives use AES-256-GCM encryption with a password-derived key; forgotten passwords cannot be recovered.
- The migration preset includes application configuration and API keys, the library/notes/RAG databases, PDFs, Agent memory and conversation history, review drafts, graph relations, reader state, annotations, the notes vault, and MinerU-derived caches.
- Based on the current sample, a full migration package is about 12.2 GiB. A routine backup is about 2.3 GiB and excludes the RAG database and MinerU cache.
- Imports validate and stage the package before an offline restart applies it. Pre-import data is retained for rollback and can be removed from Settings after verification.
- **Breaking change:** WebDAV backup has been removed; this version cannot read old remote backups. Restore with PaperQuay 0.4.x before upgrading, then export a `.pqbackup` archive. Remote files are not deleted automatically.

## Downloads

- Windows x64: `.exe`
- Linux x64: `.AppImage`, `.deb`, `.tar.gz`
- macOS x64: `.dmg`

**Starting with v{{VERSION}}, macOS arm64 installers are not built or published.** Historical release assets remain available.

## Verification

- `npm run build` and all 936 automated tests pass.
- Windows x64 Electron packaging and MCP bundle generation pass. Isolated-userData desktop export and encrypted manifest preview pass.
- Full restart-based UI import/rollback and production-scale 12.2 GiB power-loss testing were not performed in this release preparation; automated temporary-SQLite/PDF state-machine tests cover the corresponding core behavior.

---

# PaperQuay v{{VERSION}}

## 加密备份与数据迁移

- 支持导出和导入密码保护的 `.pqbackup` 单文件，使用 AES-256-GCM 与密码派生密钥加密；密码遗忘后无法找回。
- 完整迁移预设包含应用配置与 API Key、文献库/笔记/RAG 数据库、PDF、Agent 记忆与会话历史、综述草稿、知识图谱关系、阅读器状态、批注、笔记 vault 和 MinerU 派生缓存。
- 按当前样本估算，完整包约 12.2 GiB；日常备份约 2.3 GiB，不含 RAG 数据库和 MinerU 缓存。
- 导入会先校验并暂存，随后通过离线重启应用；导入前数据保留为回滚点，确认无误后可在设置中删除。
- **破坏性变更：**新版移除 WebDAV，不能读取旧远端备份。升级前需使用 PaperQuay 0.4.x 恢复旧备份，再导出 `.pqbackup`。新版不会自动删除远端文件。

## 下载平台

- Windows x64：`.exe`
- Linux x64：`.AppImage`、`.deb`、`.tar.gz`
- macOS x64：`.dmg`

**自 v{{VERSION}} 起不再构建或发布 macOS arm64 安装包。**历史版本资产保留。

## 验证

- `npm run build` 与全部 936 项自动化测试通过。
- Windows x64 Electron 打包和 MCP bundle 生成通过；隔离 userData 下的桌面导出与加密清单预览通过。
- 本次未进行基于重启的完整桌面导入/回滚及 12.2 GiB 生产规模断电测试；对应核心状态机由临时 SQLite/PDF 自动化测试覆盖。
