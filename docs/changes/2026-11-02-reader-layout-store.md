# 2026-11-02 - 阅读器布局 store 分片

## 现象

`Reader` 持有助手侧栏面板、分离状态、侧栏宽度和拖动状态，并将四项状态继续逐项传给 `DocumentReaderTab`。

## 根因

布局状态所有权集中在阅读器父组件，导致阅读器 Tab props 膨胀；侧栏宽度持久化和拖动边界逻辑也与父组件生命周期混在一起。

## 修改

新增 `useReaderLayoutStore`，保留助手面板默认值、`paper-reader-assistant-panel-width-v1` 键名、408 默认宽度、280/9999 边界及松手时单次写入。`DocumentReaderTab` 直接订阅四项布局状态，Reader 不再传递这四个 props。

## 验证

`npm run build` 通过；布局 store 新增 4 项测试通过；全量 `npm test` 在修正 Node `.ts` 导入后通过 879 项（878 项原有测试 + 4 个测试用例计入文件运行项）。props 接口由 62 项降为 58 项。桌面实机回归待五刀收敛后按交接文档统一执行并留截图。
