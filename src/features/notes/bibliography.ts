// 学术化参考文献格式化（痛点 7 / docs/notes-charter.md 的引用规范）。
// 支持 GB/T 7714-2015 顺序编码制（默认，中文写作场景）、APA 7 与 IEEE。
// 数据组装优先级：库内结构化字段（authors/year/publication/volume/issue/pages/doi）
// → paper.citation 预生成串兜底 → 标题兜底。本模块只做纯文本格式化，不依赖 DOM/编辑器。
import type { LiteraturePaper } from '../../types/library';

export type NoteCitationStyle = 'gbt7714' | 'apa7' | 'ieee';

export const NOTE_CITATION_STYLE_STORAGE_KEY = 'paperquay:note-citation-style:v1';

export const NOTE_CITATION_STYLE_OPTIONS: Array<{ id: NoteCitationStyle; label: string }> = [
  { id: 'gbt7714', label: 'GB/T 7714' },
  { id: 'apa7', label: 'APA 7' },
  { id: 'ieee', label: 'IEEE' },
];

export function normalizeNoteCitationStyle(value: unknown): NoteCitationStyle {
  return value === 'apa7' || value === 'ieee' ? value : 'gbt7714';
}

export function loadNoteCitationStyle(): NoteCitationStyle {
  try {
    if (typeof window === 'undefined') return 'gbt7714';
    return normalizeNoteCitationStyle(window.localStorage.getItem(NOTE_CITATION_STYLE_STORAGE_KEY));
  } catch {
    return 'gbt7714';
  }
}

export function saveNoteCitationStyle(style: NoteCitationStyle): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NOTE_CITATION_STYLE_STORAGE_KEY, normalizeNoteCitationStyle(style));
  } catch {
    // 本地设置写入失败不阻断编辑。
  }
}

function trimTrailingPeriod(value: string): string {
  return value.replace(/[.。]+$/, '');
}

function cleanPart(value: unknown): string {
  return trimTrailingPeriod(typeof value === 'string' ? value.trim() : '');
}

function authorNames(paper: LiteraturePaper | undefined): string[] {
  return (paper?.authors ?? []).map((author) => author.name?.trim() ?? '').filter(Boolean);
}

// 是否 CJK 姓名（无空格、含中日韩字符）——CJK 姓名整体使用，不拆姓/名。
function isCjkName(name: string): boolean {
  return !/\s/.test(name) && /[　-鿿豈-﫿]/.test(name);
}

// GB/T 7714：姓前名后、全大写不强制（保持原拼写），至多 3 位后加 et al.（西文）/等（中文）。
function formatAuthorsGbt(names: string[]): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, 3);
  const suffix = names.length > 3 ? (isCjkName(names[0]) ? ', 等' : ', et al.') : '';
  return `${shown.join(', ')}${suffix}`;
}

// APA：Surname, X. Y.；CJK 姓名保持整体。最多 20 位（实务上笔记场景截断为 3 + et al. 风格不符合
// APA 正文规则，但参考文献列表允许至 20 位；这里作者极少超限，超限时按第 19 位后省略的简化处理为 et al.）。
function apaName(name: string): string {
  if (isCjkName(name)) return name;
  if (name.includes(',')) {
    // 已是 "Surname, Given" 形式
    const [surname, ...rest] = name.split(',').map((part) => part.trim());
    const initials = rest.join(' ').split(/\s+/).filter(Boolean).map((token) => `${token[0].toUpperCase()}.`).join(' ');
    return initials ? `${surname}, ${initials}` : surname;
  }
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return tokens[0];
  const surname = tokens[tokens.length - 1];
  const initials = tokens.slice(0, -1).map((token) => `${token[0].toUpperCase()}.`).join(' ');
  return `${surname}, ${initials}`;
}

function formatAuthorsApa(names: string[]): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, 3).map(apaName);
  if (names.length > 3) return `${shown.join(', ')}, et al.`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')}, & ${shown[shown.length - 1]}`;
}

// IEEE：名首字母在前，"A. B. Smith, C. Doe, and E. Wang"。
function ieeeName(name: string): string {
  if (isCjkName(name)) return name;
  if (name.includes(',')) {
    const [surname, ...rest] = name.split(',').map((part) => part.trim());
    const initials = rest.join(' ').split(/\s+/).filter(Boolean).map((token) => `${token[0].toUpperCase()}.`).join(' ');
    return initials ? `${initials} ${surname}` : surname;
  }
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return tokens[0];
  const initials = tokens.slice(0, -1).map((token) => `${token[0].toUpperCase()}.`).join(' ');
  return `${initials} ${tokens[tokens.length - 1]}`;
}

function formatAuthorsIeee(names: string[]): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, 3).map(ieeeName);
  if (names.length > 3) return `${shown.join(', ')}, et al.`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')}, and ${shown[shown.length - 1]}`;
}

// GB/T 7714 文献类型标志：按 itemType 映射，未知时按有无 publication 推断。
function gbtDocumentMark(paper: LiteraturePaper | undefined): string {
  switch (paper?.itemType) {
    case 'journalArticle':
      return 'J';
    case 'conferencePaper':
      return 'C';
    case 'book':
      return 'M';
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

function formatGbt7714(paper: LiteraturePaper | undefined, fallbackLabel: string): string {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const mark = gbtDocumentMark(paper);
  const authors = formatAuthorsGbt(authorNames(paper));
  const year = cleanPart(paper?.year);
  const publication = cleanPart(paper?.publication);
  const volume = cleanPart(paper?.volume);
  const issue = cleanPart(paper?.issue);
  const pages = cleanPart(paper?.pages);
  const publisher = cleanPart(paper?.publisher);
  const doi = cleanPart(paper?.doi);

  let entry = authors ? `${trimTrailingPeriod(authors)}. ${title}` : title;
  entry += `[${mark}]`;

  if (mark === 'M') {
    // 专著：出版者, 年.
    const pubParts = [publisher, year].filter(Boolean).join(', ');
    if (pubParts) entry += `. ${pubParts}`;
    if (pages) entry += `: ${pages}`;
  } else if (mark === 'EB/OL') {
    // 电子/预印本：来源（站点或库名）, 年. DOI/URL.
    const source = publication || publisher;
    const tail = [source, year].filter(Boolean).join(', ');
    if (tail) entry += `. ${tail}`;
  } else {
    // 期刊/会议/学位/报告：刊名, 年, 卷(期): 页码.
    const volumeIssue = issue ? `${volume}(${issue})` : volume;
    const tail = [publication, year, volumeIssue].filter(Boolean).join(', ');
    if (tail) entry += `. ${tail}`;
    if (pages) entry += `: ${pages}`;
  }
  if (doi) entry += `. DOI: ${doi}`;
  return `${trimTrailingPeriod(entry)}.`;
}

function formatApa7(paper: LiteraturePaper | undefined, fallbackLabel: string): string {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const authors = formatAuthorsApa(authorNames(paper));
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

function formatIeee(paper: LiteraturePaper | undefined, fallbackLabel: string): string {
  const title = cleanPart(paper?.title) || cleanPart(fallbackLabel);
  const authors = formatAuthorsIeee(authorNames(paper));
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

// 参考文献列表条目：按样式格式化。paper 缺失（文献已被移出库）时退化为标题兜底。
export function formatBibliographyEntry(
  paper: LiteraturePaper | undefined,
  fallbackLabel: string,
  style: NoteCitationStyle,
): string {
  if (!paper && fallbackLabel) return `${trimTrailingPeriod(fallbackLabel)}.`;
  switch (style) {
    case 'apa7':
      return formatApa7(paper, fallbackLabel);
    case 'ieee':
      return formatIeee(paper, fallbackLabel);
    default:
      return formatGbt7714(paper, fallbackLabel);
  }
}

// 内联 APA 引用文本（decoration 渲染用）：(第一作者 et al., 2020)。
export function formatInlineApaCitation(
  paper: LiteraturePaper | undefined,
  fallbackLabel: string,
): string {
  const names = authorNames(paper);
  const year = cleanPart(paper?.year) || 'n.d.';
  if (names.length === 0) {
    return `(${cleanPart(fallbackLabel) || cleanPart(paper?.title) || '文献'})`;
  }
  const first = apaName(names[0]);
  const firstSurname = first.includes(',') ? first.slice(0, first.indexOf(',')) : first;
  if (names.length === 1) return `(${firstSurname}, ${year})`;
  if (names.length === 2) {
    const second = apaName(names[1]);
    const secondSurname = second.includes(',') ? second.slice(0, second.indexOf(',')) : second;
    return `(${firstSurname} & ${secondSurname}, ${year})`;
  }
  return `(${firstSurname} et al., ${year})`;
}
