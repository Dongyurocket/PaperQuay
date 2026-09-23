# PaperQuay v{{VERSION}}

## Fixes

- **Agent replies overwritten by streaming residue**: Fixed a bug where the `finally` block unconditionally committed cross-turn accumulated streaming text at the end of every run, replacing final answers and clearing cancellation states.
- **Executed plans "revived" after switching chats**: Applied/cancelled plans now persist a terminal status and are never re-activated on session restore. Plan items are fully rendered instead of showing only the first 4, closing the approval blind spot where invisible items were executed.
- **Memory approval card could be submitted repeatedly**: The card locks after a successful write and gains a Reject button, preventing stale content from overwriting newer memory.
- **Double-run race when cancelling**: The 500ms forced cleanup was removed in favor of controller-identity checks, with a "Cancelling" button state. The legacy execution path now supports cancellation via requestId, so Cancel works in every mode.
- **Background runs misjudged as "interrupted"**: Runs still executing after a session switch no longer trigger false recovery prompts or dirty status writes.
- **Interrupted-run recovery always failed for long runs**: Streaming deltas are no longer persisted per token, recovery reads the newest event window, and recovered message sequences are sanitized of orphan tool messages that providers would reject.

## Improvements

- **Streaming performance**: Removed the per-token IPC + SQLite write + full trace read-back + full localStorage serialization chain. Long streaming answers are noticeably smoother and the run-event table no longer bloats.
- **More reliable context compaction**: Token estimation now counts tool-call arguments and attachment base64; synthetic visual-context messages no longer act as compaction boundaries; an over-limit response triggers one forced compaction retry; compaction requests are cancellable.
- **Self-healing tool errors**: Write-tool failures and mixed paper+memory writes are fed back to the model instead of aborting the run; an empty plan (model decided nothing needs changing) shows a normal approval card instead of an error.
- **Default model-call timeouts**: Non-streaming Agent calls get sensible defaults (120s for decisions, 300s for plan generation) so a hung provider no longer requires manual cancellation.
- **Comparative-survey context budget**: Per-paper context quotas scale with the model's context window, and batched context loading removes memory spikes for large-scope surveys.
- **UI details**: Figure preview overlay now uses a portal for true fullscreen coverage; long URLs/code/tables no longer overflow horizontally; the collapsed sidebar scrolls to all chats; the reasoning-effort menu is height-capped.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **Agent 回复被流式残影覆盖**：修复每次运行结束时 `finally` 无条件提交跨轮累积流式缓冲的 bug，最终答案不再被中间轮输出替换，取消标记与耗时 meta 恢复正确展示。
- **批量计划切换会话后“复活”重复写入**：执行/取消后的计划现在回写终态（已执行/已取消），会话恢复时不再重新激活；计划项从仅渲染前 4 项改为全量可见，消除“看不见却被执行”的审批盲区。
- **记忆审批卡可重复提交**：记忆写入成功后卡片锁定并显示终态，新增“拒绝”按钮，杜绝旧内容覆盖新记忆。
- **取消运行的双 run 竞态**：移除 500ms 强制清态，改为 controller 身份校验收尾，取消中按钮显示“正在取消”；legacy 执行路径接入 requestId 取消支持，取消按钮对所有执行模式生效。
- **后台运行被误判为“中断”**：切换会话后仍在运行的 run 不再触发虚假的中断恢复提示与脏写。
- **中断恢复对长运行必然失败**：流式 delta 不再逐 token 落库，恢复读取改为最新事件窗口；恢复消息序列双向清理孤儿 tool 消息，修复恢复后首发请求被 provider 拒绝的问题。

## 优化

- **Agent 流式性能**：消除每个 token 一次的 IPC + SQLite 写入 + trace 全量读回 + localStorage 全量序列化链路，长回答流式明显更流畅，运行事件表不再膨胀。
- **上下文压缩更可靠**：token 估算计入工具调用参数与附件 base64；视觉附件伪消息不再被误判为压缩边界；压缩后仍超限时自动强制压缩并重试一次；压缩请求支持取消。
- **工具错误自愈**：写工具失败与混合写（论文+记忆）不再硬终止运行，错误回喂模型由其分拆或解释；模型判断“无需变更”时返回空计划审批卡而非报错。
- **模型调用默认超时**：非流式 Agent 调用增加默认超时（决策 120s、计划生成 300s），provider 挂起不再只能手动取消。
- **对比调研上下文预算**：每篇论文正文配额按模型上下文窗口动态分配，分批加载消除大范围调研的内存峰值。
- **界面细节**：图表预览遮罩改为 portal 全屏覆盖；长 URL/代码/表格不再横向溢出；折叠侧栏可滚动访问全部会话；思考强度菜单限高。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
