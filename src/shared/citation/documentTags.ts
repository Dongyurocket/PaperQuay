/**
 * Word 文档模型：引用域（ContentControl）标签 + 文档级设置的编解码。
 *
 * 设计要点（方案 §6.2）：
 *  - 每个引用 = 1 个 ContentControl，`tag = "pq:c|<citeId>"`（短标签，规避 Word 对
 *    ContentControl.tag 的 64 字符限制）；引用明细（paperId/页码/前后缀/多篇组合）
 *    存在文档级设置 `pq:citations` 里，随 .docx 一起保存、重开仍在。
 *  - 文末文献列表 = 1 个 `tag = "pq:bib"` 的 ContentControl（可跨多段）。
 *  - 刷新时先按 OOXML 顺序取出 citeId（见 extractCitationControlTagsFromOoxml），
 *    再按此顺序重算编号 —— 标题/正文改动不会打乱编号语义。
 */
import { cleanPart } from './text.ts';
import { normalizeCitationItems, type CitationItemInput } from './numbering.ts';

export const CITATION_CONTROL_TAG_PREFIX = 'pq:c|';
export const BIBLIOGRAPHY_CONTROL_TAG = 'pq:bib';
export const CITATION_CONTROL_TITLE = 'PaperQuay 引用';
export const BIBLIOGRAPHY_CONTROL_TITLE = 'PaperQuay 参考文献';
export const DEFAULT_BIBLIOGRAPHY_TITLE = '参考文献';
/** 文档模型的 schema 版本：写入文档设置的 `pq:schemaVersion`，便于将来迁移。 */
export const DOCUMENT_SCHEMA_VERSION = '1';

export const DOCUMENT_SETTINGS_KEYS = {
  style: 'pq:style',
  locale: 'pq:locale',
  schemaVersion: 'pq:schemaVersion',
  citations: 'pq:citations',
  citedPaperIds: 'pq:citedPaperIds',
  bibliographyControlId: 'pq:bibControlId',
  documentTitle: 'pq:documentTitle',
} as const;

export interface StoredCitation {
  citeId: string;
  items: CitationItemInput[];
  updatedAt: number;
}

export function createCitationId(random: () => number = Math.random): string {
  return random().toString(16).slice(2, 10).padEnd(8, '0').slice(0, 8);
}

export function encodeCitationControlTag(citeId: string): string {
  return `${CITATION_CONTROL_TAG_PREFIX}${cleanPart(citeId)}`;
}

/** 解析出 citeId；不是引用域标签时返回 null。 */
export function parseCitationControlTag(tag: unknown): string | null {
  const value = typeof tag === 'string' ? tag.trim() : '';
  if (!value.startsWith(CITATION_CONTROL_TAG_PREFIX)) return null;
  const citeId = value.slice(CITATION_CONTROL_TAG_PREFIX.length).trim();
  return /^[0-9a-z]{4,32}$/i.test(citeId) ? citeId : null;
}

export function isCitationControlTag(tag: unknown): boolean {
  return parseCitationControlTag(tag) !== null;
}

export function isBibliographyControlTag(tag: unknown): boolean {
  return typeof tag === 'string' && tag.trim() === BIBLIOGRAPHY_CONTROL_TAG;
}

export function normalizeStoredCitations(value: unknown): StoredCitation[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const citations: StoredCitation[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    const citeId = cleanPart(record.citeId).toLowerCase();
    if (!/^[0-9a-z]{4,32}$/.test(citeId)) continue;
    const items = normalizeCitationItems(record.items);
    if (items.length === 0) continue;
    citations.push({
      citeId,
      items,
      updatedAt: Number(record.updatedAt) || 0,
    });
  }
  return citations;
}

export function serializeStoredCitations(citations: StoredCitation[]): string {
  return JSON.stringify(citations.map(({ citeId, items, updatedAt }) => ({ citeId, items, updatedAt })));
}

export function upsertStoredCitation(
  citations: StoredCitation[],
  citation: StoredCitation,
): StoredCitation[] {
  const next = citations.filter((item) => item.citeId !== citation.citeId);
  next.push(citation);
  return next;
}

export function removeStoredCitation(citations: StoredCitation[], citeId: string): StoredCitation[] {
  return citations.filter((item) => item.citeId !== citeId);
}

export function findStoredCitation(
  citations: StoredCitation[],
  citeId: string,
): StoredCitation | undefined {
  return citations.find((item) => item.citeId === citeId);
}

/**
 * 从整篇文档的 OOXML（`body.getOoxml()`）中按**文档顺序**取出引用域 citeId。
 * 依赖 `<w:sdtPr><w:tag w:val="pq:c|xxxxxxxx"/>`：标签是纯 ASCII，不存在实体转义歧义。
 */
export function extractCitationControlTagsFromOoxml(ooxml: unknown): string[] {
  if (typeof ooxml !== 'string' || ooxml.length === 0) return [];
  const tags: string[] = [];
  const pattern = /<w:tag\b[^>]*\bw:val="([^"]*)"/g;
  let match = pattern.exec(ooxml);
  while (match) {
    const citeId = parseCitationControlTag(match[1]);
    if (citeId) tags.push(citeId);
    match = pattern.exec(ooxml);
  }
  return tags;
}

/** 从 OOXML 判断文档里是否已有文献列表控件。 */
export function hasBibliographyControlInOoxml(ooxml: unknown): boolean {
  if (typeof ooxml !== 'string') return false;
  return extractBibliographyTagCount(ooxml) > 0;
}

export function extractBibliographyTagCount(ooxml: string): number {
  const pattern = /<w:tag\b[^>]*\bw:val="([^"]*)"/g;
  let count = 0;
  let match = pattern.exec(ooxml);
  while (match) {
    if (isBibliographyControlTag(match[1])) count += 1;
    match = pattern.exec(ooxml);
  }
  return count;
}
