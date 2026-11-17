import {
  getSummarySectionKey,
  getSummarySectionLabel,
  type SummarySectionKey,
  type SummarySectionLocalize,
} from '../../reader/overview/summarySections.ts';

export interface PaperOverviewDisplaySection {
  key?: SummarySectionKey;
  title: string;
  content: string;
}

function normalizeKeyword(value: string) {
  return value.trim().toLocaleLowerCase();
}

/** AI 关键词全部已在文献元数据关键词中时才视为重复；有任何新词就保留该节，避免信息丢失。 */
export function isOverviewKeywordSectionRedundant(content: string, knownKeywords: readonly string[]): boolean {
  const known = new Set(knownKeywords.map(normalizeKeyword).filter(Boolean));
  const aiKeywords = content
    .split(/[,，;；、\n]/)
    .map((item) => normalizeKeyword(item.replace(/^[-*]\s*/, '')))
    .filter(Boolean);
  return aiKeywords.length > 0 && known.size > 0 && aiKeywords.every((item) => known.has(item));
}

export function parsePaperOverviewForDisplay(
  value: string,
  localize: SummarySectionLocalize,
  knownKeywords: readonly string[] = [],
): PaperOverviewDisplaySection[] {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const sections: PaperOverviewDisplaySection[] = [];
  let key: SummarySectionKey | undefined = 'overview';
  let title = getSummarySectionLabel('overview', localize);
  let lines: string[] = [];
  let hasMarkdownHeading = false;
  const flush = () => {
    const content = lines.join('\n').trim();
    if (content) sections.push({ ...(key ? { key } : {}), title, content });
    lines = [];
  };

  for (const line of normalized.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (!heading) {
      lines.push(line);
      continue;
    }

    hasMarkdownHeading = true;
    flush();
    const rawTitle = heading[1].trim();
    key = getSummarySectionKey(rawTitle);
    title = key ? getSummarySectionLabel(key, localize) : rawTitle;
  }
  flush();

  if (sections.length) {
    return sections.filter((section) =>
      section.key !== 'keywords' || !isOverviewKeywordSectionRedundant(section.content, knownKeywords));
  }
  if (hasMarkdownHeading) return [];
  return [{ key: 'overview', title: getSummarySectionLabel('overview', localize), content: normalized }];
}
