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
import {
  chunkMatchesFormulaNumber,
  chunkMatchesReferenceEntry,
  extractFormulaNumbers,
  extractReferenceNumbers,
  hasSourceOriginIntent,
} from '../../shared/ragQueryUtils.cjs';
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
  /** 超出预算被截去的证据段数量（按相关性从低到高丢弃）。 */
  budgetSkippedCount?: number;
}

const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_CHUNK_OVERLAP = 120;
const SOFT_MERGE_CHUNK_TARGET = 650;
const MAX_LEAD_IN_MERGE_CHARS = 450;
const MAX_NEIGHBOR_STEPS = 6;
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
export function estimateRagTokens(text: string): number {
  const wideCount = (text.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g) ?? []).length;
  return Math.ceil(wideCount + (text.length - wideCount) / 3);
}

/**
 * 全文回退（MinerU Markdown / PDF 文本）也要服从模型上下文预算。
 * 保留开头（标题、摘要、方法通常在前），按 token 估算二分出最大前缀，
 * 尽量切在行边界，并附上一行截断说明。
 */
export function trimDocumentTextToTokenBudget(
  text: string,
  tokenBudget?: number,
): { text: string; truncated: boolean } {
  if (
    typeof tokenBudget !== 'number' ||
    !Number.isFinite(tokenBudget) ||
    tokenBudget <= 0 ||
    !text
  ) {
    return { text, truncated: false };
  }

  if (estimateRagTokens(text) <= tokenBudget) {
    return { text, truncated: false };
  }

  const marker = '\n\n[truncated]';
  // 截断说明本身也占 token；先扣掉，保证最终文本不超过预算。
  const contentBudget = Math.max(1, tokenBudget - estimateRagTokens(marker));
  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateRagTokens(text.slice(0, mid)) <= contentBudget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  let cut = low;
  const lastLineBreak = text.lastIndexOf('\n', cut);
  if (lastLineBreak > cut * 0.8) {
    cut = lastLineBreak;
  }

  return {
    text: `${text.slice(0, cut).trim()}${marker}`,
    truncated: true,
  };
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

function wrapEquationMarkdown(text: string): string {
  const trimmed = normalizeChunkText(text);
  if (!trimmed) {
    return '';
  }
  if (/^\$\$[\s\S]*\$\$$/.test(trimmed) || /^\\\[[\s\S]*\\\]$/.test(trimmed)) {
    return trimmed;
  }
  return `$$\n${trimmed}\n$$`;
}

function isVariableExplanationText(text: string): boolean {
  const trimmed = text.trim();
  return /^(?:where|in which|here,|with\b|式中|其中)/i.test(trimmed);
}

interface MineruChunkCandidate {
  block: PositionedMineruBlock;
  text: string;
  pageIndex: number | null;
  sectionId: string | null;
  sectionPath: string[] | null;
  kind: 'title' | 'table' | 'equation' | 'caption' | 'prose';
}

export function buildMineruRagChunks(
  blocks: PositionedMineruBlock[],
): RagChunkInput[] {
  const headingStack: Array<{ level: number; title: string }> = [];
  let sectionId: string | null = null;

  const entries: MineruChunkCandidate[] = [];

  for (const block of blocks) {
    if (isPageDecorationBlock(block)) {
      continue;
    }

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
    const pageIndex = Number.isFinite(block.pageIndex) ? block.pageIndex : null;
    const rawText = extractTextFromMineruBlock(block);
    const normalized = normalizeChunkText(rawText);

    if (!normalized) {
      continue;
    }

    const kind: MineruChunkCandidate['kind'] =
      level !== null || block.type === 'title'
        ? 'title'
        : block.type === 'table'
          ? 'table'
          : block.type === 'equation'
            ? 'equation'
            : block.type === 'image' || block.type === 'caption'
              ? 'caption'
              : 'prose';

    entries.push({
      block,
      text: kind === 'equation' ? wrapEquationMarkdown(normalized) : normalized,
      pageIndex,
      sectionId,
      sectionPath,
      kind,
    });
  }

  const output: RagChunkInput[] = [];
  let buffer: MineruChunkCandidate[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) {
      return;
    }

    const first = buffer[0];
    const hasEquation = buffer.some((item) => item.kind === 'equation');
    const hasProse = buffer.some((item) => item.kind === 'prose');
    const primaryEquation = buffer.find((item) => item.kind === 'equation');
    const anchor = primaryEquation ?? first;
    const sectionPrefix =
      hasEquation && !hasProse && anchor.sectionPath && anchor.sectionPath.length > 0
        ? `[Section: ${anchor.sectionPath[anchor.sectionPath.length - 1]}]\n`
        : '';
    const combinedText = `${sectionPrefix}${buffer.map((item) => item.text).join('\n\n')}`;
    const prefix = `mineru:${anchor.block.blockId}`;

    if (combinedText.length <= DEFAULT_CHUNK_SIZE) {
      const chunk = buildBlockScopedChunk(prefix, combinedText, anchor.pageIndex, anchor.block.blockId);
      if (chunk) {
        output.push({ ...chunk, sectionId: anchor.sectionId, sectionPath: anchor.sectionPath });
      }
    } else {
      splitTextIntoChunks(prefix, combinedText, anchor.pageIndex, anchor.block.blockId)
        .forEach((chunk) => {
          output.push({ ...chunk, sectionId: anchor.sectionId, sectionPath: anchor.sectionPath });
        });
    }

    buffer = [];
  };

  for (const entry of entries) {
    if (entry.kind === 'title' || entry.kind === 'table') {
      flushBuffer();
      const prefix = `mineru:${entry.block.blockId}`;
      if (entry.text.length <= DEFAULT_CHUNK_SIZE) {
        const chunk = buildBlockScopedChunk(prefix, entry.text, entry.pageIndex, entry.block.blockId);
        if (chunk) {
          output.push({ ...chunk, sectionId: entry.sectionId, sectionPath: entry.sectionPath });
        }
      } else {
        splitTextIntoChunks(prefix, entry.text, entry.pageIndex, entry.block.blockId)
          .forEach((chunk) => {
            output.push({ ...chunk, sectionId: entry.sectionId, sectionPath: entry.sectionPath });
          });
      }
      continue;
    }

    if (buffer.length === 0) {
      buffer.push(entry);
      continue;
    }

    const prev = buffer[buffer.length - 1];
    const sameSection = prev.sectionId === entry.sectionId;
    let lastEquationIndex = -1;
    for (let idx = buffer.length - 1; idx >= 0; idx -= 1) {
      if (buffer[idx].kind === 'equation') {
        lastEquationIndex = idx;
        break;
      }
    }
    const bufferHasEquation = lastEquationIndex >= 0;
    const hasTrailingProseAfterEq =
      bufferHasEquation && buffer.slice(lastEquationIndex + 1).some((item) => item.kind === 'prose');
    const bufferHasCaptionOnly = buffer.every((item) => item.kind === 'caption');
    const currentLen = buffer.map((item) => item.text).join('\n\n').length;
    const combinedLen = currentLen + 2 + entry.text.length;

    let canMerge = false;
    if (sameSection && combinedLen <= DEFAULT_CHUNK_SIZE) {
      if (entry.kind === 'caption' && bufferHasCaptionOnly) {
        canMerge = true;
      } else if (entry.kind === 'equation' && !bufferHasCaptionOnly) {
        canMerge = (bufferHasEquation && !hasTrailingProseAfterEq) || currentLen <= MAX_LEAD_IN_MERGE_CHARS;
      } else if (entry.kind === 'prose') {
        if (bufferHasEquation) {
          canMerge =
            !hasTrailingProseAfterEq &&
            (isVariableExplanationText(entry.text) || entry.text.length <= MAX_LEAD_IN_MERGE_CHARS);
        } else if (!bufferHasCaptionOnly) {
          canMerge =
            (currentLen < 260 || entry.text.length < 220) &&
            combinedLen <= SOFT_MERGE_CHUNK_TARGET;
        }
      }
    }

    if (canMerge) {
      buffer.push(entry);
    } else {
      flushBuffer();
      buffer.push(entry);
    }
  }

  flushBuffer();

  return output.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
  }));
}

export function buildPdfRagChunks(documentText: string): RagChunkInput[] {
  const sections = documentText
    .split(/(?=^# Page[ \t]+[1-9]\d*[ \t]*\r?$)/m)
    .map((section) => {
      const match = section.match(/^# Page[ \t]+([1-9]\d*)[ \t]*(?:\r?\n|$)([\s\S]*)$/);

      return {
        pageIndex: match ? Number(match[1]) - 1 : null,
        text: match ? match[2] : section,
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

/** MinerU 分块抽取器版本：上下文感知公式/短块合并与 LaTeX 清洗升级后递增，触发按需懒重建。 */
export const MINERU_RAG_EXTRACTOR_VERSION = 'mineru-chunks-v3';

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
        sourceSignature: textSignature(`${MINERU_RAG_EXTRACTOR_VERSION}\n${mineruSourceText}`),
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

function isCaptionOrImageChunk(
  chunk: RagChunkInput,
  blockById: Map<string, PositionedMineruBlock>,
): boolean {
  const block = chunk.blockId ? blockById.get(chunk.blockId) : undefined;
  if (block && (block.type === 'image' || block.type === 'caption')) {
    return true;
  }
  const trimmed = chunk.text.trim();
  return trimmed.length < 120 && /^(?:\([a-z0-9]+\)|fig(?:ure)?\.?\s*\d)/i.test(trimmed);
}

function isEquationLikeChunk(
  chunk: RagChunkInput | RagRetrievalResult,
  blockById: Map<string, PositionedMineruBlock>,
): boolean {
  const block = chunk.blockId ? blockById.get(chunk.blockId) : undefined;
  if (block?.type === 'equation') {
    return true;
  }
  const trimmed = chunk.text.trim();
  return /\\tag\{\s*\d+(?:\.\d+)?\s*\}/.test(trimmed) || /^\$\$[\s\S]*\$\$$/m.test(trimmed);
}

function isHeadingChunk(
  chunk: RagChunkInput,
  blockById: Map<string, PositionedMineruBlock>,
): boolean {
  const block = chunk.blockId ? blockById.get(chunk.blockId) : undefined;
  if (block?.type === 'title') {
    return true;
  }
  return false;
}

/**
 * 普通正文/公式命中的自适应邻接扩展：
 * - 普通正文默认前后各 1 片，保持上下文紧致；
 * - 遇到图注碎片、连续公式组或种子本身为公式时，在同章节及 token 预算内穿透碎片并打包完整公式组与释义段。
 */
function buildNeighborContext(input: {
  seed: RagRetrievalResult;
  orderedChunks: RagChunkInput[];
  positionByChunkId: Map<string, number>;
  blockById: Map<string, PositionedMineruBlock>;
  usedChunkIds: Set<string>;
  tokenBudget: number;
}): { additions: RagRetrievalResult[]; before: RagRetrievalResult[]; usedTokens: number } {
  let position = input.positionByChunkId.get(input.seed.chunkId);
  if (typeof position !== 'number' && input.seed.blockId) {
    const byBlock = input.orderedChunks.findIndex((chunk) => chunk.blockId === input.seed.blockId);
    if (byBlock >= 0) {
      position = byBlock;
    }
  }

  if (typeof position !== 'number') {
    return { additions: [], before: [], usedTokens: 0 };
  }

  const seedChunk = input.orderedChunks[position];
  const seedIsEquation = isEquationLikeChunk(input.seed, input.blockById);
  const canExtendPast = (candidate: RagChunkInput | undefined): candidate is RagChunkInput => {
    if (!candidate) return false;
    if (isHeadingChunk(candidate, input.blockById)) return false;
    if (seedChunk?.sectionId && candidate.sectionId && candidate.sectionId !== seedChunk.sectionId) {
      return false;
    }
    return true;
  };

  const beforePicks: RagChunkInput[] = [];
  const afterPicks: RagChunkInput[] = [];
  let usedTokens = 0;

  const tryPick = (chunk: RagChunkInput): boolean => {
    if (input.usedChunkIds.has(chunk.chunkId)) {
      return false;
    }
    const tokens = estimateRagTokens(chunk.text);
    if (usedTokens + tokens > input.tokenBudget) {
      return false;
    }
    usedTokens += tokens;
    input.usedChunkIds.add(chunk.chunkId);
    return true;
  };

  // Backward scan: gather at least 1 non-caption, non-equation lead-in if seed is an equation or preceded by fragments.
  let hasProseBefore = false;
  for (let step = 1; step <= MAX_NEIGHBOR_STEPS; step += 1) {
    const candidate = input.orderedChunks[position - step];
    if (!canExtendPast(candidate)) {
      break;
    }
    if (input.usedChunkIds.has(candidate.chunkId)) {
      if (step === 1 && !seedIsEquation) break;
      continue;
    }
    const picked = tryPick(candidate);
    if (!picked) {
      if (step === 1) break;
      continue;
    }
    beforePicks.unshift(candidate);

    const isEq = isEquationLikeChunk(candidate, input.blockById);
    const isFrag = isCaptionOrImageChunk(candidate, input.blockById);
    if (!isEq && !isFrag) {
      hasProseBefore = true;
      break;
    }
    if (!seedIsEquation && step === 1 && hasProseBefore) {
      break;
    }
  }

  // Forward scan: bridge short caption fragments and keep contiguous equation groups + explanation together.
  let hasSubstantiveProseAfter = false;
  let sawEquationAfter = seedIsEquation;
  for (let step = 1; step <= MAX_NEIGHBOR_STEPS; step += 1) {
    const candidate = input.orderedChunks[position + step];
    if (!canExtendPast(candidate)) {
      break;
    }
    if (input.usedChunkIds.has(candidate.chunkId)) {
      if (step === 1 && !seedIsEquation) break;
      continue;
    }

    const isEq = isEquationLikeChunk(candidate, input.blockById);
    const isFrag = isCaptionOrImageChunk(candidate, input.blockById);

    // Once we already have a normal prose chunk after (and didn't touch equations unless we just got its explanation), stop.
    if (hasSubstantiveProseAfter) {
      break;
    }
    if (sawEquationAfter && !isEq && !isFrag && afterPicks.some((item) => !isCaptionOrImageChunk(item, input.blockById) && !isEquationLikeChunk(item, input.blockById))) {
      break;
    }

    const picked = tryPick(candidate);
    if (!picked) {
      break;
    }
    afterPicks.push(candidate);

    if (isEq) {
      sawEquationAfter = true;
      continue;
    }
    if (!isFrag) {
      hasSubstantiveProseAfter = true;
      if (!sawEquationAfter) {
        break;
      }
    }
  }

  const toAddition = (chunk: RagChunkInput): RagRetrievalResult => ({
    chunkId: chunk.chunkId,
    sourceType: input.seed.sourceType,
    pageIndex: chunk.pageIndex,
    blockId: chunk.blockId,
    text: chunk.text,
    // 上下文补充不参与排名；保留种子分仅为排序稳定，retrievalRole 是区分依据。
    score: input.seed.score,
    retrievalRole: 'context',
    expandedFrom: input.seed.chunkId,
  });

  const before = beforePicks.map(toAddition);
  const after = afterPicks.map(toAddition);
  return {
    additions: [...before, ...after],
    before,
    usedTokens,
  };
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

function formatResultBodyForContext(
  result: RagRetrievalResult,
  blockById: Map<string, PositionedMineruBlock>,
): string {
  const trimmed = result.text.trim();
  if (!trimmed) {
    return '';
  }
  const block = result.blockId ? blockById.get(result.blockId) : undefined;
  if (block?.type === 'equation' && !trimmed.includes('$$')) {
    return wrapEquationMarkdown(trimmed);
  }
  return trimmed;
}

function buildContextSection(
  results: RagRetrievalResult[],
  index: number,
  anchor: RagRetrievalResult,
  blockById: Map<string, PositionedMineruBlock>,
  chunkSectionMap: Map<string, string[]>,
): string {
  const body = results
    .map((result) => formatResultBodyForContext(result, blockById))
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const sectionPath = chunkSectionMap.get(`${anchor.sourceType}::${anchor.chunkId}`);
  const sectionHint = sectionPath && sectionPath.length > 0 ? sectionPath[sectionPath.length - 1] : '';
  const baseHint =
    anchor?.pageIndex !== null && anchor?.pageIndex !== undefined
      ? `Page ${anchor.pageIndex + 1}`
      : anchor?.sourceType ?? 'Context';
  const anchorHint = sectionHint && !body.startsWith(sectionHint)
    ? `${baseHint} · ${sectionHint}`
    : baseHint;

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

function evidenceKindFor(
  blockId: string | null | undefined,
  blockById: Map<string, PositionedMineruBlock>,
): DocumentChatCitation['evidenceKind'] {
  if (!blockId) return 'text';
  const block = blockById.get(blockId);
  if (!block) return 'text';
  if (block.type === 'table') return 'table';
  if (block.type === 'image' || block.type === 'chart') return 'image';
  if (block.type === 'equation') return 'equation';
  return 'text';
}

function buildSafeCitationPreview(results: RagRetrievalResult[]): string {
  const raw = results
    .map((result) => normalizeChunkText(result.text))
    .filter(Boolean)
    .join('\n\n');
  if (raw.length <= 480) {
    return raw;
  }
  const clipped = raw.slice(0, 480);
  const fenceCount = (clipped.match(/\$\$/g) ?? []).length;
  if (fenceCount % 2 === 1) {
    const lastOpen = clipped.lastIndexOf('$$');
    if (lastOpen > 40) {
      return clipped.slice(0, lastOpen).trimEnd();
    }
  }
  return clipped;
}

function buildCitation(
  anchor: RagRetrievalResult | null,
  results: RagRetrievalResult[],
  index: number,
  meta: { paperId?: string; paperTitle?: string; indexOffset?: number },
  blockById: Map<string, PositionedMineruBlock>,
): DocumentChatCitation | null {
  if (!anchor) {
    return null;
  }

  const displayIndex = index + 1 + (meta.indexOffset ?? 0);

  return {
    id: `cite:${displayIndex}`,
    label: String(displayIndex),
    sourceType: anchor.sourceType,
    pageIndex: anchor.pageIndex,
    blockId: anchor.blockId,
    chunkId: anchor.chunkId,
    previewText: buildSafeCitationPreview(results),
    ...(meta.paperId ? { paperId: meta.paperId } : {}),
    ...(meta.paperTitle ? { paperTitle: meta.paperTitle } : {}),
    evidenceKind: evidenceKindFor(anchor.blockId, blockById),
    score: anchor.score,
  };
}

interface BuiltContextSectionEntry {
  sectionResults: RagRetrievalResult[];
  anchor: RagRetrievalResult;
  hydrated?: boolean;
}

function findHydratedFormulaChunk(
  formulaNum: string,
  orderedChunksBySource: Map<string, RagChunkInput[]>,
  blockById: Map<string, PositionedMineruBlock>,
  usedChunkIds: Set<string>,
): { sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>; chunk: RagChunkInput } | null {
  const sourceOrder: Array<Exclude<RagSourceMode, 'off' | 'hybrid'>> = ['mineru-markdown', 'pdf-text'];
  let fallbackMatch: { sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>; chunk: RagChunkInput } | null = null;

  for (const sourceType of sourceOrder) {
    const chunks = orderedChunksBySource.get(sourceType) ?? [];
    for (const chunk of chunks) {
      if (usedChunkIds.has(chunk.chunkId)) continue;
      if (!chunkMatchesFormulaNumber(chunk.text, formulaNum)) continue;
      const block = chunk.blockId ? blockById.get(chunk.blockId) : undefined;
      if (block?.type === 'equation' || /\\tag\{/.test(chunk.text)) {
        return { sourceType, chunk };
      }
      if (!fallbackMatch) {
        fallbackMatch = { sourceType, chunk };
      }
    }
  }

  return fallbackMatch;
}

function findHydratedReferenceChunk(
  refNum: string,
  orderedChunksBySource: Map<string, RagChunkInput[]>,
  usedChunkIds: Set<string>,
): { sourceType: Exclude<RagSourceMode, 'off' | 'hybrid'>; chunk: RagChunkInput } | null {
  const sourceOrder: Array<Exclude<RagSourceMode, 'off' | 'hybrid'>> = ['mineru-markdown', 'pdf-text'];

  for (const sourceType of sourceOrder) {
    const chunks = orderedChunksBySource.get(sourceType) ?? [];
    if (chunks.length === 0) continue;
    const tailStart = Math.floor(chunks.length * 0.6);

    // 1. Prefer explicit References / Bibliography section or tail chunks.
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      const chunk = chunks[index];
      if (usedChunkIds.has(chunk.chunkId)) continue;
      const inReferenceSection = Boolean(
        chunk.sectionPath?.some((heading) => /reference|bibliography|参考文献/i.test(heading)),
      );
      if (!inReferenceSection && index < tailStart) continue;
      if (chunkMatchesReferenceEntry(chunk.text, refNum)) {
        return { sourceType, chunk };
      }
    }

    // 2. Fallback across full document in case heading hierarchy didn't mark References.
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      const chunk = chunks[index];
      if (usedChunkIds.has(chunk.chunkId)) continue;
      if (chunkMatchesReferenceEntry(chunk.text, refNum)) {
        return { sourceType, chunk };
      }
    }
  }

  return null;
}

export function buildRagContextText(input: {
  results: RagRetrievalResult[];
  topK: number;
  mineruBlocks: PositionedMineruBlock[];
  preparedSources: ReaderRagPreparedSource[];
  paperId?: string;
  paperTitle?: string;
  /** 原始用户问题，用于交叉引用公式/文献编号的确定性补全。 */
  question?: string;
  /** 多文献合并时把引用编号整体后移，避免 [n] 冲突。 */
  citationIndexOffset?: number;
  /** 多文献合并时按检索结果补齐文献身份（documentKey → paper）。 */
  paperLookup?: (result: RagRetrievalResult) => { paperId?: string; paperTitle?: string } | null;
  /** 当前文献可用的证据 token 预算；未提供时不主动截取。 */
  tokenBudget?: number;
}): ReaderRagContextDocument {
  const pdfChunks = input.preparedSources.find((source) => source.sourceType === 'pdf-text')?.chunks ?? [];
  const results = input.results.slice(0, input.topK).map((result) => {
    if (result.sourceType !== 'pdf-text' || result.pageIndex !== null || result.chunkId !== 'pdf:0:0') {
      return result;
    }
    const match = result.text.match(/^# Page[ \t]+([1-9]\d*)[ \t]*\r?\n([\s\S]+)$/);
    const current = pdfChunks.find((chunk) => chunk.chunkId === result.chunkId);
    const body = match ? normalizeChunkText(match[2]) : '';
    const currentText = current ? normalizeChunkText(current.text) : '';
    const pageIndex = match ? Number(match[1]) - 1 : null;
    if (!body || !currentText || current?.pageIndex !== pageIndex ||
        !(currentText.startsWith(body) || body.startsWith(currentText))) {
      return result;
    }
    return { ...result, pageIndex };
  });
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
  const chunkSectionMap = new Map<string, string[]>();
  input.preparedSources.forEach((source) => {
    source.chunks.forEach((chunk) => {
      if (chunk.sectionPath && chunk.sectionPath.length > 0) {
        chunkSectionMap.set(`${source.sourceType}::${chunk.chunkId}`, chunk.sectionPath);
      }
    });
  });

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
  const sectionEntries: BuiltContextSectionEntry[] = [];
  /** 上下文补充段（标题扩展 + 前后邻接 + 交叉引用补全），标记 retrievalRole=context 后随结果返回。 */
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
    } else if (questionContextTokenBudget > 0 && (
      seed.sourceType !== 'pdf-text' ||
      (orderedChunksBySource.get(seed.sourceType) ?? []).some((chunk) =>
        chunk.chunkId === seed.chunkId && chunk.text === seed.text)
    )) {
      // 普通正文/公式命中：自适应邻接扩展，单目标窗口与整次问答双层预算约束。
      const targetBudget = Math.min(
        Math.max(0, CONTEXT_TARGET_TOKEN_BUDGET - estimateRagTokens(seed.text)),
        questionContextTokenBudget,
      );
      const neighbor = buildNeighborContext({
        seed,
        orderedChunks: orderedChunksBySource.get(seed.sourceType) ?? [],
        positionByChunkId: getPositionMap(seed.sourceType),
        blockById,
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
    const anchor = selectCitationAnchor(sectionResults, blockById);
    if (!anchor) {
      return;
    }

    sectionEntries.push({ sectionResults, anchor });
  });

  // 交叉引用确定性补全：若问句或高相关正文引用了公式编号（如 Eqs. 5-7 / 公式(6)）或文献条目（如 [18]），
  // 且对应公式块/文献条目尚未出现在已选上下文中，从本篇 preparedSources 直接补齐，解决跨页/被图表隔断导致的缺失。
  const questionText = input.question?.trim() ?? '';
  if (input.preparedSources.length > 0 && (questionText || seeds.length > 0)) {
    const includedTexts = () =>
      sectionEntries.flatMap((entry) => entry.sectionResults.map((item) => item.text));

    const seedInspectionText = seeds.slice(0, 4).map((item) => item.text).join('\n');
    const questionFormulaNumbers = extractFormulaNumbers(questionText, { includeStandaloneParens: true });
    const seedFormulaNumbers = extractFormulaNumbers(seedInspectionText, { includeStandaloneParens: false });
    const targetFormulaNumbers = [...new Set([...questionFormulaNumbers, ...seedFormulaNumbers])].slice(0, 6);

    for (const formulaNum of targetFormulaNumbers) {
      if (includedTexts().some((text) => chunkMatchesFormulaNumber(text, formulaNum))) {
        continue;
      }

      const found = findHydratedFormulaChunk(
        formulaNum,
        orderedChunksBySource,
        blockById,
        usedChunkIds,
      );
      if (!found) continue;

      const anchorSeed: RagRetrievalResult = {
        chunkId: found.chunk.chunkId,
        sourceType: found.sourceType,
        pageIndex: found.chunk.pageIndex,
        blockId: found.chunk.blockId,
        text: found.chunk.text,
        score: seeds[0].score,
        retrievalRole: 'context',
        expandedFrom: seeds[0].chunkId,
      };
      usedChunkIds.add(found.chunk.chunkId);
      contextSupplements.push(anchorSeed);

      const neighbor = buildNeighborContext({
        seed: anchorSeed,
        orderedChunks: orderedChunksBySource.get(found.sourceType) ?? [],
        positionByChunkId: getPositionMap(found.sourceType),
        blockById,
        usedChunkIds,
        tokenBudget: Math.min(800, Math.max(250, questionContextTokenBudget)),
      });
      questionContextTokenBudget = Math.max(0, questionContextTokenBudget - neighbor.usedTokens);

      const beforeHydrated: RagRetrievalResult[] = [];
      const afterHydrated: RagRetrievalResult[] = [];
      neighbor.additions.forEach((result) => {
        contextSupplements.push(result);
        if (neighbor.before.includes(result)) {
          beforeHydrated.push(result);
        } else {
          afterHydrated.push(result);
        }
      });

      const sectionResults = [...beforeHydrated, anchorSeed, ...afterHydrated];
      sectionEntries.push({
        sectionResults,
        anchor: anchorSeed,
        hydrated: true,
      });
    }

    const questionRefNumbers = extractReferenceNumbers(questionText);
    const shouldHydrateSeedRefs =
      hasSourceOriginIntent(questionText) || questionFormulaNumbers.length > 0;
    const seedRefNumbers = shouldHydrateSeedRefs ? extractReferenceNumbers(seedInspectionText) : [];
    const targetRefNumbers = [...new Set([...questionRefNumbers, ...seedRefNumbers])].slice(0, 3);

    for (const refNum of targetRefNumbers) {
      if (includedTexts().some((text) => chunkMatchesReferenceEntry(text, refNum))) {
        continue;
      }

      const found = findHydratedReferenceChunk(refNum, orderedChunksBySource, usedChunkIds);
      if (!found) continue;

      const refSeed: RagRetrievalResult = {
        chunkId: found.chunk.chunkId,
        sourceType: found.sourceType,
        pageIndex: found.chunk.pageIndex,
        blockId: found.chunk.blockId,
        text: found.chunk.text,
        score: seeds[0].score,
        retrievalRole: 'context',
        expandedFrom: seeds[0].chunkId,
      };
      usedChunkIds.add(found.chunk.chunkId);
      contextSupplements.push(refSeed);
      sectionEntries.push({
        sectionResults: [refSeed],
        anchor: refSeed,
        hydrated: true,
      });
    }
  }

  const renderSection = (entry: BuiltContextSectionEntry, index: number) =>
    buildContextSection(entry.sectionResults, index, entry.anchor, blockById, chunkSectionMap);

  // 超出预算时优先保留第一条直击与交叉引用补全的公式/文献条目，按相关性从低到高丢弃普通尾段。
  const keptEntries = [...sectionEntries];
  let budgetSkippedCount = 0;
  if (typeof input.tokenBudget === 'number' && Number.isFinite(input.tokenBudget) && input.tokenBudget > 0) {
    while (
      keptEntries.length > 1 &&
      estimateRagTokens(keptEntries.map((entry, idx) => renderSection(entry, idx)).join('\n\n')) > input.tokenBudget
    ) {
      let dropIndex = -1;
      for (let i = keptEntries.length - 1; i >= 1; i -= 1) {
        if (!keptEntries[i].hydrated) {
          dropIndex = i;
          break;
        }
      }
      if (dropIndex === -1) {
        dropIndex = keptEntries.length - 1;
      }
      keptEntries.splice(dropIndex, 1);
      budgetSkippedCount += 1;
    }
  }

  const keptSections = keptEntries.map((entry, idx) => renderSection(entry, idx));
  let documentText = keptSections.join('\n\n').trim();

  // 最后一道硬裁剪：只剩一个超长 section 时上面的循环无法再丢条目，
  // 这里按预算裁剪文本本身，确保最终提示词不超过模型窗口。
  if (
    documentText &&
    typeof input.tokenBudget === 'number' &&
    Number.isFinite(input.tokenBudget) &&
    input.tokenBudget > 0 &&
    estimateRagTokens(documentText) > input.tokenBudget
  ) {
    // 注意：只截断正文、不丢弃证据条目，因此不增加 budgetSkippedCount
    // （该字段的 UI 语义是「已丢弃证据」）。截断由文本末尾的标记表示。
    documentText = trimDocumentTextToTokenBudget(documentText, input.tokenBudget).text;
  }

  const keptCitations = keptEntries
    .map((entry, idx) => {
      const lookup = input.paperLookup?.(entry.anchor);
      return buildCitation(
        entry.anchor,
        entry.sectionResults,
        idx,
        {
          paperId: lookup?.paperId ?? input.paperId,
          paperTitle: lookup?.paperTitle ?? input.paperTitle,
          indexOffset: input.citationIndexOffset,
        },
        blockById,
      );
    })
    .filter((citation): citation is DocumentChatCitation => Boolean(citation));

  return {
    documentText,
    sectionCount: keptSections.length,
    citations: keptCitations,
    retrievals: [...results, ...contextSupplements],
    ...(budgetSkippedCount > 0 ? { budgetSkippedCount } : {}),
  };
}

const RAG_RESULT_MIN_MARGIN = 0.12;
const RAG_RESULT_MAX_MARGIN = 0.45;
const RAG_RESULT_RELATIVE_MARGIN = 0.4;

export function filterRelevantRetrievals(
  results: RagRetrievalResult[],
  topK: number,
  options?: { isRrfScored?: boolean },
): RagRetrievalResult[] {
  if (results.length <= 1) {
    return results.slice(0, topK);
  }

  const sorted = [...results].sort((left, right) => left.score - right.score);
  if (options?.isRrfScored) {
    return sorted.slice(0, topK);
  }

  const bestScore = sorted[0]?.score ?? 0;
  const dynamicMargin = Math.max(
    RAG_RESULT_MIN_MARGIN,
    Math.min(RAG_RESULT_MAX_MARGIN, Math.abs(bestScore) * RAG_RESULT_RELATIVE_MARGIN),
  );
  const threshold = bestScore + dynamicMargin;
  const filtered = sorted.filter(
    (result, index) =>
      index === 0 ||
      result.channels?.includes('fts') ||
      result.channels?.includes('exact') ||
      result.score <= threshold,
  );

  return (filtered.length > 0 ? filtered : sorted).slice(0, topK);
}

/**
 * 多来源（mineru-markdown + pdf-text）混合合并：
 * - 先在各来源内完成阈值过滤，避免一个来源的 `1 - RRF` 分数与另一来源的 L2 distance 跨尺度比较；
 * - 再按来源内排名转为统一打分，保留精确关键词/公式命中（fts/exact），优先使用结构更干净的 MinerU 块，
 *   并对同页冗余的纯向量 pdf-text 分块去重以留出更多证据名额。
 */
export function mergeHybridSourceRetrievals(
  perSourceLists: Array<{
    sourceType: string;
    ftsHitCount: number;
    results: RagRetrievalResult[];
  }>,
  topK: number,
): RagRetrievalResult[] {
  const filteredLists = perSourceLists.map((entry) => ({
    sourceType: entry.sourceType,
    results: filterRelevantRetrievals(entry.results, topK, {
      isRrfScored: entry.ftsHitCount > 0,
    }),
  }));

  if (filteredLists.length <= 1) {
    return (filteredLists[0]?.results ?? []).slice(0, topK);
  }

  const ranked = filteredLists
    .flatMap((entry) =>
      entry.results.map((result, rankIndex) => {
        const hasKeywordHit = Boolean(
          result.channels?.includes('fts') || result.channels?.includes('exact'),
        );
        const sourceBonus = result.sourceType === 'mineru-markdown' ? 0.002 : 0;
        const keywordBonus = hasKeywordHit ? 0.025 : 0;
        const unifiedPriority = 1 / (60 + rankIndex + 1) + sourceBonus + keywordBonus;
        return {
          result,
          hasKeywordHit,
          unifiedPriority,
        };
      }),
    )
    .sort((left, right) => right.unifiedPriority - left.unifiedPriority);

  const mineruPages = new Set<number>();
  for (const item of ranked) {
    if (
      item.result.sourceType === 'mineru-markdown' &&
      typeof item.result.pageIndex === 'number'
    ) {
      mineruPages.add(item.result.pageIndex);
    }
  }

  const picked: RagRetrievalResult[] = [];
  const deferredPdfOverlaps: RagRetrievalResult[] = [];

  for (const item of ranked) {
    if (
      item.result.sourceType === 'pdf-text' &&
      !item.hasKeywordHit &&
      typeof item.result.pageIndex === 'number' &&
      mineruPages.has(item.result.pageIndex)
    ) {
      deferredPdfOverlaps.push(item.result);
      continue;
    }
    picked.push(item.result);
    if (picked.length >= topK) {
      return picked;
    }
  }

  for (const fallback of deferredPdfOverlaps) {
    picked.push(fallback);
    if (picked.length >= topK) {
      break;
    }
  }

  return picked;
}
