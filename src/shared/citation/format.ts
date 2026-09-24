/**
 * 引用/参考文献条目格式化（GB/T 7714-2015 顺序编码制与著者-出版年制、APA 7、IEEE）。
 *
 * 数据组装优先级：库内结构化字段（authors/year/publication/volume/issue/pages/doi）
 * → fallbackLabel 兜底 → 标题兜底。本模块只做纯文本格式化，不依赖 DOM/编辑器/Node。
 *
 * GB/T 7714-2015 相关取舍（见 docs/plans/2026-09-25-office-addin-citation-plan.md §7.2）：
 *  - 西文作者：有 `familyName`/`givenName` 结构化字段时输出「姓 + 名首字母」（`Vaswani A`），
 *    缺结构化字段时退回 `name` 原样（不猜测拆名，避免误拆）。
 *  - 专著 `[M]`：`出版地: 出版者, 年: 页`；学位论文 `[D]`：`保存地: 保存单位, 年`。
 *  - 会议论文 `[C]`：题名后接 `//论文集名`（GB/T 7714-2015 写法）。
 */
import { assignCitationNumbers, normalizeCitationItems, type CitationItemInput } from './numbering.ts';
import { citationStyleKind, normalizeCitationStyle, type CitationStyleId } from './styles.ts';
import { cleanPart, initialsCompact, initialsWithDots, isCjkName, joinParts, trimTrailingPeriod } from './text.ts';
import type { CitationAuthorInput, CitationPaperLike } from './types.ts';

export interface AuthorParts {
  /** 原始展示名（结构化字段缺失时的输出）。 */
  name: string;
  family: string;
  given: string;
  /** 是否来自结构化字段（familyName/givenName）。 */
  structured: boolean;
  cjk: boolean;
}

/** 从没有结构化字段的姓名串推断姓/名：CJK 整体、含逗号按「姓, 名」、否则末词为姓。 */
export function deriveNameParts(raw: string): { family: string; given: string } {
  if (!raw) return { family: '', given: '' };
  if (isCjkName(raw)) return { family: raw, given: '' };
  if (raw.includes(',')) {
    const [family, ...rest] = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return { family: family ?? '', given: rest.join(' ') };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return { family: tokens[0], given: '' };
  return { family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(' ') };
}

export function toAuthorParts(author: CitationAuthorInput | null | undefined): AuthorParts {
  const record = typeof author === 'string' ? { name: author } : (author ?? {});
  const family = cleanPart(record.familyName);
  const given = cleanPart(record.givenName);
  const raw = cleanPart(record.name) || joinParts([given, family], ' ');
  const structured = Boolean(family || given);
  const derived = structured ? { family: family || raw, given } : deriveNameParts(raw);
  return {
    name: raw || derived.family,
    family: derived.family,
    given: derived.given,
    structured,
    cjk: isCjkName(derived.family || raw),
  };
}

export function paperAuthorParts(paper: CitationPaperLike | undefined): AuthorParts[] {
  return (paper?.authors ?? [])
    .map((author) => toAuthorParts(author))
    .filter((parts) => Boolean(parts.name || parts.family));
}

/** GB/T 7714：西文「姓 + 名首字母」，CJK 姓名整体保留。 */
export function gbtAuthorName(parts: AuthorParts): string {
  if (!parts.structured || parts.cjk) return parts.name;
  const initials = initialsCompact(parts.given);
  return initials ? `${parts.family} ${initials}` : parts.family;
}

/** APA：`Surname, X. Y.`，CJK 姓名整体保留。 */
export function apaAuthorName(parts: AuthorParts): string {
  if (parts.cjk) return parts.name;
  if (!parts.family) return parts.name;
  const initials = initialsWithDots(parts.given);
  return initials ? `${parts.family}, ${initials}` : parts.family;
}

/** IEEE：`X. Y. Surname`，CJK 姓名整体保留。 */
export function ieeeAuthorName(parts: AuthorParts): string {
  if (parts.cjk) return parts.name;
  if (!parts.family) return parts.name;
  const initials = initialsWithDots(parts.given);
  return initials ? `${initials} ${parts.family}` : parts.family;
}

/** 取前 3 位作者；超过 3 位时按第一作者是否 CJK 追加「, 等」或「, et al.」。 */
export function formatAuthorsGbt(parts: AuthorParts[]): string {
  if (parts.length === 0) return '';
  const shown = parts.slice(0, 3).map(gbtAuthorName);
  const suffix = parts.length > 3 ? (parts[0].cjk ? ', 等' : ', et al.') : '';
  return `${shown.join(', ')}${suffix}`;
}

export function formatAuthorsApa(parts: AuthorParts[]): string {
  if (parts.length === 0) return '';
  const shown = parts.slice(0, 3).map(apaAuthorName);
  if (parts.length > 3) return `${shown.join(', ')}, et al.`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')}, & ${shown[shown.length - 1]}`;
}

export function formatAuthorsIeee(parts: AuthorParts[]): string {
  if (parts.length === 0) return '';
  const shown = parts.slice(0, 3).map(ieeeAuthorName);
  if (parts.length > 3) return `${shown.join(', ')}, et al.`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')}, and ${shown[shown.length - 1]}`;
}

/** GB/T 7714 文献类型标志：按 itemType 映射，未知时按有无 publication 推断。 */
export function gbtDocumentMark(paper: CitationPaperLike | undefined): string {
  switch (paper?.itemType) {
    case 'journalArticle':
      return 'J';
    case 'conferencePaper':
      return 'C';
    case 'book':
    case 'bookSection':
      return 'M';
    case 'thesis':
      return 'D';
    case 'report':
      return 'R';
    case 'preprint':
      return 'EB/OL';
    default:
      return paper?.publication ? 'J' : 'EB/OL';
  }
}

/** GB 7714-87 文献类型标志：会议论文析出用 [A]（区别于 2015 的 [C]//），专利用 [P]。 */
export function gbt87DocumentMark(paper: CitationPaperLike | undefined): string {
  switch (paper?.itemType) {
    case 'journalArticle':
      return 'J';
    case 'conferencePaper':
      return 'A';
    case 'book':
    case 'bookSection':
      return 'M';
    case 'thesis':
      return 'D';
    case 'report':
      return 'R';
    case 'patent':
      return 'P';
    case 'preprint':
    case 'webpage':
      return 'EB/OL';
    default:
      return paper?.publication ? 'J' : 'EB/OL';
  }
}

/** GB 7714-87 作者：西文「姓全大写 + 名缩写不加缩写点」（VASWANI A）；CJK 姓名整体保留。 */
export function gbt87AuthorName(parts: AuthorParts): string {
  if (!parts.structured || parts.cjk) return parts.name;
  const family = parts.family.toUpperCase();
  const initials = initialsCompact(parts.given);
  return initials ? `${family} ${initials}` : family;
}

/** GB 7714-87（CAJ-CD B/T-1998 §6.6.5）：3 名以内全列，4 名以上列前 3 名加「，等」/「，et al」。 */
export function formatAuthorsGbt87(parts: AuthorParts[], options: { punctuation?: Gbt87Punctuation } = {}): string {
  if (parts.length === 0) return '';
  const comma = options.punctuation === 'half' ? ', ' : '，';
  const shown = parts.slice(0, 3).map(gbt87AuthorName);
  const suffix = parts.length > 3 ? (parts[0].cjk ? `${comma}等` : `${comma}et al`) : '';
  return `${shown.join(comma)}${suffix}`;
}

/** GB 7714-87 标点风格：full = 全角紧凑（多数中文期刊模板）；half = 半角带空格（与 GB/T 7714 官方示例一致）。 */
export type Gbt87Punctuation = 'full' | 'half';

export function normalizeGbt87Punctuation(value: unknown): Gbt87Punctuation {
  return value === 'half' ? 'half' : 'full';
}

/**
 * GB 7714-87 / CAJ-CD B/T-1998 条目：与 2015 版的差异在西文作者全大写、论文集
 * [A]…[C] 两段式、以及出版信息默认用全角标点（可用 punctuation: 'half' 切半角）。
 * 模型没有专利号/公告日期字段，[P] 按「申请者. 题名[P]. 年」尽力输出；[EB/OL] 同理省略更新/引用日期。
 */
export function formatGbt87Entry(
  paper: CitationPaperLike | undefined,
  fallbackLabel: string,
  options: { punctuation?: Gbt87Punctuation } = {},
): string {
  const half = options.punctuation === 'half';
  const dot = half ? '. ' : '.';
  const comma = half ? ', ' : '，';
  const colon = half ? ': ' : '：';
  const wrapIssue = (text: string) => (half ? `(${text})` : `（${text}）`);

  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const mark = gbt87DocumentMark(paper);
  const authors = formatAuthorsGbt87(paperAuthorParts(paper), options);
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const publisher = cleanPart(paper?.publisher);
  const publisherPlace = cleanPart(paper?.publisherPlace);
  const institution = cleanPart(paper?.institution);
  const url = cleanPart(paper?.url);
  const volumeIssue = issue ? `${volume}${wrapIssue(issue)}` : volume;
  const placeAndPublisher = joinParts([publisherPlace, publisher], colon);

  let entry = authors ? `${trimTrailingPeriod(authors)}.${half ? ' ' : ''}${title}` : title;

  if (mark === 'A') {
    // 论文集析出：题名[A].论文集名[C].出版地：出版者，年：页码.
    entry += '[A]';
    if (publication) entry += `${dot}${publication}[C]`;
    const tail = joinParts([placeAndPublisher, year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  } else if (mark === 'M' || mark === 'R') {
    // 专著/报告：书名[M].出版地：出版者，年：页码.（版本字段不在模型内，略）
    entry += `[${mark}]`;
    const tail = joinParts([placeAndPublisher, year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  } else if (mark === 'D') {
    // 学位论文：题名[D].保存地点：保存单位，年.
    entry += '[D]';
    const holder = institution || publisher;
    const tail = joinParts([joinParts([publisherPlace, holder], colon), year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  } else if (mark === 'P') {
    entry += '[P]';
    if (year) entry += `${dot}${year}`;
  } else if (mark === 'EB/OL') {
    entry += '[EB/OL]';
    const source = placeAndPublisher || publication;
    const tail = joinParts([source, year], comma);
    if (tail) entry += `${dot}${tail}`;
    if (url) entry += `${dot}${url}`;
  } else {
    // 期刊：题名[J].刊名，年，卷（期）：页码.
    entry += '[J]';
    const tail = joinParts([publication, year, volumeIssue], comma);
    if (tail) entry += `${dot}${tail}`;
    if (pages) entry += `${colon}${pages}`;
  }

  return `${trimTrailingPeriod(entry)}.`;
}

export function formatGbtEntry(
  paper: CitationPaperLike | undefined,
  fallbackLabel: string,
  options: { authorDate?: boolean } = {},
): string {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const mark = gbtDocumentMark(paper);
  const authors = formatAuthorsGbt(paperAuthorParts(paper));
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const publisher = cleanPart(paper?.publisher);
  const publisherPlace = cleanPart(paper?.publisherPlace);
  const institution = cleanPart(paper?.institution);
  const doi = cleanPart(paper?.doi);
  const volumeIssue = issue ? `${volume}(${issue})` : volume;
  const placeAndPublisher = joinParts([publisherPlace, publisher], ': ');

  // 著者-出版年制：年份紧随作者之后，刊名/出版信息里不再重复写年份（GB/T 7714-2015 §10.1）。
  const yearPrefix = options.authorDate && year ? `${year}. ` : '';
  const tailYear = options.authorDate ? '' : year;
  let entry = authors ? `${trimTrailingPeriod(authors)}. ${yearPrefix}${title}` : title;
  entry += `[${mark}]`;

  if (mark === 'M') {
    const tail = joinParts([placeAndPublisher, tailYear]);
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  } else if (mark === 'D') {
    const holder = publisher || institution;
    const tail = joinParts([joinParts([publisherPlace, holder], ': '), tailYear]);
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  } else if (mark === 'EB/OL') {
    const source = publication || publisher;
    const tail = joinParts([source, tailYear]);
    if (tail) entry += `. ${tail}`;
  } else if (mark === 'C') {
    // 会议论文：[C]//论文集名. 年, 卷(期). 出版地: 出版者: 页码.
    if (publication) entry += `//${publication}`;
    const tail = joinParts([tailYear, volumeIssue]);
    if (tail) entry += `. ${tail}`;
    if (placeAndPublisher) entry += `. ${placeAndPublisher}`;
    if (pages) entry += `: ${pages}`;
  } else {
    // 期刊/报告：刊名, 年, 卷(期): 页码.
    const tail = joinParts([publication, tailYear, volumeIssue]);
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  }

  if (doi) entry += `. DOI: ${doi}`;
  return `${trimTrailingPeriod(entry)}.`;
}

export function formatApa7(paper: CitationPaperLike | undefined, fallbackLabel: string): string {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const authors = formatAuthorsApa(paperAuthorParts(paper));
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const doi = cleanPart(paper?.doi);
  const url = cleanPart(paper?.url);

  let entry = authors ? `${authors} ` : '';
  entry += year ? `(${year}). ` : '(n.d.). ';
  entry += `${title}.`;
  if (publication) {
    entry += ` ${publication}`;
    if (volume) entry += `, ${volume}${issue ? `(${issue})` : ''}`;
    if (pages) entry += `, ${pages}`;
    entry += '.';
  }
  if (doi) entry += ` https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`;
  else if (url) entry += ` ${url}`;
  return entry;
}

export function formatIeee(paper: CitationPaperLike | undefined, fallbackLabel: string): string {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const authors = formatAuthorsIeee(paperAuthorParts(paper));
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const doi = cleanPart(paper?.doi);

  let entry = authors ? `${authors}, ` : '';
  entry += `"${title},"`;
  if (publication) entry += ` ${publication},`;
  if (volume) entry += ` vol. ${volume},`;
  if (issue) entry += ` no. ${issue},`;
  if (pages) entry += ` pp. ${pages},`;
  if (year) entry += ` ${year}.`;
  if (doi) entry += ` doi: ${doi}.`;
  return entry;
}

/** 参考文献列表条目：文献已被移出库（paper 缺失）时退化为 fallbackLabel 兜底。 */
export function formatBibliographyEntry(
  paper: CitationPaperLike | undefined,
  fallbackLabel: string,
  style: CitationStyleId,
  options: { punctuation?: Gbt87Punctuation } = {},
): string {
  if (!paper && fallbackLabel) return `${trimTrailingPeriod(fallbackLabel)}.`;
  switch (style) {
    case 'apa7':
      return formatApa7(paper, fallbackLabel);
    case 'ieee':
      return formatIeee(paper, fallbackLabel);
    case 'gbt7714-87':
      return formatGbt87Entry(paper, fallbackLabel, options);
    case 'gbt7714-author-date':
      return formatGbtEntry(paper, fallbackLabel, { authorDate: true });
    default:
      return formatGbtEntry(paper, fallbackLabel);
  }
}

/** 著者-出版年制正文里的作者标签。 */
export function authorDateLabel(
  parts: AuthorParts[],
  style: CitationStyleId,
  fallbackLabel: string,
): string {
  if (parts.length === 0) return fallbackLabel;
  const surname = (item: AuthorParts) => (item.cjk ? item.name : item.family || item.name);
  if (parts.length === 1) return surname(parts[0]);
  if (parts.length === 2) return `${surname(parts[0])} & ${surname(parts[1])}`;
  const useChineseSuffix = style === 'gbt7714-author-date' && parts[0].cjk;
  return `${surname(parts[0])}${useChineseSuffix ? ' 等' : ' et al.'}`;
}

/** 内联 APA 引用文本（笔记 decoration 兼容入口，行为保持不变）。 */
export function formatInlineApaCitation(
  paper: CitationPaperLike | undefined,
  fallbackLabel: string,
): string {
  const parts = paperAuthorParts(paper);
  const year = cleanPart(paper?.year) || 'n.d.';
  if (parts.length === 0) {
    return `(${cleanPart(fallbackLabel) || cleanPart(paper?.title) || '文献'})`;
  }
  return `(${authorDateLabel(parts, 'apa7', cleanPart(fallbackLabel))}, ${year})`;
}

/**
 * 前缀/后缀拼装：前缀后补一个空格（除非以开括号结尾），后缀按标点决定是否补空格。
 * 注意这里**不能**用 cleanPart——它会吃掉结尾的句点，而用户填写的后缀常常就是「。」。
 */
export function wrapAffixes(core: string, prefix?: string | null, suffix?: string | null): string {
  const head = typeof prefix === 'string' ? prefix.trim() : '';
  const tail = typeof suffix === 'string' ? suffix.trim() : '';
  let text = core;
  if (head) text = /[(（[]$/.test(head) ? `${head}${text}` : `${head} ${text}`;
  if (tail) text = /^[,.;:，。；：)\]）]/.test(tail) ? `${text}${tail}` : `${text} ${tail}`;
  return text;
}

function formatNumericInline(items: CitationItemInput[], seqs: number[]): string {
  const numbers = [...new Set(seqs.filter((value) => value > 0))].sort((left, right) => left - right);
  if (numbers.length === 0) return '';
  const ranges = numbers
    .map((value) => `${value}`)
    .reduce<string[]>((chunks, value, index, list) => {
      if (index === 0) return [value];
      const previous = list[index - 1];
      const lastChunk = chunks[chunks.length - 1];
      if (Number(value) === Number(previous) + 1) {
        const [start] = lastChunk.split('-');
        chunks[chunks.length - 1] = `${start}-${value}`;
        return chunks;
      }
      chunks.push(value);
      return chunks;
    }, []);
  const core = items.length === 1 ? `[${ranges.join(',')}]${cleanPart(items[0].locator)}` : `[${ranges.join(',')}]`;
  const prefix = items[0]?.prefix ?? null;
  const suffix = items[items.length - 1]?.suffix ?? null;
  return wrapAffixes(core, prefix, suffix);
}

function formatAuthorDateInline(
  items: CitationItemInput[],
  style: CitationStyleId,
  resolvePaper: (paperId: string) => CitationPaperLike | undefined,
): string {
  const segments = items.map((item) => {
    const paper = resolvePaper(item.paperId);
    const year = cleanPart(paper?.year) || 'n.d.';
    const locator = cleanPart(item.locator);
    const locatorText = locator ? `, ${locator}` : '';
    if (item.suppressAuthor) return `${year}${locatorText}`;
    const label = authorDateLabel(paperAuthorParts(paper), style, cleanPart(item.label) || item.paperId);
    return `${label}, ${year}${locatorText}`;
  });
  return wrapAffixes(
    `(${segments.join('; ')})`,
    items[0]?.prefix ?? null,
    items[items.length - 1]?.suffix ?? null,
  );
}

export interface CitationRenderGroup {
  citeId?: string | null;
  items: CitationItemInput[];
}

export interface CitationRenderEntry {
  paperId: string;
  /** 顺序编码制 = 引用序号；著者-出版年制 = 文献表中的位置（1..n）。 */
  seq: number;
  text: string;
  missing: boolean;
}

export interface CitationRenderRequest {
  style?: unknown;
  locale?: string | null;
  /** 单组渲染（插入引用时使用）。 */
  items?: unknown;
  /** 全文渲染（刷新时使用；按文档顺序传入，编号由该顺序全局派生）。 */
  groups?: unknown;
  bibliographyTitle?: string | null;
  bibliographyOrder?: 'appearance' | 'alpha' | null;
  /** GB 7714-87 专用：full = 全角紧凑（默认）；half = 半角带空格。其他样式忽略。 */
  punctuation?: string | null;
}

export interface CitationRenderResult {
  style: CitationStyleId;
  kind: 'numeric' | 'author-date';
  /** 单组请求时的内联文本；多组请求时等于第一组的文本。 */
  inline: string;
  groups: Array<{ citeId: string | null; inline: string }>;
  entries: CitationRenderEntry[];
  bibliography: string;
  bibliographyTitle: string;
  missingPaperIds: string[];
}

export function normalizeRenderGroups(request: CitationRenderRequest): CitationRenderGroup[] {
  const rawGroups = Array.isArray(request?.groups) ? request.groups : null;
  if (rawGroups && rawGroups.length > 0) {
    return rawGroups
      .map((group) => {
        const record = (group ?? {}) as Record<string, unknown>;
        return {
          citeId: cleanPart(record.citeId) || null,
          items: normalizeCitationItems(record.items),
        };
      })
      .filter((group) => group.items.length > 0);
  }
  const items = normalizeCitationItems(request?.items);
  return items.length > 0 ? [{ citeId: null, items }] : [];
}

/**
 * 文献表文本行：顺序编码制补 `[n] ` 前缀（与正文编号一致），著者-出版年制不编号。
 */
export function formatBibliographyLines(
  kind: 'numeric' | 'author-date',
  entries: CitationRenderEntry[],
): string[] {
  return entries.map((entry) => (kind === 'numeric' ? `[${entry.seq}] ${entry.text}` : entry.text));
}

/**
 * 渲染入口（桥的 `/citations/render` 与加载项刷新共用同一实现）：
 * 编号按传入顺序（文档顺序）全局派生；文献表去重后按样式排序。
 */
export function renderCitations(
  request: CitationRenderRequest,
  resolvePaper: (paperId: string) => CitationPaperLike | undefined,
): CitationRenderResult {
  const groups = normalizeRenderGroups(request ?? {});
  const style = normalizeCitationStyle(request?.style);
  const kind = citationStyleKind(style);
  const flatItems = groups.flatMap((group) => group.items);
  const seqByPaperId = assignCitationNumbers(flatItems);

  const cache = new Map<string, CitationPaperLike | undefined>();
  const missing = new Set<string>();
  const lookup = (paperId: string): CitationPaperLike | undefined => {
    if (!cache.has(paperId)) {
      const paper = resolvePaper(paperId);
      cache.set(paperId, paper);
      if (!paper) missing.add(paperId);
    }
    return cache.get(paperId);
  };

  const renderedGroups = groups.map((group) => {
    const seqs = group.items.map((item) => seqByPaperId.get(item.paperId) ?? 0);
    return {
      citeId: group.citeId ?? null,
      inline:
        kind === 'numeric'
          ? formatNumericInline(group.items, seqs)
          : formatAuthorDateInline(group.items, style, lookup),
    };
  });

  const labelByPaperId = new Map<string, string>();
  for (const item of flatItems) {
    if (!labelByPaperId.has(item.paperId)) labelByPaperId.set(item.paperId, cleanPart(item.label));
  }

  let orderedPaperIds = [...seqByPaperId.keys()];
  if (kind === 'author-date' && request?.bibliographyOrder !== 'appearance') {
    orderedPaperIds = orderedPaperIds.slice().sort((left, right) => {
      const leftParts = paperAuthorParts(lookup(left));
      const rightParts = paperAuthorParts(lookup(right));
      const leftKey = leftParts[0]?.family || leftParts[0]?.name || labelByPaperId.get(left) || left;
      const rightKey = rightParts[0]?.family || rightParts[0]?.name || labelByPaperId.get(right) || right;
      const byAuthor = leftKey.localeCompare(rightKey);
      if (byAuthor !== 0) return byAuthor;
      const byYear = (cleanPart(lookup(left)?.year) || '').localeCompare(cleanPart(lookup(right)?.year) || '');
      if (byYear !== 0) return byYear;
      return left.localeCompare(right);
    });
  }

  const entries: CitationRenderEntry[] = orderedPaperIds.map((paperId, index) => {
    const text = formatBibliographyEntry(
      lookup(paperId),
      labelByPaperId.get(paperId) || paperId,
      style,
      { punctuation: normalizeGbt87Punctuation(request?.punctuation) },
    );
    return {
      paperId,
      seq: kind === 'numeric' ? seqByPaperId.get(paperId) ?? index + 1 : index + 1,
      text,
      missing: missing.has(paperId),
    };
  });

  return {
    style,
    kind,
    inline: renderedGroups[0]?.inline ?? '',
    groups: renderedGroups,
    entries,
    bibliography: formatBibliographyLines(kind, entries).join('\n'),
    bibliographyTitle: cleanPart(request?.bibliographyTitle) || '参考文献',
    missingPaperIds: [...missing],
  };
}
