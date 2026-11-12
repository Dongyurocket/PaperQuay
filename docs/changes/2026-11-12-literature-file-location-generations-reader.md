# 文献位置服务接入解析版本与阅读器

- 日期：2026-11-12
- 关联：工作区 P0-F、长文档 L1a 位置契约；KG 证据与长文档界面共用同一服务。
- 状态：解析 generation locator 和阅读器入口已接入；P0-F 总体验收仍进行中。

## 实现

- 共享知识存储提供来源的已发布 generation 清单。位置服务对 `paper.id` 与 `native-library:${paper.id}` 两种来源身份读取 manifest，按已登记相对路径构造 generation 产物定位项，并返回 generation ID、sourceVersion、manifest hash 和 current/history 标记。
- 定位前重新读取登记，并逐文件核验 manifest 记录的大小和 SHA-256。文件缺失显示为 missing；内容被改动显示版本不符且禁止打开；只有 manifest 不足以核验版本的旧缓存会明确标为未核实。历史 generation 缺失时保留其自身状态，不回退至 current 文件。
- 阅读器工具菜单为 native-library 文献提供“打开所在位置”。弹窗打开时捕获不可变 paper ID 和标题，沿用文献详情及右键菜单使用的 `LiteratureFileLocationsDialog` 与主进程定位命令。
- 定位命令只验证并打开已登记路径，不触发解析、下载、模型调用或目录创建。

## 验证

- `node --test tests/literatureFileLocations.test.mjs tests/knowledgeGraphCommands.test.mjs tests/paddleOcrLifecycle.test.ts`：17/17 通过，包含 generation 替换后旧 locator 不会指向新版、缺失/篡改拒绝及解析 generation 发布保护。
- `npx tsc --noEmit`：通过。
- `TEMP`/`TMP` 指向 `.codex-tmp/nov12-location-check` 后运行 `npm run check`：生产构建通过，自动化测试 1000/1000、0 失败。构建输出既有大 chunk、动态导入和过期 Browserslist 数据提示；测试清理器报告隔离 fixture `EPERM` 并跳过清理，命令仍以 0 退出。
- 阅读器弹窗目标改为打开时冻结 ID/标题后，重新运行 `npm run build`：2617 modules，TypeScript/Vite 均通过；`git diff --check` 通过。

## 未完成

- Electron runtime 当前无法启动，未获得源码窗口；资源管理器文件选中/目录打开、浮动阅读器和 P0-T 双主题截图/缩放验收待桌面环境恢复后完成。
- MinerU 历史缓存及文库登记来源已覆盖；逐附件版本签名、非 MinerU 解析结果、图谱证据面板和长文档章节/单元面板仍需接入共享 locator。
- 跨重启的 attempt 恢复调度、远端 job 自动续跑、崩溃窗口恢复及仍被引用产物保护清理没有完成，L1a 继续进行中。

## 后续 L1a 增量：远端任务身份

- `parse_partitions.remote_job_id` 已增加到共享知识库，旧数据库通过启动时 `ALTER TABLE` 幂等升级。
- Paddle 服务返回 job ID 后立即写入当前运行分卷；knowledge store 提供按 generation 读取有序分卷记录的接口。
- `node --test tests/paddleOcrLifecycle.test.ts tests/backupKnowledgeStore.test.mjs`：6/6 通过，覆盖远端 ID 写入及关闭/重新打开数据库后的持久读取、旧 schema 幂等升级、原有 generation 发布/篡改保护。
- 新增迁移与远端 ID 持久化后再次运行 `npm run check`（`TEMP`/`TMP`=`.codex-tmp/nov12-jobid-check`）：构建通过，完整测试 1001/1001、0 失败。清理器仍输出 fixture `EPERM` 并跳过清理，不影响退出码。
- 这一增量只持久化服务端任务身份和分卷状态，不会自动恢复轮询或下载；提交响应与本地保存之间的崩溃窗口、attempt staging、取消/崩溃恢复和引用保护仍待实现。

## 后续 L1a 增量：generation 隔离 staging 与兼容缓存提交

- 每个带持久 generation 的 Paddle 解析将最终产物写入 MinerU 缓存根下 `.document-generations/<source-hash>/<generation-id>/`，不再把当前 generation 的 manifest 指向会被下次解析覆盖的固定 `extractDir`。拆分卷合并后也发布至该 generation 专属目录。
- 只在新产物 manifest 完整、源文件哈希/页覆盖/文件大小与 SHA-256 校验通过后，才准备兼容阅读器缓存并切换 knowledge store 的 current generation。旧解析目录和仍由其他 generation 引用的产物不会作为本次 staging 写入目标。
- 兼容缓存替换对每次 generation 使用独立备份名；失败时删除本次写入并恢复本次移动的旧缓存。清理只删除本次 attempt 的备份，不会清理其他 `.bak-*` 文件。
- 专项 `node --test tests/paddleOcrLifecycle.test.ts tests/paddleOcrRuntime.test.ts tests/backupKnowledgeStore.test.mjs` 11/11；覆盖 staging 路径唯一、兼容缓存发布、current 切换失败恢复旧缓存、篡改后旧 generation/原文保持、遗留备份保留和任务 ID 重启读取。
- 本地运行期失败回滚有测试；若进程在兼容缓存替换的文件系统窗口崩溃，启动恢复账本尚未接通，不能据此宣称崩溃恢复完成。远端 job 自动续跑、取消恢复、引用保护 GC 和真实 Paddle 服务验证仍待做。
