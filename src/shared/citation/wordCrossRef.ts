/**
 * Word 交叉引用（REF 域 + 书签）的 OOXML 构建器。
 *
 * 用途：顺序编码制下，把正文 `[1]` 做成 Word 原生交叉引用——文献表条目的序号包在
 * 书签里，正文引用是 `REF <书签> \h` 域（显示缓存的序号文本，Ctrl+点击跳转，
 * Word 的「更新域」也能原生重算）。内容控件（pq:c / pq:bib）仍然是刷新身份，域只负责呈现。
 *
 * 全部为纯字符串函数，无 DOM/Node 依赖（与 src/shared/citation 其余模块同约束）。
 */
import { cleanPart } from './text.ts';
import type { CitationItemInput } from './numbering.ts';

/** paperId → Word 书签名：字母开头、只含字母数字下划线、不超过 40 字符。 */
export function citationBookmarkName(paperId: string): string {
  const cleaned = cleanPart(paperId).replace(/[^A-Za-z0-9]/g, '_');
  return `r_${cleaned}`.slice(0, 40);
}

export function escapeXmlText(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 与 formatNumberRanges 同语义的连续区间折叠，但返回 [start, end] 区间对（便于逐端点建 REF 域）。 */
export function collapseSeqRanges(seqs: number[]): Array<[number, number]> {
  const sorted = [...new Set(seqs.filter((value) => Number.isFinite(value) && value > 0))].sort(
    (left, right) => left - right,
  );
  if (sorted.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const current of sorted.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push([start, previous]);
    start = current;
    previous = current;
  }
  ranges.push([start, previous]);
  return ranges;
}

function textRun(text: string): string {
  return `<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;
}

/** 一个 REF 域：显示文本为缓存的序号，\h 使其成为指向书签的超链接。 */
function refField(bookmark: string, display: number): string {
  return `<w:fldSimple w:instr=" REF ${bookmark} \\h ">${textRun(String(display))}</w:fldSimple>`;
}

/**
 * 构建一组正文引用的 OOXML（供内容控件 insertOoxml 用）：
 * `[` + REF(1) + `-` + REF(3) + `]`，前缀/后缀/单条页码语义与 formatNumericInline 一致。
 * 任一 paperId 缺序号（无法定位书签）时返回 null，调用方退化为纯文本插入。
 */
export function buildNumericCitationOoxml(
  items: CitationItemInput[],
  seqByPaperId: Map<string, number>,
): string | null {
  if (items.length === 0) return null;
  const seqs: number[] = [];
  const bookmarkBySeq = new Map<number, string>();
  for (const item of items) {
    const seq = seqByPaperId.get(item.paperId) ?? 0;
    if (seq <= 0) return null;
    seqs.push(seq);
    bookmarkBySeq.set(seq, citationBookmarkName(item.paperId));
  }
  const ranges = collapseSeqRanges(seqs);
  if (ranges.length === 0) return null;

  const parts: string[] = [textRun('[')];
  ranges.forEach(([start, end], index) => {
    if (index > 0) parts.push(textRun(','));
    parts.push(refField(bookmarkBySeq.get(start) ?? '', start));
    if (end > start) {
      parts.push(textRun('-'));
      parts.push(refField(bookmarkBySeq.get(end) ?? '', end));
    }
  });
  parts.push(textRun(']'));
  if (items.length === 1) {
    const locator = cleanPart(items[0].locator);
    if (locator) parts.push(textRun(locator));
  }

  const prefix = typeof items[0]?.prefix === 'string' ? items[0].prefix.trim() : '';
  const lastItem = items[items.length - 1];
  const suffix = typeof lastItem?.suffix === 'string' ? lastItem.suffix.trim() : '';
  // 与 wrapAffixes 同规则：前缀后补空格（开括号结尾除外），后缀以标点开头不补。
  if (prefix) parts.unshift(textRun(/[(（[]$/.test(prefix) ? prefix : `${prefix} `));
  if (suffix) parts.push(textRun(/^[,.;:，。；：)\]）]/.test(suffix) ? suffix : ` ${suffix}`));
  return parts.join('');
}

/** 文献表条目段落 OOXML：序号包在书签里（REF 域就指向它），author-date 无序号时不建书签。 */
export function buildBibliographyEntryParagraph(
  seq: number | null,
  text: string,
  paperId: string,
  bookmarkId: number,
): string {
  const body = escapeXmlText(cleanPart(text));
  if (typeof seq !== 'number' || seq <= 0) {
    return `<w:p>${textRun(cleanPart(text))}</w:p>`;
  }
  const name = citationBookmarkName(paperId);
  return (
    `<w:p>` +
    textRun('[') +
    `<w:bookmarkStart w:id="${bookmarkId}" w:name="${name}"/>` +
    textRun(String(seq)) +
    `<w:bookmarkEnd w:id="${bookmarkId}"/>` +
    textRun('] ') +
    `<w:r><w:t xml:space="preserve">${body}</w:t></w:r>` +
    `</w:p>`
  );
}

/** 文献表标题段落 OOXML（不含书签）。 */
export function buildBibliographyTitleParagraph(title: string): string {
  return `<w:p>${textRun(cleanPart(title))}</w:p>`;
}

/** 书签 w:id 起点：随机基数避免与文档里既有书签冲突；同一批次内递增即可。 */
export function bookmarkIdBase(random: () => number = Math.random): number {
  return 1000 + Math.floor(random() * 100000);
}
