# PaperQuay v{{VERSION}}

## Reader chat

- Failed questions stay in the conversation. If a request fails before producing a useful answer, only its empty assistant placeholder is removed. Questions, message attachments and history remain; a new draft or a different selected conversation is preserved.
- Requests from an earlier document activation cannot overwrite current messages, errors or running flags after switching away and back.
- Copy individual user messages or the assistant's cleaned Markdown / HTML source in both the sidebar and floating chat. Formulas, code blocks and original citation labels are preserved; streaming copy captures the text available at the click.
- Copy success and failure have accessible inline feedback. Clipboard writes fall back from Electron to the browser API and then textarea; focus and recoverable selections are restored. Notes keep their existing trimmed-copy behavior.

## Downloads

- Windows x64: `.exe`
- Linux x64: `.AppImage`, `.deb`, `.tar.gz`
- macOS x64: `.dmg`

**Starting with v{{VERSION}}, macOS arm64 installers are no longer built or published.** This platform policy applies to future releases; existing historical assets remain available.

## Verification

- Local production build and all 916 tests pass.
- Isolated Electron checks pass: 11 failed-request scenarios, 12 copy interactions and 3 real-DOM clipboard fallback checks. Light/dark themes, narrow panels, keyboard focus and floating chat were visually reviewed; the final desktop package passed isolated startup.
- Native OS clipboard writes and all four notes screens were not individually exercised; the shared compatibility entry and full-build type checks cover the notes callers.

---

# PaperQuay v{{VERSION}}

## 阅读器聊天

- 问答失败后保留问题：首个有效回答前失败时，只移除本次空助手占位，保留问题、消息附件与历史，不覆盖用户新草稿或当前会话选择。
- 切换文档再返回后，旧请求不能修改当前消息、错误提示或运行标记。
- 侧栏与浮动问答支持逐条复制用户消息和助手清理后的 Markdown / HTML 源码，保留公式、代码块及原引用编号；流式复制使用点击时快照。
- 复制成功和失败均有可访问的行内反馈。剪贴板依次尝试 Electron、浏览器 API 和 textarea；回退后恢复焦点与可恢复选区。笔记复制保持原有默认 trim 行为。

## 下载平台

- Windows x64：`.exe`
- Linux x64：`.AppImage`、`.deb`、`.tar.gz`
- macOS x64：`.dmg`

**自 v{{VERSION}} 起停止构建和发布 macOS arm64 安装包，后续版本继续沿用此范围。** 历史版本资产保留。

## 验证

- 本地生产构建与全部 916 项测试通过。
- 隔离 Electron 下 11 项失败请求、12 项复制交互和 3 项真实 DOM 回退通过；浅色/深色、窄栏、键盘焦点与浮窗截图已审阅，最终桌面包隔离启动通过。
- 未覆写实测系统原生剪贴板，四个笔记界面未逐个操作；共用兼容入口行为和完整构建类型检查已覆盖笔记调用方。
