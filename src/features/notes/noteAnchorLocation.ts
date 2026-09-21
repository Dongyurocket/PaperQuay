import type { NoteAnchor, NotePdfLocation } from '../../types/notes';

/**
 * 锚点的可跳转位置。
 *
 * `blockId` / `pageIndex` 是「跳到正文块」所需的精确位置，`pdfLocation` 还能额外带上
 * bbox 做高亮。三者都可能缺失：历史笔记的锚点只保留了 id / label（见下方
 * `resolveNoteAnchorLocation` 的降级推导），因此跳转前统一走这里补齐。
 */
export interface ResolvedNoteAnchorLocation {
  blockId: string | null;
  pageIndex: number | null;
  pdfLocation: NotePdfLocation | null;
}

export type NoteAnchorLocationSource = Pick<
  NoteAnchor,
  'id' | 'label' | 'blockId' | 'pageIndex' | 'pdfLocation'
>;

const MINERU_BLOCK_ID_PATTERN = /^page-(\d+)-block-(\d+)$/;
const ANCHOR_PAGE_LABEL_PATTERN = /^P\s*(\d+)$/i;
// 润色引用锚点 id 约定：note-polish:<paperId>:<chunkId>，MinerU 分块的 chunkId 形如
// `mineru:page-20-block-3:0`（见 readerRag.buildMineruRagChunks），paperId 本身可能含冒号。
const MINERU_CHUNK_MARKER = ':mineru:';

function normalizePageIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeBlockId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** MinerU 块 id（`page-<页>-block-<块序号>`，均为 1 起始）对应的 0 起始页下标。 */
export function pageIndexFromMineruBlockId(blockId: string): number | null {
  const match = MINERU_BLOCK_ID_PATTERN.exec(blockId.trim());

  if (!match) {
    return null;
  }

  const pageNumber = Number(match[1]);
  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber - 1 : null;
}

/** 锚点标签是 `P12` 这类页码时取出 0 起始页下标；其余标签（摘录标题等）返回 null。 */
export function pageIndexFromAnchorLabel(label: unknown): number | null {
  if (typeof label !== 'string') {
    return null;
  }

  const match = ANCHOR_PAGE_LABEL_PATTERN.exec(label.trim());

  if (!match) {
    return null;
  }

  const pageNumber = Number(match[1]);
  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber - 1 : null;
}

/**
 * 从润色引用锚点 id 还原位置：`note-polish:<paperId>:mineru:<blockId>:<chunkIndex>`
 * → `{ blockId, pageIndex }`。其它形态（pdf 分块等）返回 null。
 */
export function parseNotePolishAnchorLocation(anchorId: string): { blockId: string; pageIndex: number | null } | null {
  if (typeof anchorId !== 'string') {
    return null;
  }

  const trimmed = anchorId.trim();
  const markerIndex = trimmed.indexOf(MINERU_CHUNK_MARKER);

  if (markerIndex < 0) {
    return null;
  }

  const [blockId] = trimmed.slice(markerIndex + MINERU_CHUNK_MARKER.length).split(':');
  const normalizedBlockId = normalizeBlockId(blockId);

  if (!normalizedBlockId) {
    return null;
  }

  const pageIndex = pageIndexFromMineruBlockId(normalizedBlockId);
  return { blockId: normalizedBlockId, pageIndex };
}

/**
 * 解析锚点的可跳转位置，按可靠性降级：
 * 1. 锚点自带的 `blockId` / `pageIndex` / `pdfLocation`；
 * 2. 锚点 id 里的 MinerU 分块信息（`note-polish` 锚点）；
 * 3. 显示用页码标签（`P20`）——保证「芯片显示 P20 就一定跳到 P20」。
 */
export function resolveNoteAnchorLocation(anchor: NoteAnchorLocationSource): ResolvedNoteAnchorLocation {
  const explicitBlockId = normalizeBlockId(anchor.blockId);
  const pdfLocation = anchor.pdfLocation ?? null;
  const explicitPageIndex =
    normalizePageIndex(anchor.pageIndex) ??
    (pdfLocation && typeof pdfLocation.pageNumber === 'number' && pdfLocation.pageNumber >= 1
      ? pdfLocation.pageNumber - 1
      : null);

  const parsed = explicitBlockId === null || explicitPageIndex === null
    ? parseNotePolishAnchorLocation(anchor.id)
    : null;
  const blockId = explicitBlockId ?? parsed?.blockId ?? null;
  const pageIndex =
    explicitPageIndex ??
    parsed?.pageIndex ??
    (blockId ? pageIndexFromMineruBlockId(blockId) : null) ??
    pageIndexFromAnchorLabel(anchor.label);

  return { blockId, pageIndex, pdfLocation };
}
