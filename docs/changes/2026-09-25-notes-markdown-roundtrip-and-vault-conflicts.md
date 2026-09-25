# 笔记 Markdown 往返与 vault 冲突保护

## 现象

笔记正文的唯一事实源是 Tiptap JSON，但 vault 回导、MCP 笔记写入和编辑器缺失 `contentJson` 的兜底都接收 Markdown。原实现把这些输入写成 `contentJson: null`，编辑器再按空行拆成纯文本段落，标题、列表、内联样式、双链、标签、文献引用和锚点链接无法往返。vault 同步还以 mtime 和数据库 `updatedAt` 比较新旧，双侧同时修改时会静默覆盖一侧内容。

## 根因

vault 只有 Tiptap JSON 到 Markdown 的序列化，没有反向解析；三条写路径各自把 Markdown 当作纯文本。frontmatter 虽然写入 `updatedAt`，但阶段 1 没有使用；manifest 只记录文件路径，也没有记录上次导出的正文版本，无法判断“双侧都改”。

## 修改

- 新增 `src/shared/markdownToTiptap.cjs`，前端通过 `.cjs.d.ts` 引入，Electron 后端直接 `require`。先用 `npm run build` 验证了 Vite/TypeScript 对该共享模块的解析可行性，没有复制第二份解析实现。
- 解析器支持标题、段落、有序/无序列表、粗体、斜体、删除线、行内代码、代码块、引用块、`[[wikilink]]` 和 `#hashtag`。只有 frontmatter/上下文已知的锚点 ID 才重建 `noteAnchorLink`；只有参考文献列表能唯一匹配本地文献的 `[n]` 才重建 `paperReference`，未知值保留文本，避免伪造锚点或 `paperId`。双链在无法解析真实 note ID 时以标签作为节点 ID，保留交换格式并等待后续关系归一化。
- vault 回导、MCP `create_note/update_note`、`noteContentToTiptap` 兜底均调用共享解析器。MCP 仍沿用现有写入护栏；没有改变 noteStore 的 UPSERT/关系维护边界。
- manifest 继续接受旧的 `{ files: { noteId: "path" } }`，新格式增加每个笔记的 `exportedUpdatedAt` 与完整文件 `contentHash`。阶段 1 以 frontmatter `updatedAt` 为主时钟，缺失时回退 mtime；文件内容变化且 DB 在上次导出后也变化时，原文件不覆盖，写出 `--conflict-YYYYMMDD-HHmmss.md`，DB 保持应用侧版本。
- 同步 stats 增加 `conflicts`，笔记工作区同步结果显示冲突副本数量。

## 验证

- `npm run build`
- `node --test tests/markdownToTiptap.test.ts tests/noteVault.test.ts tests/knowledgeMcpNotesWrite.test.ts`
- `npm run check`（交付前执行）
- 测试覆盖基础 Markdown 节点、已知/未知锚点和文献、vault 完整往返、旧 manifest、仅文件侧修改、仅 DB 侧修改以及双侧冲突副本。

## 仍然收窄或偏离方案的地方

- 本次没有引入完整 CommonMark/GFM 解析器，解析范围严格收敛到方案 P3-1 列出的节点和现有 vault 序列化格式；表格、任务列表、图片等超出范围的结构仍按现有未知块降级。
- `wikiLink` 的 Markdown 只携带标题，不包含真实 note ID；已知目标标题时使用目标 ID，未知目标使用标题作为临时节点 ID。这保留了 `[[...]]`，但不能凭空证明目标存在，后续保存时仍由 noteStore 的关系归一化决定是否建立链接。
- 冲突副本不纳入 manifest 管理，避免阶段 3 清理用户需要人工合并的文件；当前冲突时间戳精度为秒级，极短时间内重复冲突时由文件系统同名覆盖风险仍需后续增加唯一后缀。
