# 上游同步说明

## 远程约定

| 远程 | 作用 | 地址 |
| --- | --- | --- |
| `upstream` | 原始项目，只读同步来源 | `https://github.com/WangQrkkk/PaperQuay.git` |
| `origin` | 个人 Fork，提交和 Release 目标 | `https://github.com/<你的用户名>/PaperQuay.git` |

不要把两个远程的职责混用。修复分支推送到 `origin`，上游同步从 `upstream` 获取。

## 同步策略

`main` 只保留经过验证的同步结果。默认使用 fast-forward：

```text
upstream/main -> 本地 main -> origin/main
```

如果 `git merge --ff-only upstream/main` 失败，说明个人 `main` 存在额外提交或分叉。此时不要强制推送，先查看：

```powershell
git log --oneline --graph --decorate --all -30
git diff upstream/main...main
```

通常的处理方式是把未完成工作移到功能分支，再让 `main` 回到上游同步线；涉及已有个人提交时，先人工确认历史结构，再决定 rebase 或 merge。

## 处理上游 Bug 修复

1. 先在个人 Fork 的功能分支完成修复。
2. 在本地运行 `npm run build`、`npm test` 和必要的手工验证。
3. 推送到个人 Fork。
4. 创建指向 `WangQrkkk/PaperQuay:main` 的 Pull Request。
5. 上游合并后，再运行 `Sync-Upstream.ps1` 清理个人分支上的重复修改。

## 冲突处理原则

- 先保留用户数据和存储迁移相关代码的行为。
- UI 冲突要结合截图和实际交互验证，不只看 TypeScript 是否通过。
- `electron/backend/updateCommands.cjs` 和 `package.json` 的发布配置属于个人 Fork 配置，若上游同步覆盖，重新运行 `Configure-Fork.ps1`。
- README 已本地化：`README.md` 是中文主文档，`README_EN.md` 是英文版，`README.zh-CN.md` 仅保留跳转。上游若更新英文 `README.md`，合并时把有效内容合入 `README_EN.md`，并同步更新中文主文档，不要让上游英文版覆盖回默认 README。
- 不要把个人 API 配置、测试论文或本地路径提交到仓库。
