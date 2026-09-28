# PaperQuay v{{VERSION}}

This release fixes the Agent model menu being cut off once a conversation starts, and makes the memory and reasoning controls distinguishable.

## Fixes

- **Agent model menu stays visible after a reply starts**: once the composer docks to the bottom of the window, the model menu still opened downward and only its title remained on screen. It now opens upward when there is not enough room below, and its height stays within the available space.
- **Organize-memory and reasoning effort no longer look the same**: both were square brain icons. Organize memory is now a labeled action ("整理记忆" / Memory). Reasoning effort is a gauge-style selector that shows the current level, such as "思考 自动".

Switching the model during a running reply applies to the next message. The in-flight reply keeps the model it started with.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本次修复 Agent 开始回答后模型下拉被窗口裁掉的问题，并区分整理记忆与思考强度两个控件。

## 修复

- **回答开始后模型菜单不再被裁切**：输入框贴底后，模型下拉仍向下展开，只剩标题露在窗口里。现在下方空间不足时改为向上展开，高度不超过该侧可用空间。
- **整理记忆和思考强度不再长得一样**：两者原先都是大脑方形图标。整理记忆改为带文字的操作按钮；思考强度改为仪表式选择器，直接显示当前档位，例如「思考 自动」。

回答进行中切换模型，会从下一条消息起生效；当前这一轮仍使用开始时的模型。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
