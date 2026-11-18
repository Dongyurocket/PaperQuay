# PaperQuay v{{VERSION}}

## Core Workflows

- Removed the dedicated review-writing workspace and survey-specific Agent workflow. Cross-paper questions and synthesis notes remain available through the ordinary Agent and its evidence tools. Existing synthesis notes and old settings are preserved.
- Removed generation of AI-suggested graph relations. Existing AI-suggested relations remain visible and removable, and manually created relations remain supported.
- Reader chat now supports stopping the underlying request, uses the submitted question consistently for retrieval, and preserves supported citation locations when saving an answer as a note.
- Agent and reader retrieval report scope, search channels and fallback conditions. Agent search also reports index coverage for the active embedding model and dimension. Excluded papers are filtered even when old index entries remain.
- Improved note draft conflict handling and search filters. The external MCP server adds a bounded read-only `get_note` tool, and the accompanying Skills and integration guide reflect the current contracts.

## Verification

- Production build passed. The isolated full test suite passed 1087 tests; one optional real-model benchmark was skipped.
- Isolated Electron and simulated-service checks covered reader and Agent flows. The real generation model returned HTTP 402 during the attempted check, so real-model end-to-end behavior remains unverified. The installed release was not tested before publication.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 核心工作流

- 移除独立综述写作工作区和 Agent 专项综述流程。跨文献问答与综合笔记仍可通过普通 Agent 和证据工具完成；历史综合笔记和旧设置保留。
- 移除图谱 AI 关系候选生成功能。已有 AI 关系仍可展示和删除，手动创建关系仍可使用。
- 阅读器问答支持停止底层请求，检索使用本次提交的问题，保存回答为笔记时保留可转换的引用定位信息。
- Agent 和阅读器检索显示范围、检索通道及降级情况；Agent 另显示当前向量模型和维度下的索引覆盖。即使旧索引尚未清理，已排除文献也不会进入检索候选。
- 改善笔记草稿冲突处理和搜索筛选。外部 MCP 服务新增有返回上限的只读 `get_note`，并更新配套 Skills 和集成指南。

## 验证

- 生产构建通过；隔离全量测试 1087 项通过，1 项可选真实模型基准跳过。
- 使用隔离数据和模拟服务检查了阅读器与 Agent 流程。真实生成模型检查时服务返回 HTTP 402，因此真实模型端到端行为尚未验证；本次发布前未验证安装版。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
