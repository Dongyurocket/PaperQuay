# Installer smoke

- installer: PaperQuay-0.4.38-win-x64.exe (sha256 0941c9c83d7d20c061ad55f0d53033830ab29224ab2292d2ef3cc61ca709c26f)
- payload app.asar: sha256 0523dc064aad2d10b6e08598da9c98f14ca3e34ee8ebfdba8505e7fedb87edc0
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
- FAIL 备份导入（原生对话框授权） — Error: UIAutomation failed (code 1): file dialog window not found for pid 22912
- PASS MCP read_paper_figure（安装版 server）
- FAIL 备份导入（恢复到临时目录） — Error: backup package was not authorized through the dialog
