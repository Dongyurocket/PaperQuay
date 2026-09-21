import type { Editor } from '@tiptap/core';
import type { LiteraturePaper } from '../../types/library';
import type { NoteAnchor } from '../../types/notes';
import { resolveNoteAnchorLocation } from './noteAnchorLocation.ts';

export const REFERENCE_LIST_HEADING = '参考文献';
export const NOTE_POLISH_ANCHOR_PREFIX = 'note-polish:';

export interface NoteReferenceLocation {
  anchorId: string | null;
  blockId: string | null;
  pageIndex: number | null;
  sourceType: string | null;
}

export interface NoteReferenceEntry {
  paperId: string;
  label: string;
  locations: NoteReferenceLocation[];
}

interface TiptapJsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapJsonNode[];
}

const MAX_LOCATIONS_PER_REFERENCE = 4;

function normalizePaperId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePageIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// 润色引用锚点 id 约定为 note-polish:<paperId>:<chunkId>，paperId 本身可能含冒号，从尾部切。
export function paperIdFromNotePolishAnchorId(anchorId: string): string {
  if (!anchorId.startsWith(NOTE_POLISH_ANCHOR_PREFIX)) return '';
  const rest = anchorId.slice(NOTE_POLISH_ANCHOR_PREFIX.length);
  const lastColon = rest.lastIndexOf(':');
  return lastColon > 0 ? rest.slice(0, lastColon) : '';
}

function hasLocation(location: NoteReferenceLocation): boolean {
  return Boolean(location.anchorId || location.blockId || location.pageIndex !== null);
}

function pushLocation(entry: NoteReferenceEntry, location: NoteReferenceLocation) {
  if (!hasLocation(location)) return;
  const exists = entry.locations.some((item) =>
    item.anchorId === location.anchorId &&
    item.blockId === location.blockId &&
    item.pageIndex === location.pageIndex);
  if (exists) return;
  if (entry.locations.length >= MAX_LOCATIONS_PER_REFERENCE) return;
  entry.locations.push(location);
}

// 从笔记文档实时派生参考文献列表：扫描内联 paperReference 与润色产生的 noteAnchorBlock，
// 按首次出现排序、按 paperId 去重，并聚合每篇文献的引用位置（页码/块/锚点）。
export function extractNoteReferences(doc: unknown, anchors?: NoteAnchor[]): NoteReferenceEntry[] {
  const entries: NoteReferenceEntry[] = [];
  const entryByPaperId = new Map<string, NoteReferenceEntry>();
  const anchorById = new Map((anchors ?? []).map((anchor) => [anchor.id, anchor]));

  const resolve = (paperId: string, label: string, location: NoteReferenceLocation) => {
    if (!paperId) return;
    let entry = entryByPaperId.get(paperId);
    if (!entry) {
      entry = { paperId, label, locations: [] };
      entryByPaperId.set(paperId, entry);
      entries.push(entry);
    }
    pushLocation(entry, location);
  };

  const walk = (node: TiptapJsonNode | null | undefined) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'paperReference') {
      const attrs = node.attrs ?? {};
      const paperId = normalizePaperId(attrs.paperId);
      resolve(paperId, typeof attrs.label === 'string' && attrs.label.trim() ? attrs.label : paperId, {
        anchorId: typeof attrs.anchorId === 'string' ? attrs.anchorId : null,
        blockId: typeof attrs.blockId === 'string' ? attrs.blockId : null,
        pageIndex: normalizePageIndex(attrs.pageIndex),
        sourceType: typeof attrs.sourceType === 'string' ? attrs.sourceType : null,
      });
    }

    if (node.type === 'noteAnchorBlock') {
      const attrs = node.attrs ?? {};
      const anchorId = typeof attrs.anchorId === 'string' ? attrs.anchorId.trim() : '';
      if (anchorId) {
        const anchor = anchorById.get(anchorId);
        const paperId = normalizePaperId(anchor?.paperId) || paperIdFromNotePolishAnchorId(anchorId);
        const label =
          (typeof attrs.sourceTitle === 'string' && attrs.sourceTitle.trim()) ||
          anchor?.label ||
          paperId;
        // 锚点位置可能未随笔记持久化，统一降级还原，保证参考文献列表里的位置芯片也能跳转。
        const location = resolveNoteAnchorLocation({
          id: anchorId,
          label: anchor?.label ?? (typeof attrs.label === 'string' ? attrs.label : ''),
          blockId: anchor?.blockId ?? null,
          pageIndex: anchor?.pageIndex ?? null,
          pdfLocation: anchor?.pdfLocation ?? undefined,
        });
        resolve(paperId, label, {
          anchorId,
          blockId: location.blockId,
          pageIndex: location.pageIndex,
          sourceType: anchor?.source ?? null,
        });
      }
    }

    for (const child of node.content ?? []) walk(child);
  };

  walk(doc as TiptapJsonNode);
  return entries;
}

function trimTrailingPeriod(value: string): string {
  return value.replace(/[.。]+$/, '');
}

export function formatReferenceListEntryText(entry: NoteReferenceEntry, paper: LiteraturePaper | undefined): string {
  const title = trimTrailingPeriod(paper?.title?.trim() || entry.label || entry.paperId);
  const authors = trimTrailingPeriod((paper?.authors ?? []).map((author) => author.name).filter(Boolean).join(', '));
  const rawYear = paper?.year;
  const year = trimTrailingPeriod(
    typeof rawYear === 'string' ? rawYear.trim() : typeof rawYear === 'number' ? String(rawYear) : '',
  );
  const parts = [title, authors, year].filter(Boolean);
  return `${parts.join('. ')}.`;
}

export function buildReferenceListNodes(entries: NoteReferenceEntry[], papers: LiteraturePaper[]) {
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  return [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: REFERENCE_LIST_HEADING }],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: entries.map((entry) => ({
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: formatReferenceListEntryText(entry, paperById.get(entry.paperId)) }],
        }],
      })),
    },
  ];
}

// 在文末插入（或替换已有的）参考文献列表。已存在的列表通过「参考文献」标题块识别。
function findReferenceListHeading(doc: Editor['state']['doc']): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  doc.forEach((node, offset) => {
    if (found) return;
    if (node.type.name === 'heading' && node.textContent.trim() === REFERENCE_LIST_HEADING) {
      found = { from: offset, to: offset + node.nodeSize };
    }
  });
  return found;
}

export function upsertNoteReferenceList(
  editor: Editor,
  entries: NoteReferenceEntry[],
  papers: LiteraturePaper[],
): boolean {
  if (entries.length === 0) return false;

  const doc = editor.state.doc;
  const existingHeading = findReferenceListHeading(doc);

  if (existingHeading) {
    const from = existingHeading.from;
    let to = existingHeading.to;
    // 标题之后紧邻的有序/无序列表视为旧列表本体，一并替换。
    let cursor = to;
    while (cursor < doc.content.size) {
      const next = doc.nodeAt(cursor);
      if (!next) break;
      if (next.type.name === 'orderedList' || next.type.name === 'bulletList') {
        to = cursor + next.nodeSize;
        cursor = to;
      } else {
        break;
      }
    }
    editor.chain().deleteRange({ from, to }).run();
  }

  editor.chain().focus('end').insertContent(buildReferenceListNodes(entries, papers)).run();
  return true;
}
