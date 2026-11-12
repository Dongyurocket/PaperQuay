# PaperQuay v{{VERSION}}

## Translated PDF language metadata

- Set, change, and clear the language on an existing translated PDF attachment.
- Select papers across the full current selection, review every translated attachment and its old/new value, then save changes atomically. Known languages are unchecked by default.
- Confirm a language when attaching a translated PDF from either the library or reader. The translation target is only a suggested default; duplicate attachments keep their existing metadata.
- Language edits update attachment metadata and an existing asset binding only. They do not rewrite or move PDF files, and upgrades never infer languages for existing attachments.

## Verification

- `npm run build` passed; `npm test` passed all 977 tests.
- Windows x64 installer is built by the Release workflow. Installed-app acceptance for these new dialogs and reader-state preservation remains pending installation of this release.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

---

## 译版 PDF 语言元数据

- 可为已有译版附件设置、修改或清除语言。
- 多选文献（含跨页全选）后，可查看所有译版附件及修改前后的值，再原子保存；已有语言默认不勾选。
- 从文献库或阅读器附加译版时都需确认语言。翻译目标语言仅作为候选默认值；重复附件保留原语言元数据。
- 语言编辑只更新附件元数据及已有资产绑定，不重写或移动 PDF。升级不会推断或回填已有译版语言。

## 验证

- `npm run build` 通过；`npm test` 全部 977 项通过。
- Windows x64 安装包由 Release 工作流构建。新弹窗与阅读器状态保持的安装版验收，待安装此版本后完成。

## Windows 发布范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内更新。
