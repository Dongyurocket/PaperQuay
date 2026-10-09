# PaperQuay v{{VERSION}}

This release verifies the relationship between each Agent answer sentence and its cited evidence before enabling citation navigation.

- Answers copy structured citation tokens; displayed numbers and navigation targets come from canonical sources. Unknown, ambiguous, conflicting, and unverified citations remain visibly unavailable.
- The selected Agent model checks each sentence/source pair. Only a valid supported verdict enables navigation; timeouts, invalid responses, and failures remain unverified. Verification adds model latency and usage cost, and readers should still check the original source.
- Verification results persist across saved conversations, forks, and recovery. Citations can be checked again with the current model, with run and token usage recorded.
- The verified-evidence footer lists only sources actually verified for the answer. Other retrieved materials are collapsed separately; legacy numeric citations remain unverified.

Validation: build and all 678 tests passed; the user confirmed manual acceptance on 2026-10-09.

## Downloads

Choose the installer for your system from Assets: Windows `.exe`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

本版在开放 Agent 引用跳转前，逐条核验回答句子与所引证据的关系。

- 回答复制结构化引用 token，显示编号与跳转目标来自 canonical 来源；未知、歧义、元数据冲突和未验证引用保留可见状态且不可跳转。
- 当前 Agent 模型逐对核验句子与来源，仅有效的支持判定可放行；超时、非法响应及失败保持未验证。二次核验会增加延迟和模型费用，判断仍须以原文为准。
- 核验结果随会话保存，分叉及恢复保留完整证据；支持使用当前模型重新核验，并记录运行和 token 用量。
- 底部已核验证据仅列回答实际通过核验的来源，其他检索材料单独折叠；历史数字引用保持未验证。

验证：构建与全部 678 项测试通过；2026-10-09 用户确认人工核验通过。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
