# 文献文件位置服务实施进展

- 日期：2026-11-12
- 关联：工作区 P0-F；供 KG 证据入口和长文档面板共享。
- 状态：第一版实现进行中，未作为 P0-F 完成交付。

## 已实现

- Electron 主进程从文库登记数据解析原文 PDF、全部登记译版、已登记非 PDF 附件（包括 Markdown）、MinerU 当前及历史候选目录中的已有 `full.md`、JSON 和图片目录，以及登记 PDF 同目录中已有的固定解析文件名。
- 位置查询只检查固定候选的存在性，不递归扫描邻近 PDF，也不按标题搜索或创建目录。
- 行右键将命中的 paper 快照传给位置面板；详情复用同一面板。执行请求只传 `paperId + locationId`，主进程重新读取文库、重算位置、确认文件仍存在，再调用 `shell.showItemInFolder` 或 `shell.openPath`。
- 列表行支持 ContextMenu 与 Shift+F10；键盘打开时菜单将焦点放到首个可用项，Escape 关闭并把焦点还给触发文献行。
- 未登记附件路径、任意 renderer 文件路径及已变化的位置 ID 均无法通过执行命令。
- 缺失 PDF、未生成解析产物及远端无本地 PDF 会分别显示；带有附件 content hash 的本地来源仍可能标为版本未核实，因为当前解析缓存尚无 sourceVersion 身份绑定。

## 验证

- `node --test tests/literatureFileLocations.test.mjs tests/fileCommands.test.ts`：5 项通过，涵盖中文／空格路径、多份译版、注册 Markdown、解析目录和固定产物、未登记标题猜测、缺失和远端来源、ID 越权／过期、文件与目录 shell 分流、列出后文件被删除。
- 最新增量在受控 store 中更换原文附件 `contentHash` 后重放旧 location ID，命令明确拒绝并且 shell 未收到打开请求；恢复原始 fixture 后其余定位流程继续通过。专项仍为 5/5。
- `npm run build`：本轮最后一次构建通过，TypeScript 与 Vite 生产构建完成（2616 modules transformed）；仍有仓库既有 chunk 与动态导入警告。
- `npm test`：截至本次增量的单独串行完整结果为 982 项通过、0 失败。与并行构建运行时曾遇到 2 项备份恢复临时文件 `EPERM`；串行重跑通过。测试结束时部分历史测试报告跳过临时目录清理 `EPERM`，本轮没有递归清理这些路径。
- `git diff --check`：通过。

## 未完成的验收

- 历史证据文件缺失后必须保留 sourceVersion 并拒绝跳转到新版；当前 UI/API 尚无 sourceVersion locator 查询。
- 图谱证据侧栏与长文档分卷/章节面板尚未接入。
- MinerU 用户配置缓存根的旧目录版本、PDF 替换后的缓存归属和每个附件 source hash 尚需专项复核。
- 本机 Electron runtime 的 `--version` 自身退出为 `-2147483645`，源码 Electron 无可见窗口；本轮未操作已安装实例，也没有进行真实 Windows Explorer 或浮动窗验收。
- 尚需测试父级详情变化、跨文献快速打开、外部来源本地附件缺失等竞态与状态语义，并在实际 Windows shell 通过验收后才能勾选 P0-F。
