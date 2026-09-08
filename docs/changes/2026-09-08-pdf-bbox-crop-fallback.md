# PDF 原始区域切片（BBox Crop）回退机制

## 背景

在阅读 MinerU 解析的学术论文时，由于复杂多行公式、算法推导或紧凑常数可能存在微小的 OCR 识别瑕疵，或者部分公式过于复杂导致排版效果欠佳。
PaperQuay 解析生成的结构块（Block）中完整保留了在原 PDF 中的矢量定位坐标 `bbox` 及所属页码。
为了确保科研人员在阅读、复现公式与核对常数时的 100% 准确性，需要提供原版 PDF 区域切片（BBox Crop）回退与即时对照机制。

## 方案设计与实现

1. **`src/features/pdf/pdfBlockCrop.ts`**：
   - 封装 `getPdfBlockCropDataUrl` 与 `usePdfBlockCrop` React Hook；
   - 复用前端 `pdfjs-dist` 矢量画布能力，根据块的 `bbox`、`bboxCoordinateSystem` 与 `bboxPageSize` 计算真实渲染矩形；
   - 以 2.0x Retina 高保真分辨率进行离屏渲染与区域裁剪，保留 6px 微小边距防止笔画被截断；
   - 建立 LRU 内存切片缓存（最大 80 个切片），二次切换瞬间呈现，零重复计算。
2. **`src/features/blocks/blockViewerContent.tsx`**：
   - 实现 `BlockPdfCropViewer` 组件，提供原版切片展示、加载骨架屏以及点击全屏大图预览能力；
   - `BlockItemComponent` 在悬浮/激活时在顶部操作栏提供「原 PDF 切片 / 显示排版」切换按钮；
   - `EquationContentComponent` 在公式解析失败（KaTeX Parse Error）的报错框中提供「查看原 PDF 切片」一键回退展开能力。
3. **`src/features/blocks/BlockViewer.tsx` 与 `src/features/reader/ReaderWorkspace.tsx`**：
   - 贯通 `pdfSource` 传递链；
   - 管理块切片显示状态集合 `cropBlockIds`；
   - 在右键菜单中增加「切换为原 PDF 切片 / 显示排版文本」快捷项。
