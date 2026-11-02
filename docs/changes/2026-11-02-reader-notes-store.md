# 2026-11-02 - 阅读器笔记 store 分片

## 现象

阅读器父组件持有笔记列表、活动笔记及加载/保存/错误状态，并逐项传给 `DocumentReaderTab`。

## 根因

笔记状态所有权集中在 Reader，导致阅读器 Tab props 继续膨胀；笔记加载、保存、冲突和删除逻辑本身已由现有 helper 与服务调用覆盖。

## 修改

新增 `useReaderNotesStore`，迁移五项笔记状态及函数式 setter。`DocumentReaderTab` 直接订阅 store；复用 `documentReaderNotes.ts` 的排序、锚点、定位和高亮 helper，未改变笔记保存、冲突提示、切换或删除流程。

## 验证

`npm run build` 通过；笔记 store 新增 2 项测试通过；全量 `npm test` 886/886。`DocumentReaderTabProps` 由第二刀后的 38 项降为 28 项。桌面笔记交互待五刀收敛后统一执行并留截图。
