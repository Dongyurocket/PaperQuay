# 2026-11-23 - 审计 4A-2 小批：退出排空、关系原子写与图谱资产边界（D1-10、D2-10、D3-8）

关联计划：[2026-11-23 审计剩余工作清单](../plans/2026-11-23-audit-remaining.md) 第 4 批的三项后端耐久性 / 边界问题。
本批只处理这三项，不改 schema、不重构其他模块。

## 现象

- **D1-10**：退出时 `noteIndexer.close()` 直接 `pending.clear()`；`before-quit` 同步关库后只留 3 秒 `app.exit(0)` 兜底。窗口关闭前刚保存的笔记（以及批量重建索引）可能还没写入 RAG 索引就被丢弃。
- **D2-10**：知识图谱自定义关系用 `writeJsonSync` 直接覆盖目标文件；写入中途崩溃或并发写会让文件截断。下一次读取 `JSON.parse` 失败后被当成空库返回，随后任一关系的创建 / 修改 / 删除都会把剩余关系永久覆盖。
- **D3-8**：`read_paper_figure` 直接信任 MinerU `content_list` 中的资产路径。绝对路径、UNC、`..` 穿越或指向缓存目录外的路径都会被当作图片读取并返回 base64，形成越界读取。

## 根因

- 退出流程把「停止接收新任务」与「丢弃未处理任务」合并为一个同步 `close()`；没有可等待的排空接口，退出也没有延后到排空之后。
- JSON 写入没有临时文件 + `fsync` + `rename` 的原子替换；读取把「文件不存在」与「文件损坏」都当成空库。
- 资产路径只区分绝对 / 相对，没有把解析后的真实路径限制在承载该 `content_list` 的 MinerU 缓存目录内。

## 修改

### D1-10 退出等待笔记索引排空

- `electron/backend/noteEmbedding.cjs`
  - 新增 `accepting` 状态：`enqueue` 在排空开始后拒绝新任务，但已入队任务继续处理。
  - `drain()` 改为按队列长度循环，硬 `close()` 仍会清空队列。
  - 新增 `closeWhenIdle({ timeoutMs })`：停止接收新任务，等待当前 drain（含正在执行的任务）结束，返回 `{ drained, timedOut, pending }`；`pending` 计入正在执行、已出队的任务（`:125-149`）。
- `electron/backend.cjs`
  - `close` 改为幂等；新增 `shutdown({ timeoutMs = 2500 })`：先 `noteIndexer.closeWhenIdle`，再关闭 note / RAG / library store，返回排空结果（`:225-238`）。
- `electron/main.cjs`
  - `before-quit` 改为 `event.preventDefault()` 后异步执行：关闭外部写入 watcher，等待 `backend.shutdown({ timeoutMs: 2500 })`，随后移除运行标记、释放恢复锁并 `app.exit(0)`；保留 3 秒强制退出兜底，重复退出请求不会打断正在进行的排空（`:430-476`）。运行标记保留到 store 关闭之后，MCP 写入在排空期间仍被拒绝。

### D2-10 关系库原子写与损坏保护

- `electron/backend/utils.cjs`
  - `writeJsonSync` 改为：同目录临时文件（`wx`、0600）+ `fs.writeFileSync` + `fsyncSync` + `renameSync` 原子替换；失败时关闭句柄并删除临时文件（`:96-119`）。
  - 新增 `renameSyncWithRetry`：Windows 上目标被读取方 / 杀软短暂持有时 `MoveFileEx` 返回 `EPERM`/`EBUSY`/`EACCES`，做有界重试（20 次 × 15ms），避免退化为非原子覆盖（`:79-93`）。
- `electron/backend/knowledgeGraphCommands.cjs`
  - `readRelationStore` 只把 `ENOENT` 当空库；其他读取错误返回 `GRAPH_RELATION_STORE_UNREADABLE`。
  - `JSON.parse` 失败时把原文件复制为 `<file>.corrupt.json`（已存在则不覆盖，保留首次证据），抛出带 `code: 'GRAPH_RELATION_STORE_CORRUPT'` 与 `backupPath` 的错误；不再静默当空，也不会在后续写入中覆盖损坏文件（`:100-163`）。

### D3-8 read_paper_figure 资产路径包含校验

- `electron/mcp/knowledgeMcpService.cjs`
  - 新增 `resolveMineruFigureAsset(cacheDir, assetPath)`（`:350-394`）：
    - 字符串层拒绝空值、NUL、绝对路径（含 Windows / POSIX）、盘符、UNC / 根相对路径、`.`/`..` 段与含 `:` 的段（ADS）。
    - 对 `cacheDir` 与 `path.resolve(cacheDir, assetPath)` 取 `realpath`，再用 `path.relative` 校验真实路径必须位于当前缓存目录内；符号链接指向目录外同样被拒。
    - 区分 `missing`（文件不存在，沿用原提示）与 `invalid`（越界 / 非法路径）。
  - `readPaperFigure` 只读取校验通过的 `realpath`，不再信任 content list 的绝对路径（`:2402`）。

## 验证

- 新增 / 更新用例：
  - `tests/noteSemanticSearch.test.ts`：`closeWhenIdle` 在任务执行中会等待、完成后 `{drained:true}`、排空开始后新编辑不再入队；任务卡住时按 30ms 超时返回 `{timedOut:true,pending>=1}`。
  - `tests/knowledgeGraphCommands.test.mjs`：损坏文件读取抛出 `GRAPH_RELATION_STORE_CORRUPT`、生成 `.corrupt.json` 且原文件与备份均不被改写、重复读取不叠加备份、写入被拒；`rename` 失败时旧文件保持不变且无 `.tmp` 残留；两个子进程并发写入时父进程持续读取，未观察到截断 JSON，结束后无临时文件。
  - `tests/knowledgeMcp.test.ts`：绝对路径（缓存内外）、UNC、`..`、POSIX 穿越、盘符路径与 ADS 均 `imageAvailable:false`；合法相对路径仍返回原始 base64。
- 命令与结果（2026-11-23，本机）：
  - `npm run typecheck`：四个项目 0 诊断。
  - `npm test`：943 项，942 通过、1 跳过、0 失败。
  - `npm run build`：通过（仅既有 `INEFFECTIVE_DYNAMIC_IMPORT` 警告）。
  - 未跟踪的 `tests/knowledgeMcpFigure.test.ts` 三项用例继续通过，未修改该文件。

## 剩余风险

- D1-10 只等待笔记索引队列；`ragStore.close()` 仍是异步且不等待，worker 卡在同步 SQLite 调用时只能由 3 秒兜底强制退出。该行为与修改前一致，未在本批扩大范围。
- `closeWhenIdle` 的超时只停止等待，不取消正在进行的 embedding 请求；退出时该请求随进程结束而中断，对应的索引状态保持旧值，下次启动会重新入队。
- D2-10 的并发一致性仍是「后写者覆盖前写者」：原子写消除了文件损坏，但没有跨进程锁或版本比较；两个进程同时修改不同关系时仍可能丢一条更新（D3-11 范围）。
- `.corrupt.json` 备份不会自动清理，也不会自动从备份恢复；需要用户或后续工具人工处理。
- D3-8 的包含基准是「承载匹配 `content_list` 的缓存目录」，不是整个 MinerU 根目录；跨目录的共享资产会被拒绝。当前 MinerU 输出把 `images/` 放在同一缓存目录内，符合预期。
