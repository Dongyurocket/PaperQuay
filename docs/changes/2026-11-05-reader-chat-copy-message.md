# 2026-11-05 - 阅读器聊天复制消息

## 现象

阅读器侧栏与浮动问答没有逐条消息复制入口。笔记剪贴板工具只裁剪并写入文本，既不回退失败路径，也不检查 execCommand 的失败返回。

## 根因

剪贴板实现内嵌在笔记兼容模块中，返回值与失败处理不足；阅读器未提供复制反馈或异步结果隔离。

## 修改

- 共用 `src/utils/clipboard.ts`：默认 trim；preserveWhitespace 保留原值；空白返回 false；按 Electron、浏览器、textarea 回退；全部失败抛错。textarea 无论成功或失败都清理临时节点，分别恢复输入框选区或页面选区与原焦点，不改写原生 Selection 方法。
- 用户复制传入存储中的 message.content；助手复制清理后的 Markdown/HTML 源码。保留公式、代码及原引用编号，不使用引用导航注入后的文本或预览 DOM。流式复制固定点击时的内容快照。
- 助手使用“复制原始内容”，用户使用图标按钮；中英文 title/aria-label、focus-visible、focus-within、至少 11px、统一操作栏容器和窄栏换行。成功/失败反馈期间保持操作栏可见；错误为行内 role=status，不写 qaError。
- 局部复制请求序号及定时器控制：新复制、会话切换或卸载时失效旧反馈；成功反馈约 1.6 秒。系统剪贴板的异步完成顺序仍不保证与点击顺序一致。
- 笔记兼容入口保留原 `Promise<void>` 签名，内部 await 共用工具，4 个笔记模块无需改 import 或菜单回调。

## 与计划的必要差异

计划提出直接 re-export 新共用工具，但它返回 `Promise<boolean>`，笔记菜单的 onSelect 要求 `void | Promise<void>`。实际构建在 NotesSidebar、NotesWorkspace 等模块报告 TS2345，因而采用同名薄包装保留旧签名，仍由共用工具实现全部写入与失败处理。

## 验证

- `npm run build`：通过，输出 `.verification-20261105-reader-chat/build.log`。保留既有动态导入与大分块警告。
- `npm test`：916/916 通过，输出 `.verification-20261105-reader-chat/tests.log`；新增剪贴板与反馈测试 11 项。
- `node .verification-20261105-reader-chat/run-copy.mjs`：12/12 通过，结果 `copy-results.json`、输出 `copy.log`。真实 ChatWorkspacePanel 与 FloatingAssistantPanel 覆盖源码、HTML、流式快照、用户空白、拒绝重试、A/B 竞态、切会话、卸载、笔记默认 trim、保存笔记、中英文、330px 窄栏及 CDP Tab/Enter 键盘激活。无运行异常。
- `node .verification-20261105-reader-chat/run-dom-clipboard.mjs`：3/3 通过，结果 `dom-clipboard-results.json`。真实 Chromium DOM 证明输入框反向选区、页面选区、焦点、清理以及 execCommand 抛错行为。
- 六张最终截图已视觉审阅：浅色成功/失败、深色窄栏焦点/键盘成功、浮窗成功/失败，按钮未重叠，元信息与操作栏可换行，反馈可见。索引见本轮验证目录 README。
- 本次最终 Vite dist 已打包为 `release/reader-chat-20261105-final/win-unpacked`，复制到临时目录进行隔离完整应用启动 smoke；具体路径和数据边界见验证目录 README。

## 验收边界与独立发现

- 复杂故障通过隐藏离屏 Electron 42.2.0、真实产品组件/store 与本地 mock 服务边界执行；未修改个人真实模型配置、文库、笔记 vault 或既有验证目录。
- 系统原生剪贴板写入未直接覆写实测；Electron 桥接分支有单测，整包真实 preload 的入口可用性有启动 smoke。四个笔记调用模块由完整构建验证类型兼容，默认 trim 经真实兼容导出行为验证，未逐个操作四个笔记界面。
- 深色窄栏截图显示已有模型选择器使用白底与浅色字，模型名对比不足；复制按钮与保存按钮不遮挡元信息。该选择器未在本次修改，作为独立 UI 缺陷记录，不将其标记为已修复。
- 本次未提供一键重试、附件正文持久化、网络响应原文复制或每会话错误状态。
