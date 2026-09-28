# 2026-09-28 - Agent 模型菜单被裁切，整理记忆与思考强度难以区分

## 现象

Agent 开始回答后，输入框贴在窗口底部。此时打开「选择 Agent 模型」，菜单仍向下展开，只露出标题「选择 Agent 模型」，模型列表被窗口下沿裁掉，看起来像下拉框没有出来。

同一行里，「整理 Agent 记忆」和「思考强度」都是 40×40 的大脑类图标按钮，并排时分不清哪个是操作、哪个是档位。

## 根因

- 新会话时输入框在画面中部，模型菜单向下展开还有空间。一旦开始回答，布局改为底部输入框。`ModelPresetPicker` 固定用 `top: button.bottom + 6` 向下定位，并把 `maxHeight` 至少撑到 180px，底部空间不足时菜单主体落到视口外。菜单虽然 portal 到 `document.body`，不受父级 `overflow` 裁切，但会被窗口本身裁掉。
- 2026-08-27 只把整理记忆从图标 `Brain` 换成 `BrainCog`。两个控件仍是同尺寸、同轮廓的方形图标按钮，小尺寸下仍然像。

## 修改

- `src/utils/anchoredMenu.ts`：按按钮上下剩余空间决定菜单向上或向下展开，高度不超过该侧可用空间。
- `src/components/ModelPresetPicker.tsx`：Agent 与问答模型选择器共用这套定位。底部空间不足时改为向上展开。
- `src/features/agent/AgentWorkspaceView.tsx`：
  - 「整理 Agent 记忆」改为档案盒图标加文字「整理记忆」，作为操作按钮。
  - 「思考强度」改为仪表图标加当前档位（如「思考 自动」）的选择器，不再使用大脑图标。
- `tests/anchoredMenu.test.ts`：覆盖贴底向上展开、空间充足时向下展开、不把菜单撑出可用高度。

## 验证

- `npm run check` 通过：`tsc` 与 Vite 构建成功，`node --test "tests/*.test.ts"` 532 项通过、0 失败。
