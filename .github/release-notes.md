# PaperQuay v{{VERSION}}

## Fixes

- **LaTeX formulas rendered in red (glued control sequences)**: Formulas from model output or OCR often lost the required space between a backslash command and a following letter (e.g. `\pir^2`, `\Omegar`, `\sumT_{z,rotor_i}`, `\timesa_z`), producing undefined commands that KaTeX rendered in red. A new `normalizeGluedLatex` sanitizer splits glued runs at the longest known LaTeX control-word prefix and restores the space (chained command glue like `\alphabeta` gets the backslash back), while unknown commands are left untouched. A new `remarkFixGluedLatex` plugin repairs every math/inlineMath AST node before KaTeX rendering and is wired into all four markdown entry points — Agent chat, assistant sidebar, MinerU block viewer, and reparse preview — with `normalizeRawLatexExpression` covering the direct equation rendering path. The Agent system prompt now also instructs the model to always separate backslash commands from following letters.

## Downloads

Select the installer matching your system and architecture from Assets: Windows `.exe` or `.msi`, macOS `.dmg`, or Linux `.AppImage` / `.deb` / `.tar.gz`.

---

# PaperQuay v{{VERSION}} 中文说明

## 修复

- **公式红字（LaTeX 控制序列粘连）**：模型输出或 OCR 生成的公式丢失反斜杠命令与后续字母之间的必需空格（如 `\pir^2`、`\Omegar`、`\sumT_{z,rotor_i}`、`\timesa_z`），形成未定义命令被 KaTeX 标红。新增 `normalizeGluedLatex` 清洗：按最长已知 LaTeX 控制词前缀拆分并补空格（双命令粘连如 `\alphabeta` 自动补回反斜杠），未知命令原样保留；新增 `remarkFixGluedLatex` 插件在 KaTeX 渲染前修复所有 math/inlineMath 节点，接入 Agent 回答、助手侧栏、MinerU 块渲染、重解析预览共四处渲染入口，并接入 `normalizeRawLatexExpression` 覆盖公式直渲路径；Agent 系统提示同步补充 LaTeX 书写规则从源头约束。

## 下载

请在 Assets 中选择对应系统和架构的安装包：Windows `.exe` 或 `.msi`、macOS `.dmg`、Linux `.AppImage` / `.deb` / `.tar.gz`。
