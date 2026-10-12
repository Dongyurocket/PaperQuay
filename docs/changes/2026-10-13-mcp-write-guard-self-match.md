# 2026-10-13 - MCP 写护栏把自身进程误判为桌面端

## 现象

以官方推荐方式（`PaperQuay.exe` + `ELECTRON_RUN_AS_NODE=1`）启动 MCP 服务后，只要 PaperQuay 桌面端已关闭，全部 MCP 写工具（`import_pdfs`、分类管理、`update_paper`、笔记写入等）恒被拒绝，报「检测到 PaperQuay 桌面应用正在运行」。0.4.11 实测稳定复现；用系统 Node 启动同一入口则不受影响。

## 根因

- `ELECTRON_RUN_AS_NODE=1` 只改变 Electron 二进制的运行模式，进程映像名仍为 `PaperQuay.exe`。
- 护栏判定先查运行标记（`desktopRunMarkerState`）：桌面端正常退出时 `before-quit` 会删除标记，状态为 missing → false，回退到 `detectDesktopAppRunning()`。也就是说 **tasklist 回退路径恰好只在桌面端未运行时执行**。
- 回退实现 `tasklist /FI "IMAGENAME eq PaperQuay.exe"` 只做映像名正则匹配，不解析 PID：此时系统里唯一的 `PaperQuay.exe` 就是 MCP 进程自己，必然误报。
- Linux/macOS 的 `pgrep -x PaperQuay` 同样不区分桌面端与 MCP 服务进程（comm 名相同），且未排除自身 PID。
- 仅排除 `process.pid` 不充分：多个 MCP 客户端并行时，其他 MCP 进程的同名映像仍会被误判为桌面端。

## 修改

- `electron/mcp/knowledgeMcpService.cjs`：`detectDesktopAppRunning(deps)` 支持测试注入 `execFileSync`/`selfPid`/`platform`。
  - Windows：`tasklist` 改用 `/FO CSV` 输出并解析 PID，排除自身；排除后无同名进程直接返回 false（不启动 PowerShell）。仍有同名进程时用 `Get-CimInstance Win32_Process` 按命令行过滤——入口含 `paperquay-mcp` 的进程不视为桌面端；命令行读不到的进程保持保守拒绝。
  - Linux/macOS：`pgrep` 输出解析 PID 并排除自身；无匹配仍由退出码 1 映射为 false。
  - 桌面端运行中的 marker 主路径、检测失败返回 null 的保守拒绝语义均不变。
- `bin/paperquay-mcp.cjs`：启动时 `process.title = 'paperquay-mcp'`，使 *nix 下 `pgrep -x PaperQuay` 天然不匹配 MCP 服务进程（Windows 映像名不受 `process.title` 影响，由上面的 PID/命令行排除覆盖）。打包产物 `server.cjs` 由 esbuild 从该入口打包，自动包含此改动。
- `tests/mcpWriteGuardDetection.test.ts`：新增 8 项注入式测试。

## 验证

- `npm run build` 通过；`npm test` 全部 854 项通过（846 既有 + 8 新增）。
- 本机真实调用 `detectDesktopAppRunning()`：桌面端未运行（MCP 由系统 Node 启动）时返回 `false`。
- 新增测试覆盖：仅自身进程（且不启动 PowerShell）、自身+真桌面端、自身+其他 MCP 客户端、无同名进程、tasklist 失败返回 null、pgrep 仅自身/含桌面端/无匹配退出码 1。
- 构建时注意：系统 `%TEMP%` 下 esbuild 临时文件被占用会导致 `Access is denied`，把 `TEMP`/`TMP` 指到工作区内目录即可绕过（与本次修改无关）。
