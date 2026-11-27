# 统一有效块文本（C 方案）：把 AI 重解析结果接入摘要、RAG、摘录与导出

- 日期：2026-11-27
- 状态：**部分实施（0.4.45）**。0.4.45 已用解析目录 sidecar JSON（`parse-edits/`）+ `MineruBlockBase.textOverride` 覆盖正文、翻译、摘要、问答、文库预览与 RAG 索引；本文的 SQLite 跨进程存储、MCP 直读、笔记/导出统一仍待后续评估。以下正文保留 0.4.44 基线的分析。
- 代码基线：`main` `236e17a`（0.4.44）
- 关联：[重解析后译文同步](../changes/2026-11-27-reparse-translation-sync.md)、[长文档 RAG 与概览](2026-11-25-long-document-rag-and-overview.md)、[RAG 过期重建](2026-11-25-rag-badge-stale-rebuild-and-qa-silent-drop.md)、[阅读器重解析 OCR 状态](../changes/2026-09-17-reader-reparse-ocr-state.md)

## 0. 结论（先看这一页）

0.4.44 只解决了「重解析 → 翻译」这一条链路：覆盖文本提升为阅读器级唯一状态，译文缓存带块级源指纹。**其他所有文本消费者仍然读原始 MinerU 文本**——摘要、RAG 索引、文库页预览、整块加入笔记、复制、导出、MCP 检索结果都不包含修复内容。原因是覆盖值存在渲染进程的 `localStorage`，主进程、文库工作区和 RAG 索引都看不到它。

C 方案的目标不是「再给每个功能打一个补丁」，而是建立**一份跨进程可读的有效块文本层**：

1. **存储换成 SQLite**：新增 `block_overrides(document_key, parse_revision, block_id, markdown, ...)`，按现有 UPSERT 规则写入，随 `.pqbackup` 自动备份，主进程与 MCP 可读。
2. **在块上物化 `effectiveMarkdown`**：打开文档时按当前解析修订加载覆盖，只给被修复的块附加字段，不改写 MinerU JSON、`full.md` 或 bbox。
3. **两个底层函数统一收口**：`extractTextFromMineruBlock` 与 `toMarkdownFragment` 优先返回 `effectiveMarkdown`；摘要输入、RAG 分块、Markdown 文档、复制、笔记与本轮翻译都自动跟随。
4. **失效与重建复用现有机制**：内容签名变化触发概览缓存失效；RAG 走已有的暂存重建（`ensurePreparedSourceIndexed`）；旧解析修订的覆盖保留但不再生效。
5. **一次性迁移**：阅读器打开文献时把 0.4.44 的 `localStorage` 覆盖写入数据库并删除旧键；保留一个版本的只读回退。

预计 **5–7 人日**（P0 存储与迁移 1–1.5、P1 文本收口 1.5–2、P2 摘要/RAG 重建 1、P3 翻译收口与 MCP 0.5–1、测试与实机 1–1.5）。不做 MinerU JSON 改写，不做向量库替换，不自动重跑 AI。

**为什么不是继续用 localStorage / sidecar 文件**：

| 方案 | 主进程/MCP 可读 | 云解析与路径迁移 | 备份 | 事务与并发 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `localStorage`（现状） | 否 | 依赖 pdfSource 签名 | 否 | 单窗口 | 只适合阅读视图 |
| MinerU 目录 sidecar JSON | 是（需传路径） | `cloud:` 路径与备份导入重映射要额外处理 | 随缓存目录 | 需文件锁 | 备选，不作为主方案 |
| **SQLite 表（推荐）** | 是 | 按 `document_key`，与路径无关 | 现有 DB 快照 | UPSERT + 修订号 | 采用 |
| 直接改写 MinerU `content` | 是 | 破坏原始解析，无法审计回退 | 随缓存 | 高风险 | 不采用 |

## 1. 现状与问题定义

### 1.1 0.4.44 已覆盖的范围

- 覆盖存储：`src/services/blockReparseOverrides.ts`，键为 `documentSource + mineruPath + 完整 blocks` 的 SHA-256，值存 `localStorage`。
- 阅读器状态：`src/features/blocks/useBlockReparseOverrides.ts`，`BlockViewer` 与翻译共用。
- 翻译输入：`src/features/reader/translationSource.ts`，`resolveBlockTranslationText` 优先覆盖文本，译文缓存 v2 带 `sourceHashes`。

### 1.2 仍然读原始文本的链路（源码核对）

| 消费方 | 入口 | 实际文本来源 | 覆盖是否生效 |
| --- | --- | --- | --- |
| 阅读器正文 | `BlockViewer` → `buildRenderableBlocks` | `toMarkdownFragment(block, plainText)` | 是（单独的 `customOverrideMarkdown` 渲染分支） |
| 整块加入笔记 / 复制 | `BlockViewer` 的 `resolveContextMarkdown` | `renderable.markdown` | **否** |
| 概览输入 | `buildSummaryBlockInputs(blocks)`（`summarySource.ts:24`） | `extractTextFromMineruBlock` | **否** |
| 概览缓存 key | `computeMineruBlocksContentSignature(blocks)`（`documentReaderSummarySource.ts:36`） | 同上 | **否** |
| 概览正文（有 full.md 时） | `loadMineruMarkdownDocument`（`documentReaderSummarySource.ts:203`） | 缓存 `full.md` 原文 | **否** |
| 文库页概览 | `buildLibraryPreviewSummaryRequest`（`readerLibraryPreview.ts:341`） | `full.md` 或 `buildMineruMarkdownDocument(blocks)` | **否** |
| RAG 分块 | `buildMineruRagChunks(blocks)`（`readerRag.ts:291`） | `extractTextFromMineruBlock` | **否** |
| RAG 文档签名 | `prepareReaderRagDocument`（`readerRag.ts:498`） | `mineruDocumentText` + chunks | **否** |
| 文库自动索引 | `indexLibraryPaperMineruSource`（`libraryRagIndexing.ts:170`） | 同上 | **否** |
| 文库页翻译 | `useReaderLibraryActions` | `extractTranslatableMarkdownFromMineruBlock` | **否**（0.4.44 已知边界） |
| MCP `read_paper_content` | `knowledgeMcpService.cjs:1199` | RAG `rag_chunks.text` | 取决于索引是否重建 |
| MCP `read_paper_figure` | `knowledgeMcpService` 的图表读取 | MinerU 解析 JSON | **否** |

结论：只改 `BlockViewer` 或再复制一套「覆盖感知」函数，会继续制造第二条、第三条真相。必须把有效文本放到块层，并让文本抽取函数统一优先它。

### 1.3 典型用户场景

1. 某段被 OCR 成乱码，AI 重析修好后，**概览仍按乱码生成**，无法引用修复后的术语。
2. 修复了表格，**RAG 检索仍命中旧表格文字**，问答引用的还是错内容。
3. 修复后把整块加入笔记，**笔记里是修复前的文本**。
4. 文库页直接翻译这篇文献，**译文仍基于原始 OCR**；打开阅读器后才被 0.4.44 的失效逻辑纠正。
5. 外部 Agent 通过 MCP 读到的仍是旧索引内容。

## 2. 目标与非目标

### 2.1 目标

- 同一份「已确认的重解析结果」在阅读器、概览、RAG、文库页、笔记/复制、导出与 MCP 中保持一致。
- 存储跨进程可读、可备份、可按解析修订失效；写入符合项目 UPSERT 红线。
- 失效可解释：解析变化后明确提示「修复基于旧解析，已失效」，不静默套用。
- 不为已经修复的块重复消耗 embedding / 概览 token；重建走现有暂存与缓存机制。

### 2.2 非目标

- 不改写 MinerU JSON、`full.md`、图片资产或 PDF 标注。
- 不做跨设备同步（只随 `.pqbackup` 备份/恢复）。
- 不做重解析后的自动文本重映射（blockId 漂移另案；修订不匹配即失效）。
- 不把覆盖文本写进向量库之外的外部服务，不上传任何用户内容。
- 不改变「AI 重析只由用户手动触发」的产品边界。

## 3. 数据模型与存储

### 3.1 表结构（新增，不改既有表）

```sql
CREATE TABLE IF NOT EXISTS block_overrides (
  document_key   TEXT    NOT NULL,
  parse_revision TEXT    NOT NULL,
  block_id       TEXT    NOT NULL,
  markdown       TEXT    NOT NULL,
  model          TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (document_key, parse_revision, block_id)
);

CREATE INDEX IF NOT EXISTS idx_block_overrides_document
  ON block_overrides (document_key, updated_at DESC);
```

- `document_key`：复用 `buildReaderRagDocumentKey(item)`（`readerRag.ts:258`）——native-library 用 `itemKey`，独立文献用 `workspaceId`，与 RAG 文档键一致。
- `parse_revision`：`sha256(JSON.stringify(blocks))` 的 hex。只依赖解析内容，不依赖绝对路径；同一内容在不同缓存位置得到同一修订。
- 写入必须 `INSERT ... ON CONFLICT(document_key, parse_revision, block_id) DO UPDATE SET markdown=excluded.markdown, model=excluded.model, updated_at=excluded.updated_at`，不允许 `INSERT OR REPLACE`。
- 恢复原始识别 = `DELETE` 单行，不做空串占位。
- 删除文献时在现有删除路径追加 `DELETE FROM block_overrides WHERE document_key = ?`；不做外键级联，避免与 `papers` 的软删除/独立文献语义耦合。

### 3.2 为什么不存 `source_text_hash`

修订号已经覆盖整份 blocks；块级原始文本变化必然改变修订号。`sourceHashes`（译文）解决的是「同一修订内块文本可变」的问题，而覆盖不会改变块原始文本，因此不需要再存一份块指纹。后续若要支持「修复跨解析复用」，再补 `source_block_hash` 做匹配。

### 3.3 迁移与兼容

1. 阅读器打开文档、blocks 就绪后计算旧键（与 0.4.44 相同的算法），读取 `localStorage` 覆盖。
2. 若数据库当前修订没有记录，逐块 UPSERT 迁移；迁移成功后 `removeItem` 旧键。
3. 若数据库已有记录，以数据库为准，不合并旧键（避免旧值覆盖新值）。
4. 发布后保留一个版本的只读回退：数据库查询为空时仍尝试旧 `localStorage` 键；下一版本移除。
5. 迁移失败不阻塞阅读：保留 localStorage，状态栏提示一次「修复记录暂未迁移」，下次打开重试。

### 3.4 IPC 接口

新增 `electron/backend/blockOverrideCommands.cjs`，按现有 `*Commands.cjs` 模式注册，并在 `electron/ipcAllowlist.cjs` 登记：

- `block_overrides_get`：`{ documentKey, parseRevision }` → `{ revision, overrides: [{ blockId, markdown, model, updatedAt }] }`
- `block_overrides_set`：`{ documentKey, parseRevision, blockId, markdown | null, model? }` → `{ updatedAt }`
- `block_overrides_list_revisions`：`{ documentKey }` → 修订列表与数量（用于「旧解析修复已失效」提示与清理）
- `block_overrides_clear_revision`：`{ documentKey, parseRevision }` → 删除数量

写入在主进程按 `document_key + parse_revision` 串行化（同翻译缓存写入队列的做法），避免多窗口读改写覆盖。单块 UPSERT 天然幂等，不需要整表重写。

## 4. 有效文本层

### 4.1 块字段

给 `PositionedMineruBlock` 增加可选字段（只存在于内存，不序列化回 MinerU）：

```ts
export interface PositionedMineruBlock {
  // ...existing
  /** 用户确认的 AI 重解析 Markdown；仅当前解析修订有效 */
  effectiveMarkdown?: string;
}
```

新增纯函数（建议 `src/services/blockOverrides.ts`）：

```ts
export function applyEffectiveBlockOverrides(
  blocks: PositionedMineruBlock[],
  overrides: Record<string, string>,
): PositionedMineruBlock[];
```

只在有覆盖时复制对应块，未覆盖的块保持原引用；不改变 `type`、`bbox`、`contentSourceBlockId`。

### 4.2 两个收口点

1. `extractTextFromMineruBlock(block)`（`mineru.ts:1147`）开头：
   ```ts
   if (block.effectiveMarkdown?.trim()) return block.effectiveMarkdown.trim();
   ```
   影响：概览输入、概览内容签名、RAG 分块文本、复制、笔记、后续导出。
2. `toMarkdownFragment(block, plainText)`（`mineru.ts:469`）开头：
   ```ts
   if (block.effectiveMarkdown?.trim()) return block.effectiveMarkdown.trim();
   ```
   影响：`buildRenderableBlocks` 的 `markdown`、`buildMineruMarkdownDocument`、`loadMineruMarkdownDocument` 的回退路径。

注意：

- 表格覆盖是 Markdown 表格，必须绕过 `**表格说明**` 前缀，因此收口点放在 `switch` 之前。
- 公式覆盖可能包含 `$$...$$`；`buildMineruRagChunks` 的 `wrapEquationMarkdown` 已做幂等判断，不会重复包裹。
- 列表覆盖来自 AI 的 Markdown 列表，`toMarkdownFragment` 不应再走 `renderListMarkdownContent`，否则会二次处理；收口点提前返回即可。

### 4.3 渲染

`buildRenderableBlocks` 把 `effectiveMarkdown` 放进 `RenderableMineruBlock`；`BlockItem` 的判断从「`customOverrideMarkdown` 存在」改为「`renderable.effectiveMarkdown` 存在」，统一用 `MarkdownContent` 渲染并显示「AI 已修复」徽标。现有 `customOverrideMarkdown` prop 与 `blockOverrides` 逐步删除，避免两套入口。

图片块沿用当前行为：覆盖存在时以 Markdown 替换整块显示（用户已确认的修复文本优先）。若后续希望保留图片、只替换图注，另开提案，不在本期改。

### 4.4 加载链路

新增共享加载器（阅读器、文库预览、RAG 自动索引共用）：

```ts
loadEffectiveBlocks({ item, blocks, mineruPath })
  → { blocks: PositionedMineruBlock[], revision, overrides }
```

- 计算 `parse_revision`（Web Crypto SHA-256）。
- 调 `block_overrides_get`。
- 迁移旧 localStorage（仅阅读器入口传 `migrateLegacy: true`）。
- `applyEffectiveBlockOverrides`。

阅读器在 `useReaderDocument` 的 blocks 就绪后加载；文库预览在 `loadReaderLibraryPreviewBlocks` 之后加载；RAG 自动索引在 `indexLibraryPaperMineruSource` 开头加载。三处都走同一个 helper，避免键算法漂移。

## 5. 各消费方改造

| 模块 | 改动 | 说明 |
| --- | --- | --- |
| `src/features/blocks/useBlockReparseOverrides.ts` | 改为数据库读写 + 旧键迁移 | 对外 API 形状不变，减少 UI 改动 |
| `src/services/mineru.ts` | `extractTextFromMineruBlock`、`toMarkdownFragment` 收口；`buildRenderableBlocks` 携带字段 | 核心改动 |
| `src/features/blocks/blockViewerContent.tsx` | 优先渲染 `effectiveMarkdown` | 删除 `customOverrideMarkdown` 专用分支 |
| `src/features/reader/useDocumentTranslation.ts` | 输入改用 `extractTranslatableMarkdownFromMineruBlock`（已自动含覆盖），删除单独的 `getOverrideMarkdown` 依赖 | 译文 `sourceHash` 逻辑不变 |
| `src/features/reader/documentReaderSummarySource.ts` | 有覆盖时优先 `buildMineruMarkdownDocument(effectiveBlocks)`，不再先读 `full.md` | 签名已随 `extractText...` 改变 |
| `src/features/reader/readerLibraryPreview.ts` | 同上；`buildLibraryPreviewSummaryRequest` 接收 effective blocks | 文库页概览/翻译一致 |
| `src/features/reader/readerRag.ts` | 无代码改动（走 extract 收口）；`prepareReaderRagDocument` 的 `sourceSignature` 自动变化 | 重建走暂存 |
| `src/features/reader/libraryRagIndexing.ts` | 入口加载 effective blocks；覆盖保存后触发同一索引函数 | 受 `ragAutoIndexAfterParse` / RAG 开关约束 |
| `src/features/reader/useReaderLibraryActions.ts` | 文库页翻译输入改用 effective blocks | 修复 0.4.44 已知边界 |
| `electron/mcp/knowledgeMcpService.cjs` | 无改动（读 RAG 库）；可选 P3 让 `read_paper_figure` 读覆盖 | RAG 重建后 `search/read_paper_content` 自动生效 |
| 笔记/复制/导出 | 无显式改动，跟随 `renderable.markdown` / `extractText...` | 需要有回归用例 |

### 5.1 概览缓存失效

`computeMineruBlocksContentSignature` 走 `extractTextFromMineruBlock`，覆盖生效后签名自然变化，`buildPaperSummarySourceKey` 随之变化：

- 旧概览不会被误用；
- 是否自动重新生成由 `autoGenerateSummary` 决定；未开启时显示「概览基于旧解析」并提供重新生成，不隐式消耗 token；
- `docs/changes/2026-09-17` 的「覆盖只影响本地阅读视图」边界在本方案中正式变更，需在变更记录中写明。

### 5.2 RAG 重建

`ensurePreparedSourceIndexed`（`src/services/localRag.ts:122`）已有「签名不一致 → 暂存重建、失败保留旧索引」的逻辑，C 方案直接复用：

- 覆盖保存后，如果 RAG 已启用且该文献已索引：重新构建 effective 文档与 chunks，调用 `ensurePreparedSourceIndexed`；签名不同会触发暂存重建。
- 自动重建受 `ragAutoIndexAfterParse`（或显式设置）约束；关闭时把状态标为「待更新」，不自动花 embedding 费用。
- 重建期间旧索引仍可检索；失败保留旧索引并记录 `rebuild_error`。
- `read_paper_content` 读 `rag_chunks`，重建完成后自动看到修复文本。

### 5.3 译文

0.4.44 已把覆盖文本接入翻译输入。C 方案落地后，`extractTranslatableMarkdownFromMineruBlock` 会因 `extractTextFromMineruBlock` 收口而自动拿到覆盖文本，可删除 `useDocumentTranslation` 中重复的 `getOverrideMarkdown` 透传；`sourceHash` 与 v2 缓存保持不变。这一步放在 P3，先保证两套逻辑并存时结果一致。

## 6. 分阶段实施

### P0 存储、迁移与加载（1–1.5 人日）

1. `libraryDatabaseStore.cjs` 建表与索引；删除文献时清理。
2. 新增 `blockOverrideCommands.cjs`，注册命令并在 `ipcAllowlist.cjs` 登记。
3. 新增 `src/services/blockOverrides.ts`（渲染层 API）与 `loadEffectiveBlocks`。
4. `useBlockReparseOverrides` 改为数据库读写；旧 localStorage 键一次性迁移与只读回退。
5. UI 增加「修复基于旧解析，已失效」提示（读取 `block_overrides_list_revisions`）。

验收：修复一块 → 重启 → 仍然生效；换一份解析 → 旧修复不生效且有提示；数据库无记录时旧 localStorage 仍能读。

### P1 文本收口（1.5–2 人日）

1. `mineru.ts` 两个收口点 + `buildRenderableBlocks` 字段。
2. `BlockItem` 优先渲染有效文本；删除旧覆盖分支。
3. 概览输入、复制、整块加入笔记跟随生效。
4. 单元测试覆盖 `extractTextFromMineruBlock` / `toMarkdownFragment` / `buildMineruMarkdownDocument` / `buildMineruRagChunks`。

验收：修复文本出现在概览输入、复制内容、笔记摘录和 RAG chunk 文本中；未修复块字节级不变。

### P2 摘要与 RAG 重建（1 人日）

1. `loadMineruMarkdownDocument` 与 `buildLibraryPreviewSummaryRequest` 在存在覆盖时优先 effective blocks。
2. 覆盖保存后触发 RAG 重建或标「待更新」；复用 `ensurePreparedSourceIndexed`。
3. 概览缓存 key 变化与重新生成提示。
4. 文库页翻译使用 effective blocks。

验收：修复包含独特术语的段落 → RAG 检索能命中该术语；旧术语在重建后不再命中；概览不再复述旧乱码；文库页翻译与阅读器一致。

### P3 翻译收口、MCP 与清理（0.5–1 人日）

1. `useDocumentTranslation` 删除重复的覆盖透传，统一走 `extractTranslatableMarkdownFromMineruBlock`。
2. 可选：`read_paper_figure` 对表格/图注返回覆盖文本。
3. 删除旧 `localStorage` 回退与 `customOverrideMarkdown` 分支；保留迁移记录一个版本后清理。
4. 更新 `docs/USER_MANUAL.zh-CN.md`、`docs/changes/`。

## 7. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 有效文本破坏块结构分类 | 表格/公式 chunk 类型错误 | 只替换文本，不改 `type`；`toMarkdownFragment` 提前返回；公式包裹幂等；表格走 Markdown 渲染回归 |
| RAG 重建产生 embedding 费用 | 用户成本 | 受 `ragAutoIndexAfterParse` 与 RAG 开关约束；默认标「待更新」；重建前可估算 |
| 概览缓存整体失效 | 重新生成成本 | 只对含覆盖的文献签名变化；未开启自动概览时提示而非自动生成 |
| 多窗口/多进程写入冲突 | 覆盖丢失 | 主进程按文档+修订串行化；单块 UPSERT；读取带 `updatedAt` 版本 |
| 解析重跑后 blockId 漂移 | 修复错位 | 修订号不匹配即不生效；保留旧修订供提示/清理，不自动映射 |
| 独立文献 `workspaceId` 不稳定 | 修复丢失 | 实施前验证 standalone 的 `workspaceId` 生成规则；若不稳，改用 `itemKey + PDF 内容哈希` 作为 `document_key` |
| 迁移覆盖新值 | 数据回退 | 数据库优先；仅当数据库无该修订记录时迁移 localStorage |
| 备份/导入丢表 | 修复丢失 | DB 快照已包含整库；导入后跑 schema 初始化；增加往返测试 |
| 用户未打开阅读器就自动索引 | 覆盖未迁移 | 自动索引前也尝试旧键迁移（只读），或明确「先打开一次」；P0 文档写明 |

## 8. 测试与验收

### 8.1 自动化

- `tests/blockOverrideStore.test.ts`：UPSERT、删除单行、按修订查询、删除文献清理、并发写。
- `tests/effectiveBlockText.test.ts`：`extractTextFromMineruBlock` / `toMarkdownFragment` / `buildMineruMarkdownDocument` / `buildMineruRagChunks` 对覆盖的优先级；未覆盖块不变。
- `tests/summarySourceSignature.test.ts`：覆盖改变签名；不同修订不复用旧概览。
- `tests/libraryRagIndexing.test.ts`：覆盖文本进入 chunks 与 `sourceSignature`；`skipIfSignatureMismatch` 行为不变。
- 现有 `readerTranslation*`、`reparseTranslationSync` 回归必须继续通过。
- 备份往返：导出包含 `block_overrides` 的 `.pqbackup`，导入后修复仍生效（隔离 profile）。

### 8.2 手工验收（安装版）

1. 翻译一篇 → 修复一块 → 复制整块到笔记，内容为修复文本。
2. 修复含独特术语的段落 → 重新建立 RAG → 搜索新术语命中、旧术语不命中。
3. 生成概览 → 概览使用修复文本；未开启自动概览时出现「基于旧解析」提示。
4. 文库页直接翻译该文献 → 译文使用修复文本。
5. 重启、重新打开、备份导入后修复仍在。
6. 重新解析同一文献 → 旧修复不生效，提示可清理；原 MinerU JSON 与 `full.md` 哈希未变。
7. MCP `read_paper_content` 返回重建后的修复文本。

### 8.3 性能与体量

- 覆盖行数等于用户实际修复的块数，通常 < 100 行/文献，KB 级。
- 加载只在文档打开时按 `document_key + revision` 查一次；渲染路径不做数据库访问。
- RAG 重建是唯一的重成本操作，必须复用暂存与失败回退。

## 9. 回滚

- 表是新增表，不改既有表结构；回滚代码后旧版本不会读取它，不影响启动。
- 若必须彻底回退：保留表与数据（可人工导出），只撤下读取逻辑；不执行 `DROP TABLE`。
- 迁移已删除的 localStorage 键无法自动恢复；回滚前先用数据库导出一份 JSON（提供一次性脚本），或保留旧键到下一版本再删。

## 10. 开放问题（实施前确认）

1. **standalone 的 `document_key` 稳定性**：`workspaceId` 是否在重命名/移动 PDF 后保持？若不稳定，改用 PDF 内容哈希。
2. **自动重建的默认值**：覆盖保存后默认「标待更新」还是「立即重建」？建议默认标待更新，只有用户点「更新索引」或开启自动索引时重建。
3. **图片块策略**：继续「覆盖文本替换整块」，还是保留图片、只替换图注？本期保持现状。
4. **旧修订保留数量**：每个文档保留最近 2 个修订还是全部？建议保留全部但提供「清理旧修订」。
5. **MCP 图表读取**：是否在 P3 让 `read_paper_figure` 读覆盖，取决于外部 Agent 对表格修复的使用频率。

## 11. 工作量估算

| 阶段 | 内容 | 人日 |
| --- | --- | --- |
| P0 | 表、IPC、迁移、加载与提示 | 1–1.5 |
| P1 | 文本收口与渲染 | 1.5–2 |
| P2 | 概览、RAG、文库页 | 1 |
| P3 | 翻译收口、MCP、清理、文档 | 0.5–1 |
| 验证 | 单测、备份往返、安装版验收 | 1–1.5 |
| 合计 | | **5–7**（乐观下界 4，实际可能 1.5×） |

## 12. 评审记录

- 2026-11-27 初稿：基于 0.4.44 代码基线核对 12 条文本消费链路；确定 SQLite 主方案、`effectiveMarkdown` 物化与两个抽取函数收口；将 RAG 重建绑定到现有 `ensurePreparedSourceIndexed` 暂存机制；列出 standalone 键稳定性与图片块策略为开放问题。
