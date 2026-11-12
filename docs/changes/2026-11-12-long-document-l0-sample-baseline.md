# 长文档 L0：工程样本基线

日期：2026-11-12（Asia/Shanghai）

## 样本与权利

- NASA NTRS 记录 [19830015360](https://ntrs.nasa.gov/citations/19830015360)，《Array structure design handbook for stand alone photovoltaic applications》，工程/结构力学技术手册。
- 官方 API 元数据：`distribution=PUBLIC`、`copyright.determinationType=GOV_PUBLIC_USE_PERMITTED`、`containsThirdPartyMaterial=false`、`sensitiveInformation=2`、`downloadsAvailable=true`。本次只为工程测试下载，不表示项目取得任何额外权利。
- 样本放在被忽略的 `.codex-tmp/l0-sample/19830015360.pdf`，文件大小 18,433,400 bytes。源文件保留在隔离测量目录，不导入个人文库，也不纳入产品包。

## 本轮测量

以项目锁定的 PDF.js 4.8.69（`pdfjs-dist/legacy/build/pdf.mjs`）逐页顺序读取并提取文本；Node 进程中加载整份 PDF，逐页执行 `getTextContent()` 后释放页面资源。

| 指标 | 实测 |
| --- | ---: |
| PDF 文件 | 18,433,400 bytes |
| 物理页数 | 248 |
| 含非空文本页 | 245 / 248（98.79%） |
| 提取字符数 | 435,800 |
| 完成时间 | 599 ms |
| Node RSS 峰值 | 175,357,952 bytes（约 167.2 MiB） |
| 生成磁盘产物 | 0 bytes；本次仅读取 PDF |
| 外部解析/模型费用 | 0；未调用外部服务 |

命令通过 PowerShell here-string 执行 Node ESM 脚本，调用 `getDocument()`、逐页 `getTextContent()` 并记录 wall time、RSS、非空页数与字符数。脚本在命令中一次性执行，没有改动产品代码或依赖锁文件。

## 解释与待验收项

抽样提取显示页面 10 正文有连续文本；页面 50 的图注与页面 150 的表题可提取；页面 100 的工程图注/尺寸串存在顺序和字符噪声。封面第 1 页文字噪声明显（例如字母间距、断词），因此 245/248 的非空率不能当作高质量率。空文本页为 4、6、247，仍需和渲染页面核对它们是空白页、图像扫描还是其他版式内容。

这证明当前锁定 PDF.js 路径可为该样本提供快速全文文本抽取基线，不能代表 MinerU 结构解析质量。尚未评估表格/公式重建、印刷页码映射、目录/章节覆盖、应用内检索召回与定位，也未测持久分卷写盘、取消恢复、冷启动及磁盘峰值。

下一步抽查含表格、公式、图示和目录的页面，与原 PDF 对照文本及页码；测应用检索召回。若需调用 MinerU 云服务，需另记真实服务、价格和费用；本轮未调用。
