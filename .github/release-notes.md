# PaperQuay v{{VERSION}}

The installed MCP service now includes `sqlite-vec`, so the packaged entry can start without a manual `node_modules` copy.

- 0.4.10 shipped `resources/paperquay-mcp/server.cjs` and the wasm file, but electron-builder dropped the sibling `node_modules` directory. The official entry exited before the MCP handshake with `Cannot find module 'sqlite-vec'`.
- The installer now copies `sqlite-vec` and the current platform extension beside `server.cjs`. Packaging fails if `vec0.dll`, `vec0.dylib`, or `vec0.so` is missing for the target platform.
- Reinstalling or upgrading no longer removes a manually added copy, because the directory is part of the installer.

Validation: the packaging filter regression test passed. Installers are built by the `app-v{{VERSION}}` release workflow.

## Downloads

Choose the matching system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

安装版 MCP 现在自带 `sqlite-vec`，官方入口不再需要手工补 `node_modules`。

- 0.4.10 的 `resources/paperquay-mcp/` 只有 `server.cjs` 和 wasm。electron-builder 丢掉了旁边的 `node_modules`，官方入口在握手前退出，报 `Cannot find module 'sqlite-vec'`。
- 安装包现在会把 `sqlite-vec` 和当前平台扩展放到 `server.cjs` 旁边。目标平台缺少 `vec0.dll`、`vec0.dylib` 或 `vec0.so` 时，打包直接失败。
- 重装或覆盖升级不会再清掉一份需要手工补回的目录，因为该目录已包含在安装包中。

验证：打包过滤回归测试通过。安装包由 `app-v{{VERSION}}` Release 工作流构建。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
