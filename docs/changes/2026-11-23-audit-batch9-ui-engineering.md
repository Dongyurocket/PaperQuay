# 第 9 批：UI 与工程化收尾

日期：2026-11-23。未提交、未 push；未改 SQLite schema / user_version，未写用户数据。

## 本批已完成

- D2-5：MCP `searchNotesKeyword` 在 FTS 成功但零命中时回退 LIKE；新增删除 FTS 行后的 `search_notes({mode:'keyword'})` 回归用例。索引维护仍由应用写入路径负责。
- D7-4（增量）：输入框焦点环使用不透明 accent；移除错误的 3.9:1 描述，更新源码守卫。浅/深色令牌对比度计算用例尚未补齐，保留 partial。
- D7-6：Dialog 焦点陷阱排除 `tabindex=-1` 的选项，避免命令面板非 Tab 停靠项破坏边界判断。
- D7-7：右键菜单将键盘处理放到 document capture 层；支持 Esc、Tab、方向/Home/End，关闭时归还焦点；共享原语覆盖 NotesSidebar、TabBar、PdfViewer 入口。
- D7-11（增量）：组件 kicker 改用 `--pq-text-primary`，不再以白字置于 10% 强调色背景；浅/深主题 4.5:1 对比度计算用例尚未补齐，保留 partial。
- S5：图谱布局 Worker 增加超时终止与主线程回退，后续请求允许重建 Worker；新增超时回退/重建测试。
- D4-9：NotesList 排序/移动选项和 NotesGraphView 空态/体检标签改为双语；标签页空笔记标题移至展示层本地化。
- D4-6（增量）：`papersRefreshing` 已从 hook 贯通到列表/工具栏 props，后台刷新时保留旧列表内容；工具栏尚未渲染该状态，无障碍提示未落地。

## 明确保留

- D4-9 / D7-9 仍 partial：NotesWorkspace、noteHealth、notes service 错误码/本地化等尚未全量清理；本次仅完成上述 UI 子集。
- D4-6 仍 partial：首屏 loading 与用户筛选/搜索的 skip-next 防抖竞态尚未解决。
- D7-13、D3-2、D3-13、D8-4、D8-6、D8-10、D8-11、D8-13 未完成，不宣称关闭。
- D1-13 继续 partial：sandbox / embedded ASAR integrity 仍是 §3 验收风险。
- 列表虚拟化的 aria-setsize/posinset 与键盘漫游未完成；行已有 `memo` 与 `useCallback`，剩余不稳定点是 `renderPaperRow`/对象 prop 身份。S5 仍 partial，最坏边数/768 维基准与 fcose 动态加载未完成。

## 验证

- 基线：第 8 批既有全套 1,279 项（1,273 通过、6 跳过、0 失败）。
- 本批后：`npm run typecheck` 通过；`npm test` 1,281 项（1,275 通过、6 跳过、0 失败）；`npm run build` 通过；`npm run mcp:bundle` 通过。
- 未运行安装版/ASAR 实机验收。构建输出包含 Browserslist 数据过期与既有动态导入警告。

## 独立复核（2026-11-23）

4 个只读 verifier 复核本批声明：

- **CONFIRMED**：D2-5（删除 `notes_fts` 行后 MCP keyword 仍命中，端到端用例真实）；D7-6（FOCUSABLE 排除 `tabindex=-1`）；D7-7（document capture 键盘处理，关闭归还焦点）；S5 Worker 超时终止/回退/重建（行为用例真实）。
- **修正**：D4-6 的“工具栏无障碍提示”原先写错——`refreshing` prop 只贯通到 `LiteratureToolbar`，组件从未读取，也没有 `aria-live`/`role=status`；已改为“仅贯通 props，提示未落地”。首屏竞态与并发 `finally` 竞态仍未解决。
- **测试口径**：D7-6 的选择器变更没有行为/源码用例；D7-7 的守卫是源码正则，不是键盘行为用例。两者并入第 10 批补测。
- **次要观察**：从背景焦点按 ArrowUp 进入菜单末项而非首项（Down/Home 为首项）；`createWorker()` 返回 null 后本会话不再重试；已终止 Worker 的迟到 `onerror` 可能终止新 Worker（下次请求可恢复）。
- **未完成项核对**：D7-13、D3-2、D3-13、D8-4、D8-6、D8-10、D8-11、D8-13 确实未动；D8-4/6/10 是仓库既有的 partial 状态，不是本批新增。虚拟列表无 `aria-setsize`/`aria-posinset`，行键盘仅 Enter/Space；S5 最坏边数与 768 维基准仍缺，`vite.config.ts` 仍把 `cytoscape-fcose` 放进静态 `vendor-graph`。
