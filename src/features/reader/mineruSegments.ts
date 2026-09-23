export const MINERU_PARSE_PAGE_BATCH = 25;

export function sliceMineruPages<T>(pages: readonly T[], start: number, count: number): T[] {
  const from = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return pages.slice(from, from + size);
}
