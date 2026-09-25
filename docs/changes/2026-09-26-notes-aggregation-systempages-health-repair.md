# 笔记聚合、系统页维护与体检修复闭环

## 现象

笔记系统已经具备摘录卡、页面类型、稳定双链和共享 Markdown→Tiptap 解析器，但仍缺少三段高阶闭环：Agent 无明确的“摘录→精读卡/概念页”工作配方；批量写入后没有自动维护 `log`、`index`、`overview`；体检只能发现问题，不能把报告交给 Agent 生成审批修复计划。

## 方案原文要求

- 聚合优先复用既有 `search_notes` + `write_notes`，按 `pageKind='excerpt'` 召回，产出 `paper-card`/`concept`，每个要点回链摘录卡，文献引用通过 `paperReference`。
- 批量写入成功后维护系统页；导航页需要节流；用户手改的系统页不得被自动覆盖。
- 体检报告提供 Agent 修复入口；删除类操作默认只列清单；断链修复与 noteId 双链机制一致。

## 实际修改

- 聚合采用 Agent 系统提示中的配方，没有新增专门工具。单篇文献提示使用 `pageKind='excerpt' + paperId`，跨文献提示使用 `pageKind='excerpt' + 标签/关键词`；目标页通过 `write_notes` 审批创建为 `paper-card` 或 `concept`。
- 新增 `noteAggregation.ts` 纯逻辑草稿生成器和测试：来源摘录只读，输出精确 `[[摘录卡标题]]`；正文引用使用 `[n]`，末尾唯一参考文献条目由共享解析器重建为真实 `paperReference`，不手写引用节点或编号属性。
- `applyAgentNoteWritePlan` 成功后追加 `log` 记录日期、`create/update/delete` 操作统计和涉及笔记双链；每累计 **5 个成功写操作**刷新 `index`/`overview`。缺失页按既有模板结构创建，内容统一重新解析为 Tiptap JSON。
- 系统页采用 `pageKind + 首行 marker/hash` 判定是否仍由系统管理。marker hash 与正文不一致即视为用户接管，自动维护跳过，不覆盖手改内容。当前节流计数器为进程生命周期计数，不做持久化；这是本次范围的有意收窄。
- 体检卡新增“让 Agent 修复”入口，通过应用事件打开 Agent 并预填修复指令。修复指令明确删除只列清单、不生成 `delete`；断链优先按已有 `noteId` 重挂，无法确认时保留人工处理清单；锚点和原文快照只可保真，不可改写。

## 验证

- 新增聚合、系统页纯逻辑测试，覆盖 3 张摘录卡、回链 `noteId`、`paperReference`、来源锚点/快照不变、系统页创建/更新/漂移跳过和每 5 次节流。
- `npm run build` 通过。
- `npm test` 通过：503 个测试，503 通过，0 失败。
- 未启动 Electron 桌面端，未完成桌面端手工回归；因此事件按钮实际点击、Agent 输入框预填和系统页在真实 SQLite 中的视觉行为未冒充为已验证。

## 收窄与后续

- 本次没有新增语义 embedding 检索或后台 watcher；聚合召回继续依赖既有 `search_notes` 的过滤/关键词能力，系统页导航继续按每 5 次成功写入刷新。
- `noteAggregation.ts` 是可测试的草稿/指令生成层，实际模型归纳仍由 Agent 完成，并始终经过 `write_notes` 审批。
