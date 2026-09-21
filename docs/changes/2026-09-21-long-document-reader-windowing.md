# 2026-09-21 - 长文档阅读窗口化

## 现象

打开学位论文、教材或长篇报告时，左侧 PDF 与右侧识别后的结构内容在滚动中都会明显卡顿。页数和结构块越多，卡顿越重。

## 根因

双栏阅读把长文档当成短论文来挂载：

- 右侧 `BlockViewer` 用 idle 回调把全部 MinerU 块增量挂进 DOM，且从不卸载离屏块。每个块都跑 ReactMarkdown + remark-math + KaTeX。
- 左侧缩略图对 `pageCount` 生成全部按钮；PDF.js 在 `disableAutoFetch: false` 时会 eager `getPage(2..N)`。
- `syncPageHosts` 对每一个 `.page` 建立 overlay 节点和 ResizeObserver；`PdfPageOverlay` 为页内全部结构块生成透明热点（悬停实际走 PDF 命中测试）。

## 修改

- 新增共享 `resolveVirtualWindow`，右侧结构块按视口窗口化，离屏卸载，ResizeObserver 记录真实高度并校正滚动。
- 缩略图列表只保留视口附近按钮，图片容器固定 `aspect-[0.74]` 以便等步长虚拟化。
- `syncPageHosts` 只观察当前页 ±1 以及活动/悬停/高亮页；overlay 只渲染 hovered/active 块。
- PDF.js `disableAutoFetch: true`，避免打开长 PDF 时预取全部页面代理。
- `.page` 增加 `contain: layout paint`，不用 `content-visibility`，以免干扰 PDF.js 的几何测量。

## 验证

- `npm test`：`tests/virtualWindow.test.ts`、`tests/blockViewerWindow.test.ts`、`tests/pdfDocumentSource.test.ts`，以及 `tests/pdfViewerUtils.test.ts` 中的缩略图窗口用例。
- `npm run build`：TypeScript 与 Vite 构建。
- 手工：打开 200+ 页学位论文，左右栏连续滚动、点击结构块跳转 PDF、缩略图跳转、批注与悬停高亮仍可用。
