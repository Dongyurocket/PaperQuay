import type { LibraryAgentRagCitation } from '../../services/libraryAgent';

export interface AgentCitationGroupPage {
  label: string;
  pageIndex: number | null;
  blockId?: string | null;
  citation: LibraryAgentRagCitation;
}

export interface AgentCitationGroup {
  paperId: string;
  paperTitle: string;
  count: number;
  pages: AgentCitationGroupPage[];
  firstLabel: string;
}

/**
 * 将平铺的引用列表按 paperId 聚合为文献组。
 * - 保持文献初次出现的相对顺序
 * - 组内按 pageIndex 升序排序，无页码（null/undefined）排在最后
 * - 同页去重保留首条；无页码多条也去重保留首条
 * - count 为去重后的实际引用页项数量
 */
export function groupAgentCitations(
  citations?: LibraryAgentRagCitation[],
): AgentCitationGroup[] {
  if (!citations || citations.length === 0) {
    return [];
  }

  const groupMap = new Map<string, AgentCitationGroup>();

  for (const citation of citations) {
    const paperId = citation.paperId || 'unknown';
    let group = groupMap.get(paperId);

    if (!group) {
      group = {
        paperId,
        paperTitle: citation.paperTitle?.trim() || paperId,
        count: 0,
        pages: [],
        firstLabel: citation.label || '',
      };
      groupMap.set(paperId, group);
    }

    const pageIndex = citation.pageIndex ?? null;
    const isDuplicate = group.pages.some((p) => p.pageIndex === pageIndex);
    if (!isDuplicate) {
      group.pages.push({
        label: citation.label,
        pageIndex,
        blockId: citation.blockId ?? null,
        citation,
      });
    }
  }

  const groups = Array.from(groupMap.values());

  for (const group of groups) {
    group.pages.sort((a, b) => {
      if (a.pageIndex === null && b.pageIndex === null) return 0;
      if (a.pageIndex === null) return 1;
      if (b.pageIndex === null) return -1;
      return a.pageIndex - b.pageIndex;
    });
    group.count = group.pages.length;
  }

  return groups;
}

/**
 * 格式化文献组的页码摘要：
 * - 单页：第 X 页
 * - 多页：第 X–Y 页
 * - 无页码：全文
 */
export function formatGroupPageSummary(
  group: AgentCitationGroup,
  l: (zh: string, en: string) => string = (zh) => zh,
): string {
  const numericPages = group.pages
    .map((p) => p.pageIndex)
    .filter((idx): idx is number => idx !== null)
    .map((idx) => idx + 1);

  if (numericPages.length === 0) {
    return l('全文', 'Full text');
  }

  const minPage = Math.min(...numericPages);
  const maxPage = Math.max(...numericPages);

  if (minPage === maxPage) {
    return l(`第 ${minPage} 页`, `Page ${minPage}`);
  }

  return l(`第 ${minPage}–${maxPage} 页`, `Pages ${minPage}–${maxPage}`);
}
