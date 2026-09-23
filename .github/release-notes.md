# PaperQuay v{{VERSION}}

## Fixes

- **Fix Empty Paper List in "All Papers" View**: Fixed an issue in the SQL query pushdown filter (`buildLibraryFilter`) where selecting the system category "All Papers" (`systemKey === 'all'`) was mistakenly treated as a hierarchical user category instead of a no-filter view, causing the library list to erroneously display 0 papers. Both system category IDs and alias keys are now fully supported.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **修复选择“所有文献”时文献列表显示为 0 的问题**：修复文库底层 SQL 查询筛选 `buildLibraryFilter` 对系统分类 `system-all`（`systemKey === 'all'`）未独立处理、误入自定义多级分类导致在 `paper_categories` 过滤为空的 bug；同时支持系统分类 ID 与别名兼容匹配，恢复“所有文献”视图及全选操作下的全库文献正确展示。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
