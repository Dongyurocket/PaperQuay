import type { LibraryAgentRagCitation } from '../../services/libraryAgent.ts';

/**
 * 将正文中的内部 paper ID 解析为 Markdown 链接胶囊。
 * 未在引用或文献表中找到的退化为带有 title 的代码块。
 *
 * 纯函数：不依赖 React 或 Electron，供 AgentMarkdown.tsx 与 node --test 单测共用。
 */
export function resolveBarePaperIds(
  content: string,
  citations?: LibraryAgentRagCitation[],
  titleFallbackById?: Map<string, string> | Record<string, string>,
): string {
  const getFallbackTitle = (id: string): string | undefined => {
    if (!titleFallbackById) return undefined;
    if (titleFallbackById instanceof Map) {
      return titleFallbackById.get(id);
    }
    return titleFallbackById[id];
  };

  const citationsByPaperId = new Map<string, LibraryAgentRagCitation[]>();
  for (const c of citations ?? []) {
    const list = citationsByPaperId.get(c.paperId) ?? [];
    list.push(c);
    citationsByPaperId.set(c.paperId, list);
  }

  const fenceParts = content.split(/(```[\s\S]*?```)/g);

  return fenceParts
    .map((part) => {
      if (part.startsWith('```')) {
        return part;
      }

      return part
        .split(/(`[^`\n]+`|\[[^\]]*\]\([^)]*\))/g)
        .map((inlinePart) => {
          if (
            (inlinePart.startsWith('`') && inlinePart.endsWith('`')) ||
            (inlinePart.startsWith('[') && inlinePart.includes('](') && inlinePart.endsWith(')'))
          ) {
            return inlinePart;
          }

          return inlinePart.replace(
            /(^|[^\w`])((?:paper|category)_[A-Za-z0-9_-]{8,})(?:[,，]\s*(?:p(?:age)?\.?\s*|第\s*)(\d+)(?:\s*页)?)?(?=$|[^\w`])/g,
            (_match, prefix: string, id: string, pageSuffix?: string) => {
              if (id.startsWith('category_')) {
                return `${prefix}\`${id}\``;
              }

              const paperCitations = citationsByPaperId.get(id);
              const fallbackTitle = getFallbackTitle(id);
              const paperTitle = paperCitations?.[0]?.paperTitle || fallbackTitle;

              if (paperTitle) {
                const targetPage = pageSuffix ? parseInt(pageSuffix, 10) : undefined;
                let pageIndexToUse: number | undefined = targetPage;

                if (paperCitations && paperCitations.length > 0) {
                  const matchedCitation = targetPage !== undefined
                    ? paperCitations.find((c) => (c.pageIndex !== null && c.pageIndex !== undefined ? c.pageIndex + 1 : undefined) === targetPage)
                    : paperCitations[0];

                  if (matchedCitation && matchedCitation.pageIndex !== null && matchedCitation.pageIndex !== undefined) {
                    pageIndexToUse = matchedCitation.pageIndex + 1;
                  } else if (targetPage === undefined && paperCitations[0].pageIndex !== null && paperCitations[0].pageIndex !== undefined) {
                    pageIndexToUse = paperCitations[0].pageIndex + 1;
                  }
                }

                const pageLabel = pageIndexToUse !== undefined ? ` · 第 ${pageIndexToUse} 页` : '';
                const query = pageIndexToUse !== undefined ? `?page=${pageIndexToUse}` : '';
                return `${prefix}[${paperTitle}${pageLabel}](#agent-paper-${encodeURIComponent(id)}${query})`;
              }

              return `${prefix}[${id}](#agent-paper-unresolved:${id})`;
            },
          );
        })
        .join('');
    })
    .join('');
}
