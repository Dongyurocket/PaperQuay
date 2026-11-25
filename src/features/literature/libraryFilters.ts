import type { LibraryTagCount, ListPapersRequest, LiteraturePaper } from '../../types/library.ts';

export const LIBRARY_FILTERS_STORAGE_KEY = 'paperquay-literature-filters-v1';
export type LibraryReadStatus = 'unread' | 'reading' | 'finished';
export type LibraryMembership = 'all' | 'included' | 'excluded';
export type LibraryRagStatusFilter = 'all' | 'ready' | 'stale' | 'pending' | 'failed' | 'none';
export interface LibraryFilterState {
  favorite: boolean;
  recentlyRead: boolean;
  tagIds: string[];
  yearFrom: number | null;
  yearTo: number | null;
  itemTypes: string[];
  readStatus: LibraryReadStatus | null;
  hasPdf: boolean;
  hasTranslatedPdf: boolean;
  missingFile: boolean;
  hasSummary: boolean;
  mineruParsed: boolean;
  source: '' | 'local' | 'zotero';
  ragMembership: LibraryMembership;
  ragStatus: LibraryRagStatusFilter;
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilterState = {
  favorite: false, recentlyRead: false, tagIds: [], yearFrom: null, yearTo: null,
  itemTypes: [], readStatus: null, hasPdf: false, hasTranslatedPdf: false,
  missingFile: false, hasSummary: false, mineruParsed: false, source: '', ragMembership: 'all',
  ragStatus: 'all',
};

export function serializeLibraryFilters(filters: LibraryFilterState): string {
  return JSON.stringify(filters);
}

export function parseLibraryFilters(value: string | null): LibraryFilterState {
  const fallback = (): LibraryFilterState => ({ ...DEFAULT_LIBRARY_FILTERS, tagIds: [], itemTypes: [] });
  try {
    if (!value) return fallback();
    const item = JSON.parse(value) as Record<string, unknown>;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fallback();
    const booleans = ['favorite', 'recentlyRead', 'hasPdf', 'hasTranslatedPdf', 'missingFile', 'hasSummary', 'mineruParsed'];
    const strings = (value: unknown) => Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
    const year = (value: unknown) => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 9999);
    // 旧版本没有 ragStatus：缺省回落 all，不要因为一个新增筛选丢掉用户已有的标签/年份。
    const ragStatus = item.ragStatus ?? 'all';
    if (booleans.some((key) => typeof item[key] !== 'boolean') || !strings(item.tagIds) || !strings(item.itemTypes)
      || !year(item.yearFrom) || !year(item.yearTo)
      || (typeof item.yearFrom === 'number' && typeof item.yearTo === 'number' && item.yearFrom > item.yearTo)
      || ![null, 'unread', 'reading', 'finished'].includes(item.readStatus as LibraryReadStatus | null)
      || !['', 'local', 'zotero'].includes(item.source as string)
      || !['all', 'included', 'excluded'].includes(item.ragMembership as string)
      || !['all', 'ready', 'stale', 'pending', 'failed', 'none'].includes(ragStatus as string)) return fallback();
    return { ...DEFAULT_LIBRARY_FILTERS, ...item, ragStatus: ragStatus as LibraryRagStatusFilter, tagIds: [...new Set(item.tagIds as string[])], itemTypes: [...new Set(item.itemTypes as string[])] } as LibraryFilterState;
  } catch { return fallback(); }
}

export function loadLibraryFilters(): LibraryFilterState {
  try { return parseLibraryFilters(localStorage.getItem(LIBRARY_FILTERS_STORAGE_KEY)); }
  catch { return parseLibraryFilters(null); }
}

export function persistLibraryFilters(filters: LibraryFilterState): void {
  try { localStorage.setItem(LIBRARY_FILTERS_STORAGE_KEY, serializeLibraryFilters(filters)); } catch { /* storage is optional */ }
}

export function buildPaperQuery(
  filters: LibraryFilterState,
  sort: Pick<ListPapersRequest, 'sortBy' | 'sortDirection'>,
  category: string | null,
  search: string,
  mineruPaperIds: string[] = [],
): ListPapersRequest {
  return {
    categoryId: category, search, ...sort,
    favorite: filters.favorite || null,
    tagIds: filters.tagIds,
    yearFrom: filters.yearFrom, yearTo: filters.yearTo,
    itemTypes: filters.itemTypes, readStatus: filters.readStatus,
    hasPdf: filters.hasPdf || null, hasTranslatedPdf: filters.hasTranslatedPdf || null,
    missingFile: filters.missingFile || null, hasSummary: filters.hasSummary || null,
    source: filters.source || null,
    ragEnabled: filters.ragMembership === 'all' ? null : filters.ragMembership === 'included',
    ragStatus: filters.ragStatus === 'all' ? null : filters.ragStatus,
    ...(filters.mineruParsed ? { paperIds: mineruPaperIds } : {}),
    ...(filters.recentlyRead ? { readAfter: Date.now() - 30 * 24 * 60 * 60 * 1000 } : {}),
  };
}

type LocaleText = (zh: string, en: string) => string;
export interface ActiveLibraryFilter { id: string; label: string }

export function describeActiveFilters(filters: LibraryFilterState, l: LocaleText, tags: LibraryTagCount[] = []): ActiveLibraryFilter[] {
  const result: ActiveLibraryFilter[] = [];
  const add = (active: boolean, id: string, zh: string, en: string) => { if (active) result.push({ id, label: l(zh, en) }); };
  add(filters.favorite, 'favorite', '收藏', 'Favorites');
  add(filters.recentlyRead, 'recentlyRead', '最近 30 天阅读', 'Read in the last 30 days');
  if (filters.readStatus) result.push({ id: 'readStatus', label: ({ unread: l('未读', 'Unread'), reading: l('在读', 'Reading'), finished: l('已读完', 'Finished') })[filters.readStatus] });
  if (filters.yearFrom !== null || filters.yearTo !== null) result.push({ id: 'year', label: `${filters.yearFrom ?? '…'}–${filters.yearTo ?? '…'}` });
  for (const id of filters.tagIds) result.push({ id: `tag:${id}`, label: tags.find((tag) => tag.id === id)?.name ?? id });
  for (const id of filters.itemTypes) result.push({ id: `type:${id}`, label: itemTypeLabel(id, l) });
  add(filters.hasPdf, 'hasPdf', '有 PDF', 'Has PDF');
  add(filters.hasTranslatedPdf, 'hasTranslatedPdf', '有译版 PDF', 'Has translated PDF');
  add(filters.missingFile, 'missingFile', '文件缺失', 'Missing file');
  add(filters.hasSummary, 'hasSummary', '已生成概览', 'Has overview');
  add(filters.mineruParsed, 'mineruParsed', 'MinerU 已解析', 'MinerU parsed');
  if (filters.source) result.push({ id: 'source', label: filters.source === 'local' ? l('本地', 'Local') : l('Zotero', 'Zotero') });
  if (filters.ragMembership !== 'all') result.push({ id: 'ragMembership', label: filters.ragMembership === 'included' ? l('已加入知识库', 'In knowledge base') : l('已排除知识库', 'Excluded from knowledge base') });
  if (filters.ragStatus !== 'all') result.push({
    id: 'ragStatus',
    label: ({
      ready: l('RAG 已索引', 'RAG indexed'),
      stale: l('RAG 待更新', 'RAG update needed'),
      pending: l('RAG 待索引', 'RAG pending'),
      failed: l('RAG 索引失败', 'RAG index failed'),
      none: l('RAG 未建立', 'RAG not built'),
    })[filters.ragStatus],
  });
  return result;
}

export const LIBRARY_ITEM_TYPES = ['journalArticle', 'conferencePaper', 'thesis', 'report', 'book', 'preprint', 'misc'] as const;
export function itemTypeLabel(value: string, l: LocaleText): string {
  const labels: Record<string, [string, string]> = {
    journalArticle: ['期刊', 'Journal'], conferencePaper: ['会议', 'Conference'], thesis: ['学位论文', 'Thesis'],
    report: ['报告', 'Report'], book: ['图书', 'Book'], preprint: ['预印本', 'Preprint'], misc: ['其他', 'Other'],
  };
  const label = labels[value];
  return label ? l(...label) : value;
}

export function removeLibraryFilter(filters: LibraryFilterState, id: string): LibraryFilterState {
  if (id.startsWith('tag:')) return { ...filters, tagIds: filters.tagIds.filter((item) => item !== id.slice(4)) };
  if (id.startsWith('type:')) return { ...filters, itemTypes: filters.itemTypes.filter((item) => item !== id.slice(5)) };
  if (id === 'year') return { ...filters, yearFrom: null, yearTo: null };
  if (id in DEFAULT_LIBRARY_FILTERS) return { ...filters, [id]: DEFAULT_LIBRARY_FILTERS[id as keyof LibraryFilterState] };
  return filters;
}

/** 演示文库沿用与持久化查询相同的筛选口径。 */
export function matchesDemoLibraryFilters(paper: LiteraturePaper, filters: LibraryFilterState, mineruIds: string[]): boolean {
  const year = /^\d{4}$/.test(paper.year ?? '') ? Number(paper.year) : null;
  const progress = paper.readingProgress || 0;
  const status = progress >= 1 ? 'finished' : paper.lastReadAt != null || progress > 0 ? 'reading' : 'unread';
  return (!filters.favorite || paper.isFavorite)
    && (!filters.recentlyRead || (paper.lastReadAt != null && paper.lastReadAt >= Date.now() - 30 * 24 * 60 * 60 * 1000))
    && (!filters.tagIds.length || paper.tags.some((tag) => filters.tagIds.includes(tag.id)))
    && ((filters.yearFrom === null && filters.yearTo === null) || (year !== null && (filters.yearFrom === null || year >= filters.yearFrom) && (filters.yearTo === null || year <= filters.yearTo)))
    && (!filters.itemTypes.length || filters.itemTypes.includes(paper.itemType ?? ''))
    && (!filters.readStatus || filters.readStatus === status)
    && (!filters.hasPdf || paper.attachments.some((a) => a.kind === 'pdf' && !a.missing))
    && (!filters.hasTranslatedPdf || paper.attachments.some((a) => a.kind === 'translated-pdf' && !a.missing))
    && (!filters.missingFile || paper.attachments.some((a) => a.missing))
    && (!filters.hasSummary || Boolean(paper.aiSummary?.trim()))
    && (!filters.mineruParsed || mineruIds.includes(paper.id))
    && (!filters.source || paper.source === filters.source)
    && (filters.ragMembership === 'all' || (paper.ragEnabled !== false) === (filters.ragMembership === 'included'))
    // 演示库没有真实 RAG 索引，状态筛选不应伪装成有结果。
    && filters.ragStatus === 'all';
}
