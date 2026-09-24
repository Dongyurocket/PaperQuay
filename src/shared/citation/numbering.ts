/**
 * 引用编号派生：顺序编码制的编号由**文档中引用的首次出现顺序**实时派生，不落盘。
 * 同一 paperId 在多处引用共用同一个号（与 src/features/notes/noteReferences.ts 同规则）。
 */
import { cleanPart } from './text.ts';

/** 前后缀保留标点（用户填写的后缀常常就是「。」，不能用会吃掉句点的 cleanPart）。 */
function trimAffix(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface CitationItemInput {
  paperId: string;
  /** 文献表兜底标签（文献被移出库时显示）：插入时记录标题快照。 */
  label?: string | null;
  /** 页码/章节等定位信息，如 "25" 或 "p. 25"。 */
  locator?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  /** 著者-出版年制下只输出年份（“作者已在文中”场景）。 */
  suppressAuthor?: boolean | null;
}

export function normalizeCitationItem(value: unknown): CitationItemInput | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const paperId = cleanPart(record.paperId);
  if (!paperId) return null;
  return {
    paperId,
    label: cleanPart(record.label) || null,
    locator: cleanPart(record.locator) || null,
    prefix: trimAffix(record.prefix) || null,
    suffix: trimAffix(record.suffix) || null,
    suppressAuthor: Boolean(record.suppressAuthor),
  };
}

export function normalizeCitationItems(value: unknown): CitationItemInput[] {
  if (!Array.isArray(value)) return [];
  const items: CitationItemInput[] = [];
  for (const raw of value) {
    const item = normalizeCitationItem(raw);
    if (item) items.push(item);
  }
  return items;
}

/** 按首次出现顺序给每个 paperId 分配 1..n 的序号。 */
export function assignCitationNumbers(items: CitationItemInput[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const item of items) {
    if (!numbers.has(item.paperId)) numbers.set(item.paperId, numbers.size + 1);
  }
  return numbers;
}

/** [1,2,3,5] -> "1-3,5"（连续区间折叠，GB/T 顺序编码制写法）。 */
export function formatNumberRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers.filter((value) => Number.isFinite(value) && value > 0))].sort(
    (left, right) => left - right,
  );
  if (sorted.length === 0) return '';
  const chunks: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const current of sorted.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    chunks.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  chunks.push(start === previous ? `${start}` : `${start}-${previous}`);
  return chunks.join(',');
}
