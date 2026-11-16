# 文献详情与元数据（第 0 段、P3a、P3）

2026-11-17，分支 `ui/p3-details-metadata`，基于已发布的 0.4.27（`04be902`）。本轮未改版本号、未提交或推送，也未写入真实文库；知识库与 RAG schema、`user_version` 均未改动。

## 第 0 段：0.4.27 实测问题

- 缓存恢复的完整翻译任务现在同时保存完成数与总数；总数不可得时使用完成数作为总数。成功任务显示完整进度，运行中且没有总数的任务保留不确定进度，错误任务保留已完成部分。缓存恢复和手动命中共用一致的完成状态表达。
- 「设置译版语言」改用共享 `Dialog`，保留 BCP 47 校验、清除语言、保存中禁用和错误提示。修复深浅主题表面与正文令牌，并增加扫描 `src` 内全部 `--pq-*` 引用的契约测试。

## 第一段：P3a 元数据数据层

- 在 library 数据库新增可空的 `papers.language`、`papers.citation_key`、`authors.affiliation`、`authors.orcid`。迁移只用 `ensureColumn` 追加列；作者表的创建定义与重复 ID 列表迁移同步保留新增列。知识库与 RAG 库不变。
- 同步 SQLite 与 JSON store 的行映射和读写、TypeScript 类型、桌面与 MCP `update_paper` 白名单、MCP 参数说明及 `paperquay-library-manage` 技能文档。`authorDetails` 优先于兼容保留的 `authors` 名称数组。
- BibTeX 使用用户提供的引用键并导出论文语言；空引用键仍自动生成。CrossRef 和 Zotero 导入补充论文语言、作者单位、ORCID 与 Citation Key，已有手填内容不被覆盖。ORCID 校验含校验位。
- 新增旧库升级、store 往返、白名单一致、BibTeX 优先级、元数据校验及两种备份恢复路径的测试。

## 第二段：P3 详情面板与编辑态

- 详情只读态移除装饰标题栏；标题旁提供收藏和 `⋯` 菜单。状态卡合并为可操作状态条，译版 PDF 的附加、替换、语言设置和移除进入相应菜单。各信息分区可折叠并持久化；作者旁显示 ORCID 链接，单位在悬停时显示。
- 编辑态按文献类型分组并折叠字段；作者支持逐行增删、排序、粘贴拆分，以及单位和 ORCID；关键词、标签采用 chip 编辑，标签补全使用 `library_list_tags`，分类支持多选。论文语言与译版语言分别编辑，引用键显示自动生成的占位值。
- 纯函数校验 DOI、年份、ISSN、URL、ORCID 和引用键；重新识别显示逐字段差异并允许选择应用。标题、年份和 DOI 支持行内编辑。Ctrl/Cmd+S 保存、Esc 取消；切换文献时对未保存草稿提供保存、放弃或取消选项。
- 收尾审查发现父组件更新同 ID 文献对象时详情面板仍留着旧附件；现在同步新对象，并在草稿已修改时保留草稿。收藏操作也不再通过通用保存流程退出编辑态或重置草稿。

## 独立审查与反驳复核

数据迁移/后端审查确认作者表新列已同时进入建表定义和重复 ID 迁移列清单，旧库迁移保留现有作者数据；没有发现知识库/RAG schema 或 `user_version` 变更。界面审查对 Dialog 遮罩、主题对比度、Esc、焦点陷阱、语言校验和状态 chip 接线的疑虑经代码路径复核均不成立。

复核后确认并修复 7 项问题：桌面更新返回的 `LiteraturePaper` 曾混入请求专用的 `authorDetails`；无显式 Markdown 标题的概览曾退回硬编码英文标题；错误状态缺少总数时曾显示满进度且不显示完成数；快速重复保存可能在 React 状态更新前并发提交；关键词/标签 chip 输入未与可见标签建立可访问名称关联；编辑中重新识别可能用识别结果覆盖草稿；未保存切换弹窗的首焦点曾落在「放弃并切换」。现已分别改为仅返回规范化作者、使用本地化回退标题、显示已完成数与未知总数且不显示虚假的进度比例、增加同步保存互斥、关联标签和输入、编辑期间禁用重新识别，以及将「取消切换」放在首位。新增针对返回对象和未知总数错误进度的回归断言。

## 验证

- `npx tsc --noEmit`：通过。
- `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"`：**1048 / 1048 通过**，相对 0.4.27 的 1018 项基线新增 30 项。
- `npm run build`：使用仓库内 `.tmp-build/` 作为 `TEMP` 与 `TMP` 后通过；保留既有 Browserslist、动态导入及包体积提示。
- `git diff --check`：通过。
- 自动验证使用测试夹具、隔离 SQLite 与仓库内临时目录，没有访问或写入用户真实文库。

## 相对方案的补充与限制

- 增加同 ID 文献对象同步与收藏保留草稿，原因是审查确认这两条交互会造成旧数据展示或草稿丢失风险。
- 完整 Electron 桌面视觉与操作验收尚未完成；以下检查需用 `--user-data-dir=<空目录>` 或一次性复制库，不使用真实文库：浅色/深色主题下详情布局与对比度、译版语言 Dialog 的不透明度和键盘焦点、附件增删改后的即时刷新、作者元数据编辑、未保存切换、重新识别差异预览及实际保存/重启持久化。

## 改动文件

| 范围 | 文件 |
| --- | --- |
| 详情、状态与编辑 | `src/features/literature/LiteratureLibraryView.tsx`、`src/features/literature/components/LiteraturePaperDetails.tsx`、`src/features/literature/components/TranslatedPdfLanguageDialog.tsx`、`src/features/literature/components/TranslatedPdfLanguageBatchDialog.tsx`、`src/features/literature/details/` 下的编辑表单、状态条、差异预览、分区状态与草稿纯函数、`src/features/literature/paperTaskProgress.ts`、`src/features/literature/metadataValidation.ts` |
| 元数据存储与导入 | `electron/backend/libraryDatabaseStore.cjs`、`libraryStore.cjs`、`libraryCommands.cjs`、`metadataValidation.cjs`、`paperMetadataFields.cjs`、`zoteroApi.cjs`、`zoteroLocal.cjs`、`electron/mcp/knowledgeMcpService.cjs`、`src/types/library.ts`、`src/types/metadata.ts`、`src/services/library.ts`、`src/utils/bibtex.ts` |
| 主题令牌 | `src/app/index.css` 与引用未定义令牌的 `src` 界面文件 |
| 测试 | `tests/p3aMetadata.test.ts`、`tests/paperDetailsDraft.test.ts`、`tests/paperTaskProgress.test.ts`、`tests/pqCssTokens.test.ts` |
| 文档与 MCP | `docs/USER_MANUAL.zh-CN.md`、`docs/MCP_AGENT_INTEGRATION.md`、`skills/paperquay-library-manage/SKILL.md`、本记录及计划文档 |
