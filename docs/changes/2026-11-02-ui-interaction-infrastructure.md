# 2026-11-02 - UI 交互基础设施（反馈层、浮层原语、命令面板、焦点可见）

阶段 2 的落地记录。阶段 1 的缺陷修复见 `2026-11-02-library-card-container-query.md` 与 `2026-11-02-ui-detail-fixes.md`。

## 现象

1. **没有任何全局反馈**：成功/失败/进行中提示散落在各 feature 的内联 `error` / `statusMessage` 里，切走标签页就看不到；全仓库 `aria-live` 为 0 处，读屏软件无法播报任何状态变化。
2. **浮层各自实现**：11 个文件重复写 `fixed inset-0` 遮罩，Esc 关闭、焦点陷阱、背景滚动锁与 aria 语义各处不一致；Tab 键能把焦点漏到遮罩背后的界面。
3. **原生确认框混用**：6 处 `window.confirm`，不受主题控制、样式与产品不一致。
4. **无快捷键、无命令入口**：`grep -i shortcut` 全仓为空，桌面应用的键盘通道完全缺失。
5. **破坏性操作无确认**：Agent 的「清空历史记录」直接删除全部会话且不可撤销，「删除单个会话」同样无确认。
6. **键盘焦点不可见**：`focus-visible` 仅 3 个文件出现，其余控件 Tab 过去没有任何视觉反馈。
7. **Agent 会话列表难辨识**：标题单行截断，多条会话共享长前缀时无法区分；用量直接暴露英文单位 `tok`。

## 修改

新增 `src/ui/` 目录，五个模块：

| 文件 | 职责 |
| --- | --- |
| `toast.tsx` | 模块级单例 store + `toast()/toast.success/error/info/progress` + 挂载在 App 的 `<Toaster/>`；可视 toast 与 `role="status" aria-live="polite"` 播报区分离 |
| `taskCenter.tsx` | 全局长任务条，订阅既有 `documentParseTasks` 注册表，右下角常驻显示运行中任务（含进度条）与 60 秒内的失败，可折叠 |
| `dialog.tsx` | `Dialog`（Portal + 焦点陷阱 + Esc + 背景滚动锁 + 尺寸档 + `aria-modal`）与 `ConfirmDialog`（危险/普通两种版式） |
| `confirmHost.tsx` | Promise 式 `confirmAction()` 单例宿主，替换 6 处 `window.confirm`；同时只允许一个确认框，后到者把前一个按取消结束 |
| `commands.ts` / `commandPalette.tsx` | 动作注册表（`registerCommands` 幂等 + `runCommand`）、快捷键解析/渲染（`mod` 自动映射 Ctrl/⌘）、`useGlobalShortcuts` 全局监听、`Cmd/Ctrl+K` 命令面板（搜索、上下选择、Enter 执行） |

接入与迁移：

- `src/app/App.tsx`：挂载 `<Toaster/>`、`<TaskCenter/>`、`<ConfirmHost/>`、`<CommandPalette/>`；注册 9 条基础命令（文库/Agent/笔记/综述/图谱切换、关闭当前标签 `mod+w`、打开设置 `mod+,`、切换主题、打开 PDF）。
- `documentParseTasks.ts`：新增 `listDocumentParseTasks()` 供任务中心枚举。
- `LibraryConfirmDialog`：改为共享 `ConfirmDialog` 的薄封装，调用点零改动；其余 5 处 `window.confirm`（Agent 恢复提示 ×2、翻译版 PDF 页数不一致 ×2、清空 L3 记忆、删除笔记分类）全部改为 `await confirmAction({...})`。
- **新增确认**：Agent「清空历史记录」与「删除单个会话」此前无任何确认，属误点即丢数据，现补 `confirmAction` 并在清空后 `toast.success`。
- `src/app/index.css`：全局 `:focus-visible` 焦点环（accent 色、2px、offset 2px）；输入类控件与 `[role="dialog"]` 不叠 outline。
- Agent 会话列表：新增「搜索历史对话」输入框；按「今天/昨天/最近 7 天/更早」分组；标题改两行 `line-clamp-2`；用量由 `585k tok` 改为 `585k 用量`。
- 文库「刷新」：成功后 `toast.success('文献库已刷新')`，失败 `toast.error`。
- 新增 `tests/uiCommands.test.ts`（4 项）：快捷键解析与渲染、注册表覆盖语义、注销幂等、未知命令不抛错。

## 验证

- `npm run build` 通过；`npm test` 869 项全绿（原 865 + 新增 4）。
- **实机验证（Computer Use，打包为 `win-unpacked` 后启动真实应用）**：
  - **确认框**：点「清空历史记录」弹出居中对话框，警示图标、标题、说明、`取消`/`清空`（红色危险按钮），背景压暗；点「取消」后历史记录未被删除。
  - **toast**：点文库「刷新」，右下角出现绿色「文献库已刷新」，带对勾图标与关闭按钮，3 秒后自动消失。
  - **Agent 列表**：搜索框、日期分组标题「更早」、两行标题、`585k 用量` 均正常显示。
  - **命令面板**（前台键盘输入，用户授权后执行）：`Ctrl+K` 弹出面板，含搜索框、`Esc` 提示、三组命令（标签/导航/应用）共 9 条，快捷键提示渲染为 `Ctrl+W` / `Ctrl+,`，首项高亮；连按 `↓` 两次高亮从第 1 项移到第 3 项；`Enter` 执行「切换到笔记」——应用确实切换到笔记工作区且面板关闭；重新 `Ctrl+K` 打开后按 `Esc`，面板区域中心像素由 `(250,250,249)`（面板底色）变为 `(144,148,145)`（工作区），确认关闭。
  - **焦点环**：连按 `Tab` 依次在标题栏主题按钮、标签页关闭按钮、左栏导航图标上出现青色圆角描边（左栏区域像素扫描到 59 个 accent 色像素），说明全局 `:focus-visible` 对不同控件类型均生效。
- **未实机验证**：设置弹窗等内容深嵌套的模态未用 Tab 走查完整焦点陷阱；`Dialog` 的焦点陷阱与滚动锁仅做了代码实现与静态检查（本轮验证的确认框已实际打开/关闭，但未逐次 Tab 探测边界循环）。

## 已知遗留

- 设置弹窗（`ReaderPreferencesWindow`）仍是自有实现，未切换到 `Dialog` 原语：它包含侧栏导航与多分区滚动，迁移需要单独一轮回归，留待阶段 3。
- 仍在用 `fixed inset-0` 的自建浮层（Agent 计划卡、笔记右键菜单、块重识别弹窗等）未逐个迁移；`Dialog` 原语已就位，可按「改动时顺带迁移」推进，避免一次性大改带来上游合并冲突。
- `ContextMenu`（`src/components/ContextMenu.tsx`）与 `NotesContextMenu` 仍是两套实现，未合并。
