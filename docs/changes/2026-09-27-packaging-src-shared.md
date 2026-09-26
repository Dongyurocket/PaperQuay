# 2026-09-27 - 安装版缺少共享 Markdown 解析器导致启动崩溃

## 现象

Windows 安装版（0.3.0）启动即弹出 Electron 主进程未捕获异常对话框，窗口不出现：

```text
Error: Cannot find module '../src/shared/markdownToTiptap.cjs'
Require stack:
- resources\app.asar\electron\backend\noteVault.cjs
- resources\app.asar\electron\backend.cjs
- resources\app.asar\electron\main.cjs
```

## 根因

0.3.0 引入共享 Markdown → Tiptap 解析器 `src/shared/markdownToTiptap.cjs`，由 `electron/backend/noteVault.cjs` 在模块顶层 require，并被 `electron/main.cjs` → `backend.cjs` 的启动链带上主进程。electron-builder 的 `build.files` 白名单只包含 `dist/**/*`、`electron/**/*`、`package.json` 与列出的 `node_modules`，没有包含 `src/**`，因此安装包（`app.asar` 根为 `node_modules`、`dist`、`electron`、`package.json`）里根本没有这个文件。开发模式直接读取仓库文件，所以 `npm run dev` 一切正常，只有打包安装后才会崩。

## 修改

- `package.json`：`build.files` 增加 `"src/shared/**/*"`，其余 require 路径与文件位置保持不变（渲染层、主进程、测试继续共用同一份实现）。

## 验证

- `npm run build` 通过；`npm test` 528 项全部通过（`tests/markdownToTiptap.test.ts`、`tests/noteVault.test.ts` 等含在内）。
- `node electron/build.cjs --dir` 重新打包后检查 `release/win-unpacked/resources/app.asar`：根条目为 `node_modules`、`dist`、`electron`、`package.json`、`src`，`src/shared/markdownToTiptap.cjs`（6849 字节，与仓库文件一致）和 `electron/backend/noteVault.cjs` 都在包内。
