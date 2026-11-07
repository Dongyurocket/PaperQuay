# 2026-11-06 - 加密全量备份包与 WebDAV 退役

## 现象

旧 WebDAV 备份仅合并三个 SQLite 与可选文件，未纳入 API 密钥、Agent 记忆、知识图谱关系、阅读器 localStorage 和笔记 vault；服务端以明文持有数据库，恢复不能保证跨设备得到一致状态。

## 根因

备份不是完整应用状态的单一容器，恢复路径依赖原机器绝对路径，浏览器状态另存于 Chromium LevelDB。WebDAV 凭据与上传数据均未在应用端加密；备份表还耦合到文库全量保存 SQL 清单。

## 修改

- 新增 `.pqbackup` AES-256-GCM 帧加密容器与 scrypt 密钥派生，采用流式、背压、每帧认证、SHA-256 和整包自检；固定 `kdfId=1` 为 scrypt `N=131072,r=8,p=1,dkLen=32`。密码无法恢复。
- 导出三库快照、配置密钥、附件、派生缓存、Agent 记忆、知识图谱关系、vault 和有界 localStorage 状态；以 staging、磁盘预检、原子发布及进度/取消保障大包处理。
- 导入校验后暂存到 data/assets 双根，通过 pending checksum 状态机重启离线换入，重绑附件和渲染器状态，并保留 `.pre-import-*` 回滚点；提供用户回滚、删除旧数据和恢复期 MCP 写保护。
- 移除 WebDAV IPC、服务、客户端、设置面板和旧类型；桌面专用启动迁移删除遗留 `webdav_settings` 与 `backupEnabled`。共享 MCP bundle 重建，不含 WebDAV 源码。
- 更新 README、英文 README、用户手册、开发手册、Release Notes 与 AGENTS 项目地图，说明旧 WebDAV 备份必须先在 0.4.x 恢复、远端文件需用户自行清理。

## 验证

- `npm run build`：通过（TypeScript 与 Vite production bundle）。
- `npm test`：936/936 通过。
- 隔离专项：备份容器、密码/帧加密、导入状态机、跨平台 root 重绑、旧库迁移及 MCP restore guard 均通过；最近一次合并后的备份隔离集 35/35 通过。
- `npm run mcp:bundle`：通过；`packaging/mcp/server.cjs` 中 WebDAV 扫描无匹配。
- `node electron/build.cjs --dir --config.directories.output=release/local-encrypted-backup-final2-20261106`：通过，afterPack 校验 Windows `sqlite-vec` 原生资源。
- 最终隔离 userData 桌面复验：备份设置 UI 可打开，估算显示 630.1 KiB/5 项；加密导出 UI 完成 5/5、100%，生成 346,649 字节 `.pqbackup`。SHA-256：`32DFDD94A421AB95978AEA835225D836994AAEB841012A1831950D60779A6AF5`；Node 容器 `inspect + verify` 均成功（5 entries）。桌面 UI 使用同一文件和读取密码成功解密并显示版本、计数、路径选择项；因隔离空库未生成知识图谱关系文件，预览显示 1 条 `FILE_MISSING_AT_EXPORT` warning，符合测试数据现状。
- 未在本轮执行 UI 确认后的完整 `backup_import_stage`、自动重启后的 renderer 回灌/库切换，以及 UI 手工 rollback/delete；这些路径由临时 SQLite/文件夹状态机集成测试覆盖，但尚无桌面级截图/哈希证据。2026-11-07 的真实导入已覆盖前者，UI 手工 rollback/delete 仍未覆盖。
- 未执行低磁盘、断电强杀恢复演练或真实跨设备文件系统迁移；小型隔离测试不替代这些压力场景。
- 2026-11-07 后续验证：0.4.20 导出的完整包导入同机另一库目录，恢复 225 个附件、0 未找回、无警告，RAG 数据库 8.6 GB 与 MinerU 缓存随包恢复；完整导入与自动重启后的回灌/库切换由这次实测覆盖。低磁盘、断电强杀恢复演练和跨机器迁移仍未覆盖。
