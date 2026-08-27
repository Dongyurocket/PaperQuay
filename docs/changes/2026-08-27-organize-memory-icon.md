# 2026-08-27 - 区分整理记忆与思考强度按钮图标

## 现象

Agent 工作区输入框工具栏中，"整理 Agent 记忆"按钮与"思考强度"选择器使用了完全相同的 `Brain`（大脑）图标，并排显示时无法区分功能。

## 根因

`src/features/agent/AgentWorkspaceView.tsx` 中两处按钮都从 lucide-react 引入了同一个 `Brain` 图标：

- 思考强度选择器（composer 内的 ReasoningEffortPicker）
- "整理 Agent 记忆"按钮（`onOrganizeMemory`）

## 修改

- `src/features/agent/AgentWorkspaceView.tsx`：
  - "整理 Agent 记忆"按钮图标由 `Brain` 改为 `BrainCog`（大脑 + 齿轮，语义为"管理/整理记忆"）。
  - 思考强度选择器保留 `Brain` 图标不变。

## 验证

- `npm run build` 通过（TypeScript 构建检查 + Vite 构建成功）。
