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

- **MinerU Multi-Key Round-Robin & Failover Rotation**: Supports entering multiple MinerU API keys (separated by line breaks or commas) with visibility toggle and active key count badge. Single and batch tasks automatically rotate through keys in a round-robin schedule, with automatic failover to the next key if quota/rate-limits are reached.
- **Automated Split-Parse-Merge for Large PDFs (>200 Pages)**: Completely eliminates the 200-page cloud limit! PDFs over 200 pages are automatically and losslessly split into safe batches (150 pages each), parsed in parallel/rotation using the multi-key pool, and seamlessly merged back together.
- **Accurate BBox, Page Offset & Asset Remapping**: Automatically recalculates `page_idx` in `content_list_v2.json` and `middle.json` to keep text blocks and BBox crop fallbacks aligned with original PDF page numbers; isolates image assets with unique namespaces to prevent filename collisions.
- **Friendly Error Translation & OCR Fallback Safeguard**: Translates cloud errors into actionable advice and eliminates redundant OCR retries on page limit failures.

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

- **MinerU 多 Key 自动轮换与故障切换调度**：设置中支持同时录入多个 Key（换行或逗号分隔），提供明文显隐切换与实时状态徽章；单篇及批量解析时自动执行 Round-Robin 均衡分发，若单 Key 遭遇限流或额度耗尽自动无缝切换至下一个可用 Key 重试。
- **超页大文件（>200页）全自动拆分、识别与产物合并**：彻底解决 MinerU 官方云端单次 200 页硬性限制！超过 200 页的大文件由系统在后台自动无损切分为 150 页安全分卷，协同多 Key 轮换并发上传识别，并在完成后全自动合并产物。
- **精准页码对齐、BBox 映射与图片防冲突**：自动累加重写各分卷的 `page_idx`，保证阅读器双语段落、BBox 选区和原 PDF 区域切片（BBox Crop）与原始文档绝对对齐；图片资源自动做命名空间隔离与路径重映射，防止分卷图片互相覆盖。
- **超页错误智能转译与 OCR Fallback 优化**：捕获超页报错时转译为人性化中文说明，并在发生超页限制时直接返回，规避无意义的 OCR 模式二次重复重试。

## 备注

- AI 特性需要在“设置”中配置你自己的兼容模型接口与 API 密钥。
- 发布产物由 GitHub Actions 自动构建生成。
