import type { MineruBlockBase, MineruPage, PositionedMineruBlock } from '../../types/reader.ts';
import { flattenMineruPages } from '../../services/mineru.ts';

export const MINERU_PARSE_PAGE_BATCH = 25;

export interface MineruDocumentMetadata {
  pageCount: number;
  blockCount: number;
  sourcePath?: string;
  title?: string;
}

export interface MineruOutlineIndexItem {
  blockId: string;
  pageIndex: number;
  level: number | null;
  title: string;
}

export interface MineruPageSegment {
  segmentIndex: number;
  totalSegments: number;
  startPageIndex: number;
  pageCount: number;
  pages: MineruPage[];
  blocks: PositionedMineruBlock[];
  done: boolean;
}

export interface MineruDocumentParts {
  metadata: MineruDocumentMetadata;
  outlineIndex: MineruOutlineIndexItem[];
  segments: MineruPageSegment[];
}

export function sliceMineruPages<T>(pages: readonly T[], start: number, count: number): T[] {
  const from = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return pages.slice(from, from + size);
}

export function extractMineruHeadingLevel(block: MineruBlockBase): number | null {
  const content = block.content;
  if (!content || typeof content !== 'object') {
    return null;
  }
  const raw = (content as Record<string, unknown>).text_level;
  const level = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(level) || level <= 0) {
    return null;
  }
  return Math.min(Math.round(level), 6);
}

export function extractMineruBlockText(block: MineruBlockBase): string {
  const content = block.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'object') {
    const raw = content as Record<string, unknown>;
    if (typeof raw.text === 'string') return raw.text;
    if (typeof raw.title === 'string') return raw.title;
  }
  return '';
}

/**
 * 从解析页面提取轻量章节索引（仅包含标题块的 blockId、pageIndex、层级和标题文字）。
 * 体积极小，主线程可优先获取并在正文渲染前构建完整目录。
 */
export function extractMineruOutlineIndex(pages: readonly MineruPage[]): MineruOutlineIndexItem[] {
  const items: MineruOutlineIndexItem[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    if (!Array.isArray(page)) continue;
    for (let blockIndex = 0; blockIndex < page.length; blockIndex++) {
      const block = page[blockIndex];
      if (!block || block.type !== 'title') continue;
      const text = extractMineruBlockText(block).trim();
      if (!text) continue;
      const level = extractMineruHeadingLevel(block);
      items.push({
        blockId: `page-${pageIndex + 1}-block-${blockIndex + 1}`,
        pageIndex,
        level,
        title: text,
      });
    }
  }
  return items;
}

/**
 * 将整篇 MinerU 结果拆分为元数据、章节索引和正文分段。
 * 传输大结果时按页分段传输，避免整篇长任务或大体积结构化克隆开销。
 */
export function splitMineruPagesIntoParts(
  pages: readonly MineruPage[],
  batchSize = MINERU_PARSE_PAGE_BATCH,
  sourcePath?: string,
): MineruDocumentParts {
  const safeBatch = Math.max(1, Math.floor(batchSize));
  const pageCount = pages.length;
  let totalBlocks = 0;
  for (const page of pages) {
    if (Array.isArray(page)) totalBlocks += page.length;
  }

  const metadata: MineruDocumentMetadata = {
    pageCount,
    blockCount: totalBlocks,
    sourcePath,
  };

  const outlineIndex = extractMineruOutlineIndex(pages);

  const segments: MineruPageSegment[] = [];
  const totalSegments = Math.max(1, Math.ceil(pageCount / safeBatch));

  if (pageCount === 0) {
    segments.push({
      segmentIndex: 0,
      totalSegments: 1,
      startPageIndex: 0,
      pageCount: 0,
      pages: [],
      blocks: [],
      done: true,
    });
  } else {
    for (let i = 0; i < totalSegments; i++) {
      const startPageIndex = i * safeBatch;
      const pageSlice = pages.slice(startPageIndex, startPageIndex + safeBatch);
      const flattenedSlice = flattenMineruPages(pageSlice as MineruPage[]);
      const correctedBlocks = flattenedSlice.map((b) => {
        const actualPageIndex = startPageIndex + b.pageIndex;
        return {
          ...b,
          pageIndex: actualPageIndex,
          blockId: `page-${actualPageIndex + 1}-block-${b.blockIndex + 1}`,
        };
      });

      segments.push({
        segmentIndex: i,
        totalSegments,
        startPageIndex,
        pageCount: pageSlice.length,
        pages: pageSlice as MineruPage[],
        blocks: correctedBlocks,
        done: i === totalSegments - 1,
      });
    }
  }

  return {
    metadata,
    outlineIndex,
    segments,
  };
}
