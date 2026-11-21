# PaperQuay v{{VERSION}}

## What's New

- The translated-PDF menu in paper details and the empty translated-PDF pane in the reader now provide "Generate with RetainPDF". PaperQuay calls the locally installed RetainPDF desktop app to translate the complete PDF, then downloads and attaches the translated PDF automatically.
- PaperQuay discovers the live RetainPDF port from `runtime-ports.json`, starts RetainPDF when needed, and reuses RetainPDF's own OCR provider, Paddle/MinerU token, translation model, endpoint, and API key. PaperQuay does not persist those credentials.
- Translation progress appears in the global task bar. The library and any open reader refresh when the attachment is ready. Job state is persisted in `.retainpdf-jobs.json`, so polling or attachment resumes after an app restart.

## Notes

- Windows only. RetainPDF must be installed and configured with a working OCR token and translation model.
- RetainPDF currently translates into Simplified Chinese, so the attached PDF language is recorded as `zh-CN`.
- One RetainPDF translation job is allowed per paper. A cancel command exists, but the paper menu has no cancel entry yet. No new MCP tool was added in this release.

## Verification

- `npm run build` passed, and `npm test` ran 808 tests with 807 passing, 1 optional benchmark skipped, and 0 failed. Build and tests used a repository-local temporary directory to avoid the local `%TEMP%` lock.
- Added 5 tests covering Paddle/MinerU config mapping, missing-credential messages, job stage/failure extraction, loopback-only API bases, and a complete upload -> create job -> poll -> download -> attach flow against a local stub server.
- The installed RetainPDF was verified through its executable path, `41000` health check, and current Paddle / translation-model configuration. No real full-document translation was run to avoid consuming quota. Per-page click-through of the installed PaperQuay build was not performed before release.

## Windows Release

Only Windows x64 installers are published and maintained. Download the `.exe` from Assets; `stable.yml` and `.blockmap` support in-app updates. Other platforms can be built from source.

---

## 新增内容

- 文献详情「译版 PDF」菜单和阅读器未附加译版的空状态新增「用 RetainPDF 生成译版」。PaperQuay 调用本机已安装的 RetainPDF 桌面端完成整本 PDF 翻译，随后自动下载并附加译版 PDF。
- PaperQuay 从 `runtime-ports.json` 发现 RetainPDF 实际端口，未运行时自动启动，并复用 RetainPDF 自己的 OCR Provider、Paddle/MinerU Token、翻译模型、接口地址与 API Key；这些凭据不会由 PaperQuay 落盘保存。
- 翻译进度显示在全局任务条。附加完成后文献库和已打开阅读器即时刷新；任务状态持久化到 `.retainpdf-jobs.json`，应用重启后会继续轮询或续做附加。

## 说明

- 仅支持 Windows。需要本机安装 RetainPDF，并配置可用的 OCR Token 与翻译模型。
- RetainPDF 当前输出简体中文，自动附加的附件语言记为 `zh-CN`。
- 同一文献同时只允许一个 RetainPDF 翻译任务。取消命令已提供，但菜单暂未增加取消入口；本版本未新增 MCP 工具。

## 验证

- `npm run build` 通过；`npm test` 808 项中 807 通过、1 项可选基准跳过、0 失败。构建与测试使用仓库内临时目录，规避本机 `%TEMP%` 锁。
- 新增 5 项测试：Paddle / MinerU 配置映射、缺失凭据提示、任务阶段与失败信息提取、loopback 地址限制，以及本地桩服务下的上传、建任务、轮询、下载、自动附加完整链路。
- 已验证本机 RetainPDF 的可执行文件路径、`41000` 健康检查与当前 Paddle / 翻译模型配置可用。未执行真实整本翻译以避免消耗额度；发布前未执行安装版逐页界面点击验收。

## Windows 发布范围

仅发布和维护 Windows x64 安装包。请从 Assets 下载 `.exe`；`stable.yml` 和 `.blockmap` 用于应用内更新。其他平台可自行从源码构建。
