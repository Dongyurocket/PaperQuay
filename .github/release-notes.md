# PaperQuay v{{VERSION}}

## Fixes

- Full-document translation no longer reports "translation cache could not be written, the result is only available in the current window" and marks the task as failed when the translations were already generated.
- Translation cache writes no longer consult the library database for path validation. App-data and approved cache directories are trusted directly, so a busy library database (MCP writes, backup, import) cannot block cache persistence.
- Transient `EPERM` / `EBUSY` / `EACCES` cache write failures are retried, clear a read-only target, and fall back to a direct overwrite. If the configured cache directory is unavailable and the cache is incomplete, the default cache directory is used.
- After a failed write, the existing cache is read back. If it already contains every translation, the write is treated as successful instead of failing the task or duplicating the cache. Reads compare the primary and fallback caches and keep the more complete one.
- A later successful progress or final write clears earlier cache-write errors, so a transient failure no longer leaves the task marked as failed after the result has been saved.

## Note

- Only cache persistence and task status changed. Translation models, prompts, and existing translated content are unchanged; the normal translation and cache-read paths behave as before.

## Verification

- `npx tsc --noEmit` and `npm run build` passed; 803 tests ran with 802 passing, 1 optional benchmark skipped, 0 failed.
- Added focused tests: cache directories remain writable when the library database is unavailable, read-only targets recover, an unavailable primary root falls back to the default root, a complete existing cache is treated as saved when a rewrite fails, and reads keep the more complete cache.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 修复内容

- 修复全文翻译完成后偶发「译文缓存写入失败，本次结果仅保留在当前窗口」并把任务误判为失败的问题。
- 译文缓存写入不再为校验路径读取文库数据库：应用数据目录和已批准缓存目录直接放行，MCP 写入、备份或导入占用文库时也不会阻塞译文缓存落盘。
- 缓存写入遇到 `EPERM` / `EBUSY` / `EACCES` 等瞬时错误时自动重试、清除只读属性，并退化为直接覆盖；配置的缓存目录不可用且缓存不完整时，改用默认缓存目录。
- 写入失败后读回现有缓存；如果已经包含本次全部译文，按成功处理，不重复重写、不再复制一份到备用目录。读取时比较主缓存与备用缓存，保留更完整的一份。
- 进度写入或最终写入成功后清空之前的缓存错误，避免瞬时失败在结果已经保存后仍把任务标成失败。

## 说明

- 只影响译文缓存的持久化与任务状态，不改变翻译模型、提示词或已有译文内容；正常的翻译与缓存读取路径保持不变。

## 验证

- `npx tsc --noEmit`、`npm run build` 通过；803 项测试中 802 通过、1 项可选基准跳过、0 失败。
- 新增定向测试：文库数据库不可用时缓存目录仍可写入、只读文件可恢复写入、主目录不可用回退默认目录、已有完整缓存时重写失败按成功处理、读取时保留更完整的缓存。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
