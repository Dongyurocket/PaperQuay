# 2026-10-12 - 安装版 MCP 补上 sqlite-vec

## 现象

0.4.10 安装包的 `resources/paperquay-mcp/` 只有 `server.cjs` 和 `sql-wasm.wasm`。用安装版入口启动 MCP 时，进程在握手前退出，报 `Cannot find module 'sqlite-vec'`。从同版本 `packaging/mcp/node_modules` 手工补进安装目录后，Electron 和系统 Node 都能握手。覆盖升级会清掉这个手工目录。

## 根因

`scripts/bundle-mcp.cjs` 已把 `sqlite-vec` 及其平台包复制到 `packaging/mcp/node_modules`。`sqlite-vec` 是原生扩展加载器，esbuild 不能把它打进 `server.cjs`，运行时要从 `server.cjs` 旁边的 `node_modules` 解析，并再解析同级的 `sqlite-vec-<os>-<arch>/vec0.*`。

electron-builder 26 复制 extraResources 时，源目录下相对路径正好是 `node_modules` 的子目录会被直接丢弃，且发生在 glob 之前。因此第一条 `extraResources` 即使写成包含 `node_modules/**`，也带不走这个目录。0.4.10 发布前只启动了 bundle 目录，没有检查安装包里的 `resources/paperquay-mcp`。

## 修改

- `package.json` 增加第二条 extraResources：`from` 为 `packaging/mcp/node_modules`，`to` 为 `paperquay-mcp/node_modules`。相对路径变成 `sqlite-vec/...`，不再触发那条过滤。
- `electron/afterPack.cjs` 在打包后检查 `server.cjs`、`sql-wasm.wasm`、`sqlite-vec/package.json`，以及当前平台的 `vec0.dll` / `vec0.dylib` / `vec0.so`。缺任一文件则打包失败。
- 回归测试锁定两条 extraResources 的过滤结果和平台包名。

## 验证

- `tests/mcpPackaging.test.ts` 用 electron-builder 的 `FileMatcher` 复现：第一条排除 `node_modules`，第二条接受各平台扩展文件。
- 2026-10-12：前端构建通过，全部 846 项测试通过。Windows x64 `--dir` 打包后，`release/local-0.4.11/win-unpacked/resources/paperquay-mcp/node_modules` 含 `sqlite-vec` 与 `sqlite-vec-windows-x64/vec0.dll`，`afterPack` 打印 `verified MCP sqlite-vec resources: sqlite-vec-windows-x64/vec0.dll`。
- 版本 0.4.11 由 `app-v0.4.11` 触发 Release 工作流构建并发布。
