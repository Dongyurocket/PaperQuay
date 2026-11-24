# PaperQuay v{{VERSION}}

This release closes the code, architecture and UI audit that started on 2026-11-22 (batches 1–12) plus the batch-12R release blockers. It also includes the 0.4.37 reader-QA formula retrieval work.

## What's Fixed

- **Data and startup**: metadata writes now use UPSERT consistently, cascade deletes stay on the relation tables, and the import/delete/backup paths that could lose data are fixed. MinerU caches and custom translated-PDF directories require a fresh directory-picker authorization after upgrading.
- **Directory authorization (B1)**: `select_directory` and `prepare_mineru_cache_dir` authorize only the selected directory, never its parent, so picking `D:/cache` no longer exposes all of `D:/`. `translatedPdfDir` authorization status now matches the real read/write policy; a previous MinerU directory that is unauthorized or rejected by the OS (EPERM/EACCES) only skips migration with a warning; write-mode status probes write permission; attaching a translated PDF checks the target directory; unauthorized status queries no longer return a realpath; non-existent intermediate directories are resolved through the nearest existing ancestor so a junction cannot escape the write root.
- **Notes and vault (E5)**: Markdown export detects and removes an existing `参考文献`/`References` heading and its adjacent list before appending the canonical bibliography, so export → import → export no longer duplicates or grows the list; a handwritten list is kept when the note has no inline references. Fence tracking follows CommonMark length/info-string rules and handles list-item code blocks, nested fences, a following separate list and multi-line continuation without deleting or swallowing content; a heading followed by prose keeps that prose and does not append a second list. Distilled excerpt cards now write `💭 My thoughts:` and the `Excerpt card` tag in English, while append still recognizes both languages. Multi-line system-page operation summaries are no longer truncated.
- **Graph and accessibility (E4/E1)**: graph labels use two opaque 6-digit hex colors (`#1f2937` light, `#e5e7eb` dark, ≥14:1 on the canvas) instead of passing the dark `rgba()` token to Cytoscape. The MCP configuration textarea and the note editor have localized `aria-label`s; the editor declares a `textbox` role, and the select-all button's visible text is part of its accessible name.
- **axe acceptance**: the report now keeps each incomplete item's target/html/node details and scans the notes editor/list plus the backup, MCP and update settings pages. 16 view/theme combinations report 0 violations, 0 serious/critical violations and 0 `label-content-name-mismatch`; the report and 16 screenshots were regenerated with full drive paths (not just usernames) replaced by a placeholder.
- **RetainPDF (A6)**: the paper-details panel remounts on `key={paper.id}`, ignores stale results from the previous paper, recognizes removed or replaced translated attachments, relying on the TaskCenter native-paper-updated event to refresh the library after attaching, and the reader entry now shares the concurrency-deduped start function. An in-flight status snapshot can no longer overwrite an attached event that arrived while it was loading.
- **Engineering and release (F4/F2)**: the release workflow runs ESLint before typecheck; the typecheck backlog total is corrected to 250; NSIS residual-process detection compares the executable's directory with `$INSTDIR` instead of a prefix (so `PaperQuay Beta` is not matched); installer smoke reports now include installer/app.asar SHA-256 hashes and redact local paths and the test password.
- **Performance (S1)**: remeasured against pre-audit `1283d82` with alternating baseline/current runs, recording `--no-sandbox --disable-gpu --disable-crash-reporter --disable-breakpad`, dist/preload hashes, endpoint definitions and sample variance. Medians: cold start 577 → 518 ms (100 ms poll resolution; the 59 ms delta is directional), window visible 259.6 → 194.8 ms, first library row present (renderer clock) 265.8 → 186.8 ms. First Notes/Graph opens are 100/60 ms versus 19/26 ms before because workspaces are now lazy-loaded instead of mounted at startup; see the batch-12R change record for the full table and variance.

## Known Limitations

- **Unsigned Windows build (D1-13)**: code signing/notarization and the release pipeline were not verified on this machine. The Windows installer is unsigned. `--no-sandbox` was used for local acceptance because Chromium's OS sandbox crashes before `app ready` in this host; the renderer is still restricted by `webPreferences.sandbox`. Rejecting a tampered `app.asar` was not exercised.
- **Registered install / backup import (F2)**: the NSIS registered install and uninstall were not run because this machine already has a PaperQuay install with the same appId and its MCP process holds files. The extracted payload smoke covers startup/preload, PDF import, opening papers, a Chinese CID PDF, notes, vault sync, RetainPDF status, backup export, unauthorized-package rejection and MCP `read_paper_figure`. Backup restore through the native dialog is not verified.
- **S1 measurement scope**: numbers are single-machine medians of 3+3 alternating runs. They compare the audit result with pre-audit `1283d82`, not the theoretical S1-only delta; the "cold" endpoint is process spawn → first library row (window-visible is a separate main-process marker). Electron fps and installed-build first paint were not measured.
- **axe boundary**: axe cannot determine contrast over the PDF canvas text layer, canvas graphics or animation mid-frames. Those incomplete items are kept with full target/html details in the report and are not counted as violations. The select-all checkbox glyph remains an incomplete color-contrast item because its background is composited from translucent layers.
- **Notes first open**: the measured change versus baseline is recorded as-is; it was not optimized further.
- **Platforms**: only Windows x64 is built and tested. macOS/Linux packaging and Windows arm64 remain unverified.

## Verification

- `npm run typecheck`: six tsc projects, 0 diagnostics.
- `npm test`: full suite, 0 failures.
- Clean checkout from staged tree `f92fc7f` (`git -c core.autocrlf=false archive`): `npm ci`, typecheck, lint, build and tests passed with 1,489 tests (1,480 passed, 9 skipped, 0 failed).
- `npm run lint`: 0 errors / 206 warnings (`--max-warnings 206`).
- `npm run build` and `npm run mcp:bundle`: passed.
- `PAPERQUAY_AXE=1 node --test tests/axeAudit.test.mjs`: 16 views/themes, 0 violations.
- `node tests/support/perfAudit.mjs --baseline-ref 1283d82`: 3+3 alternating runs; table and variance in the change record.
- NSIS 0.4.39 build plus afterPack/fuse/ELECTRONASAR assertions passed; payload smoke results are in `docs/assets/audit-2026-11-24/installer-smoke/`.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 修复内容

本版本收口 2026-11-22 开始的代码、架构与 UI 专项审计（第 1–12 批）及第 12R 批发布阻塞项，并包含 0.4.37 的阅读器问答公式检索改动。

- **数据与启动**：文献元数据统一 UPSERT，关联表保留级联删除，修复导入/删除/备份恢复中的丢数据路径；MinerU 缓存与自定义译版目录升级后需要重新通过目录对话框授权。
- **目录授权（B1）**：`select_directory` 与 `prepare_mineru_cache_dir` 只授权所选目录自身，不再放行父目录；选 `D:/cache` 不会让整个 `D:/` 可读。`translatedPdfDir` 的授权状态与真实读写策略一致；旧 MinerU 目录不可读时只跳过迁移并提示，不再让整次选择失败；未授权路径的状态查询不返回 realpath。
- **笔记与 Vault（E5）**：Markdown 导出先识别并剔除已有的 `参考文献`/`References` 标题及其紧邻列表，再追加规范列表，回导再导出不再重复或增长；无内联引用时保留手写列表。提炼摘录卡在英文界面写 `💭 My thoughts:` 与 `Excerpt card` 标签，追加时中英标题都能识别；系统页多行操作摘要不再截断。
- **图谱与可访问性（E4/E1）**：图谱标签改用浅/深两套不透明 6 位 hex（`#1f2937`/`#e5e7eb`，对画布 ≥14:1），不再把深色 `rgba()` 传给 Cytoscape。MCP 配置 textarea 与笔记编辑器补充本地化 `aria-label`，编辑器声明 `textbox` 角色；文献全选按钮的可见文字进入可访问名称。
- **axe 验收**：报告保留 incomplete 的 target/html/nodes，扫描扩展到笔记编辑器/列表与设置备份/MCP/更新页。16 个视图/主题 0 violations、0 serious/critical violations、0 `label-content-name-mismatch`，报告与 16 张截图重新生成。
- **RetainPDF（A6）**：详情面板以 `key={paper.id}` 重挂载，切换文献不串台；识别已移除/替换的译版附件；附加完成后由 TaskCenter 的 native-paper-updated 事件刷新文库；阅读器入口共用并发去重的启动函数。
- **工程与发布（F4/F2）**：发布流水线在 typecheck 前执行 ESLint；typecheck 待清理清单复算为 250；NSIS 残留进程检测按 `$INSTDIR` 目录边界匹配，避免误杀 `PaperQuay Beta` 等同前缀目录；安装包冒烟报告记录 installer/app.asar 的 SHA-256 并脱敏本机路径与测试口令。
- **性能（S1）**：以审计前 `1283d82` 为基线交替测量 3+3 次，记录 `--no-sandbox --disable-gpu`、dist/preload 哈希、端点定义与样本方差；数据见第 12R 批变更记录。

## 已知限制

- **Windows 未签名（D1-13）**：本机未验证代码签名/公证与发布流水线，安装包未签名。本机 Chromium OS 沙箱在 app ready 前崩溃，验收统一使用 `--no-sandbox`；渲染器仍由 `webPreferences.sandbox` 限制。未验证篡改 `app.asar` 后的拒绝加载。
- **注册式安装/备份导入（F2）**：本机已有同 appId 安装且其 MCP 进程占用文件，未执行 NSIS 注册式安装/卸载。安装包 payload 冒烟覆盖启动/preload、导入 PDF、打开论文、中文 CID PDF、笔记、Vault、RetainPDF 状态、备份导出、未授权包拒绝与 MCP `read_paper_figure`；原生对话框备份导入未验证。
- **S1 口径**：单机 3+3 次交替测量，中位数与方差见变更记录；对比对象是审计前 `1283d82`，不是理论上的“仅 S1”差值；冷启动端点止于 Library 首行，窗口可见是独立的主进程埋点。未测 Electron 实际 fps 与安装版首屏。
- **axe 边界**：PDF canvas 文本层、canvas 图形与动画中间态无法由 axe 给出确定结论；这些 incomplete 保留完整 target/html，按未决项记录，不计作 violation。文献全选按钮的图形对比度同样保留为 incomplete。
- **Notes 首次打开**：与基线的变化按实测记录，未进一步优化。
- **平台**：仅构建和测试 Windows x64；macOS/Linux 打包与 Windows arm64 未验证。

## 验证

- `npm run typecheck`：六个 tsc 项目 0 诊断。
- `npm test`：全量 0 失败。
- `npm run lint`：0 error / 206 warning（`--max-warnings 206`）。
- `npm run build`、`npm run mcp:bundle` 通过。
- `PAPERQUAY_AXE=1 node --test tests/axeAudit.test.mjs`：16 个视图/主题 0 violations。
- `node tests/support/perfAudit.mjs --baseline-ref 1283d82`：3+3 次交替测量，数据与方差见变更记录。
- NSIS 0.4.39 构建及 afterPack/fuse/ELECTRONASAR 断言通过；payload 冒烟结果见 `docs/assets/audit-2026-11-24/installer-smoke/`。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
