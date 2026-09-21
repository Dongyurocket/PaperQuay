# PaperQuay 知识库 MCP 接入指南

PaperQuay 提供了基于标准 **Model Context Protocol (MCP)** 的知识库服务。Proma、Pi、Codex 等各类 AI Agent 可以通过 stdio 协议直连 PaperQuay 本地知识库，进行文献检索、证据定位、学术问答，以及受安全护栏约束的文库写入与分类管理（导入 PDF、更新元数据、调整分类等）。

---

## 特性亮点

1. **零服务依赖**：基于 Node.js 原生直连 SQLite，无需 Electron 桌面应用保持运行即可查询与管理。
2. **并发安全无锁**：数据库开启 WAL 模式，外部只读查询与桌面应用读写互不阻塞、无锁冲突。
3. **精准段落引用**：`search_knowledge_base` 返回段落所在的**文献 ID、文献标题、页码与结构块 ID**，便于 Agent 依据事实回答并自动生成 `[1] (Paper Title, P.x)` 格式引用。
4. **向量混合检索**：在阅读器设置中配置了 Embedding API 时，`search_knowledge_base` 自动将查询向量化，与 FTS5 全文检索双通道召回，经 RRF（Reciprocal Rank Fusion）融合排序；未配置或接口异常时自动降级为关键词检索，并在分词或特殊字符场景下无缝降级到模糊匹配。
5. **写入安全护栏**：所有写工具在执行前检测 PaperQuay 桌面应用是否运行——桌面应用持有文库内存态，外部写入会在应用下一次保存时被整体覆盖，因此检测到运行中会**显式拒绝并提示关闭应用**；确需并行写入时可传 `allowWhileAppRunning: true` 强制覆盖，设环境变量 `PAPERQUAY_MCP_WRITE=off` 可将服务切换为全局只读。

---

## 提供的 MCP 工具（Tools）

### 知识库只读检索工具
| 工具名称 | 说明 | 核心参数 | 返回内容 |
| :--- | :--- | :--- | :--- |
| `search_papers` | 检索文献库元数据 | `query`（关键词）、`tag`（标签）、`categoryId`（分类过滤，含后代分类）、`limit` | 匹配文献列表（ID、中英文标题、作者、年份、DOI、标签） |
| `get_paper_details` | 读取单篇文献完整详情 | `paperId`（必填） | 完整元数据、摘要、用户笔记、AI 概览、文献类型、出版物、所属分类 ID 等 |
| `search_knowledge_base` | 向量 + 全文混合检索 RAG 知识库证据 | `query`（必填）、`paperId`（可选）、`limit`、`mode`（`auto`/`hybrid`/`keyword`） | 带文献标题、页码、段落预览、匹配分数与命中通道（`vector`/`fts`）的证据切片 |
| `read_paper_content` | 读取文献在知识库中的分块正文 | `paperId`（必填）、`pageIndex`（可选）、`limit` | 按页面或顺序排列的结构化正文内容 |
| `search_notes` | 检索用户的阅读笔记与批注摘录 | `query`（可选）、`paperId`（可选）、`limit` | 用户个人笔记、高亮批注与摘录内容 |

### Zotero 本地选择性同步工具
| 工具名称 | 说明 | 核心参数 | 返回内容 |
| :--- | :--- | :--- | :--- |
| `zotero_list_collections` | 获取本地 Zotero 分类树及条目数 | `dataDir`（可选，默认自动探测） | 分类列表（key、分类名、父分类、条目数）及探测目录 |
| `zotero_search_items` | 条件检索本地 Zotero 文献条目 | `query`、`collectionKey`、`limit`、`dataDir` | 匹配文献列表（包含是否有本地 PDF 附件、DOI 等） |
| `zotero_preview_sync` | 同步前差量比对与去重预检 | `itemKeys`、`collectionKey`、`dataDir` | 差量清单（`ready` 待同步、`alreadyExists` 重复跳过、`missingPdf` 缺 PDF） |
| `paperquay_sync_from_zotero` | 精准导入文献至 PaperQuay | `itemKeys`、`collectionKey`、`targetCategoryId`、`createCollectionCategory` | 导入报告（成功导入数、重复数、自动创建的分类） |

### 文库写入与管理工具（带运行护栏）

以下工具会修改本地文库数据库，执行前均会检查桌面应用运行状态（见下文「写入安全护栏」），并在检测到运行时**显式拒绝**，可传 `allowWhileAppRunning: true` 覆盖。

| 工具名称 | 说明 | 核心参数 | 返回内容 |
| :--- | :--- | :--- | :--- |
| `import_pdfs` | 批量导入本地 PDF 文件 | `paths`（必填，PDF 绝对路径数组）、`metadata`（按路径键控的元数据，含 `title`/`titleZh`/`authors`/`tags` 等）、`targetCategoryId` 或 `categoryName`（互斥，按名称不存在则自动创建）、`importMode`（`copy`/`move`/`keep`，默认取应用设置） | 导入报告（`imported`/`duplicates`/`errors` 明细与汇总；重复文献按内容哈希查重并补挂目标分类） |
| `list_categories` | 读取分类树及各分类文献数（只读） | 无 | 分类列表（含系统分类、`parentId`、`sortOrder`、`paperCount` 含后代分类计数） |
| `manage_category` | 分类全生命周期管理 | `action`（`create`/`rename`/`move`/`delete`）、`categoryId`、`name`、`parentId` | 操作后的分类对象；`delete` 级联删除全部子分类并把文献从其中解绑（不删除文献），返回 `deletedCategoryIds` |
| `set_paper_categories` | 批量调整文献的分类归属 | `paperIds`（必填）、`add`/`remove`（可与 `remove` 组合）或 `replace`（互斥） | 每篇文献更新后的 `categoryIds`；任一文献或分类不存在则整体拒绝，不留部分写入 |
| `update_paper` | 更新文献元数据（白名单字段） | `paperId`（必填）+ `title`/`titleZh`/`authors`/`keywords`/`tags`/`isFavorite` 等可更新字段 | 更新后的文献对象；未知字段显式报错 |
| `delete_papers` | 批量删除文献 | `paperIds`（必填）、`deleteFiles`（默认 `false`，为 `true` 时同时删除已入库的 PDF 文件） | 删除报告（`deleted`、`deletedFileCount`、`fileErrors`）；数据库先提交再删文件 |

---

## 写入安全护栏

文库数据库采用「应用内存态 + 整体落盘」的持久化模型：**桌面应用运行时持有文库的内存副本，其任何保存动作都会全量覆盖数据库**。因此 MCP 写工具默认遵循以下规则：

1. 每次写入前检测 `PaperQuay.exe`（Windows）或 `PaperQuay` 进程（macOS/Linux）是否在运行；
2. 检测到运行时，写入被**拒绝**并返回明确错误提示（引导先关闭桌面应用），数据库不产生任何修改；
3. 明确知道风险时可传 `allowWhileAppRunning: true` 强制写入（桌面应用随后的保存可能覆盖本次写入）；
4. 进程探测失败（权限不足等）时写入放行，但在返回结果中附带 `warning` 说明未能完成检测；
5. 设环境变量 `PAPERQUAY_MCP_WRITE=off` 可禁用全部写工具（此时服务等价于纯只读），该开关优先级高于 `allowWhileAppRunning`。

Zotero 同步工具（`paperquay_sync_from_zotero`）同样受该护栏保护。建议让 Agent 形成「写前确认桌面应用已关闭」的标准作业程序。

---

## 客户端配置指南

### 1. Proma Agent 配置

在 Proma 工作区配置文件（例如 `mcp.json`）中添加 `paperquay` 服务：

```json
{
  "servers": {
    "paperquay": {
      "type": "stdio",
      "command": "node",
      "args": [
        "C:/Users/yusen/.proma/agent-workspaces/paperquery/workspace-files/bin/paperquay-mcp.cjs"
      ],
      "enabled": true
    }
  }
}
```

### 2. Pi Coding Agent 配置

在全局配置 `~/.pi/agent/mcp.json` 或当前项目 `.mcp.json` 中配置：

```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": [
        "C:/Users/yusen/.proma/agent-workspaces/paperquery/workspace-files/bin/paperquay-mcp.cjs"
      ]
    }
  }
}
```

### 3. Codex CLI / Desktop 配置

在 `~/.codex/config.toml` 或当前项目的 `.codex/config.toml` 中添加：

```toml
[mcp_servers.paperquay]
command = "node"
args = [
  "C:/Users/yusen/.proma/agent-workspaces/paperquery/workspace-files/bin/paperquay-mcp.cjs"
]
```

### 4. Claude Code / Desktop 配置

在 `claude_desktop_config.json` 的 `mcpServers` 字段下添加：

```json
{
  "mcpServers": {
    "paperquay": {
      "command": "node",
      "args": [
        "C:/Users/yusen/.proma/agent-workspaces/paperquery/workspace-files/bin/paperquay-mcp.cjs"
      ]
    }
  }
}
```

---

## 自定义数据目录

服务默认会自动探测操作系统默认的 PaperQuay 数据目录：
- Windows: `%APPDATA%/PaperQuay`
- macOS: `~/Library/Application Support/PaperQuay`
- Linux: `~/.config/PaperQuay`

如果你使用了自定义数据目录或在测试环境运行，可通过以下任一方式指定：

1. **命令行参数**：
   ```bash
   node bin/paperquay-mcp.cjs --data-dir="D:/MyPaperQuayData"
   ```
2. **环境变量**：
   ```bash
   export PAPERQUAY_DATA_DIR="D:/MyPaperQuayData"
   ```

---

## 向量混合检索说明

`search_knowledge_base` 的检索行为由 `mode` 参数控制（默认 `auto`）：

| 模式 | 行为 |
| :--- | :--- |
| `auto`（默认） | 检测到可用的 Embedding 配置时走向量 + 全文混合检索，否则静默使用关键词检索 |
| `hybrid` | 强制尝试混合检索；配置缺失或向量索引不可用时降级为关键词检索，并在响应中返回 `warning` 说明原因 |
| `keyword` | 强制使用 FTS5 关键词检索（分词/特殊字符场景再降级为模糊匹配），不发起任何网络请求 |

混合检索的实现与桌面端完全一致：查询文本先经已配置的 Embedding API 向量化，在 `sqlite-vec` 向量索引上由底层单条 SQL 跨全库所有就绪文献执行全局 KNN 向量召回（若传 `paperId` 则限定单篇），与 FTS5 的 BM25 候选经 RRF 融合排序，无任何来源数量截断。响应中的 `retrievalMode` 字段标识本次实际生效的检索方式（`hybrid` / `keyword`），每条结果的 `channels` 字段标识命中来源（`vector` / `fts` / `like`）。

**配置来源与隐私边界**：MCP 服务直接读取 PaperQuay 渲染层持久化的阅读器配置（`<数据目录>/.settings/paperquay.config.json` 中的 `settings.embeddingBaseUrl` / `embeddingModel` / `embeddingDimensions` 与 `secrets.embeddingApiKey`），在应用内修改配置后下一次 MCP 调用即生效。混合检索会把**查询文本**发送到你配置的 Embedding 端点（与桌面端索引/检索时的行为一致）；设环境变量 `PAPERQUAY_MCP_EMBEDDING=off` 可全局禁用该网络请求，强制关键词检索。

---

## 典型 Agent 交互与提示词示例

Agent 被接入后，即可直接向其提问：

> “请在 PaperQuay 知识库中查找关于 Transformer 多头注意力机制的解释，并给出文献来源和页码。”

Agent 会自动执行：
1. 调用 `search_knowledge_base({ query: "multi-head attention" })` 提取关键段落；
2. 依据检索返回的 `paperTitle`、`pageNumber` 和 `snippet` 组织严谨的学术回答；
3. 输出如：`根据《Attention Is All You Need》（第 2 页）...` 的学术级引用。
