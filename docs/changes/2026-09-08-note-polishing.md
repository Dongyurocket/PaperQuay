# 2026-09-08 - 笔记 AI 润色与知识库引用

## 现象

笔记编辑器已有富文本、文献锚点和阅读器定位能力，但用户需要自行整理语言、排版和引用，无法在写作时调用本地知识库作为可追溯证据。

## 根因

现有 AI 命令支持论文摘要、问答和 Agent 计划，但没有笔记润色专用请求；笔记编辑器也没有用于选择知识库范围、预览结果和写入 RAG 引用的交互。

## 修改

- 新增笔记润色入口，支持润色选中文本或将整篇笔记的润色结果插入末尾。
- 支持三种范围：仅优化文字与排版、笔记关联文献、整个知识库。
- 后端仅接受模型返回的服务器分配证据编号，并将其映射为 RAG chunk 的文献、页码和结构块定位，避免模型伪造引用位置。
- 润色结果经过预览后才写入笔记；引用以既有 `NoteAnchorBlock` 保存，点击可打开对应文献并跳转到页级或块级位置。
- 未配置 embedding、索引缺失或检索失败时，功能会提示并降级为纯文本润色。
- 同步修复了笔记工作区跳转事件遗漏 RAG `blockId` 和 `pageIndex` 的问题。

## 验证

- `npm run build`
- `npm test`，259 tests passed
- `node --test tests/notePolish.test.ts tests/notePolishCommand.test.ts tests/documentReaderNotes.test.ts`，14 tests passed
- 启动 Vite 开发服务器：`http://127.0.0.1:1420/`
