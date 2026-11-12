# Windows 桌面验收启动复核

- 日期：2026-11-12
- 关联：工作区 P0-T/P0-F；联合执行台账。
- 目的：复核当前源码 Electron 启动链，不把 renderer 空页误记为应用运行时故障。

## 本轮观察

- `node_modules/.bin/electron.cmd --version` 在直接启动时返回 Windows 状态码 `-2147483645`。
- 加 `--enable-logging=stderr --no-sandbox --disable-gpu` 后 Electron 能创建 PaperQuay 窗口。此前的 `ERR_CONNECTION_RESET` 同时伴随 Vite 递归监听仓库内隔离 profile 的 Chromium Cookie 数据库；Vite 日志明确报 Windows `EBUSY`。因此该次 renderer 错误是测试启动配置影响，不能归因 Electron 本体。
- 将 `PAPERQUAY_DEV_DATA_DIR` 移至仓库之外后，Electron 创建了标题为 Error 的窗口；本轮未获得可交互产品 renderer。需在同一运行期确认 Vite 存活，并读取 Error 窗口或 Electron renderer 日志中的实际错误。

## 验收边界

本轮未形成产品截图、computed-style 读数、主题即时切换、hover/active/focus、缩放、嵌入/浮动窗口、会话操作或 Windows Explorer 选中文件证据。P0-T 和 P0-F 保持“实现完成/验收待补”或“进行中”。没有操作用户当前 Explorer/Zotero 窗口，也未触及个人文库。

## 下一步

以仓库外隔离 profile 和稳定存活的 Vite 服务启动源码 Electron，取得 Error 窗口及主/渲染进程日志；解决启动阻塞后先完成 P0-T 截图与计算颜色验证，再完成 P0-F 受控附件定位和真实 Explorer 验收。详细工作包状态见[联合执行台账](../implementation/joint-execution-ledger.md)。
