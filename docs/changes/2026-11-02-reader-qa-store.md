# 2026-11-02 - 阅读器 QA 会话 store 分片

## 现象

阅读器父组件持有 QA 会话、输入、附件、模型选项、运行中会话和错误状态，并逐项传给 `DocumentReaderTab`。

## 根因

QA 状态所有权集中在 `Reader`，但这些状态由多个阅读标签页共同使用；状态搬迁时必须保持现有全局共享语义，不能按文档拆分会话。

## 修改

新增 `useReaderQaStore`，迁移十项 QA 状态及其函数式 setter。`DocumentReaderTab` 直接订阅 store；Reader 保留现有会话空列表补建、选中会话修复和 preset fallback effect。继续复用 `documentReaderQaSessions.ts` 的会话选择、删除和 preset helper，未改变 QA 历史恢复、附件去重、答案渲染模式、推理强度或运行状态语义。

## 验证

`npm run build` 通过；QA store 新增 2 项测试通过；全量 `npm test` 884/884。`DocumentReaderTabProps` 由第一刀后的 58 项降为 38 项。未按文档过滤 QA 会话；A 标签页产生的会话仍由同一 Zustand store 对 B 标签页可见。桌面双标签页回归待五刀收敛后统一执行并留截图。
