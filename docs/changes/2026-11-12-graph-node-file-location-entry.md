# 图谱文献节点文件位置入口

## 实现

- 图谱画布中的文献节点右键菜单新增“打开所在位置”，直接复用文献工作区的 `LiteratureFileLocationsDialog` 和既有主进程定位服务。
- 动作从右键节点快照读取 `paperId` 与标题，不依赖详情当前选中的文献；不触发解析、下载、模型调用或目录创建。
- 当前图谱关系没有 EvidenceSpan 身份，因此此入口展示该文献登记的全部位置；按单条 evidence 精确限制 generation 的能力仍需在图谱证据对象接入后启用。

## 验证

- `npm run build`：通过，2617 modules。
- `node --test tests/knowledgeGraphCommands.test.mjs tests/knowledgeStoreEvidence.test.mjs tests/literatureFileLocations.test.mjs`：14/14 通过。
- `git diff --check`：通过。
- 本次 Windows Electron/Explorer 桌面交互未能启动，未将自动化结果记为桌面验收。

## 未完成

- 图谱 Claim/Relation 尚未携带已持久化 EvidenceSpan ID，因此不能从关系或证据详情直接定位到历史 generation。
- 长文档章节面板尚未接入同一 dialog。
