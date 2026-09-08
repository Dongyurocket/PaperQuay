# PaperQuay v{{VERSION}}

PaperQuay is an open-source AI paper workspace for literature management, PDF reading, paper overview generation, full-text translation, inline notes, Zotero import, Agent workflows, and local RAG.

## Downloads

Download the native installer for your operating system from the Assets section below.

| Platform | Recommended asset |
| --- | --- |
| Windows | `.exe` installer or `.msi` package |
| macOS | `.dmg` package for Apple Silicon or Intel |
| Linux | Electron desktop package such as `.AppImage`, `.deb`, or `.tar.gz` |

## Highlights

- **Fix: broken snapshot cards after cross-page table merging**: MinerU automatically merges multi-page tables (e.g., a thesis nomenclature spanning several pages) into the first fragment, leaving empty stub blocks on later pages whose asset path degrades to the bare `images/` directory. The renderer previously requested that directory as an image file, producing “No matching table snapshot was found” error cards with a red `Path is not a file` message. Directory-only asset paths are now rejected, and empty table stubs are treated as continuations of the merged table fragment so they are hidden from the block viewer; clicking the table region on later PDF pages still resolves to the merged table block.

## Notes

- AI features require your own compatible model endpoint and API key in Settings.
- Release assets are generated automatically by GitHub Actions.

---

# PaperQuay v{{VERSION}} 中文说明

PaperQuay 是一个开源 AI 论文工作台，覆盖文献管理、PDF 阅读、论文概览生成、全文翻译、内联笔记、Zotero 导入、Agent 工作流和本地 RAG。

## 下载说明

请在下方 Assets 区域选择与你的操作系统对应的安装包。

| 平台 | 推荐安装包 |
| --- | --- |
| Windows | `.exe` 安装包或 `.msi` 安装包 |
| macOS | Apple Silicon 或 Intel 对应的 `.dmg` 安装包 |
| Linux | `.AppImage`、`.deb` 或 `.tar.gz` 桌面安装包 |

## 本次更新

- **修复：跨页合并表格后续分片渲染空错误卡片**：MinerU 云端会自动把跨页表格（如学位论文的多页注释表/符号表）合并进第一个分片，后续分片只留下没有表格内容与截图文件名的空壳块（资源路径退化为 `images/` 目录）。此前前端会把该目录当作图片文件请求后端读取，抛出 `Path is not a file` 并显示「没有找到对应的表格截图」错误卡片。现在资源路径提取会拒绝无文件名的目录路径，空壳表格块会被标记为首个合并分片的续块并自动隐藏；在 PDF 后续页点击表格区域仍会正确定位到合并表格块。

## 备注

- AI 特性需要在“设置”中配置你自己的兼容模型接口与 API 密钥。
- 发布产物由 GitHub Actions 自动构建生成。
