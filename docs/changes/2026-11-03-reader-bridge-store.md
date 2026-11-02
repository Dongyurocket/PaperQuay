# 2026-11-03 - 阅读器 bridge store 分片

## 现象

`Reader` 持有所有阅读标签页的命令式 bridge 登记表，并负责十字段相等判断、替换和清理。

## 根因

bridge 容器状态与阅读器父组件渲染耦合；但 bridge 生命周期仍必须由 `DocumentReaderTab` 的注册/清理 effect 驱动，且翻译保活依赖全部标签页的 bridge 条目。

## 修改

新增 `useReaderBridgeStore`，迁移 bridge map、原十字段浅比较和登记/删除 action。保留 `DocumentReaderTab` 的 `onBridgeStateChange(tabId, bridge | null)` 签名、effect 生命周期、全部 bridge 字段和 Reader 的 active/busy 消费路径；未按 activeTab 或 workspaceActive 清空，也未改变后台翻译保活范围。

## 验证

bridge store 新增 3 项测试覆盖空默认、A/B 独立登记、定向替换、未知 id 清理、十字段变化和等值 no-op。`npm run build` 通过；全量 `npm test` 889/889。`DocumentReaderTabProps` 仍为 28 项，因为 bridge 回调必须保留到第五刀统一回调打包。桌面多标签页翻译保活回归待第五刀收敛后统一执行并留截图。
