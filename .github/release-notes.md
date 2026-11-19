# PaperQuay v{{VERSION}}

## Fixes

- Batch MinerU parsing that reuses an existing cache no longer triggers a whole-library RAG re-embedding when the extractor signature changes (`mineru-chunks-v2`). The batch scan skips old-signature indexes; rebuilding stays on demand when a paper is opened, when reader Q&A lazily builds an index, or when the user runs a manual rebuild.
- Prevents an automatic/batch parse scan from queueing every paper for indexing at once, reducing unnecessary embedding calls and task-list noise.

## Note

- Old-signature indexes remain readable. This is a one-time signature change from the table-extraction upgrade, not a parse re-run.
- Indexing tasks already started by an older build stop when the app closes and do not resume after restart.

## Verification

- Production build passed; 793 tests ran with 792 passing, 1 optional benchmark skipped, 0 failed.
- Added a focused test: an automatic batch index call with a ready but older signature returns skipped and never calls `rag_index_document`.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 修复内容

- 批量 MinerU 解析复用已有缓存时，不再因抽取器签名升级（`mineru-chunks-v2`）对整库触发 RAG 重嵌入。批量扫描会跳过旧签名索引，重建留给打开文献、问答懒建或手动重建。
- 避免自动/批量解析一次扫描把全部文献同时排入索引队列，减少无谓的 embedding 调用和任务列表噪声。

## 说明

- 旧索引仍可读取。这是表格抽取升级带来的一次性索引签名变化，不是重新解析。
- 旧版本已经启动的索引任务会在关闭应用后停止，重启后不会续跑。

## 验证

- 生产构建通过；793 项测试中 792 通过、1 项可选基准跳过、0 失败。
- 新增定向测试：自动批处理遇到 ready 但签名不同的旧索引时返回 skipped，且不调用 `rag_index_document`。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
