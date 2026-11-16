# PaperQuay v{{VERSION}}

## Overview shows up without clicking Generate

- Opening a paper now shows its existing overview straight from the local cache. This only reads files and never calls a model, so it works with "Auto Generate Overview" off and without an API key. While the paper content is still loading, the overview already shown in the library appears first.
- Clicking Generate checks the cache before the model settings. A missing model setting now shows an error without clearing the overview on screen.
- Opening the reader no longer wipes the cached overview in the library details panel.
- Select-all batch actions now follow the current knowledge-base filter.

## Show paper files in Explorer

- Right-click a paper to show its original PDF, translated PDF or Markdown (`full.md`) in Explorer, open its MinerU output folder, or copy the PDF path. Items whose files are missing are greyed out.
- The new backend command only accepts paths inside library-related folders and only reveals files; it never runs them.

## Cleaner buttons

- The assistant's "New chat +" button is no longer a solid black block; it matches the neighbouring buttons with an accent-coloured icon. The disabled send button and the reasoning-effort toggle use design tokens.
- Ten other solid black buttons (export annotated PDF, start reading, add to Q&A, settings actions and more) now use the theme's primary button style.

## Verification

- `npm run build` passed; `npm test` passed all 997 tests, including 20 new tests for overview auto-loading, file-location resolution and `reveal_path` rejecting out-of-scope paths.
- Installed-app acceptance is pending installation of this release: cached overview shown on open, right-click reveal of the four file types, and button appearance in light and dark themes.

## Windows release scope

From 0.4.24, only Windows x64 installers are published, maintained, and tested. The author has limited capacity; users must build macOS, Linux, and other platforms themselves, and the author does not maintain or test them. Historical release assets and source build targets remain available. Automatic installation of updates is limited to Windows packages.

Download the Windows x64 `.exe` installer from Assets. `stable.yml` and `.blockmap` support in-app updates.

---

## 概览无需再点「生成」

- 打开论文时，已有概览直接从本地缓存显示。这一步只读文件、不调用模型，关闭「自动生成概览」或未配置 API Key 时同样有效；正文尚未加载时，先显示文库里已有的概览。
- 点击生成时先读缓存再检查模型配置；缺少配置只提示错误，不清空已显示的概览。
- 打开阅读器不再清掉文库详情里已缓存的概览。
- 全选后的批量操作按当前知识库筛选执行。

## 在资源管理器中显示文献文件

- 在文献上右键，可显示原始 PDF、译版 PDF、Markdown（`full.md`），打开 MinerU 结果文件夹，或复制 PDF 路径。文件不存在的项置灰。
- 新增的后端命令只接受文库相关目录内的路径，只定位、不执行文件。

## 按钮样式统一

- 助手栏「新建会话 +」不再是实心黑块，改为与相邻按钮一致、图标为主题色的透明按钮；发送按钮禁用态和推理强度按钮改用设计令牌。
- 其余 10 处黑底按钮（导出批注 PDF、进入阅读、加入问答、设置页操作等）统一为主题主按钮样式。

## 验证

- `npm run build` 通过；`npm test` 全部 997 项通过，含概览自动加载、文件位置解析和 `reveal_path` 越界拒绝等 20 项新测试。
- 安装版验收待安装此版本后完成：打开即显示缓存概览、右键定位四类文件、日夜主题下的按钮观感。

## Windows 发布范围

自 0.4.24 起，仅发布、维护和测试 Windows x64 安装包。作者精力有限，macOS、Linux 等其他平台请用户自行打包，作者不承担维护和测试。历史发布资产及源码构建配置保留，应用内自动安装更新仅用于 Windows。

请从 Assets 下载 Windows x64 `.exe` 安装包。`stable.yml` 和 `.blockmap` 用于应用内更新。
