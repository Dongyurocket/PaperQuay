# 概览缓存自动显示、右键打开所在位置与黑底按钮清理（UI 计划 P0 + P1）

2026-11-16，分支 `ui/p0-p1-overview-cache-reveal`，基于 `main` @ `fe647ec`。对应 `docs/plans/2026-11-16-library-reader-ui-simplification.md` 的 P0 与 P1。

## 缺陷与修复

| 缺陷 | 原因 | 修复 |
| --- | --- | --- |
| 打开论文后概览为空，必须点「生成概览」才显示已有结果 | 阅读器只在生成函数里读磁盘缓存；自动触发要求「自动生成概览」开启且模型已配置，而该开关默认关闭 | 新增被动读缓存 effect：源键就绪即读 `mineruCacheDir` 下的概览缓存，只读盘、不调模型，与开关和 API Key 无关；命中后设置源键，自动生成 effect 随之短路 |
| 正文尚未就绪（源键为空）时没有任何概览 | 源键依赖 MinerU 块或 PDF 签名 | 先显示文库侧已加载的同一文档概览（`libraryPreviewSummary` 新 prop），正文就绪后由被动读缓存校正 |
| 没配 API Key 时缓存永远显示不出来；点击生成会清空已显示概览 | 生成函数先查配置后读缓存，配置缺失分支 `setPaperSummary(null)` | 先读缓存再查配置；配置缺失只报错，不清空已显示内容；未加载 MinerU 块时同样不清空 |
| 打开阅读器会清掉文库侧已缓存的概览 | 同步载荷总带 `summary: null`，文库侧按「字段存在」覆盖 | 阅读器暂无概览时同步不带 `summary` 字段（`previewSummarySyncField`） |
| 「全选 + 批量操作」可能按旧的知识库筛选解析文献 | `resolveSelectedPapers` 依赖数组漏了 `ragMembershipFilter` | 补上依赖 |

被动读取与主动生成的竞态：被动请求记录启动时的 `summaryRequestIdRef`，主动生成一旦开始就丢弃被动结果；切换文档时 `resetDocumentState` 作废在途被动请求。被动 effect 声明在自动生成 effect 之前。

## 新功能：右键「打开所在位置」

- 后端 `reveal_path`（`electron/backend/fileCommands.cjs`）：文件用 `shell.showItemInFolder` 定位，目录用 `shell.openPath` 打开，不存在返回 `{ ok:false, reason:'missing' }`。只接受这些目录内的路径：应用数据目录、文库存储目录、译版目录、MinerU 缓存（默认与设置值）、远程下载目录、已批准写入路径，以及各附件原始/存储路径所在目录。非目录一律只做定位，不执行。
- 前端纯函数 `src/features/literature/paperFileLocations.ts`：为原始 PDF、译版 PDF（最新 3 份，带语言）和 MinerU 结果生成候选路径（0.4.26 的文件夹与 Markdown 两项已合并，详见 P2 变更记录），一次 `paths_exist` 取第一个存在者。
- `usePaperFileLocationMenu.tsx` 把这些位置接入文献右键菜单，放在「删除文献记录」之前，另加「复制 PDF 路径」。检查期间显示「检查中…」，找不到的项置灰并标「未找到」。菜单宽度从 224 调为 264。

## 样式

- 助手栏「新建会话 +」：去掉实心黑底、阴影和 `dark:bg-white`，改为幽灵按钮 + 强调色图标（方案 A）。`.pq-icon-button` 是在 Tailwind utilities 之后的非分层规则，同优先级会盖掉工具类，所以强调色用 `!` 修饰。「历史记录」激活态同样处理。
- 发送按钮禁用态：由「主色 55% 透明」改为 `surface-3` 底 + `text-faint` 字，不再呈现褪色青。
- 推理强度按钮：去掉 `bg-white/60`、`dark:bg-white/5` 与硬编码 rgba；激活态从成功绿改为强调色，与 RAG/HTML 开关一致。
- 「更多」菜单悬停 `bg-white/70` 改为 `--pq-hover`。
- 黑底按钮改为 `.pq-button-primary`：导出批注 PDF、进入阅读、加入问答（2 处）、插入选中文本、设置页 3 处、检查更新、确认蒸馏；结构化阅读显示模式选中态改为 accent-soft。`pq-button-primary` 自带 `gap`，相应去掉图标上的 `mr-2/ml-2`。
- 保留：Agent 头像块（设计规范登记的有意配对）、阅读热力图位置标记（指示器，不是按钮）、遮罩与代码块底色。

## 验证

- `npx tsc --noEmit` 通过；`npm run build`（`TEMP`/`TMP` 指向仓库内 `.tmp-build/`）通过。
- `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"`：**997/997** 通过。新增 `tests/paperSummaryAutoLoad.test.ts`（9 项）、`tests/paperFileLocations.test.ts`（6 项），`tests/fileCommands.test.ts` 新增 `reveal_path` 5 项（根内文件、目录、缺失、附件原始目录、越界与 `..` 绕出）。
- 独立审查：3 路审查 + 逐条反驳复核。确认 3 项（强调色被 `.pq-icon-button` 覆盖、图标双倍间距、`gap-1.5` 失效），均已修复；其余 7 项判定为既有行为或无法实际触发。
- 浏览器预览不可用：应用依赖 Electron 窗口桥，纯 Vite 页面在 `App` 挂载时即报错。

## 未完成的验证

**桌面实机验证尚未进行**，需用 `--user-data-dir=<空目录>` 或拷贝出的一次性库逐项确认：

1. 关闭「自动生成概览」、清空 API Key，打开已有缓存概览的论文 → 概览页直接显示；返回文库，详情面板概览仍在。
2. 右键文献，PDF / 译版 / MinerU 结果均能在资源管理器中定位，缺失项置灰。
3. 「+」、发送、推理强度按钮在日间与夜间主题下的观感。

## 已知遗留

- 「刷新整篇概览」走同一生成函数，缓存命中时直接返回缓存，实际不会重新生成。此为既有行为，本轮未改，建议在 P4 概览页改造时一并处理（例如刷新时跳过缓存）。
- 仅按旧版字节长度生成键的 pdf-text 缓存，阅读器侧仍匹配不到（文库侧可以）。这是既有的窄口径遗留。

本次无数据库结构、文献、附件或缓存迁移。
