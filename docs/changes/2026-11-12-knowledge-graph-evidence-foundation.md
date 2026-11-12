# KG-P1 来源版本、EvidenceSpan 与审核事件底座

日期：2026-11-12

## 实现

- 共享 `paperquay-knowledge.sqlite` 新增 `kg_source_versions`、`kg_evidence_spans`、`kg_review_events` 及按来源/页、block、审核对象建立的索引。
- 来源版本绑定已发布的文献 generation source version、来源表示类型、内容签名、来源角色快照和解析 generation；同文献更新版本时，旧 current 来源在知识库事务中转为 stale。
- EvidenceSpan 保存不可变 quote/hash、零基物理页、可选印刷页、block/chunk/unit/章节与 unit revision、偏移和定位状态。写入要求传入来源 block 文本，quote 与 offsets 必须逐字匹配；再核对 source version 仍为当前版本，阻止迟到抽取写入。
- 人工审核采用追加事件保存对象 revision、decision、reviewer 和理由。来源缺失时保留历史 quote 与审核，并显式返回 missing；source generation 变化后旧证据保留但 `isCurrent=false`。

## 验证

- `node --test tests/knowledgeStoreEvidence.test.mjs tests/knowledgeGraphCommands.test.mjs tests/backupPackage.test.ts`：16/16。
- 新测试覆盖跨重启证据与人工决定恢复、零基页定位、quote/hash 完整性、伪造 quote 拒绝、来源版本替换后的迟到写入拒绝，以及来源行删除后的 missing 历史快照保留。
- 外部模型、工程文库抽取和桌面原文定位尚未接入或实测；本增量仅为可写入/读取的存储底座，不标记 KG-P1 完成。
