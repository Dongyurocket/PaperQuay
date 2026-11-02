# 2026-11-03 - 阅读器配置与回调 props 打包

## 现象

四刀状态迁移后，`DocumentReaderTab` 仍有 28 项 props，主要是 API 配置、回调和逐文档数据。

## 根因

配置和回调字段逐项横向传递，导致入口接口仍难以扫描；状态已由各自 store 直接订阅，剩余字段适合按职责打包。

## 修改

新增 `readerApiConfig`（复用现有 `ReaderSecrets` 的 8 项字段）和 `readerCallbacks`（11 项回调，包含 bridge 生命周期回调）。Tab 入口解构对象后继续使用原字段名和原依赖数组；`zoteroLocalDataDir`、语言标签、逐文档笔记候选/跳转/译文快照保持显式传递。未改变 API 配置值、回调签名、可选回调语义或业务流程。

## 验证

`DocumentReaderTabProps` 由 28 项降为 11 项。`npm run build` 通过；全量 `npm test` 901/901。四刀 store 测试补充边界后，最终测试数超过 900。桌面实机回归在最终打包构建后执行并记录截图。
