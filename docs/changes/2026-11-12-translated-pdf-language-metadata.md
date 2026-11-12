# 2026-11-12 - 译版 PDF 语言元数据

## 现象

既有译版附件缺少可编辑的语言信息；新附加流程也可能把翻译目标语言直接当成 PDF 的实际语言。

## 修改

- 支持单个译版设置、修改和清除语言，并支持带完整预览、冲突检测和事务回滚的批量更新。
- 文库和阅读器附加译版时确认语言；翻译目标语言仅作为候选值。重复附件仍按原规则去重，并引导用户到语言设置入口。
- 保存后刷新文库及已打开阅读器的译版标签；仅更新语言元数据，不自动识别或回填既有附件。
- 版本递增为 0.4.25；Release 提供 Windows x64 安装包。

## 验证

- `npm run check`：类型检查、生产构建及 977 项测试通过。
- 最终修正后 `npx tsc --noEmit`、译版专项 5 项测试和前端生产构建通过。
- 本地 Windows x64 安装包：122,241,558 字节；SHA-256 `2E67DF52060260FDEC8A2A37D34928CBEABEC3B5B99316FE2BE3494BE93064BD`，SHA-512 `0B0D9D158B52A670241CB704813F09418258F78296530D7D66A91CB9EA57C24C1939CAFB4C70AE94AD5B4D99E322358B92DEBFC95408D844A15F28AE99CF3004`。
- 已发布 GitHub Release：[PaperQuay v0.4.25](https://github.com/Dongyurocket/PaperQuay/releases/tag/app-v0.4.25)；CI 安装包大小 122,241,301 字节，SHA-256 `8c6be947e6d036bcb991137a6197d2b5ca818b3a9c10293db4a49e0afc13fbc7`，并已上传 `.blockmap` 与 `stable.yml`。
- Windows 安装版已完成实机交互验收，用户反馈测试无问题；不会使用或修改用户真实文库进行验收。
