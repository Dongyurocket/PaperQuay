# PaperQuay v{{VERSION}}

This release fixes Agent citation integrity, model error reporting, and composer controls on narrow windows:

- Agent answers no longer let model-written paper titles/pages diverge from what a `[n]` citation actually opens. Citation labels are unique per run, ambiguous labels are rejected, and explicit title/page conflicts are flagged as mismatches.
- Model connection failures now report an actionable Chinese message instead of a bare `fetch failed`, and one failure no longer renders duplicate error cards in the execution trace.
- The Agent composer toolbar wraps by available width, so the model picker, reasoning effort, and Send stay visible and clickable on small screens; the reasoning picker gains keyboard support and viewport-aware placement.
- MCP maintenance: server version now tracks the app version, stale schema fields were cleaned up, desktop write protection also covers development instances, and three repo-managed Agent skill guides were added.

## Downloads

Choose the installer for your system from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本版修复 Agent 引用一致性、模型错误提示与小屏下 Composer 控件可用性：

- Agent 正文中模型手写的文献题名/页码不再可能与 `[n]` 实际跳转的文献不一致：每次运行的引用编号全局唯一，歧义编号拒绝跳转，题名/页码冲突会标记为引用不匹配并受笔记门禁拦截。
- 模型连接失败不再只显示 `fetch failed`，而是给出可操作的中文排障提示；同一失败在执行轨迹中只保留一条错误卡片。
- Composer 工具栏按实际宽度换行，窄窗口或高缩放下模型选择、思考强度与发送按钮保持可见可点；思考强度控件支持键盘操作与视口内菜单定位。
- MCP 维护：服务版本与应用版本对齐，清理失效 schema 字段，开发模式下的外部写入同样受运行护栏保护，并新增三个仓库管理的 Agent 作业技能。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
