# PaperQuay v{{VERSION}}

The MCP write guard no longer mistakes its own service process for the desktop app.

- The recommended way to run the MCP service is `PaperQuay.exe` with `ELECTRON_RUN_AS_NODE=1`. On Windows the service process image name is also `PaperQuay.exe`, so once the desktop app closed and its run marker was removed, the write guard fell back to `tasklist` image-name matching and matched the MCP process itself — every write tool was refused even though the app was not running.
- On Windows the guard now parses PIDs from `tasklist` CSV output, excludes its own PID, and uses the command line to tell remaining processes apart: `paperquay-mcp` entries (other MCP clients) are not treated as the desktop app, while processes whose command line cannot be read stay conservatively blocked.
- On Linux/macOS the `pgrep` result also excludes the service's own PID, and the MCP entry rewrites `process.title` so `pgrep -x PaperQuay` does not match it at all.
- The refusal semantics while the desktop app is actually running, and the conservative refusal when detection fails, are unchanged.

Validation: frontend build passed; all 854 tests passed, including 8 new injected-exec tests for the guard's process filtering. Installers are built by the `app-v{{VERSION}}` release workflow.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

MCP 写护栏不再把自己的服务进程误判为桌面应用。

- 官方推荐用 `PaperQuay.exe` 加 `ELECTRON_RUN_AS_NODE=1` 启动 MCP 服务。该模式下进程映像名同样是 `PaperQuay.exe`：桌面端关闭、运行标记被移除后，护栏回退到 `tasklist` 按映像名匹配时会命中 MCP 进程自身，导致桌面端并未运行时全部写工具仍恒被拒绝。
- Windows 下护栏现在从 `tasklist` CSV 输出解析 PID、排除自身，并对剩余同名进程按命令行区分：入口含 `paperquay-mcp` 的进程（其他 MCP 客户端）不视为桌面端；命令行读不到的进程保持保守拒绝。
- Linux/macOS 的 `pgrep` 结果同样排除自身 PID，且 MCP 入口启动时改写 `process.title`，使 `pgrep -x PaperQuay` 不再匹配服务进程。
- 桌面端实际运行时的拒绝语义、检测失败时的保守拒绝方向均不变。

验证：前端构建通过；全部 854 项测试通过，其中 8 项为新增的护栏进程过滤注入式测试。安装包由 `app-v{{VERSION}}` Release 工作流构建。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
