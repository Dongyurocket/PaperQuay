# 概览强制刷新保留上一版

日期：2026-11-12（Asia/Shanghai）

## 实现

- 概览按钮已有内容时把操作明确作为强制刷新；强制刷新绕过 source-key 缓存命中。自动生成仍可读取匹配缓存。
- 缺少 MinerU 内容、模型配置不完整、生成失败时保留当前概览正文。
- 刷新期间继续渲染旧概览，同时显示刷新状态；新概览只有生成成功且缓存写入成功后才替换旧内容。
- 缓存写入失败时保留旧正文，并给出“新概览未保存、可重试”的错误提示。
- 阅读历史恢复不再等待本地 PDF 对象就绪；独立只读缓存恢复可在没有模型配置时运行，读取当前或兼容旧 key 并保留实际匹配 key。兼容旧 key 的读取不再静默复制到当前 key；概览显示来源版本无法核实时会明确标注。
- 文献详情编辑表单改为等待写入结果，只在写库成功后退出编辑；写库失败时继续保留草稿。写库成功但列表刷新失败会明确报告“已写入”，不把它误报为未保存，避免用户无意重复提交。
- 编辑时记录 `updatedAt` 基线，主进程以当前文献版本执行 compare-and-set；发现版本变化时拒绝覆盖并返回最新标题/版本。界面保留草稿，展示最新标题，并要求用户明确选择是否基于最新版本重试。文献内容、分类、附件等更新统一单调推进 `updatedAt`，避免同一毫秒更新产生同版本号。
- 并发保存细化为字段级合并：编辑表单一并发送打开时的字段值；主进程只比较并写入用户实际修改的字段，无关字段的并发更新自动保留。同字段已被改成另一值时拒绝保存，返回最新文献与冲突字段；用户确认后，以最新版本为基线重试，并保留其余草稿。旧文献缺省 `itemType` 按既有默认值 `journalArticle` 比较。

改动位于 `src/features/reader/DocumentReaderTab.tsx`、`src/features/reader/assistantSidebarPrimitives.tsx`、`src/features/literature/components/LiteraturePaperDetails.tsx` 和 `src/features/literature/LiteratureLibraryView.tsx`。未改写生成模型调用或自动生成策略。

## 验证

- `npm run build`：通过，TypeScript 检查与 Vite 生产构建完成（2616 modules transformed）。
- `node --test tests/documentReaderCache.test.ts tests/documentReaderSummarySource.test.ts`：15 项通过。该组覆盖缓存 envelope、source key 与旧 key 兼容，不直接覆盖 React 刷新组件的异步持久化交互。
- 完整 `npm test`：982 项通过，0 项失败。
- 文献保存/详情相关专项 `node --test tests/libraryCommands.test.mjs tests/literatureLibraryUtils.test.ts`：14 项通过。
- 新增并通过 `library_update_paper rejects a stale editor baseline without overwriting the newer metadata`，验证旧版本保存被拒绝且新值保持；`node --test tests/libraryCommands.test.mjs`：3 项通过。
- compare-and-set 增量后的完整 `npm test`：983 项通过，0 项失败；生产构建通过。
- 本次恢复路径增量后 `npm run build` 通过，缓存/source-key 专项 15 项通过。
- 字段级并发合并后：`npm run build` 通过；完整 `npm test` **984 项通过、0 项失败**；`tests/libraryCommands.test.mjs` 新增覆盖无关字段合并、同字段冲突及旧数据默认类型。
- 联合 KG-P0 表示边界变更后的最近完整套件为 **985 项通过、0 项失败**；生产构建通过。
- 完整测试期间 Node 测试清理器对部分临时目录输出 `EPERM` 并跳过删除；测试进程最终以退出码 0 完成。目录位于本轮隔离 TEMP，保留待确认，不据此声称清理成功。
- 本轮未启动 Windows 桌面，因此“刷新中旧文可见”、配置缺失及写盘失败的真实界面交互仍待桌面验收。没有执行外部模型请求。
- 编辑表单的写库失败保留草稿与“写入成功但列表刷新失败”分支已实现并通过生产构建；当前项目没有相应组件级测试，本轮专项测试未直接模拟这两个 React 状态转换，仍待真实交互验收。
- 独立无模型恢复和异步取消已进入组件生命周期，但当前没有 reader 组件级测试来直接证明无 PDF/无凭证恢复及文献切换迟到响应行为，桌面交互仍待验收。
