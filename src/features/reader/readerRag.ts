import type {
  DocumentChatCitation,
  PositionedMineruBlock,
  RagChunkInput,
  RagRetrievalResult,
  RagSourceMode,
  ReaderSettings,
  WorkspaceItem,
} from '../../types/reader.ts';
import { extractTextFromMineruBlock } from '../../services/mineru.ts';
import { textSignature } from './readerShared.ts';

export interface ReaderRagPreparedSource {
  sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>;
  sourceSignature: string;
  chunks: RagChunkInput[];
}

export interface ReaderRagPreparedDocument {
  documentKey: string;
  title: string;
  sources: ReaderRagPreparedSource[];
}

export interface ReaderRagContextDocument {
  documentText: string;
  sectionCount: number;
  citations: DocumentChatCitation[];
  retrievals: RagRetrievalResult[];
}

const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_CHUNK_OVERLAP = 120;
const MAX_HEADING_NEIGHBOR_BLOCKS = 3;
const MAX_HEADING_SECTION_CHARS = 2_400;
const MAX_HEADING_LENGTH = 140;
const MIN_SOFT_BREAK_RATIO = 0.58;
/** 上下文预算起始值（方案 §5.5，均为待调优参数）：单目标窗口 1500 tokens，一次问答 6000 tokens。 */
const CONTEXT_TARGET_TOKEN_BUDGET = 1_500;
const CONTEXT_QUESTION_TOKEN_BUDGET = 6_000;

/**
 * 无 tokenizer 时的保守 token 估算（方案 §5.5-5）：
 * CJK/假名/谚文字符约 1 token，其余约每 3 字符 1 token。
 */
function estimateTokens(text: string): number {
  const wideCount = (text.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g) ?? []).length;
  return Math.ceil(wideCount + (text.length - wideCount) / 3);
}

// Page decorations (page numbers, headers/footers, page footnotes) are not real
// content. They must not become RAG chunks or citation anchors, otherwise a
// citation can point at a page-number block and clicking it highlights the page
// number instead of the cited paragraph.
const PAGE_DECORATION_BLOCK_TYPES = new Set([
  'page_header',
  'page_footer',
  'page_number',
  'page_footnote',
]);

function isPageDecorationBlock(block: PositionedMineruBlock): boolean {
  return typeof block.type === 'string' && PAGE_DECORATION_BLOCK_TYPES.has(block.type);
}

function normalizeChunkText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findChunkEnd(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) {
    return text.length;
  }

  const minEnd = start + Math.floor(DEFAULT_CHUNK_SIZE * MIN_SOFT_BREAK_RATIO);
  const window = text.slice(start, hardEnd);
  const breakPatterns = [
    /\n{2,}(?![\s\S]*\n{2,})/,
    /[。！？.!?]\s+(?![\s\S]*[。！？.!?]\s+)/,
    /[；;]\s+(?![\s\S]*[；;]\s+)/,
    /\s+(?![\s\S]*\s+)/,
  ];

  for (const pattern of breakPatterns) {
    const match = window.match(pattern);
    if (!match || match.index === undefined) continue;

    const nextEnd = start + match.index + match[0].length;
    if (nextEnd >= minEnd) {
      return nextEnd;
    }
  }

  return hardEnd;
}

function findNextChunkStart(text: string, previousStart: number, previousEnd: number): number {
  const overlapStart = Math.max(previousStart + 1, previousEnd - DEFAULT_CHUNK_OVERLAP);
  const nextWhitespace = text.slice(overlapStart).search(/\S/);

  return nextWhitespace < 0 ? previousEnd : overlapStart + nextWhitespace;
}

function splitTextWithOverlap(text: string): Array<{ text: string; startOffset: number; endOffset: number }> {
  const chunks: Array<{ text: string; startOffset: number; endOffset: number }> = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + DEFAULT_CHUNK_SIZE);
    const end = findChunkEnd(text, start, hardEnd);
    const chunk = normalizeChunkText(text.slice(start, end));

    if (chunk) {
      chunks.push({ text: chunk, startOffset: start, endOffset: end });
    }

    if (end >= text.length) {
      break;
    }

    const nextStart = findNextChunkStart(text, start, end);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function splitTextIntoChunks(
  prefix: string,
  text: string,
  pageIndex: number | null,
  blockId?: string | null,
): RagChunkInput[] {
  const normalized = normalizeChunkText(text);

  if (!normalized) {
    return [];
  }

  return splitTextWithOverlap(normalized)
    .map((piece, index) => ({
      chunkId: `${prefix}:${index}`,
      chunkIndex: index,
      pageIndex,
      blockId,
      text: piece.text,
      startOffset: piece.startOffset,
      endOffset: piece.endOffset,
    }))
    .filter((chunk) => chunk.text);
}

function buildBlockScopedChunk(
  prefix: string,
  text: string,
  pageIndex: number | null,
  blockId?: string | null,
): RagChunkInput | null {
  const normalized = normalizeChunkText(text);

  if (!normalized) {
    return null;
  }

  return {
    chunkId: `${prefix}:0`,
    chunkIndex: 0,
    pageIndex,
    blockId,
    text: normalized,
    startOffset: 0,
    endOffset: normalized.length,
  };
}

function headingLevel(block: PositionedMineruBlock): number | null {
  if (block.type !== 'title') {
    return null;
  }

  const content = block.content;
  if (content && typeof content === 'object' && 'text_level' in content) {
    const level = Number((content as { text_level?: unknown }).text_level);
    if (Number.isFinite(level) && level > 0) {
      return Math.floor(level);
    }
  }

  return 1;
}

export function buildReaderRagDocumentKey(item: WorkspaceItem): string {
  if (item.source === 'native-library') {
    return item.itemKey;
  }

  return item.workspaceId;
}

export function buildMineruRagChunks(
  blocks: PositionedMineruBlock[],
): RagChunkInput[] {
  const headingStack: Array<{ level: number; title: string }> = [];
  let sectionId: string | null = null;

  return blocks
    .filter((block) => !isPageDecorationBlock(block))
    .flatMap((block) => {
      const level = headingLevel(block);
      if (level !== null) {
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }
        const title = normalizeChunkText(extractTextFromMineruBlock(block)) || block.blockId;
        headingStack.push({ level, title });
        sectionId = block.blockId;
      }
      const sectionPath = headingStack.length > 0 ? headingStack.map((entry) => entry.title) : null;
      const prefix = `mineru:${block.blockId}`;
      const pageIndex = Number.isFinite(block.pageIndex) ? block.pageIndex : null;
      const text = extractTextFromMineruBlock(block);
      const normalized = normalizeChunkText(text);

      if (!normalized) {
        return [];
      }

      if (normalized.length <= DEFAULT_CHUNK_SIZE) {
        const chunk = buildBlockScopedChunk(prefix, normalized, pageIndex, block.blockId);
        return chunk ? [{ ...chunk, sectionId, sectionPath }] : [];
      }

      return splitTextIntoChunks(prefix, normalized, pageIndex, block.blockId)
        .map((chunk) => ({ ...chunk, sectionId, sectionPath }));
    })
    .map((chunk, index) => ({
      ...chunk,
      chunkIndex: index,
    }));
}

export function buildPdfRagChunks(documentText: string): RagChunkInput[] {
  const sections = documentText
    .split(/\n\s*# Page /)
    .map((section, index) => {
      if (index === 0 && !section.startsWith('1\n')) {
        return {
          pageIndex: null,
          text: section,
        };
      }

      const normalized = index === 0 ? section : `# Page ${section}`;
      const match = normalized.match(/^# Page\s+(\d+)\s*\n([\s\S]*)$/);

      return {
        pageIndex: match ? Number(match[1]) - 1 : null,
        text: match ? match[2] : normalized,
      };
    })
    .filter((section) => section.text.trim());

  return sections
    .flatMap((section, index) => splitTextIntoChunks(`pdf:${index}`, section.text, section.pageIndex)
      .map((chunk) => ({
        ...chunk,
        sectionId: section.pageIndex === null ? null : `page:${section.pageIndex}`,
        sectionPath: section.pageIndex === null ? null : [`Page ${section.pageIndex + 1}`],
      })))
    .map((chunk, index) => ({
      ...chunk,
      chunkIndex: index,
    }));
}

function uniqueChunks(chunks: RagChunkInput[]): RagChunkInput[] {
  const seen = new Set<string>();

  return chunks.filter((chunk) => {
    const signature = `${chunk.pageIndex ?? 'na'}::${chunk.blockId ?? 'na'}::${textSignature(chunk.text)}`;

    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}

export function prepareReaderRagDocument(input: {
  item: WorkspaceItem;
  settings: Pick<ReaderSettings, 'ragSourceMode'>;
  mineruBlocks: PositionedMineruBlock[];
  mineruDocumentText: string;
  pdfDocumentText: string;
}): ReaderRagPreparedDocument {
  const documentKey = buildReaderRagDocumentKey(input.item);
  const sources: ReaderRagPreparedSource[] = [];
  const wantMineru =
    input.settings.ragSourceMode === 'mineru-markdown' ||
    input.settings.ragSourceMode === 'hybrid';
  const wantPdf =
    input.settings.ragSourceMode === 'pdf-text' ||
    input.settings.ragSourceMode === 'hybrid';

  if (wantMineru) {
    const mineruSourceText = normalizeChunkText(input.mineruDocumentText);
    const mineruChunks = uniqueChunks(buildMineruRagChunks(input.mineruBlocks));

    if (mineruSourceText && mineruChunks.length > 0) {
      sources.push({
        sourceType: 'mineru-markdown',
        sourceSignature: textSignature(mineruSourceText),
        chunks: mineruChunks,
      });
    }
  }

  if (wantPdf) {
    const pdfSourceText = normalizeChunkText(input.pdfDocumentText);
    const pdfChunks = uniqueChunks(buildPdfRagChunks(input.pdfDocumentText));

    if (pdfSourceText && pdfChunks.length > 0) {
      sources.push({
        sourceType: 'pdf-text',
        sourceSignature: textSignature(pdfSourceText),
        chunks: pdfChunks,
      });
    }
  }

  return {
    documentKey,
    title: input.item.title,
    sources,
  };
}

export function buildRagRetrievalQuery(question: string, excerptText?: string | null): string {
  const trimmedQuestion = question.trim();
  const trimmedExcerpt = excerptText?.trim();

  return trimmedExcerpt
    ? `Question:\n${trimmedQuestion}\n\nSelected excerpt:\n${trimmedExcerpt}`
    : trimmedQuestion;
}

function looksLikeSectionHeading(text: string): boolean {
  const normalized = normalizeChunkText(text);

  if (!normalized || normalized.length > MAX_HEADING_LENGTH) {
    return false;
  }

  const collapsed = normalized.replace(/\s+/g, ' ').trim();
  const lineCount = normalized.split('\n').filter(Boolean).length;

  if (lineCount > 2 || collapsed.length > MAX_HEADING_LENGTH) {
    return false;
  }

  if (/^(abstract|introduction|background|related work|method|methods|approach|experiment|experiments|results|discussion|conclusion|conclusions|references)\b/i.test(collapsed)) {
    return true;
  }

  if (/^(section\s+)?\d+(\.\d+)*[\s.:_-]+[A-Z]/.test(collapsed)) {
    return true;
  }

  if (/^[一二三四五六七八九十0-9]+[、.\s]/.test(collapsed)) {
    return true;
  }

  return /^[A-Z][A-Za-z0-9\s:()/_-]{0,120}$/.test(collapsed) && collapsed.split(/\s+/).length <= 10;
}

function buildChunkLookup(
  preparedSources: ReaderRagPreparedSource[],
): Map<string, Map<string, RagChunkInput[]>> {
  const lookup = new Map<string, Map<string, RagChunkInput[]>>();

  preparedSources.forEach((source) => {
    const byBlockId = new Map<string, RagChunkInput[]>();

    source.chunks.forEach((chunk) => {
      const blockId = chunk.blockId?.trim();

      if (!blockId) {
        return;
      }

      const existing = byBlockId.get(blockId) ?? [];
      existing.push(chunk);
      byBlockId.set(blockId, existing);
    });

    byBlockId.forEach((chunks) => {
      chunks.sort((left, right) => left.chunkIndex - right.chunkIndex);
    });

    lookup.set(source.sourceType, byBlockId);
  });

  return lookup;
}

function isHeadingResult(
  result: RagRetrievalResult,
  blockById: Map<string, PositionedMineruBlock>,
): boolean {
  if (result.sourceType !== 'mineru-markdown' || !result.blockId) {
    return false;
  }

  const block = blockById.get(result.blockId);

  if (block?.type === 'title') {
    return true;
  }

  return looksLikeSectionHeading(result.text);
}

function buildExpandedHeadingSection(
  seed: RagRetrievalResult,
  orderedBlocks: PositionedMineruBlock[],
  blockById: Map<string, PositionedMineruBlock>,
  blockOrder: Map<string, number>,
  chunksBySourceAndBlock: Map<string, Map<string, RagChunkInput[]>>,
  usedChunkIds: Set<string>,
): RagRetrievalResult[] {
  if (!seed.blockId || !isHeadingResult(seed, blockById)) {
    return [];
  }

  const startIndex = blockOrder.get(seed.blockId);

  if (typeof startIndex !== 'number') {
    return [];
  }

  const additions: RagRetrievalResult[] = [];
  let collectedChars = 0;
  let collectedBlocks = 0;

  for (let cursor = startIndex + 1; cursor < orderedBlocks.length; cursor += 1) {
    const nextBlock = orderedBlocks[cursor];
    const nextText = normalizeChunkText(extractTextFromMineruBlock(nextBlock));

    if (!nextText) {
      continue;
    }

    if (nextBlock.type === 'title') {
      break;
    }

    const chunks = chunksBySourceAndBlock.get(seed.sourceType)?.get(nextBlock.blockId) ?? [];

    if (chunks.length === 0) {
      continue;
    }

    chunks.forEach((chunk) => {
      if (usedChunkIds.has(chunk.chunkId)) {
        return;
      }

      additions.push({
        chunkId: chunk.chunkId,
        sourceType: seed.sourceType,
        pageIndex: chunk.pageIndex,
        blockId: chunk.blockId,
        text: chunk.text,
        score: seed.score,
        retrievalRole: 'context',
        expandedFrom: seed.chunkId,
      });
      collectedChars += chunk.text.length;
    });

    collectedBlocks += 1;

    if (
      collectedBlocks >= MAX_HEADING_NEIGHBOR_BLOCKS ||
      collectedChars >= MAX_HEADING_SECTION_CHARS
    ) {
      break;
    }
  }

  return additions;
}

/**
 * 普通正文命中的前后邻接扩展（方案 §5.5）：默认前后各 1 片，按 chunkIndex 顺序取；
 * 受传入 token 预算约束，超预算的邻接片跳过。补充项标 retrievalRole=context +
 * expandedFrom，不冒充独立命中。
 */
function buildNeighborContext(input: {
  seed: RagRetrievalResult;
  orderedChunks: RagChunkInput[];
  positionByChunkId: Map<string, number>;
  usedChunkIds: Set<string>;
  tokenBudget: number;
}): { additions: RagRetrievalResult[]; before: RagRetrievalResult[]; usedTokens: number } {
  const position = input.positionByChunkId.get(input.seed.chunkId);

  if (typeof position !== 'number') {
    return { additions: [], before: [], usedTokens: 0 };
  }

  const picks: Array<{ chunk: RagChunkInput; side: 'before' | 'after' }> = [];
  const beforeChunk = input.orderedChunks[position - 1];
  const afterChunk = input.orderedChunks[position + 1];

  if (beforeChunk) {
    picks.push({ chunk: beforeChunk, side: 'before' });
  }

  if (afterChunk) {
    picks.push({ chunk: afterChunk, side: 'after' });
  }

  const additions: RagRetrievalResult[] = [];
  const before: RagRetrievalResult[] = [];
  let usedTokens = 0;

  for (const pick of picks) {
    if (input.usedChunkIds.has(pick.chunk.chunkId)) {
      continue;
    }

    const tokens = estimateTokens(pick.chunk.text);

    if (usedTokens + tokens > input.tokenBudget) {
      continue;
    }

    usedTokens += tokens;
    input.usedChunkIds.add(pick.chunk.chunkId);

    const addition: RagRetrievalResult = {
      chunkId: pick.chunk.chunkId,
      sourceType: input.seed.sourceType,
      pageIndex: pick.chunk.pageIndex,
      blockId: pick.chunk.blockId,
      text: pick.chunk.text,
      // 上下文补充不参与排名；保留种子分仅为排序稳定，retrievalRole 是区分依据。
      score: input.seed.score,
      retrievalRole: 'context',
      expandedFrom: input.seed.chunkId,
    };

    additions.push(addition);

    if (pick.side === 'before') {
      before.push(addition);
    }
  }

  return { additions, before, usedTokens };
}

function buildOrderedChunksBySource(
  preparedSources: ReaderRagPreparedSource[],
): Map<string, RagChunkInput[]> {
  const bySource = new Map<string, RagChunkInput[]>();

  preparedSources.forEach((source) => {
    bySource.set(
      source.sourceType,
      [...source.chunks].sort((left, right) => left.chunkIndex - right.chunkIndex),
    );
  });

  return bySource;
}

function buildContextSection(
  results: RagRetrievalResult[],
  index: number,
  anchor: RagRetrievalResult,
): string {
  const body = results
    .map((result) => result.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const anchorHint =
    anchor?.pageIndex !== null && anchor?.pageIndex !== undefined
      ? `Page ${anchor.pageIndex + 1}`
      : anchor?.sourceType ?? 'Context';

  return `# Source [${index + 1}]\n${anchorHint}\n${body}`;
}

function isPageDecorationResult(
  result: RagRetrievalResult,
  blockById: Map<string, PositionedMineruBlock>,
): boolean {
  if (!result.blockId) {
    return false;
  }

  const block = blockById.get(result.blockId);

  return Boolean(block && isPageDecorationBlock(block));
}

function selectCitationAnchor(
  results: RagRetrievalResult[],
  blockById: Map<string, PositionedMineruBlock>,
): RagRetrievalResult | null {
  if (results.length === 0) {
    return null;
  }

  // 引用锚点必须保留真实目标位置：上下文补充段（retrievalRole=context）不作锚点。
  const directHits = results.filter((result) => result.retrievalRole !== 'context');

  // Prefer a body result: not a heading and not a page decoration.
  const bodyResult = directHits.find(
    (result) =>
      !isHeadingResult(result, blockById) && !isPageDecorationResult(result, blockById),
  );

  if (bodyResult) {
    return bodyResult;
  }

  // Otherwise allow a heading, but never anchor on a page decoration.
  const nonDecoration = directHits.find((result) => !isPageDecorationResult(result, blockById));

  return nonDecoration ?? directHits[0] ?? results[0] ?? null;
}

function buildCitation(
  anchor: RagRetrievalResult | null,
  results: RagRetrievalResult[],
  index: number,
): DocumentChatCitation | null {
  if (!anchor) {
    return null;
  }

  return {
    id: `cite:${index + 1}`,
    label: String(index + 1),
    sourceType: anchor.sourceType,
    pageIndex: anchor.pageIndex,
    blockId: anchor.blockId,
    chunkId: anchor.chunkId,
    previewText: results
      .map((result) => normalizeChunkText(result.text))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 480),
  };
}

export function buildRagContextText(input: {
  results: RagRetrievalResult[];
  topK: number;
  mineruBlocks: PositionedMineruBlock[];
  preparedSources: ReaderRagPreparedSource[];
}): ReaderRagContextDocument {
  const results = input.results.slice(0, input.topK);
  const seeds = results;

  if (seeds.length === 0) {
    return {
      documentText: '',
      sectionCount: 0,
      citations: [],
      retrievals: [],
    };
  }

  const orderedBlocks = [...input.mineruBlocks].sort((left, right) => {
    if (left.pageIndex !== right.pageIndex) {
      return left.pageIndex - right.pageIndex;
    }

    return left.blockIndex - right.blockIndex;
  });
  const blockById = new Map(orderedBlocks.map((block) => [block.blockId, block]));
  const blockOrder = new Map(orderedBlocks.map((block, index) => [block.blockId, index]));
  const chunksBySourceAndBlock = buildChunkLookup(input.preparedSources);
  const orderedChunksBySource = buildOrderedChunksBySource(input.preparedSources);
  const positionMapsBySource = new Map<string, Map<string, number>>();
  const getPositionMap = (sourceType: string): Map<string, number> => {
    const cached = positionMapsBySource.get(sourceType);

    if (cached) {
      return cached;
    }

    const map = new Map<string, number>();
    (orderedChunksBySource.get(sourceType) ?? []).forEach((chunk, index) => {
      map.set(chunk.chunkId, index);
    });
    positionMapsBySource.set(sourceType, map);
    return map;
  };
  const usedChunkIds = new Set<string>();
  const sections: string[] = [];
  const citations: DocumentChatCitation[] = [];
  /** 上下文补充段（标题扩展 + 前后邻接），标记 retrievalRole=context 后随结果返回，便于各入口查看其位置。 */
  const contextSupplements: RagRetrievalResult[] = [];
  let questionContextTokenBudget = CONTEXT_QUESTION_TOKEN_BUDGET;

  seeds.forEach((seed) => {
    if (usedChunkIds.has(seed.chunkId)) {
      return;
    }

    usedChunkIds.add(seed.chunkId);
    const beforeAdditions: RagRetrievalResult[] = [];
    const afterAdditions: RagRetrievalResult[] = [];

    if (isHeadingResult(seed, blockById)) {
      buildExpandedHeadingSection(
        seed,
        orderedBlocks,
        blockById,
        blockOrder,
        chunksBySourceAndBlock,
        usedChunkIds,
      ).forEach((result) => {
        if (usedChunkIds.has(result.chunkId)) {
          return;
        }

        afterAdditions.push(result);
        contextSupplements.push(result);
        usedChunkIds.add(result.chunkId);
      });
    } else if (questionContextTokenBudget > 0) {
      // 普通正文命中：前后邻接扩展，单目标窗口与整次问答双层预算约束（方案 §5.5）。
      const targetBudget = Math.min(
        Math.max(0, CONTEXT_TARGET_TOKEN_BUDGET - estimateTokens(seed.text)),
        questionContextTokenBudget,
      );
      const neighbor = buildNeighborContext({
        seed,
        orderedChunks: orderedChunksBySource.get(seed.sourceType) ?? [],
        positionByChunkId: getPositionMap(seed.sourceType),
        usedChunkIds,
        tokenBudget: targetBudget,
      });

      questionContextTokenBudget -= neighbor.usedTokens;
      neighbor.additions.forEach((result) => {
        contextSupplements.push(result);

        if (neighbor.before.includes(result)) {
          beforeAdditions.push(result);
          return;
        }

        afterAdditions.push(result);
      });
    }

    const sectionResults = [...beforeAdditions, seed, ...afterAdditions];
    const sectionIndex = sections.length;
    const anchor = selectCitationAnchor(sectionResults, blockById);
    if (!anchor) {
      return;
    }

    sections.push(buildContextSection(sectionResults, sectionIndex, anchor));
    const citation = buildCitation(anchor, sectionResults, sectionIndex);

    if (citation) {
      citations.push(citation);
    }
  });

  return {
    documentText: sections.join('\n\n').trim(),
    sectionCount: sections.length,
    citations,
    retrievals: [...results, ...contextSupplements],
  };
}
