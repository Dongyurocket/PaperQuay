# 2026-11-27 - 识别结果手动编辑与多余块删除

## 现象

使用「AI 重析」后，MinerU 的分页切片与跨页合并偶尔会在识别结果里留下多余内容：页眉页脚、切片边界的重复块、合并表格留下的碎片等。此前只能整块执行 AI 重析，无法手动修正文本，也不能把多余的块从正文、翻译和索引中彻底去掉。AI 返回的结果同样只能整段接受或放弃。

## 根因

原来的区块修复层只支持「整段替换 Markdown」，并且只保存在 `localStorage` 的阅读视图覆盖表里：

- 没有手动编辑入口，AI 结果无法二次调整。
- 覆盖表按文档哈希绑定，只影响阅读与翻译，删除块无表达方式。
- RAG 索引、摘要和问答各自读取 `content_list` 或缓存 `full.md`，不感知阅读视图里的修复。

## 修改

### 数据层

- 新增 `src/services/parseEdits.ts`：解析编辑记录为 `blockId → { hash, text?, deleted? }`，`hash` 是原始块内容指纹（类型 + 文本 + 表格 HTML）。重新解析后块内容变化时，旧编辑按指纹自动失效。
- 新增 `electron/backend/parseEditCommands.cjs`：编辑表按解析路径归档到 `<dataDir>/parse-edits/<sha256(规范化路径)>.json`，由主进程原子写入；读取时校验版本、blockId、哈希、文本长度与条目数。新增 IPC `read_parse_edits` / `write_parse_edits` 并登记白名单。
- `useBlockReparseOverrides` 从 localStorage 改为磁盘持久化：加载时校验每条编辑的块指纹，淘汰过期项；首次打开旧文档时把 localStorage 中的 AI 修复迁移到新编辑文件。
- `MineruBlockBase` 增加 `textOverride`；`extractTextFromMineruBlock` / `toMarkdownFragment` 优先使用它，阅读、翻译、摘要、问答与 RAG 分块因此共用同一份编辑文本。

### 交互

- 每个块的悬浮工具条和右键菜单增加「编辑」；`BlockReparseModal` 改为「手动编辑 / AI 重析」双标签。AI 结果自动填入编辑区，可继续删改后再保存。
- 表格块进入编辑器前把 MinerU 的表格 HTML 转成 GFM Markdown 表格（`htmlTableToMarkdown`），避免编辑器里出现不可编辑的 HTML 或重复的纯文本。
- 编辑对话框支持 Markdown 源码与预览切换、恢复原始识别、删除此块。删除操作可恢复，原始解析文件不变。
- 工具行在存在调整时显示「识别结果 N」入口，打开调整列表：逐条恢复、恢复全部，并提示重新索引后进入知识库检索。
- 隐藏块从正文、目录、翻译输入与摘要/RAG 中统一排除；当前激活块被隐藏时清空选中状态。

### 索引与翻译

- `indexLibraryPaperMineruSource` 在索引前读取编辑表并应用到块列表；存在编辑时用编辑后的块重建 Markdown，避免缓存 `full.md` 未变化导致索引签名不变、重建被跳过。
- 当前文献问答与概览在存在编辑时改用编辑后的块重建文本。
- 翻译输入跳过隐藏块，已有译文在协调时移除；文本修正后按同一份有效源文本重译。

## 验证

- `npm run typecheck`：六套 tsconfig 全部通过。
- `npm run build`：通过。
- `npm run lint`：0 error / 206 warning（与基线一致）。
- `npm test`：1,599 项，1,589 通过、10 跳过、0 失败。
- 新增 `tests/parseEdits.test.ts`：指纹稳定性、文本覆盖、隐藏块、过期编辑、非法编辑校验、目录跟随编辑。
- 新增 `tests/htmlTableToMarkdown.test.ts`：表格 HTML → GFM 表格、管道符转义、行补齐与纯文本回退。
- 新增 `tests/parseEditsStore.test.mjs`：编辑文件往返、空表删除文件、不同解析路径隔离、非法字段丢弃、损坏/不支持版本拒绝读取。
- 更新 `tests/blockReparseOverrides.test.ts`：改为验证磁盘持久化、同步读取、隐藏与恢复全部。
- 更新 `tests/readerMarkdownComponents.test.ts`：适配「手动编辑 / AI 重析」双标签。
- 实机 Electron 窗口验证未完成：当前 Agent 会话启动 Electron 开发实例时进程无窗口静默退出（最小 Electron 脚本同样无输出），已用构建、类型检查、Lint 与组件级测试覆盖渲染和状态逻辑，未做真实点选验收。
