# 元数据多候选检索接口

日期：2026-11-12（Asia/Shanghai）

## 实现

新增只读主进程命令 `lookup_literature_metadata_candidates`。DOI 查询返回精确对象；标题查询可保留最多 5 条 OpenAlex 候选和最多 10 条 Crossref 候选，不把不同提供方字段合并成一个对象。结果附带查询依据、每个字段的提供方，以及每个提供方独立的成功、无匹配、失败或禁用状态。现有 `lookup_literature_metadata` 保留原行为，避免影响导入和其他调用端。

渲染端服务与类型已添加。检索命令不调用文库保存，也不修改文献。普通单篇对话框尚未切换到新接口；候选差异逐字段应用、撤销和统一草稿保存仍属于后续 W-P2 实施。

## 验证

- `node --test tests/libraryCommands.test.mjs`：6 项通过，0 项失败。
- `npm run build`：通过（2616 modules transformed）。
- 完整 `npm test`：987 项通过、0 项失败。
- 受控 OpenAlex/Crossref 响应覆盖多候选、部分服务失败、提供方禁用、无匹配和检索零写入。
- 测试清理器对本轮隔离 TEMP 下部分临时目录报告 `EPERM` 并跳过删除；测试进程退出码为 0。
