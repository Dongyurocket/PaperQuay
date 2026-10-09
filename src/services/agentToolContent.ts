/** Text offsets refer to the unmodified source so checkpoint cursors can be reused. */
export function isAgentToolTextBoundary(value: string, offset: number): boolean {
  if (offset > 0 && /[\uD800-\uDBFF]/.test(value[offset - 1]) && /[\uDC00-\uDFFF]/.test(value[offset] ?? '')) return false;
  return ![...value.matchAll(/\[\[cite:[^\]\r\n]+\]\]/g)]
    .some((match) => match.index! < offset && match.index! + match[0].length > offset);
}

export function sliceAgentToolText(value: string, budget: number, start = 0): {
  text: string;
  offset: number;
  truncated: boolean;
} {
  const limit = Math.max(0, Math.trunc(budget));
  if (value.length - start <= limit) return { text: value.slice(start), offset: value.length, truncated: false };
  let end = start + limit;
  const prefix = value.slice(start, end);
  const paragraphs = [...prefix.matchAll(/\n\s*\n/g)];
  const paragraph = paragraphs[paragraphs.length - 1];
  if (paragraph) {
    end = start + paragraph.index! + paragraph[0].length;
  } else {
    const sentences = [...prefix.matchAll(/[.!?。！？](?:\s|$)/g)];
    const sentence = sentences[sentences.length - 1];
    if (sentence && sentence.index! + sentence[0].length > limit / 2) {
      end = start + sentence.index! + sentence[0].length;
    }
  }
  // A long paragraph may need a character boundary, but an evidence token
  // remains indivisible even when it crosses that boundary. At a token's
  // exact start, consume that one atom so a smaller prose budget cannot stall
  // the cursor. Callers still enforce their serialized-result/page budgets.
  for (const match of value.matchAll(/\[\[cite:[^\]\r\n]+\]\]/g)) {
    if (match.index! < end && match.index! + match[0].length > end) {
      end = limit > 0 && match.index === start
        ? match.index + match[0].length
        : Math.max(start, match.index!);
      break;
    }
  }
  if (end > start && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end] ?? '')) end -= 1;
  return { text: value.slice(start, end), offset: end, truncated: end < value.length };
}

export async function agentToolTextVersion(paperId: string, source: string, text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${paperId}\0${source}\0${text}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
