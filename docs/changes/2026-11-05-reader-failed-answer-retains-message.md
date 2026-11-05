# 2026-11-05 - 阅读器问答失败保留问题

## 现象

阅读器在首个有效 token 前失败时，会撤销本次用户问题；首问会话可能整条消失。失败还可能恢复旧选择及附件，覆盖请求期间的编辑。

## 根因

失败分支按发送前快照回滚整个会话。异步请求只用 workspaceId 判定归属，切走同一文档再返回时无法区分两次加载；finally 未检查归属。

## 修改

- 新增 removeFailedQaAssistantPlaceholder，只对当前状态中匹配会话 ID、助手 ID 且内容为空白的占位做不可变删除。保留问题、附件引用、其他消息、标题和创建时间；末条占位删除后按保留消息更新时间。
- 失败不恢复选择、输入框和附件；保留非空流式回答，继续使用原有错误提示。
- 每次文档问答历史激活/清理推进生命周期序号。请求在上下文解析后、流式写入、状态提示、错误和 finally 中同时校验序号与 workspaceId，隔离切走再返回的旧请求。
- 不改变附件持久化裁剪：重开保留附件元数据，运行期附件正文不承诺持久化。

## 验证

- `node --test tests/documentReaderQaSessions.test.ts`：9/9 通过，输出 `.verification-20261105-reader-chat/sessions-tests.log`。
- `npm run build`：通过，输出 `.verification-20261105-reader-chat/build.log`（现有分块体积和动态导入警告）。
- `npm test`：905/905 通过，输出 `.verification-20261105-reader-chat/tests.log`。
- 隐藏隔离 Electron 行为验收：11/11 通过，输出 `.verification-20261105-reader-chat/behaviors.log` 和 `behavior-results.json`。覆盖配置校验、首问/已有会话、空白 token、部分回答、下一稿/附件、会话切换、双会话并发、真实 localStorage 历史重开裁剪、文档切换及切走再返回。
- 最终合并工作区构建通过，全量测试 916/916 通过。失败修复自身定向测试仍为 9/9。
- 验收使用本轮 Electron 42.2.0、当前真实 DocumentReaderTab 与 zustand；仅 PDF 展示、模型网络、文档文本读取和桌面服务边界为隔离夹具。未使用真实模型、个人配置或文库；隐藏窗口无前台键鼠操作。
- 跨文档缺陷按计划 4.3 实际隔离修复：旧请求既不能追加消息，也不能写入当前错误、草稿或清除新请求运行标记。
