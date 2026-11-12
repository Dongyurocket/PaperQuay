# 文献工作区结构化筛选增量

- 日期：2026-11-12（Asia/Shanghai）
- 工作包：工作区 P3（进行中）
- 关联计划：[工作区 UI 与元数据计划](../plans/2026-11-11-literature-workspace-ui-and-metadata-plan.md)、[联合实施台账](../implementation/joint-execution-ledger.md)

## 实现范围

首段增加文献类型与收藏状态筛选。两个条件由 SQLite 统一过滤器和内存文库过滤器执行，并接入普通列表分页、加载更多、编辑后刷新、全库 ID 枚举及演示文库。筛选条件变化会清空冻结选择。未知文献类型在 SQL 查询中明确报错。

测试以同一隔离文库比较 SQL 与内存过滤结果，并核对分页总数、独立计数和全选 ID 集合。复核时发现类型/收藏 fixture 被后续夹具赋值覆盖，已修正夹具以确保真实存在 report/favorite 与 book/non-favorite 记录。

## 验证

之前源代码增量的验证记录：

- `npm run build`：通过（2616 modules transformed）。
- `node --test tests/libraryQuery.test.ts`：4/4 通过。
- `npm test`：989/989 通过。

随后修正 fixture 并在当前工作区重跑：`node --test tests/libraryQuery.test.ts` 4/4 通过，`git diff --check` 通过。此前完整测试和构建通过于夹具修正前；本次没有重跑完整 `npm test` 或构建，也没有 Windows 桌面交互、真实文库或安装版验收。P3 尚未完成。

本次追加阶段检查：`npm run check` 在 TypeScript 通过、Vite 转译 2616 个模块后失败，esbuild 清理临时目录时收到 Windows `Access is denied`；换独立 TEMP 后仍复现。`npm test`（默认并发）与 `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` 均有 `readerSettings.test.ts` 的 esbuild 输出文件 `Access is denied` 失败，此外大量隔离临时目录清理报告 `EPERM`。因此当前完整构建和测试未通过；此前 989/989 与构建结果只作为夹具修正前历史证据。查询专项仍通过。

## 后续增量：持久化属性筛选扩展

查询契约继续增加年份闭区间／未知年份、作者、载体、关键词和多标签名称筛选。年份从原始字符串开头读取四位年份，不重写书目值；无效年份或反向区间显式拒绝。标签 ID 为条目私有，故多标签使用规范化名称匹配，多个名称在该维度内 OR。列表“更多属性筛选”展开区接入控件；SQL、内存语义、演示库、分页、计数与全选 ID 遵守同一条件。阅读时间/进度、附件角色和类型适用缺项仍待后续 P3 增量。

当前增量验证：`npx tsc --noEmit` 通过；`node --test tests/libraryQuery.test.ts` 4/4 通过，覆盖年份边界/未知值、作者/刊物/关键词、多标签名、SQL 与内存 oracle、count/ID 一致以及非法年份拒绝；`git diff --check` 通过。尚未完成完整构建、全套测试和 Windows UI 交互验收。

## 一致性与迟到响应修复

SQLite 内建 `lower()` 和 `trim()` 对 Unicode 的行为不同于前端／内存过滤器。数据库连接现注册 `pq_casefold`（JavaScript `toLowerCase()`）与 `pq_trim`（JavaScript `trim()`），作者、刊物、关键词及标签筛选使用同一规范化规则。SQLite 集成夹具补充 Kelvin 符号、NBSP 标签/文本、`n.d.` 和带前置空格的年份，并继续核对 SQL 与内存 oracle、total/count/ID 一致。

全选 ID 枚举现在捕获筛选指纹、请求序号及演示文库对象；枚举期间筛选切换或较新的枚举开始后，迟到响应不再写回选择或错误状态。该修复通过源码类型检查与真实 SQLite 查询专项，但列表 React 组件竞态仍待交互级验证。

更多属性面板现在使用独立草稿：展开时从已应用条件初始化，编辑不立即查询；年份范围就地校验，未知年份切换会清空数值边界；取消丢弃未应用编辑，应用一次提交完整筛选条件，面板显示已生效属性数。

本次验证：`node --test tests/libraryQuery.test.ts tests/literatureLibraryUtils.test.ts tests/paperSelection.test.ts` 19/19 通过；`npx tsc --noEmit` 与 `git diff --check` 通过。使用仓库隔离 TEMP 后 `npm run build` 通过（2616 modules），串行完整 `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` 为 989/989、退出码 0；笔记 fixture 清理器仍报告 `EPERM`。筛选面板真实桌面交互、条件标签/移除、候选搜索和组件级竞态验收待补，不据此标记 P3 完成。

## 阅读状态与进度筛选

更多属性面板增加未读／已读和阅读进度百分比闭区间。阅读状态以 `lastReadAt` 是否存在作为可审计的持久字段；进度保留当前 0–1 数据存储，仅在查询条件和界面以 0–100 百分比表达。SQL、内存文库与演示库一致；非法上下界（非数、超出 0–100、下限大于上限）由查询层拒绝，UI 在应用前显示错误并禁用提交。全选 ID、count 和分页沿用同一 `buildLibraryFilter`。

阅读状态/进度增量的专项 `tests/libraryQuery.test.ts` 4/4 通过，覆盖已读/未读、闭区间边界、SQL／内存 oracle 及非法范围拒绝；`npx tsc --noEmit` 与 `git diff --check` 通过。随后仓库隔离 TEMP 下构建通过（2616 modules），串行完整套件 990/990、退出码 0。全套测试清理器仍有笔记 fixture 临时目录 `EPERM` 提示并跳过清理。当时尚缺的导入/最近阅读日期已在下文实现；附件角色、类型适用缺项、可搜索候选及桌面验收仍待完成，P3 继续进行中。

## 条件标签和单项移除

已应用的属性筛选现在以可访问按钮标签显示在筛选工具栏中，覆盖年份、阅读状态、进度、作者、刊物、关键词和标签。点击某个标签仅清除对应维度，其他生效条件保留；清除操作直接走已应用状态，不修改当前可能尚未提交的筛选草稿。

验证：本次 `npm run build` 在隔离 TEMP 下通过（2616 modules，TypeScript 检查通过）。未增加镜像 JSX 测试；组件行为仍需在 Windows 桌面完成实际点击、键盘和窄窗口验收。P3 尚缺时间范围（后续增量见下文）、附件角色、类型适用缺项、可搜索候选及桌面验收。

## 导入和最近阅读时间范围

筛选增加导入日期与最近阅读日期的闭区间。日期控件按本机日历日转换为毫秒时间戳（结束日包含整日）；后端 SQL 与内存过滤共同校验整数时间戳、反向范围，并将未读条目排除在最近阅读日期范围之外。演示文库过滤同步采用相同的本机日历日语义。两个时间维度也显示在已应用条件标签中，能够各自清除。

验证：`npm run build`（隔离 TEMP）通过；`node --test tests/libraryQuery.test.ts` 4/4 通过，新增 SQL 与内存结果对照、区间边界及非法时间范围断言。之后串行全套 `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` 为 990/990、退出码 0；笔记测试清理器有 `EPERM` 跳过提示。桌面日期控件及时区边界尚待实际验收。

## 附件角色

增加附件筛选项：有原文 PDF、有已登记译文 PDF、有缺失附件、无已登记附件。SQL 使用附件关系表 `kind`/`missing` 字段，内存和演示库使用对应登记记录；缺失译文不计作可用译文 PDF，原文 PDF 识别既有 `pdf` 与 `original-pdf` 类型。未知筛选值在 SQL/内存查询层显式拒绝。附件筛选也有已应用条件标签和单项清除。

验证：隔离 TEMP 下 `npm run build` 通过；`node --test tests/libraryQuery.test.ts` 4/4 通过，SQLite fixture 覆盖原文、译文、缺失和无登记附件，并与内存 oracle 对照。随后串行全套 `node --test --test-concurrency=1 "tests/*.test.ts" "tests/*.test.mjs"` 为 990/990、退出码 0；笔记测试清理器有 `EPERM` 跳过提示。真实文库／桌面验收待补。

## 类型适用的元数据缺项与候选搜索

增加可组合的元数据缺项筛选。字段候选会按列表中的文献类型过滤，并支持按中英文名称或字段键搜索；多字段按“任一缺失”匹配，已应用条件逐字段显示并可单项移除。查询端按条目实际类型决定字段适用性，因此图书不会因没有 DOI 命中 DOI 缺项，报告也不会因没有 ISBN 命中 ISBN 缺项。标题、作者、年份、摘要、关键词和 URL 对所有类型适用；出版字段按 journalArticle、conferencePaper、book、bookSection、thesis、report、preprint 的书目角色约束。未知字段在 SQL 与内存查询中拒绝。该筛选复用分页、count、全库 ID 枚举和演示库过滤链路。

验证：仓库隔离 TEMP 下 `npm run build` 通过（2617 modules）；SQLite 集成专项 `node --test tests/libraryQuery.test.ts` 4/4 通过，覆盖适用与不适用字段、多个候选任一匹配、SQL/内存 oracle、计数和全库 ID 一致及非法字段拒绝。增量后串行全套测试为 990/990、退出码 0；笔记 fixture 清理器有 `EPERM` 跳过提示。浏览器/桌面条件候选交互仍待实测。
