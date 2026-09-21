# PaperQuay v{{VERSION}}

## New Features

- **MCP library write & category management tools (6 new, 15 total)**: the MCP knowledge-base server (`bin/paperquay-mcp.cjs`) is no longer read-only. External Agents (Proma, Claude, Codex, Pi, etc.) can now manage the library over stdio:
  - `import_pdfs` — batch-import local PDFs with content-hash deduplication, `copy` / `move` / `keep` modes, per-path metadata (including `titleZh` and `tags`), and find-or-create target categories by name.
  - `list_categories` — read the category tree with per-category paper counts (including descendants).
  - `manage_category` — create / rename / move / delete categories with cycle detection, system-category protection, and cascading unlink of papers on delete.
  - `set_paper_categories` — batch add / remove / replace paper categories with all-or-nothing validation.
  - `update_paper` — whitelisted metadata updates (unknown fields fail explicitly).
  - `delete_papers` — batch delete; `deleteFiles: true` also removes stored PDFs after the database commit.
- **Write safety guard**: the desktop app persists the library from an in-memory snapshot, so any external write made while it runs would be silently overwritten. All write tools now detect the running PaperQuay desktop process and **explicitly refuse**, with an actionable message, until the app is closed. Pass `allowWhileAppRunning: true` to override at your own risk, or set `PAPERQUAY_MCP_WRITE=off` to make the server globally read-only. Zotero sync is covered by the same guard.
- **MCP read enhancements**: `search_papers` accepts `categoryId` (matches descendant categories and system-category semantics); `get_paper_details` returns the paper's category IDs.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

## Notes

- Write-tool semantics are aligned with the desktop app's `libraryCommands` (same dedupe, import modes, cascade rules, and field whitelist). MCP PDF import deliberately does not trigger Crossref metadata fetches.
- The guard detects the packaged app (`PaperQuay.exe` / `PaperQuay`); development-mode (`electron .`) instances are not detectable.
- Best practice for Agents: confirm the desktop app is closed before write operations, and re-read after writing.

---

# PaperQuay v{{VERSION}} 中文说明

## 新增

- **知识库 MCP 文库写入与分类管理工具（新增 6 个，共 15 个）**：MCP 服务不再只读。外部 Agent（Proma、Claude、Codex、Pi 等）可通过 stdio 直接管理文库：
  - `import_pdfs`：批量导入本地 PDF，内容哈希查重，支持 `copy` / `move` / `keep` 三种入库模式，逐文件元数据（含 `titleZh` 与标签），按分类名称自动查找或创建目标分类。
  - `list_categories`：读取分类树及各分类文献数（含后代分类）。
  - `manage_category`：分类创建 / 重命名 / 移动 / 删除，含环检测、系统分类保护，删除时级联解绑文献。
  - `set_paper_categories`：批量 add / remove / replace 分类归属，全量校验、原子写入。
  - `update_paper`：白名单元数据更新，未知字段显式报错。
  - `delete_papers`：批量删除文献，`deleteFiles: true` 时在数据库提交后删除已入库文件。
- **写入安全护栏**：桌面端以内存态整体落盘，应用运行时任何外部写入都会被静默覆盖。所有写工具执行前自动检测桌面应用进程，检测到运行时**显式拒绝**并提示关闭应用；可传 `allowWhileAppRunning: true` 强制覆盖，设 `PAPERQUAY_MCP_WRITE=off` 可将服务切换为全局只读。Zotero 同步纳入同一护栏。
- **MCP 读取增强**：`search_papers` 支持 `categoryId` 过滤（含后代分类与系统分类语义）；`get_paper_details` 返回文献所属分类 ID。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。

## 使用提示

- 写工具语义与桌面端 `libraryCommands` 完全一致（相同的查重、入库模式、级联规则与字段白名单）；MCP 导入 PDF 不会触发 Crossref 网络补全。
- 护栏检测的是打包后的应用进程（`PaperQuay.exe` / `PaperQuay`）；开发模式（`electron .`）实例不在检测范围内。
- Agent 建议的标准作业程序：写入前先确认桌面应用已关闭，写入后重新读取验证。
