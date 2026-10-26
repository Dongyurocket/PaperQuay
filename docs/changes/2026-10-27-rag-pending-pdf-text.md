# 2026-10-27 - hybrid 文献卡停在「RAG 待索引」

## 现象

文献已显示「MinerU 已解析」「概览已生成」，本地 RAG 已启用且检索源为 hybrid，文献卡仍一直显示「RAG 待索引」。右键或设置里的重建索引提示完成后，角标不变。

## 根因

角标按同一文献的全部索引入口聚合：任一来源不是 ready，整篇就是 pending。本机这篇文献的 `mineru-markdown` 已是 3274/3274 ready，但 `pdf-text` 在 2026-09-23 写完两个 embedding batch 后中断，停在 pending 48/178，且没有失败记录。全库只有这一篇是这种状态。

文献库的自动索引和重建只写 `mineru-markdown`。MinerU 已就绪时重建直接返回，不会补 `pdf-text`。`pdf-text` 只在阅读器问答时同步续跑；只看文献卡，或用会在后台中断的 Agent 索引，都不会把它跑完。

## 修改

手动和批量重建（`force`）在 `hybrid` / `pdf-text` 下会读取 PDF 文本层，并按 chunkId 差集补齐 `pdf-text`。解析后的自动索引仍只写 `mineru-markdown`。

## 验证

- 对照本机 `paperquay-rag.sqlite`：目标文献 MinerU 为 ready，`pdf-text` 为 pending 48/178；其余 192 篇文献索引均为 ready。
- 未在打标签前重新跑完整测试或干净安装版回归。安装包由 `app-v0.4.15` Release 工作流构建。
