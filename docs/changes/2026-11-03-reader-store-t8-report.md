# T8 阅读器 store 分片最终验收报告

## 1. 逐刀结果

| 刀 | 提交 | `DocumentReaderTabProps` | 交付物 | 实机回归 |
| --- | --- | ---: | --- | --- |
| 第一刀：布局 | `f3a91f8` | 62 → 58 | `useReaderLayoutStore`、`readerLayoutStore.test.ts` | 最终桌面构建阅读器布局正常；宽度键名/默认值/边界保持 |
| 第二刀：QA | `771fbd4` | 58 → 38 | `useReaderQaStore`、`readerQaStore.test.ts` | QA store 保持所有阅读标签页全局共享；最终阅读器问答侧栏正常 |
| 第三刀：笔记 | `7de91a7` | 38 → 28 | `useReaderNotesStore`、`readerNotesStore.test.ts` | 最终阅读器加载正常；笔记状态保存链路保持 |
| 第四刀：bridge 评估 | `9c6b01f` | 28 → 28 | `useReaderBridgeStore` 纯 store 测试与生命周期审查 | 抽取尝试触发 React #185，生产 registry 已回退保留，见下节 |
| 第五刀：配置/回调 | `d4cb7ef` | 28 → 11 | `readerApiConfig`、`readerCallbacks`；边界测试补充 | 最终候选构建成功打开阅读器，PDF、结构化正文、问答侧栏可见 |

后续稳定性/回退提交：`f55b0c8`。该提交保留 bridge 的 Reader 原有同步 registry，补齐三个 store 的同值 bailout，并保留 QA/笔记/布局的 store 迁移。

最终 props 路径：`62 → 58 → 38 → 28 → 28 → 11`。

最终桌面截图：`C:\Users\yusen\AppData\Local\Temp\windows-computer-use-0e965f158f374c29b92856df88ab2c2e.png`（文库打开阅读器后，截图哈希 `b5622fa94468fa3d8b95ddecd0032b89a8dabfd483020c27b0aa31f13acf151e`）。截图未纳入仓库，避免提交个人文库标题和路径。

## 2. bridge 结论

**保留，不迁移生产 registry。** `DocumentReaderTab` 的 bridge 注册/清理 effect 与 Zustand 父层重渲染组合会在真实桌面打开阅读器时触发 React #185 最大更新深度错误。按交接文档强耦合护栏，保留 Reader 原有 map、十字段比较、`onBridgeStateChange(tabId, bridge | null)` 生命周期和全部 mounted tab 的翻译保活语义。独立 `useReaderBridgeStore` 测试记录了登记、替换、清理、等值 no-op 和 action 稳定性，但生产不订阅该 store。

## 3. 终态验收

- `DocumentReaderTabProps`：11 项。
- `npm run build`：通过。
- `npm test`：901/901 通过。
- QA 会话：所有阅读标签页全局共享，未引入按文档过滤。
- localStorage：`ASSISTANT_PANEL_WIDTH_STORAGE_KEY`、默认宽度 408、clamp 280–9999 保持。
- 桌面：最终候选包 `release/local-ui-t8-final6` 复制到 `%TEMP%` 后启动，打开文献进入阅读器，PDF、结构化正文与问答侧栏正常显示。

## 4. 与预期不符

- 第四刀未迁移生产 bridge registry，原因是实机可复现的 React #185 生命周期循环；已记录证据并保留现状语义。
- 因第四刀保留，props 在第三刀后仍为 28，依靠第五刀对象打包直接降至 11。
- 工作区原有未跟踪个人资产（`.verification-*`、`scripts/`、`.claude/`、`.codex-temp/`）未纳入任何提交。

## 5. 推送

`git push origin main` 成功，`origin/main` 更新至 `f55b0c8`。五刀主提交均为 fast-forward 合并，无 force push、无历史改写。
