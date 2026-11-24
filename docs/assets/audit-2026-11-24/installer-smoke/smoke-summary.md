# Installer smoke

- installer: PaperQuay-0.4.39-win-x64.exe (sha256 8bb7a2f439f1cd0dca089718eaa6d6bb1837f8c5d1c6abe6e94f1fad7de0046d)
- payload app.asar: sha256 87bb3ce361ea66f83ca6ace093149a3d1565855afc34465b9c7a7188ab3155c3
- pass: 11, fail: 2

- PASS 安装包 payload 解包布局
- PASS 启动与 preload 桥
- PASS 导入 PDF
- PASS 打开论文与 PDF 渲染
- PASS 中文 CID PDF 导入与渲染
- PASS 笔记创建与读取
- PASS Vault 同步
- PASS RetainPDF 状态
- PASS 备份导出
- PASS 备份导入检查（拒绝未授权包路径）
- FAIL 备份导入（原生对话框授权） — Error: UIAutomation failed (code 1): file dialog window not found for pid 18156
- PASS MCP read_paper_figure（安装版 server）
- FAIL 备份导入（恢复到临时目录） — Error: backup package was not authorized through the dialog
