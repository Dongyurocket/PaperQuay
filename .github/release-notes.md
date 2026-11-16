# PaperQuay v{{VERSION}}

## Fixes

- A fully translated paper no longer opens with a half-filled translation bar ("Loaded N cached translations"). Restoring from the cache now records the total, so the card shows N/N right away.
- The "Set translated PDF language" dialog was transparent because it used an undefined theme variable. It now uses the shared dialog, is opaque in light and dark themes, and supports `Esc` and focus handling. The batch dialog's table header is fixed too. A new test checks that every `--pq-*` theme variable used in the UI is defined.

## Redesigned paper details

- The decorative header is gone. The title row has a star and a "⋯" menu: show in folder, copy DOI, copy citation (GB/T 7714 / APA), copy BibTeX, re-identify by DOI, add to or remove from the knowledge base, and delete.
- The knowledge-base, document-processing and progress cards are merged into one clickable status bar; translated-PDF actions live in its menu. Sections can be collapsed, and their state is kept after restart.
- Editing groups fields by item type. Authors can be added, removed, reordered or pasted as one string. Keywords and tags use chip inputs with tag suggestions, and categories support multiple selection.
- DOI, year, ISSN, URL, ORCID and citation key are validated before saving. "Re-identify by DOI" shows a field-by-field diff and applies only the fields you tick. Title, year and DOI can be edited inline.
- `Ctrl+S` saves and `Esc` cancels. Switching papers with unsaved changes asks whether to save, discard or stay.

## New metadata fields

- Papers gain "Language" (BCP 47) and "Citation key"; authors gain affiliation and ORCID (checksum-validated, shown as an orcid.org link). Existing libraries get the new columns automatically on start; existing data is unchanged.
- BibTeX export uses your citation key when set and exports the language. CrossRef and Zotero imports fill language, affiliation, ORCID and Citation Key without overwriting values you entered.
- MCP `update_paper` accepts `language`, `citationKey` and `authorDetails` (with affiliation and ORCID); `authorDetails` takes precedence over `authors`.

## Verification

- `npm run build` passed; `npm test` passed all 1048 tests, including 30 new tests for translation progress, theme variables, field migration and round trips, allow-list parity, BibTeX citation keys, metadata validation, backup restore, edit drafts and diff previews.
- Installed-app acceptance is pending installation of this release: details panel and dialogs in both themes, translation progress, author metadata editing, unsaved-change switching, re-identify diff preview, and persistence after restart.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

---

## 修复

- 已完整翻译的文献刚打开时，翻译卡不再停在一半（「已加载缓存全文翻译 N 条」）。从缓存恢复时同时记录总数，直接显示 N/N。
- 「设置译版语言」弹窗因引用了未定义的主题变量而透明。现改用共享弹窗，深浅主题下都不透明，支持 `Esc` 和焦点管理；批量设置弹窗的表头一并修正。新增测试检查界面用到的 `--pq-*` 主题变量都已定义。

## 文献详情面板重做

- 去掉装饰标题栏，标题旁放收藏和「⋯」菜单：在文件夹中显示、复制 DOI、复制引用（GB/T 7714／APA）、复制 BibTeX、按 DOI 重新识别、加入或移出知识库、删除。
- 知识库、文档处理和进度三张卡合并为一条可点击的状态条，译版 PDF 操作并入其菜单。各分区可折叠，折叠状态重启后保留。
- 编辑时按文献类型分组显示字段。作者可逐行增删、排序或粘贴整串自动拆分；关键词和标签改为 chip 输入并可补全标签，分类支持多选。
- 保存前校验 DOI、年份、ISSN、URL、ORCID 和引用键。「按 DOI 重新识别」先显示逐字段差异，只应用勾选的字段。标题、年份和 DOI 支持行内编辑。
- `Ctrl+S` 保存、`Esc` 取消；切换文献时若有未保存的修改，可选择保存、放弃或取消切换。

## 新增元数据字段

- 论文新增「论文语言」（BCP 47）和「引用键」；作者新增单位和 ORCID（含校验位校验，显示为 orcid.org 链接）。旧文库启动时自动补列，原有数据不变。
- BibTeX 导出优先使用填写的引用键并导出论文语言。CrossRef 和 Zotero 导入会补充论文语言、作者单位、ORCID 与 Citation Key，不覆盖手填内容。
- MCP `update_paper` 支持 `language`、`citationKey` 和 `authorDetails`（含单位和 ORCID），`authorDetails` 优先于 `authors`。

## 验证

- `npm run build` 通过；`npm test` 全部 1048 项通过，含翻译进度、主题变量、新字段迁移与往返、白名单一致、BibTeX 引用键、元数据校验、备份恢复、编辑草稿与差异预览等 30 项新测试。
- 安装版验收待安装此版本后完成：深浅主题下的详情面板与弹窗、翻译进度、作者元数据编辑、未保存切换、重新识别差异预览、保存后重启持久化。

## Windows 发布范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内更新。
