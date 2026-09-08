# MinerU 多 Key 自动轮换与超页大文件全自动拆分合并

## 背景与问题

用户在使用 MinerU 进行学术文献解析（特别是批量解析与长文档处理）时反馈两个关键痛点：
1. **云端 200 页硬性限制报错中断**：
   MinerU 官方云端接口（OpenDataLab 的 mineru.net API v4）对单个任务的文件页数有 200 页物理上限。遇到博士毕业论文、整本专著或合集时，云端抛出 `number of pages exceeds limit (200 pages), please split the file and try again`，导致客户端出现未捕获异常，并在批量解析（如 100 篇论文）时阻断流程；此外 OCR fallback 还会因盲目重试浪费大量时间。
2. **单 Key 额度与并发限制**：
   单 Token 每日免费解析点数有限，批量解析多篇文献时极易耗尽或遭遇限流；用户拥有多个账号或 Key，但过去只能在设置中单选填写一个，无法同时录入与自动轮流调度。

## 解决方案

### 1. MinerU 多 Key 录入与智能调度器
- **设置界面升级**：
  在「设置」→「MinerU」中将 API Token 改造为多行文本框（`SettingsTextarea`），支持一行一个 Key（或逗号/分号分隔）直接粘贴；配备明文显隐切换按钮（眼睛图标）与实时状态徽章（如 `✓ 已识别 3 个 Key（轮换使用）`）。
- **Round-Robin 均衡分发**：
  后端维护全局轮询游标，无论是单篇顺序解析还是并发批量解析，请求均匀轮流分发至不同 Key，最大化并发吞吐与免费配额利用率。
- **自动故障切换（Failover）**：
  在申请上传任务时，若当前 Key 遇到 401（未授权）、403（禁止访问）、429（限流）或点数不足/额度耗尽（`insufficient quota`、`点数不足` 等），调度器自动无缝尝试下一个可用 Key 重新发起任务，仅在全部 Key 均不可用时才汇总报错。

### 2. 超页长文档全自动拆分合并（Split & Merge）
- **PDF 总页数智能预检**：
  集成轻量纯 JS `pdf-lib`，在解析前通过 `getPdfPageCount` 检测文档页数；小于等于 200 页的常规论文直接走单卷直传解析，零额外开销。
- **本地无损分卷拆分 (`electron/backend/pdfSplitter.cjs`)**：
  当页数 > 200 页时，按每卷 150 页安全余量（`planPdfSplits`）自动在缓存临时目录生成分卷子 PDF（`splitPdfFiles`），保证各分卷 100% 处于云端安全配额内。
- **分卷并发/轮换云端识别**：
  各分卷独立调用 MinerU 云端生命周期，并依托多 Key 轮询机制分发，在单 Key 耗尽时自动故障切换。
- **多卷产物精准合并 (`electron/backend/mineruMerge.cjs`)**：
  - `content_list_v2.json`：自动校正每个分卷 block 的 `page_idx` 偏移行重写（如分卷 2 的第 0 页自动映射为原 PDF 第 150 页），确保与阅读器视口、双语段落、选框批注及原 PDF 区域切片（BBox Crop）绝对对齐；
  - `middle.json`：深度校准 `pdf_info` 里的页码和版面块信息；
  - `full.md`：按顺序拼接 Markdown 正文；
  - 图片资源与链接重映射：为各分卷图片分配隔离命名空间（`part_${index}_${name}`），防止文件名冲突覆盖，并同步重映射 Markdown 及 JSON 中的图片相对路径；
- **临时文件自动回收**：
  合并完成后自动将规范化产物写入目标缓存目录，并静默清理临时分卷 PDF 及中间解压目录。

### 3. 错误转译与 OCR Fallback 优化
- 主进程捕获云端 200 页限制报错时，自动转译为人性化中文指引；
- 优化 `mineruOcrFallback.ts`，检测到超页限制时直接返回，规避无意义的 OCR 模式二次重复重试。

## 验证与测试

- 新增 `tests/mineruMultiKey.test.ts`：覆盖双端 `parseMineruTokens` 的各种边界情况与超页正则拦截；
- 新增 `tests/mineruSplitMerge.test.ts`：覆盖动态 PDF 拆分生成、分卷计划与多分卷 JSON/Markdown/图片合并校正；
- 全库 282 项自动化测试全部通过（0 fail），TypeScript 编译与 Vite 生产构建 100% 成功。
