# PaperQuay 知识库 MCP 接入指南

PaperQuay 提供了基于标准 **Model Context Protocol (MCP)** 的只读知识库服务。Proma、Pi、Codex 等各类 AI Agent 可以通过 stdio 协议免侵入地调用 PaperQuay 本地知识库，进行文献检索、证据定位与学术问答。

---

## 特性亮点

1. **零服务依赖**：基于 Node.js 原生只读直连 SQLite，无需 Electron 桌面应用保持运行即可查询。
2. **并发安全无锁**：数据库开启 WAL 模式，外部只读查询与桌面应用读写互不阻塞、无锁冲突。
3. **精准段落引用**：`search_knowledge_base` 返回段落所在的**文献 ID、文献标题、页码与结构块 ID**，便于 Agent 依据事实回答并自动生成 `[1] (Paper Title, P.x)` 格式引用。
4. **混合检索兜底**：优先采用 SQLite FTS5 全文搜索，在分词或特殊字符场景下自动无缝降级到语义关键词模糊匹配。

---

## 提供的 MCP 工具（Tools）

| 工具名称 | 说明 | 核心参数 | 返回内容 |
| :--- | :--- | :--- | :--- |
| `search_papers` | 检索文献库元数据 | `query`（关键词）、`tag`（标签）、`limit` | 匹配文献列表（ID、中英文标题、作者、年份、DOI、标签） |
| `get_paper_details` | 读取单篇文献完整详情 | `paperId`（必填） | 完整元数据、摘要、用户笔记、AI 概览、文献类型、出版物等 |
| `search_knowledge_base` | 全文与 RAG 知识库证据检索 | `query`（必填）、`paperId`（可选）、`limit` | 带文献标题、页码、段落预览和匹配分数的证据切片 |
| `read_paper_content` | 读取文献在知识库中的分块正文 | `paperId`（必填）、`pageIndex`（可选）、`limit` | 按页面或顺序排列的结构化正文内容 |
| `search_notes` | 检索用户的阅读笔记与批注摘录 | `query`（可选）、`paperId`（可选）、`limit` | 用户个人笔记、高亮批注与摘录内容 |

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

## 典型 Agent 交互与提示词示例

Agent 被接入后，即可直接向其提问：

> “请在 PaperQuay 知识库中查找关于 Transformer 多头注意力机制的解释，并给出文献来源和页码。”

Agent 会自动执行：
1. 调用 `search_knowledge_base({ query: "multi-head attention" })` 提取关键段落；
2. 依据检索返回的 `paperTitle`、`pageNumber` 和 `snippet` 组织严谨的学术回答；
3. 输出如：`根据《Attention Is All You Need》（第 2 页）...` 的学术级引用。
