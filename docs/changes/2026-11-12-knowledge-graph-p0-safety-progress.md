# 知识图谱 P0 范围与向量身份安全进展

- 日期：2026-11-12
- 关联：知识图谱计划 P0；联合台账 `docs/implementation/joint-execution-ledger.md`。
- 状态：两个局部安全修复已实现，P0 仍进行中。

## 改动

- 局部图查询只有在请求未声明局部范围时才返回全局图。声明局部范围但缺少焦点、焦点 ID 不存在、深度非法或超出 0—4 时，返回保留快照元信息但节点和边均为空的结果。
- 全局 UI 请求以空焦点和显式深度 0 表示，保持原有全局浏览行为。焦点存在且深度为 0 时只返回焦点节点。
- 文档级近邻边先检查每个 `document_key × dimension` 在 ready 索引记录中是否只有一个 `embedding_model_key`，再要求比较双方的模型身份和维度都一致。模型身份混杂、无法从 ready index 确认的文档不生成 embedding edge。
- 平均向量表仍是兼容投影；本次未添加新数据库列或重建既有向量，也未处理 representation/sourceVersion 划界。该部分继续作为 KG-P0 缺口，不把旧缓存迁移称为已完成。

## 验证

- `node --test tests/knowledgeGraphCommands.test.mjs tests/literatureFileLocations.test.mjs tests/fileCommands.test.ts`：11 项通过。
- `node --test tests/ragStore.test.ts`：20 项通过。
- 最新串行完整 `npm test`：982 项通过、0 失败。较早一次与构建并行运行导致 2 项备份恢复测试临时文件 `EPERM`，串行完整重跑通过。
- 最新 `npm run build`：TypeScript 和 Vite 构建通过，2616 modules transformed；构建保留既有 chunk/dynamic-import 警告。
