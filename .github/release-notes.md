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

- Knowledge graph nodes no longer pile up and overlap in the center. The layout used to run while the graph workspace was still hidden (a zero-size container), compressing every node into a tiny area that was never recomputed. Layout now waits until the workspace is visible and re-runs when you switch to the Graph tab.
- The global graph layout engine switches from the built-in cose layout to fcose with benchmarked parameters, spreading dense graphs apart faster and more evenly (about 20× faster on large graphs in headless benchmarks).
- Typing in the Custom Relations panel no longer wipes the graph. Editing the relation label or description used to destroy and recreate the whole graph canvas, leaving it blank.

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

- 修复知识图谱节点全部聚集在中心重叠的问题：此前布局在图谱页仍隐藏（容器尺寸为 0）时就已经执行完毕，所有节点被压缩在极小区域且不再重算；现在布局会等图谱页可见后才执行，切换到图谱页时自动补算。
- 全局图谱布局引擎从内置 cose 更换为 fcose，参数经基准实验标定，密集图谱分布更均匀，大图布局速度提升约 20 倍。
- 修复在“自定义关系”面板输入文字时图谱被销毁重建、画布变空白的问题。

## 备注

- AI 功能需要在设置中自行配置兼容模型接口和 API Key。
- Release 资源由 GitHub Actions 自动生成。
