# 加密全量备份包（替换 WebDAV 备份）计划

- 日期：2026-11-05
- 状态：**implemented（2026-11-06）**；代码、文档、自动化测试、隔离导出与桌面密码解密预览已完成。验证证据见 `docs/changes/2026-11-06-encrypted-backup-package.md`。仍待确认导入后的自动重启全流程、12.2 GiB 生产规模导出/导入及断电恢复演练；不将其标记为已通过。
- 代码基线：本地 `main` = `3d6d1a8`（`app-v0.4.18`）
- 范围：备份/恢复后端、设置页备份分区、WebDAV 功能彻底移除、数据迁移、测试与文档
- 目标：一键导出单文件加密包；在另一台电脑导入并输入读取密码后，完整恢复配置、密钥、文献库、笔记、PDF、阅读批注与 Agent 记忆
- 评审修订（2026-11-06）：对照仓库代码复核后修订 16 项，其中 6 项会直接导致数据错配或应用无法启动（回滚不覆盖浏览器状态、重启与单实例锁冲突、恢复期 MCP 护栏失效、偏移连续性规范自相矛盾、空源根导致全路径误匹配、`content_hash` 覆盖破坏去重）。逐条理由见第十七节。
- 复核依据（2026-11-06）：`snapshotTo` 三处实现存在（`libraryDatabaseStore.cjs:1125`、`noteStore.cjs:1154`、`ragStore.cjs:2201`）；`nodeSqlite.cjs` 已封装 `node:sqlite`；`ragWorkerHost.cjs:27` 已透出 `snapshotTo`；`src/types/backup.ts` 仅被待删除的两个文件引用；`hashBytes`/`hashFile` 为 SHA-256 hex；`translatedPdfDir`、`notesVaultDir`、`zoteroLocalDataDir` 默认值为空字符串。

## 结论

用 `.pqbackup` 单文件全量包替换 WebDAV 备份。包内包含主数据、密钥和可选的派生数据；包体用密码派生的密钥做 AES-256-GCM 流式加密。导入采用“暂存、校验、重启、离线替换”四步，避免应用运行时替换 SQLite 和 LevelDB 造成锁冲突；旧数据目录整体保留为回滚点。

首版只做离线快照迁移，不做多端实时同步、双向合并或云端托管。每次导出都是完整快照，不做增量链。

| 项目 | 结论 |
| --- | --- |
| 包格式 | 自定义 `.pqbackup`，单文件，AES-256-GCM + scrypt |
| 默认包体积 | 完整迁移约 12.2 GiB（约 13.1 GB）；日常备份约 2.3 GiB |
| 默认导入方式 | 完整替换，旧 `dataDir` 保留为 `.pre-import-*` |
| 首版范围 | 导出/导入/密码/进度/回滚/WebDAV 彻底删除；不做合并导入与增量包 |
| 预计工作量 | 约 13.5 人天，按 14–16 人天排期 |
| 主要风险 | 8 GiB RAG 快照空间、导入断电、跨机路径重绑、localStorage 恢复与回滚时机、重启时单实例锁冲突 |

## 一、现状与问题

### 1.1 现有 WebDAV 实现

| 入口 | 位置 | 行为 |
| --- | --- | --- |
| 设置页备份分区 | `src/features/reader/readerPreferencesBackupSection.tsx:276-484` | 配置地址、账号、密码，手动备份/查看/补全恢复 |
| 分区注册 | `src/features/reader/readerPreferencesContent.tsx:172-179` | “备份 / WebDAV”设置节 |
| 渲染层服务 | `src/services/webdavBackup.ts:27-81` | 读取/保存设置、测试连接、立即备份、检查最新、补全恢复 |
| IPC 命令 | `electron/backend/webdavCommands.cjs:43-101` | `webdav_*` 六个命令与进度事件 |
| 备份实现 | `electron/backend/webdavBackup.cjs:165-255` | 收集三个 SQLite 快照、PDF、MinerU/翻译/摘要缓存 |
| 上传 | `electron/backend/webdavBackup.cjs:337-406` | 按 manifest 增量上传，`latest/manifest.json` 发布 |
| 恢复 | `electron/backend/webdavBackup.cjs:732-808` | 补全式恢复：本地缺什么补什么，文献库按 ID 合并 |
| 设置存储 | `electron/backend/libraryDatabaseStore.cjs:33-36`、`501`、`964` | `webdav_settings` 表 + `library.webdav` 对象 |
| 默认值 | `electron/backend/libraryStore.cjs:61-69` | 远端地址、账号、密码、包含 PDF/派生文件开关 |

现有实现有三个结构性缺口：

1. **备份集合不全**：只上传三个数据库、PDF 和 allowlist 派生缓存（`webdavBackup.cjs:165-255`）。配置文件、API 密钥、Agent 记忆、知识图谱关系、渲染层 localStorage 都不在包内。
2. **恢复是合并不是还原**：文献库按 ID 合并，设置以前者优先（`webdavBackup.cjs:462-475`），无法保证“另一台电脑得到同一份状态”。
3. **没有加密**：WebDAV 凭据和数据库以明文上传；远端服务方可见文献库与笔记。

### 1.2 覆盖范围缺口

| 数据 | 现有 WebDAV | 缺口 |
| --- | --- | --- |
| 文献库 SQLite | 上传 | 合并恢复可能留下本机旧记录 |
| 笔记 SQLite | 上传 | 同上 |
| RAG SQLite | 上传 | 8 GB 级，每次全量上传成本高 |
| 原始/翻译版 PDF | 可选 | 恢复路径依赖本机原路径 |
| MinerU/翻译/摘要缓存 | 可选 | 只上传 allowlist 文件 |
| `paperquay.config.json`（含全部 API Key） | **不包含** | 换机后需要重新填所有密钥 |
| `library_settings` | 随库上传 | 恢复时本机设置优先，可能覆盖包内设置 |
| Agent 记忆 `agent-memory/` | **不包含** | L2/L3 与 trace 丢失 |
| 知识图谱关系 JSON | **不包含** | 手工关系丢失 |
| 阅读批注、问答会话、阅读位置 | **不包含**（localStorage） | 换机后阅读痕迹全部丢失 |
| Agent 对话历史、综述草稿 | **不包含**（localStorage） | 换机后历史丢失 |
| 笔记 Markdown vault | **不包含** | 未同步回库的外部编辑丢失 |

### 1.3 本机数据规模（2026-11-05 实测）

| 组件 | 体积 | 文件数 | 说明 |
| --- | ---: | ---: | --- |
| RAG SQLite | 7.55 GiB | 1 | 向量与 chunk 主体，可重建；内含 `agent_runs` 运行记录 |
| MinerU 缓存 | 2.36 GiB | 50,982 | 图片 1.16 GiB、其余散文件 1.19 GiB、translations 2.2 MB、summaries 1.7 MB |
| 文献库 PDF | 2.25 GiB | 225（含 201 个已入库附件） | 173 篇原始 PDF（1.97 GiB）+ 28 个已入库翻译版 PDF（147 MiB）；目录内另有少量历史/重复文件 |
| Agent 记忆 | 11.7 MiB | 13 | trace/L2/L3 |
| 文献库 SQLite | 3.18 MiB | 1 | 主数据 |
| 笔记 SQLite | 0.66 MiB | 1 | 主数据（9 条笔记，6 条软删，2 个文件夹） |
| 阅读器配置 | 5.51 KiB | 1 | 含密钥，明文 |
| 渲染层 localStorage | 1.2 MiB | 约 23 个固定键 + 2 个动态前缀 | 批注、问答、Agent 历史、草稿、区块修复、UI 偏好 |
| 知识图谱关系 | 37 B | 1 | 当前为空 |
| 笔记 vault（纳入部分） | 约 14 KiB | 4（3 个 md + `.paperquay-vault.json`） | 目录总量 25 文件/4.7 MiB，其余为 `.obsidian` 插件缓存，不纳入 |
| **完整包合计** | **约 12.2 GiB（约 13.1 GB）** | **约 51,300 条目** | 不含排除项 |

结论：包体积由 RAG 向量库和 MinerU 缓存主导。必须提供“完整迁移”和“日常备份”两种预设，否则每次备份 13 GB 级不可持续。

## 二、目标与非目标

### 2.1 目标

1. 设置页提供“一键导出备份包”：选择保存位置、设置读取密码，其余使用默认值。
2. 包内包含恢复所需的主数据、配置、密钥、笔记、文献、阅读批注和 Agent 记忆。
3. 包体只有一个文件，文件名默认 `PaperQuay-Backup-YYYYMMDD-HHmm.pqbackup`。
4. 导入时先输入密码，能预览包内容；确认后完整替换本机数据，自动重启并可直接使用。
5. 导入前保留本机旧数据目录与浏览器状态快照；失败回滚后与导入前的可用状态一致，不能出现「数据库回退了、批注却还是新包的」错配。
6. 完全移除 WebDAV：入口、命令、客户端、测试、`webdav_settings` 表与 `webdav` 字段一并删除，不保留只读恢复入口、兼容开关或隐藏入口（2026-11-06 确认）。

### 2.2 非目标

- 不做多端实时同步、双向合并、冲突解决。
- 不做自动定时上传或云端托管。
- 不做增量包链；每次导出都是完整快照。
- 不做包内文件级加密浏览；包必须整体导入。
- 不备份 Zotero 本地库、浏览器缓存、日志、截图、旧 `.bak` 文件。
- 不做密码找回；忘记密码只能重新导出。

## 三、方案总览

### 3.1 用户流程

导出：

1. 设置 → 备份与迁移 → “一键导出备份包”。
2. 选择保存位置（默认“文档”目录）。
3. 设置读取密码（输入两次，显示强度，提示不可找回）。
4. 查看预估体积与包含项；点击开始。
5. 进度面板显示“准备快照 / 写入包 / 校验 / 完成”；可取消。
6. 完成后显示包路径、体积、耗时和条目数。

导入：

1. 设置 → 备份与迁移 → “从备份包导入”。
2. 选择 `.pqbackup` 文件，输入读取密码。
3. 解密 manifest，显示创建时间、来源版本、平台、组件统计和体积。
4. 选择新的文献库目录（必选）和笔记 vault 目录（可跳过）。
5. 确认“将替换本机数据，旧数据保留为回滚目录”。
6. 暂存并校验；完成后提示“应用将重启以完成恢复”。
7. 重启后自动替换、重绑路径、恢复 localStorage，进入主界面并显示恢复摘要。

### 3.2 关键决策

| 编号 | 决策 | 理由 |
| --- | --- | --- |
| D1 | 单文件自定义容器，不用 ZIP/7z | 需要 10 GB 级流式读写、随机读 manifest、无外部依赖；ZIP 需要中央目录或整包临时文件 |
| D2 | AES-256-GCM + scrypt，Node 内置 `crypto` | 无新增运行时依赖；GCM 提供机密性与完整性；scrypt 抗 GPU |
| D3 | manifest 放包尾并加密 | 导出可顺序写；导入只读尾部即可验证密码和预览，不必先解密 13 GB 级数据 |
| D4 | 每 4 MB 一帧，全局帧计数器 nonce | 流式、低内存、可检测重排/截断；避免 nonce 复用 |
| D5 | 导出先 `VACUUM INTO` 快照三个库 | 复用现有 `snapshotTo` 实现（`libraryDatabaseStore.cjs:1125-1130`、`noteStore.cjs:1154-1159`、`ragStore.cjs:2201-2206`） |
| D6 | 导入先暂存，重启后离线替换 | 应用运行时不能安全替换 SQLite/WAL 与 Chromium LevelDB |
| D7 | 旧数据目录整体改名为 `.pre-import-<时间戳>` | 回滚简单；不逐文件合并，符合“完整迁移”语义 |
| D8 | localStorage 通过 IPC 导出 JSON，启动时回灌 | 不直接复制 Chromium LevelDB，避免版本/锁问题 |
| D9 | 路径重绑在启动时用 `node:sqlite` 直接改库 | 在打开 store 之前完成，避免缓存与写回覆盖 |
| D10 | 首版只支持完整替换，不支持合并导入 | 合并需要冲突规则；与“换机迁移”目标无关 |
| D11 | 导入暂存区按内容分成两个根：数据库类留在 `dataDir` 同卷，PDF/缓存类直接落到目标卷 | 否则要么跨卷复制 12 GiB，要么把 12 GiB 塞进系统盘；分队后只对「必须同卷 `rename`」的数据库类做同卷暂存 |
| D12 | 导出完成后默认执行整包回读自检 | 备份的价值是「可恢复」，未验证的包等于没有备份；顺序读 12 GiB 约 1–3 分钟，成本远低于一次失败的换机迁移 |
| D13 | 「日常备份」不含 RAG 时明确放弃 Agent 运行记录，不做事后半恢复 | 从 7.55 GiB 的 RAG 库里拆表导出需要复制一份表结构，长期会与 `ragStore` 的建表语句漂移；运行记录属可观测数据，在预设说明与导入摘要里显式告知，比“看起来恢复了实际丢了一半”更可预期 |

弃选的备选方案（评审补充，供后续复核时免于重复讨论）：

| 备选 | 弃选理由 |
| --- | --- |
| `tar` + `age`（scrypt 口令模式） | 格式成熟可审计，但 Node 无内置 tar/age 实现；引入依赖与 PAX 长路径/Unicode 处理的工作量与自定义容器相当，且无法只读包尾拿到 manifest |
| `7z`/`zip` 外部 CLI | 需打包二进制并处理跨平台许可；ZIP 无中央目录前无法随机读 manifest，只能整包临时落地 |
| 依赖 BitLocker/VeraCrypt 等系统级加密盘 | 不满足「单文件、跨机、直接导入」的使用方式；可作为额外防线而非替代 |
| 云端托管 / 多端实时同步 | 与首版「离线快照迁移」定位冲突，且引入账号、带宽与合规问题 |

## 四、包格式与加密

### 4.1 容器布局

```text
+---------------------------------------------------------------+
| Preamble（明文，固定 104 字节）                                |
|   magic 8 | formatVersion 2 | flags 2 | kdfId 1 | cipherId 1   |
|   frameSize 4 | salt 32 | baseNonce 8 | wrappedDekLen 2        |
|   wrappedDekNonce 12 | reserved 16 | packageUuid 16           |
+---------------------------------------------------------------+
| Wrapped DEK（AES-256-GCM，密文 32 + tag 16，共 48 字节）       |
+---------------------------------------------------------------+
| Data frames（按 entry 顺序连续排列）                           |
|   [storedLen u32][ciphertext storedLen][tag 16] ...            |
+---------------------------------------------------------------+
| Manifest（AES-256-GCM 加密的 JSON，密文 + tag 16）             |
+---------------------------------------------------------------+
| Footer（明文，固定 68 字节）                                   |
|   magic 8 = `PQFT0001` | manifestOffset u64 | manifestLength u32 |
|   manifestNonce 12 | dataSha256 32 | reserved 4                |
+---------------------------------------------------------------+
```

固定偏移：数据区从第 152 字节开始（104 + 48）；首条 entry 的 `dataOffset` 默认为 152。

- 所有整数小端序。
- `manifestLength` 是 manifest 密文长度，不含 16 字节 GCM tag；footer 固定 68 字节另计。
- 明文 preamble 暴露格式版本、算法 ID、帧大小、KDF profile ID、盐、nonce 与包 UUID；不暴露文件名、路径、条目数或大小统计。首版 `kdfId=1` 固定映射 `scrypt(N=131072,r=8,p=1,dkLen=32)`，实际参数不作为可变字段写入。
- Footer 不单独做 MAC：manifest 解密的 AAD = `preamble` 全字段 + `wrappedDek` 全字节 + footer 全字段；改动任一字段都会导致 manifest 认证失败。
- 数据区 `dataSha256` 同时覆盖 preamble 之后到 manifest 之前的全部密文字节；导入时可与逐帧解析并行计算，不额外扫盘。
- 包写入先落到同目录 `.partial`，完成后 `fsync` 并原子 `rename`。
- 写入顺序固定：`preamble` → `wrappedDek` → 数据帧（边读边写）→ **预计算 `footer` 字节** → 用含该 footer 全字段的 AAD 加密 `manifest` → 写 `manifest` → 写 `footer`。footer 必须先于 manifest 定型，否则 manifest 的 AAD 无从计算；落盘位置仍在文件末尾。
- 偏移语义唯一定义：`dataLength = Σ_i(4 + storedLen_i + 16)`，`dataOffset_{i+1} = dataOffset_i + dataLength_i`，`dataOffset_0 = 152`。连续性校验用「不重叠且无空洞」，因此**相邻零长度 entry 允许 `dataOffset` 相等**，校验实现不能用严格递增断言。所有 `dataOffset` 必须落在 `[152, manifestOffset)`。
- `fsync` 只保证文件内容落盘；目录项 `fsync` 仅 POSIX 有效，Windows 上 `rename` 覆盖为尽力而为。因此必须保留 `.partial` 直到 `rename` 返回成功，并在下一次启动时按 `owner.json` 判定清理（见 6.2），不能假定「rename 一定原子可见」。

### 4.2 头部字段

| 字段 | 长度 | 说明 |
| --- | ---: | --- |
| `magic` | 8 | ASCII `PQBACKUP` |
| `formatVersion` | 2 | 首版为 `1` |
| `flags` | 2 | bit0：含 RAG；bit1：含派生缓存；bit2：含 vault |
| `kdfId` | 1 | `1 = scrypt` |
| `cipherId` | 1 | `1 = AES-256-GCM` |
| `frameSize` | 4 | 原始明文帧大小，默认 `4 * 1024 * 1024`；压缩后 `storedLen` 允许 +64 KiB 开销 |
| `salt` | 32 | 随机盐 |
| `baseNonce` | 8 | 包级随机前缀；数据帧 nonce = 前缀 + 全局帧序号（u32） |
| `wrappedDekLen` | 2 | 固定 32（DEK 密文长度，不含 16 字节 tag） |
| `wrappedDekNonce` | 12 | 包裹 DEK 的随机 nonce |
| `reserved` | 16 | 置零，未来扩展 |
| `packageUuid` | 16 | UUIDv4 二进制，用于 AAD 与日志 |

导入时先校验 `magic`、`formatVersion`、`frameSize` 与 `kdfId` 白名单；首版仅接受 `kdfId=1` 固定 scrypt profile，不认识的版本或 profile 直接拒绝。

- `packageUuid` 必须是 manifest `packageId`（小写带连字符 UUID）去掉连字符后的 16 字节；两者不一致直接拒绝。
- `flags` 只用于预览展示（“含 RAG / 含缓存 / 含 vault”），恢复行为一律以 manifest `entries` 为准；导出端必须保证 flags 与 entries 自洽，声明含 RAG 却找不到对应 entry 视为包损坏。
- 未来扩展只能使用 `flags` 保留位或 `reserved` 字段，不得改变固定偏移与固定字段长度；因此 `reserved` 必须参与 AAD 而非被忽略。

### 4.3 KDF 与密钥

- 密码处理：UTF-8；Unicode NFC 规范化；不 trim（首尾空格属于密码）；长度 8–256 字符。
- KDF：首版 `kdfId=1` 固定使用 `scrypt(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 268435456 })`。104 字节 preamble 没有可变 N/r/p/dkLen 字段；新增 profile 必须分配新的 kdfId 并保留旧 profile 导入支持。
- 本机实测 172 ms（2026-11-05，当前开发机）；低端机预计 0.5–1 s。使用异步 `crypto.scrypt`，不阻塞 UI。
- 密钥层级：
  - `KEK = scrypt(password, salt)`；
  - `DEK` 为 32 字节随机数据密钥；
  - `wrappedDek = AES-256-GCM(KEK, wrappedDekNonce, DEK, AAD = preamble)`；
  - 数据与 manifest 使用 `DEK`。
- 密码错误与包损坏统一提示“密码错误或备份包已损坏”，不区分具体原因。
- 当前固定 profile 在调用 scrypt 前由 `kdfId` 精确映射并验证，包内不能声明自定义成本参数，因此拒绝未知 kdfId，避免恶意参数导致内存 DoS。
- 未来升级新增 `kdfId` 时定义新的固定 profile，导入端保留旧 profile 支持；不得仅凭 manifest 接受可变 scrypt 参数。

### 4.4 数据分帧与 AAD

每个 entry 的明文按 `frameSize` 分帧；每帧独立压缩、独立加密：

```text
u32 storedLen | ciphertext(storedLen) | tag(16)
```

- 第 `frameIndex` 帧的原始明文长度由 entry 大小推导：`rawLength = min(frameSize, entry.size - frameIndex * frameSize)`；空文件 `frameCount = 0`。读取端也按同一公式校验，不信任包内额外字段。
- `storedLen` 是压缩后的长度，允许略大于 `rawLength`：上限 `frameSize + 64 KiB`；`compression = none` 时 `storedLen = rawLength`。解密并 inflate 后的字节数必须恰好等于 `rawLength`。
- nonce 使用 12 字节：`baseNonce(8) || globalFrameIndex(4)`；`globalFrameIndex` 在整个包内单调递增，跨 entry 不重置，断言不超过 `2^32-1`。
- AAD 绑定：`packageUuid || entryIndex(u32) || frameIndex(u32) || rawLength(u32) || storedLen(u32) || entryPlainSize(u64)`。
- 读取端按 manifest 的 `entry.size` 累计明文长度；不足或超出都判失败。
- 压缩在加密之前进行，每帧独立 `deflate-raw`（字典不跨帧）。压缩策略：
  - `none`：PDF、JPG/PNG/WEBP、SQLite（RAG 库以向量 BLOB 为主，压缩收益低）；
  - `deflate-raw`：JSON、Markdown、TXT、日志；
  - 对 SQLite/JSON 先采样 1 MiB 估算压缩率，收益低于 5% 时自动改用 `none`；
  - 默认压缩级别 6；导出选项可改“快速（1）/标准（6）/不压缩”。
- 防解压炸弹：解压后的累计字节不得超过 manifest 的 `entry.size`；压缩比超过 200:1 或单帧解压超过 `frameSize` 立即失败。
- 单帧 4 MiB，内存占用上限约 12 MiB（输入、压缩、密文、tag 缓冲），与包体积无关。

### 4.5 Manifest

Manifest 是 UTF-8 JSON，加密后放包尾。结构：

```json
{
  "manifestVersion": 1,
  "packageId": "uuid",
  "createdAt": "2026-11-05T15:00:00.000Z",
  "app": {
    "name": "PaperQuay",
    "version": "0.5.0",
    "minReaderVersion": "0.5.0",
    "platform": "win32",
    "arch": "x64"
  },
  "schema": {
    "library": 1,
    "notes": 1,
    "rag": 1
  },
  "sourceRoots": {
    "dataDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay",
    "libraryStorageDir": "C:\\Users\\yusen\\Documents\\BaiduSyncdisk\\paperq",
    "translatedPdfDir": "C:\\Users\\yusen\\Documents\\BaiduSyncdisk\\paperq\\translated-pdfs",
    "mineruCacheDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay\\.mineru-cache",
    "remotePdfDownloadDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay\\.downloads\\pdfs",
    "notesVaultDir": "C:\\Users\\yusen\\Downloads\\my-note"
  },
  "resolvedRoots": {
    "dataDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay",
    "libraryStorageDir": "C:\\BaiduSyncdisk\\paperq",
    "translatedPdfDir": "C:\\BaiduSyncdisk\\paperq\\translated-pdfs"
  },
  "counts": {
    "papers": 173,
    "attachments": 201,
    "notes": 9,
    "noteFolders": 2,
    "ragIndexes": 271,
    "ragDocuments": 177,
    "ragChunks": 274081,
    "agentMemoryFiles": 13,
    "localStorageKeys": 25
  },
  "entries": [
    {
      "index": 0,
      "kind": "database",
      "sourceRoot": "dataDir",
      "relativePath": "paperquay-library.sqlite",
      "packagePath": "data/paperquay-library.sqlite",
      "originalName": "paperquay-library.sqlite",
      "size": 3330048,
      "sha256": "…",
      "compression": "none",
      "dataOffset": 152,
      "dataLength": 3330068,
      "frameCount": 1,
      "mtimeMs": 1762300000000
    }
  ],
  "warnings": []
}
```

约定：

- `sourceRoot` + `relativePath` 用于导入后路径重绑；`packagePath` 只用于展示与调试。
- `sourceRoots` 记录用户配置路径；`resolvedRoots` 记录 `realpath` 结果，用于匹配数据库里可能使用 junction 路径的旧记录。两者都参与最长前缀匹配。
- **未配置的源根写 `null`，不写空字符串**。`translatedPdfDir`、`notesVaultDir`、`zoteroLocalDataDir` 在默认设置里就是 `''`；若把 `''` 当作源根参与前缀匹配，空前缀会命中全部路径，把未收录附件全部误判为“已重绑”。导入端把 `null`/`''` 一律视为“无此根”，不建立映射项。
- `schema` 取各库 `PRAGMA user_version`；当前三个库均为 0，本版本起写入 1。导入端只拒绝高于自身支持版本的值，低版本交给现有建表迁移。`PRAGMA user_version` 只作信息记录，**不承担迁移语义**——三个库的迁移仍由各自 `createSchema` 的幂等语句负责；不要据此实现「版本 N 才执行某迁移」的分支，否则两个机制早晚对不上。
- `manifest.packageId` 必须等于头部 `packageUuid`；不一致直接拒绝，防止拼接两个包的 manifest 与数据区。
- `sourceRoot` 必须是 `sourceRoots`/`resolvedRoots` 中存在的键，或固定值 `external`；未知值直接拒绝，避免导入端猜测路径。
- `relativePath` 一律使用 `/` 分隔，禁止 `..`、绝对路径、盘符、UNC 前缀、空段、NTFS ADS（`file.pdf:1`）、Windows 保留名（`CON`、`PRN`、`AUX`、`NUL`、`COM1`…）和结尾点/空格。
- `entries` 按 `dataOffset` 升序；导入端校验 `dataOffset + dataLength` 连续、无重叠、无空洞、末条结束位置等于 manifestOffset。空文件 `size = 0`、`dataLength = 0`、`frameCount = 0`，导入时仍需创建目标空文件；连续性校验必须容许相邻零长度 entry 的 `dataOffset` 相等，否则含多个空文件的合法包会被误判为损坏。
- 路径按 Unicode NFC 归一化后再做大小写折叠去重；Windows 上仅大小写不同的 entry 会互相覆盖，必须拒绝或按固定规则改名。
- 相对路径总长超过 240 字符时，包内使用 `<sha16>-<ext>` 短名，manifest 保留 `originalName`；导入后 `attachments.file_name` 使用短名，避免 Windows 长路径失败。
- `counts.ragIndexes` 为 `rag_indexes` 行数，`ragDocuments` 为 `COUNT(DISTINCT document_key)`，`ragChunks` 为 `rag_chunks` 行数；三者在导入校验时分别比对，不能互相替代。
- `warnings` 每个元素为 `{ code, kind?, originalName?, detail? }`，`code` 取固定枚举（`FILE_MISSING_AT_EXPORT`、`FILE_UNSTABLE_AT_EXPORT`、`PERMISSION_DENIED`、`SYMLINK_IN_ROOT`、`ABS_PATH_IN_CACHE_META`、`VAULT_ORPHAN`、`CONTENT_HASH_MISMATCH` 等），最多 1000 条，超出只保留计数 `warningsTruncated`。条目不阻断整个包；导入端据此把附件标记为缺失。UI 展示时必须脱敏：只显示 `kind` 与文件名，不展示包含用户名的绝对路径。
- manifest 大小上限 64 MB，条目数上限 200,000；超出直接拒绝，避免恶意包耗尽内存。

`kind` 取值与恢复目标：

| kind | 恢复位置 |
| --- | --- |
| `database` | 新 `dataDir` 固定文件名 |
| `config` | 新 `dataDir/.settings/paperquay.config.json` |
| `agent-memory` | 新 `dataDir/agent-memory/` |
| `knowledge-graph` | 新 `dataDir/paperquay-knowledge-graph-relations.json` |
| `library-pdf` | 新文献库目录；按 `paperId-attachmentId` 命名 |
| `translated-pdf` | 新译文目录 |
| `mineru` | 新 `dataDir/.mineru-cache/` |
| `notes-vault` | 用户选择的 vault 目录 |
| `renderer-local-storage` | preload 回灌 localStorage |
| `other` | 新文献库 `restored/`，并记录 warning |

### 4.6 完整性校验

导出时计算并写入：

- 每个 entry 的明文 SHA-256；
- 数据区（preamble 之后到 manifest 之前）的 SHA-256；
- manifest 自身的 GCM tag。

导入时：

1. 校验 footer magic、偏移范围、manifest 长度上限；`manifestOffset + manifestLength + 16 + 68` 必须等于文件长度；
2. 解包 DEK，解密 manifest，验证 AAD；
3. 校验 entry 路径安全、偏移连续、大小与帧数一致；
4. 解密每个 entry 时同步计算 SHA-256，与 manifest 比对；
5. 全部通过后才允许提交恢复。

任一步失败都不改动本机数据。

### 4.7 威胁模型与限制

能防：

- 包文件被网盘、U 盘、邮件中转时，第三方无法读取内容；
- 包被篡改、截断、重排时导入失败，不会静默写入错误数据；
- 密码错误时无法解密 manifest，也无法枚举文件名。

不能防：

- 密码过弱被离线暴力破解；因此强制 8 位以上并显示强度提示；
- 运行中的恶意软件、键盘记录器、屏幕录制；
- 已解锁的 PaperQuay 进程读取本机明文配置；
- 删除旧 `.pre-import-*` 或导出 staging 只做文件删除，SSD/日志文件系统不保证物理擦除；敏感环境应配合全盘加密；
- 包来源真实性（没有签名）。首版只保证完整性，不保证“是谁导出的”；后续可加 Ed25519 签名，不影响格式版本。

## 五、备份内容清单

### 5.1 主数据（默认必选）

| 组件 | 源位置 | 包内路径 | 跨机处理 | 代码依据 |
| --- | --- | --- | --- | --- |
| 阅读器配置与密钥 | `dataDir/.settings/paperquay.config.json` | `config/paperquay.config.json` | 重写 `mineruCacheDir`、`remotePdfDownloadDir`；保留 API Key | `libraryStore.cjs:17`、`src/services/readerConfig.ts:9-27` |
| 文献库数据库 | `dataDir/paperquay-library.sqlite` | `data/paperquay-library.sqlite` | 路径重绑；设置表更新 | `libraryStore.cjs:21` |
| 笔记数据库 | `dataDir/paperquay-notes.sqlite` | `data/paperquay-notes.sqlite` | 无需改路径 | `libraryStore.cjs:22` |
| 文献 PDF | `attachments.storedPath` 指向的文件 | `library/<entryId>.pdf` | 复制到新文献库目录并改 `stored_path` | `libraryDatabaseStore.cjs:114-128` |
| 翻译版 PDF | 同上，`kind = translated-pdf` | `translated/<entryId>.pdf` | 复制到新译文目录并改路径 | `translatedPdfAttachments.cjs:28-36` |
| Agent 记忆 | `dataDir/agent-memory/` | `data/agent-memory/` | 原样恢复 | `agentMemoryStore.cjs:61-115` |
| 知识图谱关系 | `dataDir/paperquay-knowledge-graph-relations.json` | `data/knowledge-graph-relations.json` | 原样恢复 | `knowledgeGraphCommands.cjs:15`、`100-117` |
| 阅读器 localStorage | 渲染层全部键 | `renderer/local-storage.json` | 由 preload 在 document-start 回灌；按白名单字段替换路径 | `src/utils/paperHistory.ts:11`、`src/features/agent/AgentWorkspace.model.ts:15` |
| 笔记 Markdown vault | vault 目录中 manifest 记录的文件 + `.paperquay-vault.json` | `notes-vault/...` | 恢复到用户选择的新目录；未选则跳过；只打包 manifest 管理的文件，不打包 `.obsidian` | `noteVault.cjs:15`、`81-110` |

#### 5.1.1 localStorage 键清单

| 分组 | 键 | 说明 |
| --- | --- | --- |
| 主数据 | `paper-reader-paper-history-v1` | 批注、QA 会话、滚动位置、阅读热图、工作区笔记草稿、论文摘要 |
| 主数据 | `paperquay-agent-history-v1` | Agent 会话历史 |
| 主数据 | `paperquay-review-writing-draft-v1` | 综述写作草稿 |
| 主数据 | `paperquay:block-reparse:v1:<docHash>` | 区块重新识别的手工修复覆盖 |
| 设置 | `paper-reader-settings-v3` | 阅读器、模型、翻译、RAG、引用样式等设置 |
| 设置 | `paper-reader-secrets-v1` | 旧版密钥暂存；成功写入 config 后应已删除，恢复时作为兜底 |
| 迁移标记 | `paperquay:note-folders:v1`、`paperquay:note-folders-migrated:v1` | 旧笔记文件夹树及迁移标记 |
| 迁移标记 | `paperquay:note-citation-style:v1`、`:migrated` | 旧引用样式及迁移标记 |
| UI 偏好 | `paperquay-theme-mode`、`paperquay-active-workspace-v1`、`pq.perf` | 主题、当前工作区、性能开关 |
| UI 偏好 | `paper-reader-pane-ratio-v2`、`paper-reader-assistant-panel-width-v1`、`paper-reader-workspace-header-collapsed-v1` | 阅读器布局 |
| UI 偏好 | `paperquay-literature-title-display-v1`、`paperquay-literature-paper-sort-v1`、`paperquay-literature-details-width-v1`、`paperquay-literature-category-sidebar-width-v1` | 文献库布局与排序 |
| UI 偏好 | `paperquay-pdf-annotation-colors-v1`、`paperquay-pdf-thumbnails-collapsed-v2`、`paperquay-pdf-sidebar-tab-v1`、`paperquay-pdf-outline-collapsed-v1:<sig>`、`paperquay-pdf-reading-heatmap-bar-visible-v1` | PDF 批注颜色、侧栏状态与热力条显示 |

导出时收集全部键（包括未来新增键），不依赖固定清单；上表只用于验收核对与路径替换白名单。

#### 5.1.2 密钥清单

| 位置 | 字段 | 用途 |
| --- | --- | --- |
| `config.secrets` | `mineruApiToken` | MinerU 解析（支持多 Key） |
| `config.secrets` | `paddleOcrApiToken` | PaddleOCR-VL 解析 |
| `config.secrets` | `translationApiKey`、`summaryApiKey` | 翻译、概览 |
| `config.secrets` | `embeddingApiKey` | 本地 RAG Embedding |
| `config.secrets` | `zoteroApiKey`、`zoteroUserId` | Zotero Web 回退 |
| `config.secrets` | `qaModelPresets[].apiKey` | 各模型预设 |
| `library_settings` | `openAlexApiKey` | OpenAlex 元数据 |
| 已删除 | `webdav_settings.password` | WebDAV 功能彻底移除后连表一并删除，不进入新包 |

包内不包含操作系统凭据、Zotero 本地库密码或用户主目录中的其他密钥。

### 5.2 派生数据（默认包含在“完整迁移包”，可在“日常备份”关闭）

| 组件 | 源位置 | 包内路径 | 说明 |
| --- | --- | --- | --- |
| RAG 数据库 | `dataDir/paperquay-rag.sqlite` | `data/paperquay-rag.sqlite` | 7.55 GiB；内含 Agent 运行记录 `agent_runs`/`agent_run_events`；不含则导入后需重建索引，运行记录也会丢失（见 D13，属已接受的取舍） |
| MinerU 解析缓存 | `dataDir/.mineru-cache/` 或配置的自定义目录 | `derived/mineru/<rootKey>/...` | 2.36 GiB；含 images、`*_origin.pdf`、translations、summaries；不含则阅读时重新解析 |
| 翻译/摘要缓存 | MinerU 缓存内的 `translations/`、`summaries/` | 随 `derived/mineru/` | 与缓存同生命周期 |

说明：默认缓存目录与自定义缓存目录可能同时存在，导出时按 `rootKey`（`default` 或 `custom-<hash8>`）分区，避免相对路径冲突；导入后统一合并到新 `dataDir/.mineru-cache`，同名文件按内容哈希加后缀并记录映射。导入完成后调用现有 `repair_mineru_cache_images` 逻辑扫描一次，修复 JSON 内的图片引用；MinerU 当前产物使用相对 `images/...` 路径，绝对路径引用会保留并记入 warning。

### 5.3 明确排除

**不按整个 `dataDir` 打包**，只按白名单收集。否则会把旧 `.bak`、WebDAV 凭据、WAL/SHM 和临时快照带入包内。

| 项 | 原因 |
| --- | --- |
| `dataDir/backups/`、`*.bak-*`、`*.pre-import-*` | 历史备份与旧数据，不属于当前状态 |
| `dataDir/.backup-snapshots/`、`.backup-restores/`、`.backup-staging/`、`.pq-tmp/` | 临时目录，可能含明文数据库副本 |
| `dataDir/.screenshots/` | 系统截图缓存 |
| `dataDir/.downloads/pdfs/` 中未被附件引用的文件 | 远程 PDF 下载缓存；被引用的按附件收录 |
| `Cache/`、`Code Cache/`、`GPUCache/`、`Session Storage/`、`Local Storage/` 原始 LevelDB | 可用 localStorage JSON 替代；LevelDB 复制不安全 |
| `Zotero` 本地数据目录 | 外部库，可能数十 GB；导入后重置为空，由用户重新配置 |
| `dist/`、`release/`、日志、`desktop-run` 标记 | 构建产物或运行时状态 |
| `dataDir/paperquay-library.json` | 0.4 以前的旧版单文件库，仅在数据库未初始化时作为一次迁移源（`libraryDatabaseStore.cjs:1028`）；当前状态以 SQLite 为准，带入只会重复一份旧数据 |
| `webdav_settings` 表 | 功能彻底删除，建库时直接 `DROP TABLE IF EXISTS`；不再备份 |

### 5.4 预设

| 预设 | 包含 | 约体积 | 适用 |
| --- | --- | ---: | --- |
| 完整迁移包（默认） | 主数据 + RAG + MinerU/翻译/摘要 + vault | 12.2 GiB | 换电脑、重装系统 |
| 日常备份 | 主数据 + PDF + vault，不含 RAG 与 MinerU 缓存 | 2.3 GiB | 定期快照；**不含 Agent 运行记录与 token 用量**，也不含批注以外的阅读缓存 |
| 自定义 | 逐项勾选 | 按选择 | 高级用户 |

默认选中“完整迁移包”，符合用户“一键导出所有需要备份的数据”的预期；高级选项折叠，不增加主流程操作。

## 六、导出流程

### 6.1 UI 入口

设置节改名“备份与迁移”，替换 `ReaderPreferencesBackupSection`。主面板：

- 主按钮：“一键导出备份包”“从备份包导入”。
- 最近一次导出：时间、路径、体积、结果；失败显示原因。
- 高级选项（折叠）：包含 RAG、包含解析缓存、包含 vault、压缩级别。
- 固定提示：包内包含 API Key 与密码，请妥善保管；密码不可找回。

### 6.2 后端步骤

1. `backup_export_estimate`：扫描附件、缓存目录、vault，返回条目数与预估体积；只做 `stat`，不计算哈希、不读文件内容。Windows 上 5 万级 `stat` 约 5–20 s，必须异步执行并在 UI 显示“正在统计”，同时缓存上次结果（按目录 `mtime` 失效），避免每次打开设置页都重新遍历。
2. 用户确认后，`backup_export_start`：
   - 获取全局备份锁；若已有导出/导入，返回 `BACKUP_BUSY`。
   - 预检磁盘：`所需 = 预估包体积 + 最大单个快照（RAG 7.55 GiB） + 1 GiB 安全余量`；包输出盘与 `dataDir` 盘分别计算。FAT32 且包 > 4 GiB 时拒绝。
   - 拒绝把包输出到 `dataDir`、文献库目录、MinerU 缓存、vault 或其子目录：否则写入中的 `.partial` 会被再次扫描，造成递归打包。
   - 创建暂存目录 `dataDir/.backup-staging/<id>/`，只存放三个库的 `VACUUM INTO` 快照；PDF 与缓存类条目直接从原文件边读边写入包体，不预复制。导出失败或取消时删除，启动时按 `owner.json` 清理孤儿目录。
   - 用 `snapshotTo` 生成文献库、笔记库快照；RAG 快照通过 worker RPC；快照完成后立即写入包并删除，避免同时占用三份空间。
   - RAG worker 不可用或回退到 in-process 时，不在主进程直接 `VACUUM` 8 GiB；改为跳过 RAG 并写入 `warnings`，或要求用户先切换到 worker 模式。
   - 渲染层在调用前收集 `localStorage` 快照（全部键），作为 `rendererState` 参数传入。
   - 写配置条目前做一次合并：读取磁盘上的 `paperquay.config.json`，若不存在则以默认配置 + localStorage `paper-reader-settings-v3` 构造；若存在且 localStorage 的 settings 更新，则用 localStorage 覆盖 settings；`secrets` 以配置文件为准，缺失字段用 localStorage `paper-reader-secrets-v1` 兜底。只改包内副本，不改本机配置。
   - 写包：preamble → wrapped DEK → 各 entry 数据帧（边读边写）→ 预计算 footer → 加密 manifest → 写 manifest → 写 footer。所有 entry 一律用 `fs.createReadStream` 逐帧读取，写入端做显式背压（`highWaterMark` 1–4 MiB 或 `stream.pipeline`）；禁止用 `readFile`/`readFileSync` 处理任何可能超过 8 MiB 的文件，否则峰值内存不可控。
   - 跳过明显处于写入中的文件：扩展名 `.tmp`/`.part`/`.crdownload`，或 `mtime` 距导出开始不足 10 s 的文件，记 `FILE_UNSTABLE_AT_EXPORT`，不阻断整体导出——避免包内出现半写的 MinerU JSON 或翻译缓存。
   - 每个文件边读边算 SHA-256；文献库/笔记库快照写入后执行 `PRAGMA integrity_check`；RAG 库刚由 `VACUUM INTO` 生成，只做 `quick_check` 与计数，避免为 7.55 GiB 再付一次深检成本。
   - 完成后 `fsync`、`rename`，删除 staging。随后默认执行**整包回读自检**：重新打开刚生成的包，逐 entry 解密、校验 SHA-256 与帧长度，并比对 manifest 计数。12.2 GiB 包为顺序读，预计 1–3 分钟，可与“导出”阶段合并显示，不额外增加交互；自检失败则删除该包并报错，不把未验证的包交给用户。高级选项可关闭该自检，但 UI 必须标注“未校验”。
3. `backup_export_cancel`：设置取消标志；写入器在每个帧边界检查；删除 `.partial` 与 staging。

导出前后台不得有第二个实例。所有临时目录权限收紧到当前用户。导出开始时在 staging 与 `.partial` 旁写入 `owner.json`（`pid` + 启动时间）：启动清理先按 `pid` 判定，`process.kill(pid, 0)` 报 `ESRCH` 说明属主已退出，**立即**删除；无法判定时才用 24 小时阈值。`.backup-staging` 内含明文数据库与密钥副本，不能固定等 24 小时。清理 `PaperQuay-restore/` 时跳过 `pending.json` 引用的目录。

### 6.3 进度事件

`paperquay://backup-progress`：

```ts
type BackupProgress = {
  direction: 'export' | 'import';
  phase: 'preflight' | 'collecting' | 'snapshot' | 'writing' | 'verifying' | 'done' | 'failed';
  completedBytes: number;
  totalBytes: number;
  completedEntries: number;
  totalEntries: number;
  currentLabel: string; // 只显示“文献库快照”“PDF 12/225”，不显示完整路径
};
```

事件节流 200 ms；UI 用字节数与条目数双进度，长文件不会看起来卡住。

### 6.4 一致性与失败清理

- 导出是“数据库快照时刻 + 文件读取时刻”的近似一致；不锁定整个应用。RAG 是派生数据，允许与文献库有几秒偏差。
- 收集文件前对每个源根做 `realpath`：根目录本身允许是 junction（本机文献库就是 junction），根内遇到 symlink/reparse point 直接报错并记入 `warnings`，不静默跳过。
- 包含判断用 `realpath` 后的相对路径，不用字符串前缀；避免 `C:\lib` 误判 `C:\library`。
- 文件在读取中被删除或权限不足：记入 `warnings`，跳过该条目；包仍可完成，导入端将该附件标记缺失。
- 磁盘满、写入失败、用户取消：删除 `.partial` 与 staging，原数据不动。
- `VACUUM INTO` 在 SQLite 内不可中断；快照阶段点击取消只记录标志，等当前快照完成后停止。UI 在快照阶段显示“正在完成数据库快照，暂时无法取消”，避免误以为按钮失效。
- 目标盘为 FAT32 且预估 > 4 GB：开始前提示更换 NTFS/exFAT，不尝试写入。
- 目标盘剩余空间 < 预估包体积 + 1 GB：拒绝开始。

## 七、导入流程

### 7.1 检查与预览

`backup_import_inspect({ packagePath, password })`：

1. 校验文件头、footer、版本、KDF 参数范围。
2. 解包 DEK、解密 manifest；失败返回统一错误。
3. 校验路径安全、条目上限、偏移连续。
4. 返回预览：创建时间、来源版本/平台、组件统计、体积、warnings、是否含 RAG/缓存/vault。
5. 来源版本高于当前 App，或 `manifest.app.minReaderVersion` 高于当前 App：拒绝并提示先升级 PaperQuay；`manifest.schema.*` 高于当前支持版本同样拒绝；低于当前版本：允许，由当前版本做数据库迁移。

### 7.2 暂存与校验

`backup_import_stage({ packagePath, password, targets, currentRendererState })`：

- 重新读取并验证 manifest（不信任 inspect 阶段的缓存结果）；包文件在 inspect 与 stage 之间被替换时，签名/密码校验会失败。
- 前置：`app.requestSingleInstanceLock()` 已生效（主判断）；`desktopRunMarker` 只用于检查是否还有其他存活 PID，必须排除 `process.pid`，不能把当前实例自己判为第二个实例；用户已关闭使用 PaperQuay MCP 的外部 Agent。检测到其他占用时返回 `APP_RUNNING`，不动任何文件。
- 拒绝包文件位于 `dataDir`、旧文献库目录、MinerU 缓存或 vault 内：应用阶段会整体改名这些目录，包路径会失效。
- `targets.libraryStorageDir` 必选；默认建议 `<用户文档>/PaperQuay Library`，不要使用旧 `dataDir` 内的默认 `paperquay-data`。`targets.translatedPdfDir` 默认 `<library>/translated-pdfs`；`targets.notesVaultDir` 默认跳过，选择已有 vault 时只补充缺失文件，不覆盖同名文件或同 ID 笔记。目标目录不得位于旧 `dataDir` 内，也不得位于旧文献库目录内部（避免整体改名时被带走）。
- 若目标文献库目录与当前 `library_settings.storageDir` 相同或已存在非空内容：导入前列出将保留的旧目录，应用阶段把它改名为 `<library>.pre-import-<时间戳>`，再创建新目录；回滚时改回。不要直接覆盖旧 PDF。
- 创建两个暂存根（D11），并在 `pending.json` 中分别记录：
  - `stagingDataDir = userData/PaperQuay-restore/<restoreId>/data`：必须与 `dataDir` 同级同卷（系统盘）。只放数据库、配置、Agent 记忆、知识图谱，以及导入前的 localStorage 快照。这批内容要 `rename` 成为新 `dataDir`，跨卷会退化为 12 GiB 级复制。
  - `stagingAssetsDir = <targets.libraryStorageDir 的父目录>/.pq-import-<restoreId>`：放 PDF、翻译版 PDF、MinerU 缓存与 vault，落在目标卷，提交时尽量同卷 `rename` 到位。该目录不得位于将被改名的旧文献库目录内部。
- 流式解密到上述两个暂存根：
  - 数据库/配置/Agent 记忆/知识图谱 → `stagingDataDir/...`
  - PDF/翻译版 PDF → `stagingAssetsDir/library/...`
  - MinerU 缓存 → `stagingAssetsDir/derived/mineru/...`
  - vault → `stagingAssetsDir/notes-vault/...`
- 同时把**本机当前**渲染层 localStorage 全量快照（由 `currentRendererState` 传入）写入 `userData/PaperQuay-restore/<restoreId>/renderer-local-storage.pre-import.json`。这是回滚时恢复批注、QA 会话与 Agent 历史的唯一依据：`dataDir` 改名不覆盖 `userData/Local Storage/leveldb`，若不留这份快照，回滚后数据库回到旧版本而浏览器状态仍指向新包，批注与文献会对不上且不可恢复。
- 每个条目边写边算 SHA-256；不匹配立即失败并删除 staging。
- 落盘路径用 `realpath` 校验父目录仍在 staging 目标根内；不跟随包内路径的 symlink/reparse point，不允许通过目标目录的 junction 逃逸到根外。
- 打开 `stagingDataDir` 中的三个 SQLite：
  - 文献库、笔记库执行完整 `PRAGMA integrity_check`；
  - RAG 库必须用与 `ragStore.cjs:841-851` 相同的方式 `allowExtension: true` + 加载 `sqlite-vec`，否则 `vec0` 虚拟表会导致检查失败；
  - RAG 库体积大，默认执行 `PRAGMA quick_check` + `rag_indexes`/`rag_chunks` 行数校验；完整 `integrity_check` 作为“深度校验”选项，不默认开启；
  - 统计 `papers`、`attachments`、`notes`、`note_folders`、`rag_indexes`、`rag_chunks`、`COUNT(DISTINCT document_key)`，与 manifest 的 `counts` 对比；
  - 任一不一致则拒绝提交。
- 空间预检（按两个暂存根分开算）：`dataDir` 所在盘需容纳 `stagingDataDir 体积 + 旧 dataDir 体积 + 1 GiB`（新 `dataDir` 由 `stagingDataDir` 改名而来，不再额外占一份）；目标卷需容纳 `stagingAssetsDir 体积 + 1 GiB`（提交时同卷 `rename`，不翻倍），若提交会跨卷则再加一份解压后的资产体积。不满足时建议改用“日常备份”、先清理旧 `.pre-import-*`，或把目标文献库换到空间更大的盘。
- 目标存在同名文件时不覆盖；按 `paperId-attachmentId-<hash>` 生成新文件名，并写入重绑表。
- 暂存阶段可取消；取消时同时删除 `PaperQuay-restore/<restoreId>/` 与 `stagingAssetsDir`（两处都要清，只删一处会留下含 PDF 与密钥的资产目录），不写 pending，不改本机数据。

### 7.3 提交与重启

暂存成功后，把恢复日志写在 **`dataDir` 之外**：`userData/PaperQuay-restore/pending.json`。日志不能放在 `dataDir` 内，否则整体改名后读不到。

```json
{
  "version": 1,
  "checksum": "sha256-of-fields",
  "restoreId": "20261105-153000-ab12",
  "createdAt": "2026-11-05T15:30:00.000Z",
  "step": "prepared",
  "stagingDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay-restore\\20261105-153000-ab12",
  "stagingDataDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay-restore\\20261105-153000-ab12\\data",
  "stagingAssetsDir": "D:\\PaperQuay Library.pq-import-20261105-153000-ab12",
  "rendererSnapshotPath": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay-restore\\20261105-153000-ab12\\renderer-local-storage.pre-import.json",
  "oldDataDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay.pre-import-20261105-153000",
  "targets": {
    "dataDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay",
    "libraryStorageDir": "D:\\PaperQuay Library",
    "translatedPdfDir": "D:\\PaperQuay Library\\translated-pdfs",
    "mineruCacheDir": "C:\\Users\\yusen\\AppData\\Roaming\\paperquay\\PaperQuay\\.mineru-cache",
    "notesVaultDir": "D:\\PaperQuay Notes"
  },
  "previous": {
    "libraryStorageDir": "C:\\Users\\yusen\\Documents\\BaiduSyncdisk\\paperq",
    "translatedPdfDir": "C:\\Users\\yusen\\Documents\\BaiduSyncdisk\\paperq\\translated-pdfs",
    "notesVaultDir": "C:\\Users\\yusen\\Downloads\\my-note"
  },
  "sourceRoots": { "…": "导出包 manifest 的 sourceRoots" }
}
```

`checksum` 的计算方式必须写死：对除 `checksum` 自身以外的字段做键名排序后的紧凑 JSON 序列化，取 SHA-256 hex；不得依赖属性声明顺序或空白。写入用 `<file>.tmp` + `fsync` + `rename`，避免断电留下半写文件。

写入后 `fsync`，再 `app.relaunch({ args: [...process.argv.slice(1), '--paperquay-restore-resume'] })` + `app.exit(0)`。`--paperquay-restore-resume` 是必需的：新实例从 `whenReady` 开始就要拿单实例锁，而旧实例此时可能尚未完全退出，会被当成第二实例直接退出，表现为“点了导入，应用关闭后再也起不来”。因此：旧实例在 `relaunch` 前先 `app.releaseSingleInstanceLock()`；新实例带该参数时允许在锁被短暂占用时继续，并在获得锁后立即完成恢复再进入正常单实例语义；恢复模式实例必须唯一（同时只允许一个带该参数的进程，否则弹窗退出）。UI 明确提示“正在重启完成恢复”。

### 7.4 启动时应用

`createBackend` 之前调用 `applyPendingBackupRestore(app)`。

进入状态机之前先做两件事：一是写 `desktopRunMarker`（先指向即将被改名的旧 `dataDir`），因为 PaperQuay MCP 的写入护栏依赖该 marker（`desktopRunMarker.cjs`），而 `main.cjs` 目前在 `getBackend()` 之后才写 marker；恢复期间若 marker 缺失，外部 Agent 会认为应用未运行并向待改名目录写数据。二是让 MCP 写入护栏在 `userData/PaperQuay-restore/pending.json` 存在时无条件拒绝写入。恢复成功后按新 `dataDir` 重写 marker。

状态机：

1. 读取 `pending.json`，校验 `checksum`；不合法则把文件改名为 `pending.error.json` 并正常启动（不自动删除，便于排查）。
2. `step = prepared`：`stagingDataDir` 必须存在；若 `dataDir` 不存在则先创建空目录并写入默认设置；若 `oldDataDir` 已存在，追加时间戳后缀。更新 `step = swapping`。
3. `step = swapping`：
   - 若 `dataDir` 存在且 `oldDataDir` 不存在：把 `dataDir` 改名为 `oldDataDir`。
   - 若 `dataDir` 不存在且 `oldDataDir` 存在：把 `stagingDataDir` 改名为 `dataDir`。
   - 若两者都存在：说明替换已完成，继续。
   - 其他组合：回滚并报错。
4. 把 `stagingAssetsDir/library` 落到 `targets.libraryStorageDir`；优先同卷 `rename`，跨卷时退化为 `copy`。目标已有同名文件时不覆盖：按 `paperId-attachmentId-<hash>` 改名并记录映射。若目标文献库是当前旧库，先按 7.2 的规则整体改名为 `.pre-import-*`，再写入新目录。
5. 处理 `stagingAssetsDir/notes-vault`：目标为空或不存在时整体复制；目标已有 `.paperquay-vault.json` 时，先把原 manifest 备份为 `.paperquay-vault.json.pre-import-<时间戳>`，读取目标 manifest，与包内 manifest 按 note id 合并——目标已有文件保留原路径、不覆盖，包内新增文件才写入，冲突项记入 warning；最后写回合并后的 manifest，不能直接用包内 manifest 覆盖旧清单。合并后必须收敛孤儿项：新笔记库里已不存在的 note id，从 manifest 移除，对应文件移入 `<vault>/.paperquay-orphans-<时间戳>/` 并写入 `restore-summary.json` 的 warnings；不能留下「manifest 指向不存在笔记」的记录，否则后续同步会把旧文件误判为已删除或反复产生冲突。
6. 更新 `step = rebinding`；执行路径重绑（见 7.5）。
7. 写入 `dataDir/.settings/restore-summary.json` 与 `dataDir/.settings/renderer-restore.json`（localStorage 快照 + 路径映射），包含 restoreId、时间、包来源、目标路径、旧数据目录、warnings。
8. 更新 `step = done`；把 `renderer-local-storage.pre-import.json` 移到 `oldDataDir/.settings/` 内（与回滚点同生命周期，用户删除旧数据时一并清理），删除 `stagingDataDir`、`stagingAssetsDir` 残留与 `pending.json`；正常启动。
9. 任一步失败：按 `step` 回滚——`prepared` 阶段删除 staging；`swapping` 阶段把新 `dataDir` 改名为 `.failed-<restoreId>`，把 `oldDataDir` 改回 `dataDir`；`rebinding` 阶段同上并把新数据目录移走；同时删除本次已复制到目标文献库/vault 的新建文件（按导入前的文件清单比对，不删用户原有文件）；写 `dataDir/.settings/restore-error.json`；删除 `renderer-restore.json`；`dialog.showErrorBox` 提示旧数据位置，然后退出。
10. **回滚必须同步还原浏览器状态**：若本次已由 preload 回灌过新包的 localStorage，回滚时要把 `renderer-local-storage.pre-import.json` 写成新的 `renderer-restore.json`（带 `mode: 'rollback'` 与独立 `restoreId`），由下一轮 preload 灌回，否则出现“文献库回到旧版、批注却是新包”的错配。用户在设置页手工改回 `.pre-import-*` 的手工回滚路径同样使用这份快照，因此该快照要到 `step = done` 才能归位到 `oldDataDir/.settings/`，并与旧数据目录同生命周期：删除旧数据时一并删除，手工回滚时从那里取回。

每一步更新后 `fsync` 日志；断电后按 `step` 幂等续跑。旧目录与其中的 renderer 快照都含明文密钥与 PDF，回滚目录权限收紧，并在设置页提示尽快删除（删除后回滚点同时失效，需在 UI 中写明）。

### 7.5 路径重绑

在打开任何 store 之前，用 `node:sqlite` 直接操作数据库。每个库的路径更新放在一个事务里，重复执行结果一致（按旧路径前缀匹配，已更新的新路径不再命中）。映射表按“最长源根优先”匹配，同时匹配 `sourceRoots`（用户配置路径，可能含 junction）与 `resolvedRoots`（realpath），避免文献库 junction 导致前缀匹配失败。Windows 下比较不区分大小写并统一 `\` 分隔；POSIX 下区分大小写。

**空源根绝不参与匹配**：`translatedPdfDir`、`notesVaultDir`、`zoteroLocalDataDir` 的默认值就是空字符串（`libraryStore.cjs:32-34`），空前缀会命中所有路径，把全部附件误判为“已重绑完成”。映射表构建时先剔除 `null`/`''`/`'.'` 项，并对每个源根做 `path.resolve` 后非空校验；剩余源根按长度降序排列，最长优先。

| 源根 | 新根 | 处理 |
| --- | --- | --- |
| `sourceRoots.dataDir` | 新 `dataDir` | 配置、DB、Agent 记忆等固定位置 |
| `sourceRoots.libraryStorageDir` | 用户选择的新文献库目录 | 附件 `stored_path`、`relative_path` |
| `sourceRoots.translatedPdfDir` | 新译文目录 | 翻译版附件路径；自定义目录时不在 library 根下 |
| `sourceRoots.mineruCacheDir` | 新 `dataDir/.mineru-cache` | 配置 `mineruCacheDir` |
| `sourceRoots.remotePdfDownloadDir` | 新 `dataDir/.downloads/pdfs` | 仅配置字段；被附件引用的文件按 entry 目标落到新文献库 |
| `sourceRoots.notesVaultDir` | 用户选择的 vault 或空 | `library_settings.notesVaultDir` |
| `external`（不在任何源根内） | 新文献库 `restored/` | keep 模式外部路径，统一收纳，避免依赖旧盘符 |

附件路径以 manifest entry 的 `sourceRoot/relativePath` 还原出旧 `stored_path`，导入时建立精确映射 `oldStoredPath -> newStoredPath`：`library-pdf` 落到新文献库，`translated-pdf` 落到新译文目录，`other` 落到 `restored/`。数据库更新优先用这张精确映射；源根前缀映射只作为缺失条目、未收录附件的兜底。MinerU 缓存同理建立 `oldCachePath -> newCachePath`，处理同名冲突后缀。

具体写入：

1. `library_settings`：
   - `storageDir = targets.libraryStorageDir`
   - `translatedPdfDir = targets.translatedPdfDir`
   - `mineruCacheDir = targets.mineruCacheDir`
   - `notesVaultDir = targets.notesVaultDir || ''`
   - `zoteroLocalDataDir = ''`（换机后重新配置）
   - `folderWatchEnabled = false`
   - 删除 `backupEnabled` 键
2. `paperquay.config.json` 的 `settings`：
   - `mineruCacheDir = targets.mineruCacheDir`
   - `remotePdfDownloadDir = 新 dataDir/.downloads/pdfs`
   - `autoMineruParse = false`、`autoGenerateSummary = false`、`notesVaultAutoSyncEnabled = false`（避免导入后立即联网/扣费）
   - 顶层 `zoteroLocalDataDir = ''`
   - 保留全部 `secrets` 与模型预设
3. `attachments`：逐行读取 `stored_path`，按源根映射到新路径；重算 `relative_path`；`missing` 按文件是否存在更新；`file_name` 按最终磁盘文件名更新（长路径短名/冲突后缀后必须同步）；`file_size` 按实际落盘大小校正。`content_hash` 与 manifest 的 `sha256` 同为 SHA-256 hex（`utils.cjs:91` 的 `hashBytes`、`utils.cjs:95` 的 `hashFile`），但**只补齐空值，不改写非空值**：非空且不同说明源库里该附件已与包内文件不一致（用户替换过附件或文件被外部修改），覆盖会掩盖差异，并破坏基于 `contentHash` 的去重判断（`libraryCommands.cjs:695-697`），此时记 `CONTENT_HASH_MISMATCH` 警告并保留原值。
4. `attachments.original_path`：若在源根内则同步改写；否则保留为历史来源。
5. 密钥副本优先级固定为：`config.secrets`（阅读器模型/MinerU/PaddleOCR/Embedding/Zotero）> `library_settings.openAlexApiKey`（仅 OpenAlex）> localStorage 遗留 `paper-reader-secrets-v1`。导入后把遗留 secrets 中 config 缺失的字段合并进 config，再删除 localStorage 遗留键，避免旧 Key 覆盖新 Key。
6. 不修改 `notes`、`rag_chunks`、`rag_indexes`：这些表不含本机绝对路径。
7. 跨平台导入时只做源根字符串匹配与相对路径拼接，不尝试访问旧机器的路径；旧路径不存在不影响重绑。

### 7.6 渲染层 localStorage 恢复

localStorage 位于 `%APPDATA%\PaperQuay\Local Storage\leveldb`，在 `dataDir` 之外，主进程没有直接写入 API；不能靠复制 LevelDB 恢复。

采用 preload document-start 回灌：

1. 主进程在 `createWindow()` 前把 `renderer-restore.json` 读入内存；文件包含 `state`、`pathMap`（每条旧绝对路径 -> 新绝对路径）与 `rootMap`（源根 -> 新根兜底）。`pathMap` 只收录可能被 localStorage 引用的路径（附件、`lastMineruPath`、区块修复的 `parsePath`），不为 5 万条缓存文件建全量映射；缓存路径用 `rootMap` 前缀映射。
2. `electron/preload.cjs` 在页面脚本执行前，用 `ipcRenderer.sendSync('paperquay:renderer-restore-sync')` 取得 `{restoreId, state, pathMap, rootMap}`；同步通道只在存在 pending restore 时返回数据。
3. preload 执行 `localStorage.clear()`，逐键 `setItem`；路径替换只改白名单字段，不做全字符串递归替换：
   - `paper-reader-paper-history-v1`：`document.localPdfPath`、`document.translatedPdfPath`、`qaSessions[].messages[].attachments[].filePath`、`qaMessages[]` 旧结构中的附件 `filePath`、`lastPdfPath`、`lastMineruPath`；
   - 同一记录中的 PDF 源签名：`paperSummarySourceKey`、`pdfScrollPositions` 的对象键与 `sourceKey` 字段、`pdfReadingHeatmaps` 的对象键与 `sourceKey` 字段；这些值可能是 `local:<绝对路径>`，先查 `pathMap` 精确替换，未命中再按 `rootMap` 最长前缀替换，最后重新拼成 `local:<新路径>`；
   - `paper-reader-settings-v3`：`mineruCacheDir`、`remotePdfDownloadDir`；
   - 其他键不改，避免误伤聊天正文、笔记摘录中的路径文本。PDF 侧栏折叠等纯 UI 键若包含旧签名，允许重置，不影响文献/笔记数据。
4. 写入失败（`QuotaExceededError`）时收集失败键，不静默丢数据；异步 `send('paperquay:renderer-restore-ack', {restoreId, failedKeys})`，主进程写入 `restore-summary.json` 的 warnings 并在设置页提示“浏览器存储超出配额，部分 UI 状态未恢复”。
5. 成功写入后 ack；主进程删除 `renderer-restore.json`，防止重复回灌。
6. 主题、工作区等 store 在 preload 之后才执行，因此读取到的是恢复后的值；`src/main.tsx` 不需要动态导入。

配额边界：Chromium 单 origin localStorage 上限约 10 MB，但按 UTF-16 code unit 计（约 500 万字符），中文/emoji 内容下实际可用字节约为上限的一半。导出前按 `key.length + value.length` 累计 code unit，超过 400 万时提示用户清理 Agent 历史或改用“不包含浏览器状态”的导出；提示体积时必须注明口径，不要用 `Buffer.byteLength` 直接和 10 MiB 比较，否则会给出错误的“还有余量”结论。当前实测 1.2 MiB，但 Agent 历史可能增长到上限以上。导入时若仍超限，记录 `failedKeys` 并完成其余恢复。

`renderer-restore.json` 必须带 `restoreId`：preload ack 的 `restoreId` 与文件不一致时主进程忽略该 ack 并保留文件；文件存在超过 7 天视为过期，启动时删除，避免一次早已放弃的恢复在很久以后突然覆盖用户当前状态。长期方案是把 Agent 历史迁入 SQLite（独立计划），不在本方案内夹带大规模存储重构。

若包内不含 MinerU 缓存：把 `lastMineruPath` 置空，避免指向不存在的缓存。若包内不含 RAG：保留 `paper-reader-settings-v3` 中的 RAG 设置，但不自动重建；UI 显示“需要重建索引”。

区块修复键迁移：`paperquay:block-reparse:v1:<hash>` 的哈希包含旧 `parsePath`，路径变化后旧键无法命中。导入后由渲染层在 App 启动后执行一次迁移：对每个历史记录，用旧 `documentSource`/`parsePath` 和当前 blocks 重算旧键，再用新路径重算新键，把值从旧键搬到新键；MinerU 缓存缺失或 blocks 无法重建时保留旧键并写入 warning，不静默删除。后续可把键算法改为不含 `parsePath`（独立改动，不在本方案内）。

### 7.7 回滚与旧数据保留

- 旧 `dataDir` 改名后保留，不在导入流程中删除；最多保留最近 3 份，超出时提示用户删除。
- 设置页“备份与迁移”显示“导入前数据”路径、体积和删除按钮；删除前二次确认。旧目录含明文 API Key 与 PDF，提示尽快删除。
- `backup_delete_old_data` 只接受 `userData` 下的 `PaperQuay.pre-import-*`，或导入日志 `previous` 中记录的旧文献库 `.pre-import-*` 路径；realpath 必须仍在该父目录内，拒绝任意路径删除。
- 若新版本启动失败且自动回滚也失败，保留 `restore-error.json` 与旧目录，用户可手工改回。
- **回滚必须是一个可操作的功能，而不是“请自己改目录名”**：验收标准要求“可回滚”，但自动回滚只在启动应用失败时触发；导入成功后用户想整体退回时（例如新库数据有缺）没有入口。设置页“导入前数据”卡提供“回滚到此版本”按钮，后端 `backup_rollback_prepare` 写入一份 `pending.json`（`mode: 'rollback'`，`restoreDir` = 选中的 `.pre-import-*`，`oldDataDir` = 当前 `dataDir` 改名为 `.rolledback-<时间戳>`），由**同一个**状态机在重启后完成目录交换、库目录交换与 renderer 快照灌回。不能另写一套状态机，否则两套回滚语义必然漂移。
- 回滚同样需要在重启时进行（SQLite 与 LevelDB 都不可热替换），且回滚后旧数据目录仍然保留，可再次导入。
- 导入成功后第一次启动不自动执行任何批量解析、索引、vault 同步或文件夹监听。

## 八、代码改动清单

### 8.1 新增模块

| 文件 | 职责 |
| --- | --- |
| `electron/backend/backupCrypto.cjs` | scrypt、DEK 包裹、AES-GCM 帧读写、密码规范化、参数范围校验 |
| `electron/backend/backupContainer.cjs` | `.pqbackup` 写入器/读取器、preamble/footer/manifest、路径安全、偏移校验 |
| `electron/backend/backupSources.cjs` | 收集附件、MinerU 缓存、vault、Agent 记忆、知识图谱、localStorage；生成 manifest entries |
| `electron/backend/backupExport.cjs` | 预估、快照、导出编排、取消、进度、失败清理 |
| `electron/backend/backupImport.cjs` | inspect、stage、校验、pending.json、启动时 apply、路径重绑 |
| `electron/backend/backupCommands.cjs` | IPC 命令、文件对话框、进度事件、全局锁 |
| `src/services/backupPackage.ts` | 渲染层 IPC 封装与进度订阅 |
| `src/types/backupPackage.ts` | 备份包设置、进度、manifest 摘要、导入结果类型 |
| `src/features/reader/BackupTransferSection.tsx` | 新设置分区 UI |
| `src/features/reader/BackupPasswordDialog.tsx` | 密码设置/输入、强度提示、显示切换 |
| `src/features/reader/BackupProgressPanel.tsx` | 导出/导入进度与取消 |
| `src/shared/rendererStorageRemap.cjs` | localStorage 白名单路径替换纯函数（preload 与测试共用） |
| `tests/backupCrypto.test.ts` | 加密与容器单测 |
| `tests/backupPackage.test.ts` | 导出/导入集成测试 |
| `tests/backupPathRemap.test.ts` | 路径重绑与 localStorage 替换测试 |
| `tests/backupCommands.test.ts` | IPC 编排、取消、错误映射 |

### 8.2 修改文件

| 文件 | 修改 |
| --- | --- |
| `electron/backend.cjs` | 组装 `createBackupCommands`；启动前调用 `applyPendingBackupRestore`（或移到 `main.cjs`） |
| `electron/main.cjs` | 增加 `app.requestSingleInstanceLock()`；处理 `--paperquay-restore-resume`（先在旧实例侧 `releaseSingleInstanceLock()`）；在 `getBackend()` **之前**先写 `desktopRunMarker` 并应用 pending restore；注册 renderer-restore 同步 IPC；失败弹错并退出 |
| `electron/preload.cjs` | document-start 读取恢复快照，回灌 localStorage，ack 失败键 |
| `electron/backend/integrationCommands.cjs` | 移除 `createWebdavCommands`，加入 `createBackupCommands` |
| `electron/backend/libraryStore.cjs` | 删除 `webdav` 默认值与 `webdavView`；`normalizeLibrary` 从 raw 对象中剔除 `webdav`；`backupEnabled` 从默认设置移除 |
| `electron/backend/libraryDatabaseStore.cjs` | 按 8.5 表格逐点删除建表、读取、写入与 **`clearData` 清单项**，并在 `createSchema` 末尾 `DROP TABLE IF EXISTS webdav_settings`；`loadLibraryFromDb`/`saveLibraryToDb` 去掉 webdav；写入 `PRAGMA user_version = 1` |
| `packaging/mcp/server.cjs`（生成产物） | **不手改**；源码改完后重新运行 `scripts/bundle-mcp.cjs` 生成，并确认产物内 `grep -i webdav` 为空 |
| `electron/backend/noteStore.cjs`、`electron/backend/ragStore.cjs` | 写入 `PRAGMA user_version = 1`，供备份 manifest 记录 schema |
| `src/features/reader/readerPreferencesContent.tsx` | 备份节标题改为“备份与迁移”，渲染新组件；从 `DEFAULT_LIBRARY_SETTINGS` 删除 `backupEnabled` |
| `src/types/library.ts` | 删除 `backupEnabled` |
| `tests/libraryDatabaseStore.test.ts` | 移除 `webdav` 设置读写断言，改为验证建表后无 `webdav_settings`、`clearData`/`saveLibraryToDb` 在无表时不报错 |
| `tests/literatureLibraryUtils.test.ts` | 删除 fixture 中的 `backupEnabled` 字段（第 113 行） |
| `src/app/appEvents.ts` | 如需新增导入完成事件，加入事件类型 |
| `README.md`、`README_EN.md`、`docs/USER_MANUAL.zh-CN.md`、`AGENTS.md` | 备份说明改为 `.pqbackup`；删除 WebDAV 描述 |
| `CHANGELOG.md`、`.github/release-notes.md` | 记录破坏性变更与迁移指引 |

### 8.3 删除文件

- `electron/backend/webdavCommands.cjs`
- `electron/backend/webdavClient.cjs`
- `electron/backend/webdavBackup.cjs`
- `src/services/webdavBackup.ts`
- `src/features/reader/readerPreferencesBackupSection.tsx`
- `src/types/backup.ts`（由新的 `src/types/backupPackage.ts` 取代）
- `tests/webdavBackup.test.ts`（由新测试取代）

### 8.4 IPC 命令与事件

| 命令 | 入参 | 返回 |
| --- | --- | --- |
| `backup_export_estimate` | `{ options }` | `{ entries, totalBytes, warnings }` |
| `backup_export_start` | `{ destinationPath, password, options, rendererState }` | `{ ok, packagePath, bytes, entries, durationMs, warnings }` |
| `backup_export_cancel` | `{}` | `{ cancelled }` |
| `backup_import_inspect` | `{ packagePath, password }` | `{ ok, manifestSummary, warnings }` |
| `backup_import_stage` | `{ packagePath, password, targets, currentRendererState }` | `{ ok, restoreId, restartRequired }`；`currentRendererState` 仅用于写入回滚快照 |
| `backup_renderer_restore_pending` | `{}` | `{ pending, restoreId, state, pathMap, rootMap }` |
| `backup_renderer_restore_ack` | `{ restoreId, failedKeys }` | `{ ok }` |
| `backup_get_status` | `{}` | `{ pendingRestore, lastExport, lastRestore, oldDataDirs: string[] }` |
| `backup_delete_old_data` | `{ path }` | `{ ok, freedBytes }` |
| `backup_rollback_prepare` | `{ oldDataDir }` | `{ ok, restoreId, restartRequired }`；写入 `mode: 'rollback'` 的 `pending.json`，不立即动文件 |

同步 IPC：`paperquay:renderer-restore-sync`（仅 preload document-start 使用，`sendSync`）；异步事件：`paperquay:renderer-restore-ack`。

事件：`paperquay://backup-progress`。沿用 `sender.send('paperquay:event', ...)` 模式（`webdavCommands.cjs:13-16`）。

### 8.5 WebDAV 的彻底移除

已确认（2026-11-06）**完全不保留**：无只读恢复入口、无隐藏开关、无 `webdav_settings` 表、无 `webdav` 字段。

移除必须同时覆盖下列引用。`db.prepare` 对缺失的表直接抛 `no such table`，没有任何降级，漏一处就是硬故障：

| 位置 | 内容 | 处理 |
| --- | --- | --- |
| `libraryDatabaseStore.cjs:33-36` | `CREATE TABLE IF NOT EXISTS webdav_settings` | 删除建表语句 |
| `libraryDatabaseStore.cjs:501` | `loadKeyValueTable(db, 'webdav_settings')` | 删除；`loadLibraryFromDb` 不再返回 `webdav` |
| `libraryDatabaseStore.cjs:964` | `saveKeyValueTable(db, 'webdav_settings', …)` | 删除 |
| **`libraryDatabaseStore.cjs:581-591`** | `clearData` 的 DELETE 清单含 `'webdav_settings'` | 从清单移除 |
| `libraryStore.cjs:61-69`、`83`、`248`、`268` | 默认值、`normalizeLibrary` 合并、`webdavView` 及其导出 | 全部删除（`webdavView` 仅被待删的 `webdavCommands.cjs` 引用） |

**这里最容易漏的是 `clearData`**：`saveLibraryToDb`（`libraryDatabaseStore.cjs:955-964`）每次保存都会先 `clearData(db)` 再 `saveKeyValueTable('webdav_settings', …)`。这两处任一残留而表已删除，**每一次文献库写入都会失败**——不是 WebDAV 不可用，而是加标签、改分类、收藏、导入全部报错。因此删表必须与上表各处引用在同一提交内完成，不允许分两次做。

表本身用幂等语句清理，不引入迁移计数：在 `createSchema` 末尾执行 `DROP TABLE IF EXISTS webdav_settings`（表不存在时是无操作、不写库），老库升级、新装、降级再升级都不需要额外状态。`library_settings` 中的 `backupEnabled` 键同样在读取时忽略并停止写回。

**`packaging/mcp/server.cjs` 必须重新生成，不能手改**：它是 `scripts/bundle-mcp.cjs` 把 `bin/paperquay-mcp.cjs` 连同内联的 `libraryDatabaseStore.cjs` 打成的单文件产物（当前 45,610 行，内含同一套 `webdav_settings` 建表与读写代码）。只改源码不重新打包，用户机器上的旧 MCP 产物仍会 `SELECT … FROM webdav_settings`，而应用已经把表删了，**所有 MCP 文献工具都会整批失败**（不只是 WebDAV 相关）。发布流程因此固定一条顺序：`npm run build` → 重新运行 `scripts/bundle-mcp.cjs` → `grep -i webdav packaging/mcp/server.cjs` 为空 → 再打安装包。

其余约定：

- 不自动删除远端 WebDAV 文件：用户可能仍依赖那些文件，发布说明提示自行清理。
- 升级前如需旧备份数据：先用 0.4.x 从 WebDAV 恢复到本地，再升级并导出 `.pqbackup`。这是唯一的迁移路径，新版本不提供任何兼容入口。
- `docs/changes/`、`docs/plans/` 中的历史记录不修改：它们描述当时已发生的工作，改写会破坏可追溯性；只更新面向当前使用者的文档（README、USER_MANUAL、AGENTS.md、DEVELOPMENT、CHANGELOG、release-notes）。

## 九、UI 规格

### 9.1 备份与迁移面板

- 顶部说明卡：单文件、密码加密、包含配置/密钥/文献/笔记/批注。
- 两个主按钮：主色“一键导出备份包”，次色“从备份包导入”。
- 最近记录：导出时间、体积、路径；导入时间、来源版本、结果。只保留最近 5 条，存 `dataDir/.settings/backup-history.json`，不含密码。
- 旧数据卡：仅当存在 `.pre-import-*` 目录时显示，逐条列出旧数据目录与旧文献库目录的路径、体积，以及“回滚到此版本”与“删除”两个操作；回滚需二次确认并提示“将重启应用，当前数据会另存为 `.rolledback-*`”。
- 高级选项折叠：RAG、MinerU 缓存、vault、压缩级别；显示每项体积。

### 9.2 密码对话框

- 导出：两次输入；8 位以下禁用提交；强度条（弱/中/强）；显示/隐藏；提示“忘记密码无法恢复”。
- 导入：一次输入；回车提交；错误统一提示；连续失败不锁定，但每次 KDF 约 0.2–1 s，天然限速。
- 关闭对话框即清空密码状态；不写日志、不进错误上报。实现上密码只存在于本次 IPC 入参与 KDF 调用中：不写入 `backup-history.json`、不进结构化日志、不进错误对象（错误构造前先剔除 password 字段），KDF 完成后立即丢弃引用；主进程不得把 password 存入模块级变量或长期存活的 closure。

### 9.3 进度与完成

- 进度条按字节；上方显示阶段，下方显示条目数；长阶段显示“正在写入 RAG 数据库（7.55 GiB）”。导出完成后的整包自检复用 `verifying` 阶段，文案为“正在校验备份包（可跳过）”。
- 取消按钮在“提交/重启”阶段禁用，并说明“已进入不可取消阶段”。
- 完成后展示：包路径、体积、条目数、耗时、warnings；提供“打开所在文件夹”按钮。
- 导入完成后主界面顶部显示一次性横幅：“已从 2026-11-05 的备份包恢复；旧数据保留在 …”。

### 9.4 设计约束

- 使用现有 UI 令牌与 `SettingsField`/`SettingsInput`/`ToggleRow` 原语；不引入新配色。
- 元信息字号不低于 11 px；按钮保持键盘焦点样式；进度区域 `aria-live="polite"`。
- 中英文案同时补齐，沿用 `l(zh, en)`。

## 十、错误处理

| 错误 | 触发 | 用户提示与动作 |
| --- | --- | --- |
| `BACKUP_BUSY` | 已有导出/导入 | “另一个备份任务正在进行，请稍候” |
| `APP_RUNNING` | 第二个桌面实例或 MCP 占用数据库 | “请关闭其他 PaperQuay 窗口和外部 Agent 后重试” |
| `DB_LOCKED` | 替换时 SQLite/WAL 仍被占用 | 自动回滚；提示关闭 MCP/杀毒软件后重试 |
| `INVALID_PACKAGE` | magic/版本/footer 错误 | “不是有效的 PaperQuay 备份包” |
| `WRONG_PASSWORD_OR_CORRUPT` | DEK 解包或 manifest 认证失败 | “密码错误或备份包已损坏” |
| `UNSUPPORTED_VERSION` | 包版本高于当前 App | “请先升级 PaperQuay 再导入” |
| `UNSAFE_ENTRY_PATH` | manifest 路径含 `..`/绝对路径/ADS/保留名 | “备份包包含不安全路径，已拒绝导入” |
| `CHECKSUM_MISMATCH` | entry SHA-256 不符 | “备份包校验失败，未修改本机数据” |
| `DB_INTEGRITY_FAILED` | `PRAGMA integrity_check` 失败 | “备份包内数据库损坏” |
| `DISK_FULL` | 写入/暂存空间不足 | 显示所需/可用空间，删除 staging |
| `TARGET_NOT_WRITABLE` | 目标目录无权限 | 让用户重新选择目录 |
| `QUOTA_EXCEEDED` | localStorage 回灌超限 | 记录失败键，完成其余恢复并提示部分 UI 状态未恢复 |
| `STAGING_MISSING` | 启动恢复时 staging 不存在 | 不替换任何数据；提示重新导入 |
| `CANCELLED` | 用户取消 | “已取消，未生成备份包/未修改本机数据” |
| `RESTORE_APPLY_FAILED` | 启动替换/重绑失败 | 自动回滚；弹窗显示旧数据路径与 `restore-error.json` |
| `OLD_DATA_DELETE_FAILED` | 删除回滚目录失败 | 提示路径，允许重试；不静默忽略 |
| `RESTORE_LOCK_CONFLICT` | 重启实例与旧实例抢单实例锁 | “恢复已完成但应用未能自动启动，请手动打开 PaperQuay”；`pending.json` 保留，下次启动继续 |
| `SELF_VERIFY_FAILED` | 导出后整包回读校验失败 | 删除该包并提示重试；不交付未验证的包 |
| `CONTENT_HASH_MISMATCH` | 附件 `content_hash` 与包内 sha256 不同 | 保留原值，在导入摘要中列为警告 |
| `STAGING_ORPHAN` | 启动时发现属主已退出的暂存目录 | 删除并记日志；提示上次备份任务被异常中断 |

所有错误只返回错误码与脱敏消息；完整堆栈仅写本地日志，不含密码、密钥、文件名。

## 十一、测试计划

### 11.1 单元测试

| 用例 | 断言 |
| --- | --- |
| 加密往返 | 同一密码导出/导入，manifest 与 entry 字节一致 |
| 错误密码 | 解包失败，错误码统一 |
| 篡改密文/tag | 解密失败，定位到 entry |
| 篡改 footer 偏移/nonce | manifest 解密失败 |
| 截断包/删除尾帧 | 读取失败，不产生部分 entry |
| 帧重排/跨 entry 替换 | AAD 校验失败 |
| nonce 唯一性 | 注入计数器，断言全包无重复、无回绕 |
| 帧长度越界 | `storedLen = 0 / > frameSize + 64 KiB` 拒绝；`rawLength` 按 entry.size 推导，4 MiB±1、空文件、> 4 GiB entry 边界正确 |
| 解压炸弹 | 累计解压超过 `entry.size` 或压缩比 > 200:1 失败 |
| KDF 参数越界 | 导入前拒绝，不调用 scrypt |
| 超大 manifest/条目数 | 拒绝，内存不暴涨 |
| 路径穿越 | `..`、绝对路径、盘符、UNC、`\\?\`、NTFS ADS、`CON` 等保留名、尾点/空格全部拒绝 |
| 同名/大小写冲突 | NFC + 大小写折叠后重复的 entry 拒绝或按固定规则改名 |
| 压缩策略 | JSON 压缩后更小；PDF 保持 `none`；低收益 SQLite 自动转 `none` |
| 取消 | 帧边界停止，`.partial` 与 staging 清理 |
| 零长度 entry | 连续两个空文件 `dataOffset` 相等时连续性校验通过；单个空文件 `frameCount = 0`、`dataLength = 0`，导入后目标文件存在且大小为 0 |
| 写入顺序与 AAD | footer 在 manifest 之前定型；改动 footer 任一字节导致 manifest 解密失败 |
| 空源根 | 映射表构建时 `''`/`null` 被剔除，不产生空前缀匹配项 |

### 11.2 集成测试

| 用例 | 断言 |
| --- | --- |
| 最小包往返 | 配置 + 三库 + 1 个 PDF + 1 条笔记 + localStorage 全部恢复 |
| 完整包往返 | 含 RAG、MinerU、vault、翻译版 PDF；计数一致 |
| 日常包往返 | 不含 RAG/MinerU；导入后 `lastMineruPath` 清空，提示重建索引 |
| 旧数据保留 | 导入后存在 `.pre-import-*`，内容与导入前哈希一致 |
| 回滚入口 | 导入成功后点“回滚到此版本”，重启后 `dataDir`、文献库目录与 localStorage 均回到导入前状态，且当前数据另存为 `.rolledback-*` 而非被删 |
| 导入失败回滚 | 模拟 staging 校验失败/磁盘满，旧库哈希不变 |
| 断电恢复 | 在 `prepared/swapping/rebinding` 三态各 kill 进程，下次启动幂等完成或回滚 |
| 进程互斥 | 第二个桌面实例、MCP 持库时导入，断言拒绝且旧数据完好 |
| 路径重绑 | Windows 盘符、中文、空格、UNC、junction 根、自定义译文目录、`keep` 模式外部路径全部正确 |
| localStorage 路径替换 | 只改白名单字段；`document.localPdfPath`/`translatedPdfPath`、qa 附件 `filePath`、`local:` 源签名、scroll/heatmap 键、摘要 sourceKey 正确重写；聊天正文/笔记摘录中的旧路径文本不被误改 |
| localStorage 配额 | 构造 12 MiB Agent 历史，断言失败键被记录、不静默丢数据 |
| 区块修复迁移 | 旧 `parsePath` 键在导入后按新路径重算并保留修复内容；缓存缺失时保留旧键并告警 |
| 笔记 vault | 只恢复 manifest 记录的文件，不删除用户其他 Obsidian 文件 |
| 缺失附件 | manifest warning 保留，导入后 `missing=1`，不阻断其他数据 |
| 编码冲突 | NFC/NFD 同名、大小写同名、保留名、>260 字符路径有确定行为 |
| 导入到非空机器 | 旧 `dataDir` 非空、目标文献库已有内容、vault 已有同名不同内容：旧目录改名保留，vault 冲突不覆盖且无孤儿 manifest 项 |
| 回滚后 localStorage | 回灌新包状态后模拟 `rebinding` 失败回滚，`renderer-local-storage.pre-import.json` 被灌回，旧批注与 Agent 历史与旧库一致 |
| 重启锁冲突 | 旧实例未完全退出时，带 `--paperquay-restore-resume` 的新实例仍能启动并完成恢复 |
| 恢复期 MCP 护栏 | `pending.json` 存在时外部 MCP 写入被拒；`desktopRunMarker` 在改名之前已写入 |
| 导出后自检 | 人为破坏包尾一字节，自检失败并删除包；关闭自检时 UI 标注“未校验” |
| 半写文件 | 构造 `.tmp` 与 10 s 内新写文件，导出跳过并记 `FILE_UNSTABLE_AT_EXPORT` |
| WebDAV 彻底移除 | 升级迁移后 `sqlite_master` 无 `webdav_settings`；`saveLibraryToDb`/`clearData` 不触发 `no such table`；重新生成的 `packaging/mcp/server.cjs` 内 `grep -i webdav` 为空，且 MCP 全量工具在升级后的库上可用 |

### 11.3 手工验收

- 用 `node electron/build.cjs --dir --config.directories.output=release/<新目录>` 打包，整体复制到 `%TEMP%` 启动，避免工作区可执行文件无法启动的问题。
- 使用隔离 userData（新建目录 + 指定 `--user-data-dir` 或独立测试夹具），不写真实库；如必须实机，先备份三库与配置并记录 SHA-256，结束后整体还原。
- 截图：导出密码框、导出进度、导入预览、导入完成横幅、旧数据卡。
- 断网导出：确认不依赖网络。
- 大文件：至少 1 GB 夹具，监控备份流程增量内存峰值 < 150 MB。
- 真实规模：用现有 12.2 GiB 数据做一次完整导出/导入，记录耗时、峰值内存、包体积、恢复后计数。
- 异常清理：导出/导入中途杀进程，确认重启后 `.partial`、staging、snapshot 等含明文目录被清理或列入警告。

## 十二、实施阶段与工作量

| 阶段 | 内容 | 预计 |
| --- | --- | ---: |
| P0 | 方案评审、格式定稿、测试夹具设计、**localStorage document-start 注入 spike（硬门槛）** | 1 天 |
| P1 | `backupCrypto` + `backupContainer` + 单测 | 2 天 |
| P2 | `backupSources` + `backupExport`（含导出后自检、流式背压、取消）+ 进度 | 2 天 |
| P3 | `backupImport` + pending 状态机 + 双暂存根 + 路径重绑 + vault 合并 + localStorage 回灌与回滚 + 单测 | 3.5 天 |
| P4 | IPC/命令/UI/密码框/进度/回滚入口/恢复横幅 | 2 天 |
| P5 | WebDAV 彻底移除（含 `clearData` 与 MCP 产物重新生成）、数据迁移、文档更新 | 1 天 |
| P6 | 构建、全量测试、打包实机验收、真实规模演练 | 2 天 |
| **合计** | | **约 13.5 人天（按 14–16 人天排期）** |

建议按 P1→P2→P3 的顺序实现，P4 可与 P3 后半并行；P5 在 P4 完成后做，避免同时改设置页与后端。

相对初稿 11 人天的调整理由：P3 原估 2.5 天，但其中包含 pending 四态状态机、双暂存根切换、路径重绑（含 junction/UNC/空根）、vault manifest 合并与孤儿收敛、localStorage 白名单重写、区块修复键迁移与回滚还原，仅测试覆盖就不止一天。低估这一段的直接后果是把“失败可回滚”这类门槛项推到最后才验，风险高于多排三天。

## 十三、验收标准

必须全部满足：

1. 设置页不再出现 WebDAV 地址、账号、密码或“立即备份”按钮；升级后库中不存在 `webdav_settings` 表、`library_settings` 不含 `backupEnabled`，源码与 `packaging/mcp/server.cjs` 中 `grep -ri webdav` 只命中 `docs/changes`、`docs/plans` 的历史记录。
2. 一键导出生成单个 `.pqbackup` 文件；默认完整包含配置、密钥、三库、PDF、笔记、Agent 记忆、知识图谱、localStorage、vault。
3. 错误密码无法解密；篡改任意字节、截断、重排均被拒绝。
4. 在另一台电脑（或隔离 userData）导入后：
   - 文献数、附件数、笔记数、笔记文件夹数、RAG chunk 数与包内统计一致；
   - 所有 PDF 可打开，翻译版 PDF 可打开；
   - 阅读批注、问答会话、阅读位置、Agent 历史、综述草稿存在；
   - 模型预设、MinerU/PaddleOCR/Embedding/Zotero/OpenAlex 密钥存在；
   - 若导入时选择了 vault 目录，笔记可继续双向同步；跳过时笔记库仍完整。
   - 文献存储目录指向新机器路径，无失效绝对路径。
5. 导入前旧数据保留为 `.pre-import-*`，可回滚、可删除；回滚同时还原 `dataDir` 与渲染层 localStorage（依据 `PaperQuay-restore/<id>/renderer-local-storage.pre-import.json`），回滚后批注、QA 会话与 Agent 历史必须与旧文献库对应。
6. 导入后自动解析、自动概览、vault 自动同步、文件夹监听均为关闭状态。
7. `npm run build`、`npm test` 通过；新增测试覆盖加密、容器、导出、导入、路径重绑、取消与回滚。
8. 完整应用打包后在隔离环境启动，导出/导入流程有截图与哈希证据。
9. 导出完成后默认自检通过（整包回读、逐 entry 哈希与帧长度校验、计数比对）；关闭自检时 UI 明确标注“未校验”。

## 十四、风险与应对

| 风险 | 级别 | 应对 |
| --- | --- | --- |
| 13 GB 级包导出/导入耗时长，用户误以为卡死 | P1 | 双进度、阶段文案、预计剩余时间、取消 |
| RAG 库 8 GB `VACUUM INTO` 造成临时空间不足或阻塞主进程 | P0 | 预检空间；在 worker/utilityProcess 执行；快照写一份删一份；不足时建议“日常备份” |
| 导入替换时断电 | P0 | `pending.json` 放 dataDir 外 + 三态日志 + 幂等步骤 + 旧目录回滚 |
| 第二实例/MCP 持有 SQLite 导致替换失败 | P0 | 单实例锁 + 导入前检测 + 失败自动回滚并提示关闭 MCP |
| 路径重绑遗漏导致 PDF 打不开 | P0 | manifest 记录源根；DB 逐行重写；导入后自检所有附件存在性 |
| localStorage 恢复时机 | P1 | preload document-start `sendSync` 回灌，早于任何 App/store 代码 |
| localStorage 配额 | P1 | 导出前检查 8 MiB；超限提示清理 Agent 历史；导入记录 `failedKeys`，不静默丢数据 |
| junction/符号链接导致漏文件或越界 | P1 | 源根 `realpath`，根内 reparse point 报错；目标父目录 realpath 包含校验 |
| FAT32 目标盘无法容纳 >4 GiB 单文件 | P1 | 预检文件系统，提示改用 NTFS/exFAT |
| 密码遗忘 | P1 | UI 明确提示不可恢复；不提供后门 |
| 旧 WebDAV 用户升级后找不到备份入口 | P1 | 发布说明与设置页提示“先用 0.4.x 恢复旧备份，再导出新包” |
| 包内密钥泄露 | P0 | 强制密码、默认不明文展示、日志脱敏、文档强调妥善保管 |
| Windows 长路径 | P2 | staging 根路径短；超长文件名回退哈希名并同步 DB |
| 未来格式升级 | P2 | formatVersion + kdfId；导入端保留旧版本分支 |
| 回滚只还原 `dataDir`、localStorage 仍指向新包 | P0 | stage 阶段保存导入前 localStorage 全量快照；回滚与手工改回都用同一 preload 机制灌回（7.2、7.4） |
| 重启时单实例锁冲突导致应用起不来 | P0 | `--paperquay-restore-resume` + 先 `releaseSingleInstanceLock()` 再 `relaunch`；锁冲突不静默退出 |
| 恢复期间 MCP 写入护栏误判应用未运行 | P0 | 改名之前先写 `desktopRunMarker`；`pending.json` 存在时 MCP 护栏无条件拒写 |
| 明文暂存残留（密钥与 PDF） | P1 | `owner.json` 记 pid，启动时按 pid 立即清理；24 小时阈值只作兜底 |
| 导出完成才发现包不可恢复 | P1 | 默认执行导出后整包回读自检，失败即删包报错 |

## 十五、文档更新

- `README.md:324`、`README_EN.md:313`：功能表“备份”改为“加密备份包（单文件，密码保护）”。
- `README.md:630`、`README_EN.md:619`：数据边界删除 WebDAV，改为 `.pqbackup`。
- `README.md:638`：删除“已实现 WebDAV 备份”的表述，改为加密备份包。
- `README.md:136`、`README_EN.md:135`：笔记能力描述里的“随 WebDAV 同步”改为“随加密备份包迁移”。
- `docs/USER_MANUAL.zh-CN.md:47`：能力表“备份 / WebDAV”改为“加密备份包”。
- `docs/USER_MANUAL.zh-CN.md:161`：笔记说明里的“随 WebDAV 备份”改为“随加密备份包”。
- `docs/USER_MANUAL.zh-CN.md:413-428`：5.7 节重写为“加密备份包导出/导入/换机迁移”，删除 WebDAV 步骤。
- `docs/USER_MANUAL.zh-CN.md:520`：设置参考表更新。
- `docs/USER_MANUAL.zh-CN.md:528`：升级前建议改为“先导出加密备份包”。
- `docs/USER_MANUAL.zh-CN.md:546`：FAQ 改为“备份包含哪些内容”。
- `AGENTS.md` 项目定位与数据边界：WebDAV 改为加密备份包；补充 `.pqbackup` 与 pending restore 说明。
- `docs/DEVELOPMENT.zh-CN.md:111`：本地构建前的备份建议改为导出 `.pqbackup`。
- `CHANGELOG.md` 与 `.github/release-notes.md`：标注破坏性变更、旧 WebDAV 迁移步骤、包体积与密码不可恢复提醒；明确新版本不读取旧 WebDAV 远端备份，升级前先用 0.4.x 恢复。

## 十六、待确认项与默认值

以下按默认值实施；如用户后续指定，再调整：

1. **默认预设**：完整迁移包（含 RAG 与 MinerU 缓存）。日常备份作为第二选项。
2. **密码策略**：最少 8 位，显示强度；不强制大小写/符号，不提供找回。
3. **包扩展名**：`.pqbackup`，默认文件名 `PaperQuay-Backup-YYYYMMDD-HHmm.pqbackup`。
4. **导入模式**：首版只做完整替换；合并导入列为后续需求。
5. **旧数据保留**：不自动删除，设置页提供手动删除。
6. **自动任务**：导入后默认关闭自动解析、自动概览、vault 自动同步、文件夹监听。
7. **版本号**：建议随本功能发布 `0.5.0`（备份格式与设置行为有破坏性变化）。
8. **WebDAV 移除范围**：已确认（2026-11-06）采用完全不保留——无只读入口、无隐藏开关、无 `webdav_settings` 表、无 `webdav` 字段。旧备份迁移的唯一路径是升级前用 0.4.x 恢复到本地（见 8.5），新版本不提供任何兼容入口。

## 十七、评审记录（2026-11-06）

评审方法：按第 1.1、1.3 节列出的入口逐项回读代码，核对路径、默认值、行号与可行性假设；再按「失败路径优先」检查导出中断、导入中断、回滚、并发与跨平台五类场景。以下 16 项为实质修改，其余为措辞与表格补全。

### 17.1 正确性缺陷（不修会直接出错）

| 编号 | 问题 | 处置 |
| --- | --- | --- |
| R1 | **回滚只覆盖 `dataDir`**。localStorage 位于 `userData/Local Storage/leveldb`，不在 `dataDir` 内；导入回灌后若回滚（含设置页手工改回），数据库回到旧版而批注、QA 会话、Agent 历史仍是新包内容，且无副本可恢复 | 7.2 增加 stage 阶段保存导入前全量快照；7.4 增加第 10 步回滚灌回；`pending.json` 增 `rendererSnapshotPath`；验收第 5 条与测试矩阵补对应用例 |
| R2 | **`app.relaunch()` 与 `requestSingleInstanceLock()` 冲突**。新实例在旧实例完全退出前抢锁失败即退出，表现为「点了导入，应用再也没起来」 | 7.3 改为 `relaunch` 带 `--paperquay-restore-resume`，旧实例先 `releaseSingleInstanceLock()`；新增错误码 `RESTORE_LOCK_CONFLICT` |
| R3 | **恢复期间 MCP 写入护栏失效**。`main.cjs` 在 `getBackend()` 之后才写 `desktopRunMarker`，而恢复在 `createBackend` 之前；这段窗口内外部 Agent 会认为应用未运行并向待改名目录写入 | 7.4 增加「进入状态机前先写 marker」；`pending.json` 存在时 MCP 护栏无条件拒写；补错误码与测试 |
| R4 | **偏移连续性规范自相矛盾**。4.4 的帧格式与 4.5 的 `dataLength` 未对齐；且「连续、无重叠」与「空文件 `dataLength = 0`」组合时，严格递增断言会把含多个空文件的合法包判为损坏 | 4.1 统一给出 `dataLength` 与 `dataOffset` 递推公式，显式允许相邻零长度 entry 偏移相等；补单测 |
| R5 | **空源根导致全路径误匹配**。`translatedPdfDir`、`notesVaultDir` 默认值为 `''`，空前缀会命中所有路径，把所有附件误判为「已重绑完成」 | 4.5 规定未配置源根写 `null`；7.5 增加空源根剔除与最长优先排序；补单测 |
| R6 | **`content_hash` 覆盖破坏去重**。初稿要求用 manifest SHA-256 校正 `content_hash`；两者算法虽相同，但非空值不同说明源库附件已被替换，覆盖会掩盖差异并改坏去重键 | 7.5 改为只补齐空值、非空不写；新增 `CONTENT_HASH_MISMATCH` 警告 |

### 17.2 设计缺陷与遗漏

| 编号 | 问题 | 处置 |
| --- | --- | --- |
| R7 | 导入暂存只设计了一个根，导致 12 GiB 级资产必须先写系统盘再搬到目标卷，或跨卷 12 GiB 复制 | 新增决策 D11 与 7.2 双暂存根（`stagingDataDir` / `stagingAssetsDir`），空间预检按卷分开计算 |
| R8 | 导出没有「可恢复性」证据，用户可能拿到一个打不开的包 | 新增决策 D12 与 6.2 导出后整包回读自检，失败即删包；验收与测试补对应用例 |
| R9 | 导出未约束读取方式，实现者容易用 `readFile` 把 GB 级文件读进内存 | 6.2 明确禁止整文件读入，要求流式 + 背压 |
| R10 | 未处理「文件正在被写入」：MinerU JSON、翻译缓存可能在解析中，包内会出现半写文件 | 6.2 跳过 `.tmp`/`.part`/`crdownload` 与 10 s 内新写文件，记 `FILE_UNSTABLE_AT_EXPORT` |
| R11 | 暂存目录清理按固定 24 小时阈值，会让含明文密钥与 PDF 的 12 GiB 目录在磁盘上滞留一天 | 6.2 改为 `owner.json` 记 pid，属主已退出立即清理，24 小时只作兜底 |
| R12 | vault 合并后可能留下「manifest 指向不存在笔记」的孤儿项 | 7.4 第 5 步增加孤儿收敛与 `.paperquay-orphans-<时间戳>/` 归档 |
| R13 | localStorage 配额口径错误（按字节比 10 MiB，实际按 UTF-16 code unit）；`renderer-restore.json` 缺少过期与 restoreId 校验，可能在很久以后覆盖当前状态 | 7.6 改为 code unit 口径与 400 万阈值；补 restoreId 校验与 7 天过期清理 |
| R14 | 工作量 11 人天低估 P3；`paperquay-library.json` 未列入排除项，可能重复播种旧版数据 | 12 节调整为 13.5 人天（按 14–16 排期）并说明理由；5.3 补排除项 |
| R15 | **验收标准要求“可回滚”，但产品上只有自动回滚（启动失败时），没有用户可用的回滚入口**；9.1 旧数据卡只有删除按钮，实现方要么漏做、要么另写一套回滚逻辑 | 7.7 明确回滚为可操作功能，复用同一状态机（`mode: 'rollback'`）并同时还原 renderer 快照；9.1 增加“回滚到此版本”；8.4 增加 `backup_rollback_prepare`；P4 补工作量 |
| R16 | **删 `webdav_settings` 会引爆全库写入**：`saveLibraryToDb`（`libraryDatabaseStore.cjs:955-964`）每次保存都先 `clearData(db)`（DELETE 清单含 `webdav_settings`）再 `saveKeyValueTable('webdav_settings')`；漏改任一而表已删，则**所有文献库写入**抛 `no such table`。另：`packaging/mcp/server.cjs` 是生成的打包产物（45,610 行，内联同一套 webdav 代码），不重新打包会让旧 MCP 整批失败 | 8.5 改为「逐点删除表」并单独标出 `clearData` 风险，要求删表与删引用同一提交；明确 `packaging/mcp/server.cjs` 重新生成而非手改；补验收、集成测试与 `grep` 校验 |

### 17.3 复核结论

- 第 1.1 节的九个入口、1.3 节的体积与条目数、第 8 节的文件与行号，与当前 `main`（`3d6d1a8`）一致，无需修正。
- 关键可行性假设成立：`snapshotTo` 三处齐备且 RAG 侧可由 `ragWorkerHost` 透出；`nodeSqlite.cjs` 已封装 `node:sqlite`，D9 的「开库前直接改库」可行；`ragStore` 打开即 `allowExtension: true` 加载 sqlite-vec，7.2 的 RAG 完整性校验方式正确；`src/types/backup.ts` 仅被两个待删文件引用，8.3 的删除清单安全。
- 仍需在 P0 用 spike 证伪的假设只有一条：preload 在 document-start 阶段能否稳定读写目标 origin 的 `localStorage`。若不可行，D8 需退化为「`src/main.tsx` 最前面注入的 prelude 模块」，此时必须逐一确认各 store 的 localStorage 读取发生在 prelude 之后。这也是把该 spike 列为 P0 硬门槛的原因。
- 一处已确认的决策（2026-11-06）：WebDAV 采用完全不保留，无只读入口、无 `webdav_settings` 表、无 `webdav` 字段；旧备份迁移只能升级前用 0.4.x 完成（见 8.5）。
