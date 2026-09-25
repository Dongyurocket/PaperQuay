# 笔记页面类型入库与 ID 稳定双链

## 现象

笔记宪章已经定义了 `paper-card`、`concept`、`synthesis`、`qa`、`excerpt`、`index`、`log`、`overview` 八种结构页面类型，但数据库中的 `type` 仍表示来源语义（`highlight`、`area`、`standalone`、`ai-chat`），导致页面类型不能被校验、过滤或由 MCP 稳定写入。

同时，`note_links` 已按目标笔记 ID 保存关系，但正文中的 `[[标题]]` 在重新保存时按标题解析。目标笔记改名后，引用方再次保存会因为旧标题无法匹配而丢失关系。

## 方案原文要求

- P3-3 新增独立的 `page_kind` 列，不复用旧 `type`；旧 `highlight` 映射到 `excerpt`，旧 `ai-chat` 映射到 `qa`，其余旧类型不强行猜测。
- 页面类型要贯通 CRUD、检索过滤、编辑器模板、内置 Agent、MCP 和侧栏。
- P3-6 采用方案 b：wikiLink 节点保存 `noteId` 与标题快照，解析以 ID 优先，避免改名时全库重写引用方正文。
- vault Markdown 保持 Obsidian 兼容的 `[[标题]]` 形态。

## 实际修改

### P3-3

- `electron/backend/noteStore.cjs` 通过 `ensureColumn` 增加 `notes.page_kind`，建立索引，并在打开数据库时执行幂等回填：
  - `highlight -> excerpt`
  - `ai-chat -> qa`
  - `area`、`standalone` 保持 `NULL`
- `type` 保持来源语义，不改变既有四值约束；`page_kind` 独立使用八值白名单，非法值在 noteStore、MCP 和查询入口拒绝。
- CRUD、`rowToNote`、FTS 同步、`listNotes({ pageKind })`、MCP `create_note/update_note/search_notes`、内置 Agent `search_notes/write_notes`、编辑器模板和笔记侧栏均传递或过滤 `pageKind`。
- 八个对应模板应用时写入 page kind；三个历史模板不强行归类，继续保持原有行为。
- frontmatter 增加 `pageKind`，vault 导入时恢复该字段。

### P3-6

- `WikiLink` 扩展和共享 Markdown 解析器都支持 `noteId`。为兼容既有内容，仍保留 `id` 字段；未知目标的 `noteId` 为 `null`，标题作为快照。
- `noteStore.resolveNoteLinks` 对带 ID 的节点按目标 ID 建立关系，并校验目标存在；只有没有可用 ID 的纯标题双链才按标题回退解析。
- UI 显示、点击和 Tiptap 到 Markdown 序列化优先按 `noteId` 查当前标题，查不到时回退保存的标题快照。
- vault 文件仍只写 `[[标题]]`，不把内部 ID 塞进 Markdown。一个带 `noteId` 的已知双链在导出时会反查当前标题，因此目标改名后，引用方文件会自然导出为新标题；回导再次按当前标题解析并恢复同一 `noteId` 关系。

## 偏差与收窄

- 方案 b 的内部 ID 只存在于 Tiptap JSON 和数据库关系中，没有改变 Markdown 交换格式。这是有意保留的 Obsidian 兼容边界。
- 没有为 vault Markdown 增加隐藏 ID 语法，也没有在目标改名时全库重写所有引用方正文。纯 Markdown 侧手写的旧标题没有 `noteId`，仍可能无法解析或解析到同名笔记；这是方案 b 无法消除的残余风险。
- 未把三个历史模板 `literature-review`、`method-analysis`、`experiment-note` 强制映射到八种页面类型，避免从模板内容猜测结构语义。
- `notes_fts` 的索引仍使用统一 noteStore 保存路径同步；MCP 查询增加 page kind 条件，但本次未扩大为新的检索引擎改造。

## 验证

- 页面类型迁移、幂等重开、非法值拒绝、`listNotes` 过滤通过。
- MCP `create_note({ pageKind: "concept" })` 写入、回读和过滤通过。
- 已知/未知双链 Markdown 解析通过。
- 目标笔记改名后，引用方重保存仍保持 `linkedNoteIds` 和 `note_links` 关系；循环改名不丢链。
- vault 导出跟随新标题，外部修改后回导仍恢复目标 ID 关系。
- 本次新增/调整后的聚焦测试：31 个通过。
- `npm run check` 通过：构建成功，498 个测试全部通过。

## 手工回归

已尝试启动 Electron 开发端进行目标笔记改名、引用方双链显示与重保存、模板写入 page kind、侧栏 page kind 过滤；当前 Windows 沙箱绑定 `127.0.0.1:1420` 和备用 `1421` 均返回 `EACCES`，因此原生桌面手工回归未能启动。上述行为已由对应纯逻辑/服务测试覆盖，不能替代桌面端实际操作。
