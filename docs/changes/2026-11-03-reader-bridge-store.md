# 2026-11-03 - 阅读器 bridge store 分片

## 现象

`Reader` 持有所有阅读标签页的命令式 bridge 登记表，并负责十字段相等判断、替换和清理。

## 根因

bridge 容器状态与阅读器父组件渲染耦合；但 bridge 生命周期仍必须由 `DocumentReaderTab` 的注册/清理 effect 驱动，且翻译保活依赖全部标签页的 bridge 条目。

## 修改

尝试将 bridge map、原十字段比较和登记/删除 action 抽入 `useReaderBridgeStore`，并补充独立 store 测试。实机打开阅读器时出现 React #185 最大更新深度错误，证据表明命令式 bridge 注册/清理 effect 与 Zustand 父层重渲染形成循环；按交接文档强耦合护栏，生产接线保留 `Reader` 原有同步 registry。`DocumentReaderTab` 的 `onBridgeStateChange(tabId, bridge | null)` 签名、effect 生命周期、全部 bridge 字段和 Reader 的 active/busy 消费路径均保持原样，未按 activeTab 或 workspaceActive 清空，也未改变后台翻译保活范围。

## 验证

bridge store 测试覆盖空默认、A/B 独立登记、定向替换、未知 id 清理、十字段变化、等值 no-op、回调不执行和 action 稳定性；生产回退后 `npm run build` 与全量 `npm test` 901/901 通过。最终桌面构建成功打开文献阅读器，PDF、结构化正文和问答侧栏正常显示。第四刀结论：**保留 bridge，不迁移**；原因是抽取会改变现有命令式生命周期并触发运行时循环。
