# PaperQuay v{{VERSION}}

Settings number fields accept multi-digit values, Responses sessions report completion and truncation correctly, and the MCP service ships with the installer.

- Context window, max output, and temperature are drafted locally and saved on blur or Enter. Values below the allowed range are clamped only when committed.
- Responses `completed` maps to a normal stop. Output truncated by `max_output_tokens` or `max_tool_calls` maps to `length`. Failed or cancelled responses surface an error instead of an empty answer. Non-streaming tool calls use `call_id`.
- The installer places the knowledge MCP service at `resources/paperquay-mcp/server.cjs`, outside the asar archive. Installed apps launch it with the bundled Electron binary and `ELECTRON_RUN_AS_NODE=1`; a separate Node.js install is not required. The settings page copies Proma, Claude, and Codex config, including `--data-dir`.
- External agents can attach or remove a translated PDF. A page-count mismatch is returned as a warning and does not block the attach. Desktop and MCP share one attachment implementation.

Validation: frontend build and automated tests are recorded in the changelog. This release was not manually regressed on a clean installed desktop before tagging. `ELECTRON_RUN_AS_NODE` can read the application data directory, but it cannot write the Windows temp directory.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

设置页可以连续输入数值，Responses 会话能正确区分完成和截断，MCP 知识库服务随安装包发布。

- 「上下文窗口」「最大输出」和「温度」在失焦或回车后才保存。低于合法范围的值只在提交时夹取，输入过程中不再跳变。
- Responses 的 `completed` 视为正常结束；因 `max_output_tokens` 或 `max_tool_calls` 截断时视为长度截断。失败或取消会显示错误，而不是空回答。非流式工具调用使用 `call_id`。
- 安装包把 MCP 服务放在 asar 之外的 `resources/paperquay-mcp/server.cjs`。安装版用应用自带的 Electron 加 `ELECTRON_RUN_AS_NODE=1` 启动，不需要另装 Node.js。设置页可复制 Proma、Claude 和 Codex 配置，并带上 `--data-dir`。
- 外部 Agent 可以附加或移除翻译版 PDF。页数不一致只返回警告，不拒绝附加。桌面端与 MCP 共用同一套附件实现。

验证：前端构建和自动化测试结果见更新日志。打标签前没有在干净安装版上完成桌面手工回归。`ELECTRON_RUN_AS_NODE` 可以读取应用数据目录，但不能写 Windows 临时目录。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
