# L1a 持久分卷产物与恢复

日期：2026-11-12

## 实现

- `parse_partitions` 新增 `staged_manifest` 幂等迁移，记录分卷 staging 路径、相对文件清单、文件大小、SHA-256、页数和块数；原有 `staged_path` 字段继续承载目录身份。
- Paddle 分卷写入稳定的 source/generation/partition 目录。写完并登记受校验的产物后，才将该卷标记为 complete。
- 再次解析时先校验已完成卷的文件数量、类型、大小、哈希和页数；有效结果从本地恢复并进入合并/发布，不再访问远端。若在 manifest 写入与 complete 状态切换之间中断，恢复时也会核验后补齐状态。
- staging 校验失败时只删除 generation 内登记的分卷目录，并清空该卷旧 manifest 后再重建。分卷解析或最终 current 发布失败会保留 building generation，以允许显式重试；来源版本门仍会拒绝迟到发布。
- 备份导入会把 knowledge DB 中 generation 和 partition 的 staging 绝对路径按备份记录的旧 MinerU cache root 重绑定到本机 cache root。未打包的大型解析产物仍显示缺失，但不会指向源机器目录或误用当前兼容缓存。

## 验证

- `node --check electron/backend/knowledgeStore.cjs`
- `node --check electron/backend/paddleOcrCommands.cjs`
- `node --test tests/paddleOcrLifecycle.test.ts tests/backupKnowledgeStore.test.mjs`：8/8（增量后全量专项以 `npm run check` 为准）
- 仓库隔离 TEMP 下 `npm run check`：生产构建成功，自动化测试 1004/1004，退出码 0。
- 生命周期回归关闭并重开 SQLite，在模拟发布闸门失败后验证有效分卷被本地复用、没有新增 fetch 请求并最终发布为 current；已有 tampered artifact 用例验证损坏 staging 不会发布且旧 current 保持不变。
- `node --test tests/backupPackage.test.ts tests/backupKnowledgeStore.test.mjs`：8/8；使用真实加密备份容器与生产 stage/apply 路径，验证 generation、job ID、分卷 manifest 和 current 在恢复后保留，旧 cache root 路径被绑定到本机管理路径，未包含的产物仍准确显示不存在。
- 使用本地 PDF 和受控 fetch 响应；未调用 Paddle 外部服务。未执行备份包应用恢复往返，未执行 Windows 桌面验收，也未取得大文档真实资源测量。

## 尚未完成

L1a 仍需应用启动后的恢复/继续入口、任务取消与迟到结果边界、generation artifact 引用保护与可回收策略、知识库备份往返验收以及真实解析服务/长文档验证。历史 EvidenceSpan 和 Explorer 定位未在本次增量改变。
