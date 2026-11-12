# EvidenceSpan generation 定位与 Windows journal 写入韧性

## 变更范围

- 文件位置服务可按 `evidenceId` 查询和重新校验被引用的 Paddle generation 产物，并通过现有 shell reveal 动作打开文件。
- EvidenceSpan 返回其来源版本登记的 `parseGeneration`；定位只检查该 generation 与 sourceVersion 下的 manifest，不回退到当前 generation。
- 已删除或缺失的历史产物返回明确 missing 状态；摘要 quote 校验失败、来源类型不支持或文献归属不匹配时不产生可打开位置。
- 详情位置面板和 renderer service 接受可选 evidence ID，图谱与长文档入口可复用同一接口。
- publication journal 临时文件 rename 在 Windows `EPERM`、`EACCES`、`EBUSY` 时有限重试，范围和退避与项目现有原子写一致。

## 验证

- `node --test tests/literatureFileLocations.test.mjs tests/knowledgeStoreEvidence.test.mjs`：5/5 通过。集成用例创建历史 generation EvidenceSpan，发布新版后验证证据仍只解析旧 manifest；删除旧文件后定位显示 missing，reveal 不调用 shell，也不落到新版文件。
- `node --test tests/paddleOcrLifecycle.test.ts tests/knowledgeStoreEvidence.test.mjs tests/backupPackage.test.ts`：14/14 通过，覆盖 publication journal 恢复、分卷重启复用、证据版本与备份。
- 最近 locator 变更后的 `npm run check`：生产构建通过、全套 1005/1005、退出码 0；保留既有 chunk、动态导入和 Browserslist 提示。测试 fixture 清理器报告多处隔离目录 `EPERM` 并跳过清理，未影响测试退出码。
- Windows journal rename retry 的 lifecycle 专项与完整检查均通过；当前 Windows 环境实际触发锁冲突并观察成功重试的确定性演示仍未单独完成。

## 边界

- 没有连接自动抽取、Claim/Relation 审核 UI 或图谱/章节证据侧栏；本次交付的是可复用的准确位置服务与 dialog 输入契约。
- 真实 Windows Explorer、Electron 桌面窗口和主题/缩放验收仍受当前 Electron runtime 异常退出阻塞。
