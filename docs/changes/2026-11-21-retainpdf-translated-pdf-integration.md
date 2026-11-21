# 2026-11-21 - RetainPDF 一键生成并附加译版 PDF

版本：0.4.36

## 目标

在 PaperQuay 内直接调用本机安装的 RetainPDF 桌面端完成整本 PDF 翻译，翻译结束后自动下载译版 PDF，并走现有译版附件链路附加到对应文献。

## 实现

- 主进程新增 `electron/backend/retainPdfIntegration.cjs`：
  - 从 `%APPDATA%\retain-pdf-desktop\runtime-ports.json`（兼容 `RetainPDF` 目录）发现实际端口，并用 `/health` 校验；端口失效时回退 `41000`。
  - 未运行时自动启动 `%LOCALAPPDATA%\Programs\RetainPDF\RetainPDF.exe`，等待本地服务就绪。
  - 读取 RetainPDF 自己的 `desktop-config.json`，复用其中已配置的 OCR Provider、Paddle/MinerU Token、翻译模型、接口地址与 API Key。PaperQuay 不保存、不转发这些凭据到其他位置。
  - 通过 RetainPDF 本地 HTTP API 上传原始 PDF、创建 `book` 工作流任务、轮询 `stage_snapshot`、下载 `/pdf` 产物。
  - 下载完成后调用 `addTranslatedPdfAttachment`，将语言记为 `zh-CN`，并持久化任务状态到 `PaperQuay/.retainpdf-jobs.json`；应用重启后会继续轮询或续做附加。
- 新增 IPC 命令：`retainpdf_get_status`、`retainpdf_start_translation`、`retainpdf_cancel_translation`、`retainpdf_get_translation`。
- 文献详情「译版 PDF」菜单新增「用 RetainPDF 生成译版 / 重新生成译版」；阅读器未附加译版时的空状态也提供「用 RetainPDF 生成」。
- 全局任务条接入 RetainPDF 进度；成功后广播文献更新，文献库和已打开阅读器即时刷新。

## 使用条件

- 仅支持 Windows，需安装并配置 RetainPDF。RetainPDF 必须已设置可用的 OCR Token 与翻译模型。
- 当前 RetainPDF 输出目标为简体中文，因此自动附加的附件语言记为 `zh-CN`。
- 同一文献同时只允许一个 RetainPDF 翻译任务。

## 验证

- `npm run build` 通过。默认 `%TEMP%` 存在 esbuild 句柄锁，使用独立临时目录完成构建。
- `npm test` 通过：808 项，807 通过、1 跳过；同样使用独立临时目录规避本机 `%TEMP%` 写入权限问题。
- 新增 5 项测试：
  - Paddle / MinerU 配置映射与缺失凭据提示；
  - RetainPDF 任务阶段、进度与失败信息提取；
  - 仅允许 loopback API 地址；
  - 使用本地桩服务完整验证上传、创建任务、轮询、下载和自动附加。
- 未对真实文献执行完整 OCR/模型翻译，避免消耗用户额度；真实 RetainPDF 服务仅验证了健康检查、端口发现和配置读取。

## 边界

- 本轮未新增 MCP 工具；外部 Agent 仍使用现有的 `attach_translated_pdf` 附加已生成文件。
- 取消命令已提供，但文献菜单暂未增加取消入口；任务条会持续显示进度。
