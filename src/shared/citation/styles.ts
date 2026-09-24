/** 引用样式注册表（笔记侧、Electron 桥、Word 加载项共用同一份 id 与语义）。 */

export const CITATION_STYLE_IDS = ['gbt7714', 'gbt7714-author-date', 'apa7', 'ieee'] as const;

export type CitationStyleId = (typeof CITATION_STYLE_IDS)[number];

/** numeric：正文 [n]，文献表按引用顺序；author-date：正文 (作者, 年)，文献表按作者字母序。 */
export type CitationStyleKind = 'numeric' | 'author-date';

export interface CitationStyleDescriptor {
  id: CitationStyleId;
  label: string;
  labelEn: string;
  kind: CitationStyleKind;
  description: string;
}

export const DEFAULT_CITATION_STYLE: CitationStyleId = 'gbt7714';

export const CITATION_STYLES: readonly CitationStyleDescriptor[] = [
  {
    id: 'gbt7714',
    label: 'GB/T 7714-2015 顺序编码制',
    labelEn: 'GB/T 7714-2015 (numeric)',
    kind: 'numeric',
    description: '中文写作默认：正文 [1]，文献表按引用顺序编号；同一文献始终同号。',
  },
  {
    id: 'gbt7714-author-date',
    label: 'GB/T 7714-2015 著者-出版年制',
    labelEn: 'GB/T 7714-2015 (author-date)',
    kind: 'author-date',
    description: '正文 (张三, 2021)，文献表按作者字母序排列。',
  },
  {
    id: 'apa7',
    label: 'APA 7',
    labelEn: 'APA 7th edition',
    kind: 'author-date',
    description: '正文 (Smith et al., 2020)，文献表按作者字母序排列。',
  },
  {
    id: 'ieee',
    label: 'IEEE',
    labelEn: 'IEEE',
    kind: 'numeric',
    description: '正文 [1]，文献表按引用顺序编号（IEEE 风格条目）。',
  },
];

export function isCitationStyleId(value: unknown): value is CitationStyleId {
  return typeof value === 'string' && (CITATION_STYLE_IDS as readonly string[]).includes(value);
}

/** 未知/缺省值一律回退 GB/T 7714 顺序编码制（与笔记侧既有行为一致）。 */
export function normalizeCitationStyle(value: unknown): CitationStyleId {
  return isCitationStyleId(value) ? value : DEFAULT_CITATION_STYLE;
}

export function getCitationStyle(value: unknown): CitationStyleDescriptor {
  const id = normalizeCitationStyle(value);
  return CITATION_STYLES.find((style) => style.id === id) ?? CITATION_STYLES[0];
}

export function citationStyleKind(value: unknown): CitationStyleKind {
  return getCitationStyle(value).kind;
}

export function isNumericCitationStyle(value: unknown): boolean {
  return citationStyleKind(value) === 'numeric';
}
