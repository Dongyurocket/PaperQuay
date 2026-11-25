import type { LiteraturePaperRagStatus } from './components/LiteraturePaperList';

/**
 * 文献级 RAG 动作与文案的纯函数。
 *
 * 行内角标、详情页状态条和知识库面板共用同一套动作，避免三个入口对
 * 「失败是该重试还是重建」「未解析能不能建」给出不同答案。
 */

export type RagPaperAction =
  | 'build'
  | 'retry'
  | 'update'
  | 'rebuild'
  | 'exclude'
  | 'include'
  | 'open-details'
  | 'parse-mineru';

export type LocaleText = (zh: string, en: string) => string;

export interface RagActionContext {
  status: LiteraturePaperRagStatus;
  ragIndexAvailable: boolean;
  mineruParsed: boolean;
  /** 该文献正在索引。 */
  indexing?: boolean;
  /** 批量任务或成员切换进行中：避免两条路径同时写同一篇索引。 */
  busy?: boolean;
}

export interface RagActionItem {
  id: RagPaperAction;
  action: RagPaperAction;
  label: string;
  disabled?: boolean;
  hint?: string;
}

export function ragStatusLabel(status: LiteraturePaperRagStatus, l: LocaleText): string {
  return ({
    ready: l('已索引', 'Indexed'),
    stale: l('待更新', 'Update needed'),
    pending: l('待索引', 'Pending'),
    failed: l('索引失败', 'Index failed'),
    none: l('未建立', 'Not built'),
    excluded: l('已排除', 'Excluded'),
  })[status];
}

export function ragStatusDescription(status: LiteraturePaperRagStatus, l: LocaleText): string {
  return ({
    ready: l('本地知识库可直接检索这篇文献。', 'This paper is searchable in the local knowledge base.'),
    stale: l('索引仍可检索，但抽取器或 embedding 模型已变化，建议更新。', 'The index still works, but the extractor or embedding model changed; update it when convenient.'),
    pending: l('索引正在建立或尚未完成，完成后会自动刷新。', 'Indexing is queued or in progress; the status refreshes when it finishes.'),
    failed: l('最近一次索引失败，可查看原因后重试。', 'The last indexing attempt failed. Check the reason and retry.'),
    none: l('尚未建立索引；未解析的文献需要先运行 MinerU。', 'No index yet. Papers without parsed text need MinerU first.'),
    excluded: l('该文献不参与本地知识库检索，但 PDF、解析结果和笔记都会保留。', 'This paper is excluded from local retrieval; its PDF, parsed text and notes are kept.'),
  })[status];
}

/**
 * 按聚合状态生成动作菜单。
 * 手动动作统一由调用方走 force 路径（绕过 60 秒冷却）；这里只负责呈现与禁用。
 */
export function buildRagActionItems(
  context: RagActionContext,
  l: LocaleText,
): RagActionItem[] {
  const blocked = Boolean(context.busy || context.indexing);
  const unavailable = !context.ragIndexAvailable;
  const openDetails: RagActionItem = {
    id: 'open-details',
    action: 'open-details',
    label: l('查看索引详情', 'View index details'),
  };
  const exclude: RagActionItem = {
    id: 'exclude',
    action: 'exclude',
    label: l('移出知识库', 'Exclude from knowledge base'),
    disabled: Boolean(context.busy),
  };
  const buildLabel = context.mineruParsed
    ? l('建立索引', 'Build index')
    : l('建立索引（先 MinerU 解析）', 'Build index (run MinerU first)');

  switch (context.status) {
    case 'excluded':
      return [{
        id: 'include',
        action: 'include',
        label: l('加入知识库', 'Include in knowledge base'),
        disabled: Boolean(context.busy),
      }];
    case 'ready':
      return [{
        id: 'rebuild',
        action: 'rebuild',
        label: l('重建索引', 'Rebuild index'),
        disabled: blocked || unavailable,
      }, openDetails, exclude];
    case 'stale':
      return [{
        id: 'update',
        action: 'update',
        label: l('更新索引', 'Update index'),
        disabled: blocked || unavailable,
      }, {
        id: 'rebuild',
        action: 'rebuild',
        label: l('重建索引', 'Rebuild index'),
        disabled: blocked || unavailable,
      }, openDetails, exclude];
    case 'failed':
      return [{
        id: 'retry',
        action: 'retry',
        label: l('重试索引', 'Retry indexing'),
        disabled: blocked || unavailable,
      }, openDetails, exclude];
    case 'pending':
      return [openDetails, {
        id: 'rebuild',
        action: 'rebuild',
        label: l('重建索引', 'Rebuild index'),
        disabled: blocked || unavailable,
      }, exclude];
    default:
      return [{
        id: 'build',
        action: 'build',
        label: buildLabel,
        disabled: blocked || unavailable || !context.mineruParsed,
        hint: context.mineruParsed
          ? undefined
          : l('该文献还没有 MinerU 解析结果。', 'This paper has no parsed MinerU text yet.'),
      }, exclude];
  }
}
