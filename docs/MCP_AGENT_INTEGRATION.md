# PaperQuay 知识库 MCP 接入指南

> 适用版本：v0.4.39。更新日期：2026-11-25。

PaperQuay 提供基于 **Model Context Protocol (MCP)** 的 stdio 服务（`paperquay-knowledge-mcp`）。Proma、Pi、Codex、Claude 等外部 Agent 可以检索文献库、知识库正文和笔记。写入操作受独立护栏约束。

服务版本与应用版本一致。客户端以 `initialize` 返回的 `serverInfo.version` 和 `tools/list` 为准，不要把本文参数当作固定接口。

## 特性

- **直连本地数据**：服务直接读写 `<数据目录>` 下的 SQLite，查询不需要桌面应用运行。
- **可定位的证据**：`search_knowledge_base` 返回文献 ID、标题、页码和结构块 ID，可用于生成 `(Paper Title, P.x)` 引用。
- **混合检索**：配置 Embedding 后，知识库和笔记检索使用向量 + FTS5 + RRF。未配置或调用失败时降级为关键词检索，并返回 `warning`。
- **写入护栏**：桌面应用运行时默认拒绝写入，见[写入安全护栏](#写入安全护栏)。

## 工具一览

共 28 个工具：14 个只读，14 个写入。所有写入工具都接受 `allowWhileAppRunning`，默认 `false`。

### 只读：文献、知识库与笔记检索

| 工具 | 说明 | 主要参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `search_papers` | 检索文献元数据 | `query`、`tag`、`categoryId`（非系统分类含后代）、`limit`（默认 10，上限 50） | 文献列表，含 `ragEnabled` |
| `get_paper_details` | 读取单篇详情 | `paperId`（必填） | 完整元数据、摘要、笔记、AI 概览、分类 ID、`ragEnabled`、`attachments`（`kind: "pdf"` 为原版，`"translated-pdf"` 为唯一的翻译版） |
| `list_categories` | 读取文库分类树 | 无 | 系统与用户分类、`parentId`、`sortOrder`、`paperCount`（含后代） |
| `search_knowledge_base` | 检索知识库证据 | `query`（必填）、`paperId`、`limit`（默认 8，上限 30）、`mode` | 证据切片：`paperId`、`paperTitle`、`pageNumber`、`blockId`、`snippet`、`score`、`channels`；另含 `retrievalMode`、`warning` |
| `read_paper_content` | 读取文献正文分块 | `paperId`（必填）、`pageIndex`（从 0 开始）、`limit`（默认 20，上限 100） | 按页或顺序排列的结构化正文 |
| `read_paper_figure` | 读取单个图表块 | `paperId`（必填）、`blockId`（如 `page-3-block-2`）、`pageIndex`（回退定位） | 图注、页码、块 ID、块类型；图片块在 8 MB 内返回一个 MCP image content block，超限或缺失时只返回元数据与说明；表格返回结构化表格文本 |
| `search_notes` | 检索笔记 | `query`、`paperId`、`pageKind`、`limit`（默认 10）、`mode` | 笔记、`retrievalMode`、每条 `channels`、降级 `warning` |
| `get_note` | 只读获取笔记正文及来源元数据 | `noteId`、`offset`、`limit`（最多 20000 字符） | 正文片段、标签、文件夹、双链、锚点和 `nextOffset`；锚点最多 100 条 |
| `list_note_tags` | 列出笔记标签与使用次数 | `paperId`（可选） | `tag`、`count` |
| `list_note_folders` | 读取笔记文件夹树与版本 | 无 | `id`、`name`、`parentId`、`sortOrder`、`updatedAt`（写入前传给 `expectedUpdatedAt` / `expectedFolderVersions`） |

已移出本地知识库（`ragEnabled: false`）的文献不会出现在 `search_knowledge_base` 结果中，`read_paper_content` 对其返回空。

### 只读：Zotero 本地库

| 工具 | 说明 | 主要参数 | 返回 |
| :--- | :--- | :--- | :--- |
| `zotero_list_collections` | 列出 Zotero 分类树与条目数 | `dataDir`（可选，默认自动探测） | 分类 key、名称、父分类、条目数 |
| `zotero_search_items` | 检索 Zotero 条目 | `query`、`collectionKey`、`limit`（默认 50，上限 200）、`dataDir` | 条目列表，含 DOI 与是否有本地 PDF |
| `zotero_preview_sync` | 同步前预检 | `itemKeys`、`collectionKey`、`dataDir` | `ready`、`alreadyExists`、`missingPdf` |

### 写入：文库管理

| 工具 | 说明 | 主要参数 | 返回与语义 |
| :--- | :--- | :--- | :--- |
| `paperquay_sync_from_zotero` | 从 Zotero 导入选定条目或分类 | `itemKeys`、`collectionKey`、`targetCategoryId`、`createCollectionCategory`（默认 `true`）、`dataDir` | 导入、重复与新建分类统计 |
| `import_pdfs` | 批量导入本地 PDF | `paths`（必填，绝对路径）、`metadata`（按源路径键控）、`targetCategoryId` 或 `categoryName`（二选一，名称不存在时创建根分类）、`importMode`（`copy`/`move`/`keep`，默认取文库设置） | `imported`/`duplicates`/`errors`。按内容哈希查重，提供元数据时也按 DOI/标题查重；不抓取 Crossref 参考文献 |
| `manage_category` | 创建、重命名、移动、删除分类 | `action`（必填）、`categoryId`、`name`、`parentId`、`sortOrder`、`expectedUpdatedAt`、`expectedCategoryVersions` | 重命名/移动/级联删除校验版本；`delete` 级联删除子分类，只解绑文献，返回受影响分类与文献数；系统分类不可修改 |
| `set_paper_categories` | 调整文献分类 | `paperIds`（必填）、`add`/`remove`，或 `replace`（与前两者互斥）、`expectedUpdatedAt`（数字或 `{paperId: updatedAt}`） | 每篇的 `categoryIds` 与 `updatedAt`；任一版本冲突则整批不写入 |
| `update_paper` | 更新元数据（白名单） | `paperId`（必填）、`expectedUpdatedAt`＋可更新字段，见下文 | 更新后的文献摘要与 `updatedAt`；未知字段报错；版本冲突返回 `PAPER_CONFLICT` |
| `preview_delete_papers` | 删除前预览（只读） | `paperIds`（必填）、`deleteFiles`、`deleteFilePaperIds` | 每篇 `updatedAt`、附件状态、将删除文件、共享文件、非受管路径；返回 `previewVersion` |
| `delete_papers` | 批量删除文献 | `paperIds`（必填）、`deleteFiles`（默认 `false`）、`deleteFilePaperIds`、`previewVersion`（应用运行时必填） | `deleted`、`deletedFileCount`、`fileErrors`、`partialFailure`；先提交数据库再删受管且未被共用的文件 |
| `attach_translated_pdf` | 附加翻译版 PDF | `paperId`、`sourcePath`（均必填） | 复制到翻译版 PDF 目录（默认存储目录下的 `translated-pdfs`），替换已有翻译版；返回 `attachmentId`、`storedPath`、`relativePath`、`replaced`。页数与原版不同时返回 `pageCountMismatch`，不拒绝附加 |
| `remove_translated_pdf` | 移除翻译版 PDF | `paperId`（必填）、`deleteFile`（默认 `true`） | 先提交数据库再删除已入库副本；没有翻译版时报错 |

`update_paper` 可更新字段：`title`、`titleZh`、`authors`、`authorDetails`、`year`、`publication`、`doi`、`url`、`abstractText`、`itemType`、`publisher`、`institution`、`reportNumber`、`volume`、`issue`、`pages`、`isbn`、`issn`、`language`、`citationKey`、`keywords`、`tags`、`userNote`、`aiSummary`、`citation`、`isFavorite`。`import_pdfs` 的 `metadata` 支持其中的书目字段（不含 `userNote`、`aiSummary`、`citation`、`isFavorite`）。

- `authors` 是字符串数组；`authorDetails` 是对象数组，每项可含 `name`、`givenName`、`familyName`、`affiliation`、`orcid`。两者同时提供时以 `authorDetails` 为准。
- `orcid` 须符合 `0000-0000-0000-000X` 格式并通过 MOD 11-2 校验位，否则报错。
- `language` 为 BCP 47 标签（如 `en`、`zh-Hans`），无效时报错；传空串清除。`language` 表示文献语言，与翻译版 PDF 无关。
- `citationKey` 须匹配 `^[A-Za-z0-9_:\-.]+$`；传空串清除。允许重复。
- `authors`、`authorDetails`、`keywords`、`tags` 都是整体替换。

### 写入：笔记维护

| 工具 | 说明 | 主要参数 |
| :--- | :--- | :--- |
| `create_note` | 新建笔记 | `title`、`content`（至少一个非空；正文为 Markdown/纯文本）、`tags`（去掉 `#`，最多 30 个）、`paperId`（缺省为全局笔记）、`type`（`standalone`/`highlight`/`area`/`ai-chat`，默认 `standalone`）、`pageKind`、`folderId` |
| `update_note` | 局部更新（需版本） | `noteId`（必填）、`expectedUpdatedAt`＋ `title`/`content`/`tags`/`pageKind`/`folderId` 至少一项；`tags` 整体替换；`pageKind` 传空串清除，`folderId` 传空串移到未分类 |
| `delete_note` | 软删除，并移出全文索引 | `noteId`（必填）、`expectedUpdatedAt` |
| `create_note_folder` | 新建文件夹（可嵌套） | `name`（必填）、`parentId` |
| `rename_note_folder` | 重命名文件夹 | `folderId`、`name`（均必填）、`expectedUpdatedAt` |
| `delete_note_folder` | 删除文件夹及子文件夹，其中笔记移到未分类；返回受影响笔记 ID 与新版本 | `folderId`（必填）、`expectedUpdatedAt`、`expectedFolderVersions` |

`pageKind` 取值：`paper-card`、`concept`、`synthesis`、`qa`、`excerpt`、`index`、`log`、`overview`。

笔记版本：`get_note` 返回 `updatedAt`；`update_note`、`delete_note`、`rename_note_folder` 传 `expectedUpdatedAt`。`delete_note_folder` 需目标版本与 `expectedFolderVersions`（所有受影响父子文件夹的 `updatedAt` 快照），任一变化整批拒绝并返回 `NOTE_CONFLICT`。含锚点的笔记更新正文时，新 Markdown 必须保留每个 `paperquay://anchor/<id>` 链接，否则返回 `NOTE_ANCHOR_MISSING`。

笔记写入约定：

- 正文中的 `[[笔记标题]]` 在目标笔记已存在时解析为双链；`#标签` 合并进标签。
- 写入 `content` 时，共享 Markdown → Tiptap 解析器重建富文本 JSON，并清除 HTML 缓存。标题、列表、内联格式、代码块、引用块、表格、公式、双链和标签可以重建；只有已知锚点 ID 和唯一匹配本地文献的 `[n]` 引用恢复为专用节点，其余保留为普通文本。
- **不要用 MCP 覆盖含摘录卡锚点的笔记正文**：锚点块和原文快照无法从 Markdown 重建。覆盖后锚点引用会丢失，编辑器再次保存时还会清理对应锚点数据。含文献引用或表格的笔记，覆盖时须保留 `[n]` + 文末参考文献列表和表格语法。这类笔记建议在应用内编辑，或只用 MCP 改标题、标签、文件夹。
- 批量删除前先列出待删清单，由用户确认。

## 写入安全护栏

桌面应用与 MCP 可能同时持有同一份数据。应用内的详情表单或笔记编辑器仍有旧快照，外部写入也可能与用户尚未保存的编辑冲突。所有写入工具（含 Zotero 同步和笔记工具）遵循同一套规则：

1. 写入前先读桌面应用运行标记（开发模式同样写入）。
   标记不存在时再检测进程：Windows 用 `tasklist` 查 `PaperQuay.exe`，其他平台用 `pgrep -x PaperQuay`。
   检测会排除 MCP 自身进程和命令行含 `paperquay-mcp` 的进程。因此，用 `PaperQuay.exe` + `ELECTRON_RUN_AS_NODE=1` 启动 MCP 不会误判。
2. 默认检测到应用运行时拒绝写入，数据库不变，错误提示要求先关闭应用或改为受检并行写。
3. 运行标记损坏、不可读，或进程检测失败时，无法确认运行状态，同样拒绝写入。
4. 传 `allowWhileAppRunning: true` 表示**受检并行写**：应用在运行或状态未知时，写入必须携带读取到的版本（`expectedUpdatedAt`、`expectedCategoryVersions` 或删除预览的 `previewVersion`）。版本缺失或已变化会被拒绝，返回 `PAPER_CONFLICT` / `CATEGORY_CONFLICT` / `NOTE_CONFLICT` 与当前版本号，不会静默覆盖。
5. 文库写入使用目标记录写（单篇 UPSERT / 分类单行写），不再全表重写。写入提交后更新数据目录的外部写入标记。桌面应用收到标记后刷新列表，正在编辑的详情表单显示“外部更新”提示。
6. 环境变量 `PAPERQUAY_MCP_WRITE=off` 禁用全部写入工具，优先级高于 `allowWhileAppRunning`。
7. 存在待应用的备份恢复（`<数据目录的上级目录>/PaperQuay-restore/pending.json`）时，写入工具返回 `BACKUP_RESTORE_PENDING`，`allowWhileAppRunning` 不能覆盖，直到应用启动完成恢复。

写入冲突的处理顺序：读取最新版本 → 合并本地改动 → 用最新版本重试；删除必须先 `preview_delete_papers`、经用户确认，再按预览版本删除。

## 仓库 Skills

仓库 `skills/` 提供与 MCP 同步维护的作业规范：

- [`paperquay-knowledge-search`](../skills/paperquay-knowledge-search/SKILL.md)：只读证据检索
- [`paperquay-library-manage`](../skills/paperquay-library-manage/SKILL.md)：文库写入与分类管理
- [`paperquay-notes`](../skills/paperquay-notes/SKILL.md)：笔记维护
- [`paperquay-zotero-sync`](../skills/paperquay-zotero-sync/SKILL.md)：预检后选择性同步 Zotero

Skills 只规定操作顺序和安全边界，参数以 `tools/list` 和本文为准。

### 编写自定义 Skill

新建 `skills/<skill-name>/SKILL.md`，建议包含：

1. **frontmatter**：`name` 与 `description`。`description` 写清何时触发（典型提问、关键词）和何时不触发，并指向应改用的其他 Skill。
2. **工具与权限**：列出依赖的 MCP 工具，区分只读与写入；写入前先预检，并要求用户确认。
3. **作业步骤**：按步骤写清每一步调用哪个工具、关键参数和继续或停止的判断条件。
4. **输出约束**：引用须含标题、作者、年份和页码；检索为空、Embedding 降级或文件缺失时如何回答。

## 客户端配置

### 安装版（推荐）

安装包把服务放在 asar 之外：`resources/paperquay-mcp/server.cjs`，同目录 `node_modules/` 下有 `sqlite-vec` 和当前平台的 `sqlite-vec-<os>-<arch>`。缺少时启动会报 `Cannot find module 'sqlite-vec'`。不要执行 asar 内的文件。

用应用自带的 `PaperQuay.exe` 并设置 `ELECTRON_RUN_AS_NODE=1` 启动，不需要另装 Node.js。设置页“MCP 服务”会按当前安装路径生成 Proma、Claude、Codex 的配置片段，并带上 `--data-dir`，优先复制该片段。Proma 示例：

```json
{
  "servers": {
    "paperquay": {
      "type": "stdio",
      "command": "C:/Program Files/PaperQuay/PaperQuay.exe",
      "args": [
        "C:/Program Files/PaperQuay/resources/paperquay-mcp/server.cjs",
        "--data-dir",
        "C:/Users/<you>/AppData/Roaming/PaperQuay/PaperQuay"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" },
      "enabled": true
    }
  }
}
```

路径以设置页或实际安装目录为准。也可以用 Node.js 22.5 或更高版本直接执行同一个 `server.cjs`（服务依赖 `node:sqlite`）。

其他客户端的格式：

- **Claude Code / Claude Desktop**（Desktop 为 `claude_desktop_config.json`）、**Pi**（`~/.pi/agent/mcp.json` 或项目 `.mcp.json`）：`{"mcpServers": {"paperquay": {"command": ..., "args": [...], "env": {...}}}}`
- **Codex**（`~/.codex/config.toml` 或项目 `.codex/config.toml`）：

```toml
[mcp_servers.paperquay]
command = "C:/Program Files/PaperQuay/PaperQuay.exe"
args = [
  "C:/Program Files/PaperQuay/resources/paperquay-mcp/server.cjs",
  "--data-dir",
  "C:/Users/<you>/AppData/Roaming/PaperQuay/PaperQuay",
]
env = { ELECTRON_RUN_AS_NODE = "1" }
```

### 开发模式

从源码运行时入口是 `bin/paperquay-mcp.cjs`，用系统 Node.js（22.5 或更高）启动，也可以执行 `npm run mcp`。配置格式同上，把 `command` 改为 `node`、`args` 第一项改为 `<仓库路径>/bin/paperquay-mcp.cjs`，并去掉 `env`。开发模式下设置页生成的片段也是这种形式。

## 数据目录

未指定时，服务按顺序探测下列目录，选第一个含 `paperquay-library.sqlite` 或 `paperquay-rag.sqlite` 的：

- Windows：`%APPDATA%/PaperQuay/PaperQuay`、`%APPDATA%/paperquay/PaperQuay`、`%APPDATA%/PaperQuay`、`%APPDATA%/paperquay`
- 源码在 macOS / Linux 运行时：`~/Library/Application Support/PaperQuay[/PaperQuay]`、`~/.config/PaperQuay[/PaperQuay]`

指定其他目录（如测试用的一次性目录）：

```bash
node bin/paperquay-mcp.cjs --data-dir="D:/MyPaperQuayData"
# 或
export PAPERQUAY_DATA_DIR="D:/MyPaperQuayData"
```

## 检索模式

`search_knowledge_base` 和 `search_notes` 都支持 `mode`：

| 模式 | 行为 |
| :--- | :--- |
| `auto`（默认） | 有可用 Embedding 配置时走混合检索，否则静默使用关键词检索 |
| `hybrid` | 强制尝试混合检索；不可用时降级为关键词检索，并返回 `warning` |
| `keyword` | 只用关键词检索，不发起网络请求 |

- 混合检索把查询向量化，在 `sqlite-vec` 索引上做 KNN 召回（传 `paperId` 时限定单篇），再与 FTS5 结果经 RRF 融合。`retrievalMode` 标明实际生效的方式（`hybrid`/`keyword`），每条结果的 `channels` 标明命中通道（`vector`/`fts`/`like`）。
- 关键词检索在分词失败、短词或特殊字符时回退到 LIKE 模糊匹配。
- 笔记向量只覆盖标题和可编辑正文，不含锚点证据和原文快照。向量由应用在保存、导入、vault 回导后生成；已有笔记可在笔记工具栏手动重建。`search_notes` 空查询按笔记排序返回。

**配置与隐私**：服务读取 `<数据目录>/.settings/paperquay.config.json` 中的 `settings.embeddingBaseUrl`、`embeddingModel`、`embeddingDimensions` 和 `secrets.embeddingApiKey`，应用内改配置后下一次调用即生效。混合检索会把查询文本发送到该 Embedding 端点。设 `PAPERQUAY_MCP_EMBEDDING=off` 可禁用这类请求，强制关键词检索。

## 使用示例

> “在 PaperQuay 知识库里查 Transformer 多头注意力的解释，给出文献和页码。”

Agent 调用 `search_knowledge_base({ query: "multi-head attention" })`，根据返回的 `paperTitle`、`pageNumber`、`snippet` 作答，并给出如“根据《Attention Is All You Need》第 2 页……”的引用。
