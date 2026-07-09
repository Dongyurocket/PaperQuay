import type { JSONContent } from '@tiptap/core';
import type { Note, NoteAnchor, NoteType } from '../../types/notes';
import type { SelectedExcerpt } from '../../types/reader';
import { collectText, noteContentToTiptap } from './notesTiptap';

export const NOTE_COLORS = [
  { id: 'yellow', label: 'Important', value: '#fef3c7' },
  { id: 'green', label: 'Method', value: '#d1fae5' },
  { id: 'blue', label: 'Concept', value: '#dbeafe' },
  { id: 'pink', label: 'Question', value: '#fce7f3' },
  { id: 'purple', label: 'Idea', value: '#e9d5ff' },
  { id: 'gray', label: 'Todo', value: '#f3f4f6' },
];

export function formatNoteTime(timestamp: number, locale: 'zh-CN' | 'en-US') {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}

export function normalizeTagInput(value: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const rawTag of value.replace(/\uFF0C/g, ',').split(/[,\s#]+/)) {
    const tag = rawTag.trim();
    const key = tag.toLowerCase();

    if (!tag || seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
  }

  return output;
}

export function noteTypeLabel(type: NoteType) {
  if (type === 'highlight') return 'Highlight';
  if (type === 'area') return 'Area';
  if (type === 'ai-chat') return 'AI';
  return 'Note';
}

export function buildQuoteMarkdown(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

export function titleFromText(text: string, fallback = 'Untitled Note') {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 42 ? `${normalized.slice(0, 42)}...` : normalized;
}

export function createSelectionNoteDraft(
  paperId: string,
  selectedExcerpt: SelectedExcerpt,
  sourceTitle?: string,
) {
  const type: NoteType =
    selectedExcerpt.source === 'pdf' || selectedExcerpt.blockId ? 'highlight' : 'standalone';
  const excerpt = selectedExcerpt.text.trim();
  const anchor = createNoteAnchorFromSelection(selectedExcerpt, paperId, sourceTitle);
  const contentJson = appendAnchorToNoteContent(null, anchor);
  const contentText = collectText(contentJson);

  return {
    paperId,
    type,
    title: titleFromText(excerpt),
    content: contentText || buildQuoteMarkdown(excerpt),
    contentJson,
    contentText,
    excerpt,
    pdfLocation: selectedExcerpt.pdfLocation ?? null,
    anchors: [anchor],
    tags: [],
    color: NOTE_COLORS[0].value,
  };
}

export function createNoteAnchorFromSelection(
  selectedExcerpt: SelectedExcerpt,
  paperId?: string,
  sourceTitle?: string,
): NoteAnchor {
  const now = Date.now();
  const excerpt = selectedExcerpt.text.trim();
  const pageNumber = selectedExcerpt.pdfLocation?.pageNumber;
  const excerptTitle = titleFromText(excerpt, '引用');

  return {
    id: `anchor-${now}-${Math.random().toString(16).slice(2, 8)}`,
    paperId: paperId?.trim() || undefined,
    label: pageNumber ? `P${pageNumber}` : excerptTitle,
    sourceTitle: sourceTitle?.replace(/\s+/g, ' ').trim() || undefined,
    excerpt,
    source: selectedExcerpt.source,
    blockId: selectedExcerpt.blockId ?? null,
    pageIndex:
      typeof selectedExcerpt.pdfLocation?.pageNumber === 'number'
        ? Math.max(0, selectedExcerpt.pdfLocation.pageNumber - 1)
        : null,
    pdfLocation: selectedExcerpt.pdfLocation,
    createdAt: now,
  };
}

export function noteAnchorBlockFromAnchor(anchor: NoteAnchor): JSONContent {
  const label =
    anchor.pdfLocation?.pageNumber
      ? `P${anchor.pdfLocation.pageNumber}`
      : typeof anchor.pageIndex === 'number'
        ? `P${anchor.pageIndex + 1}`
        : '定位';
  const sourceTitle = anchor.sourceTitle?.replace(/\s+/g, ' ').trim() || '文献';

  return {
    type: 'noteAnchorBlock',
    attrs: {
      anchorId: anchor.id,
      label,
      sourceLabel: anchor.source === 'blocks' ? '正文摘录' : '摘录',
      sourceTitle,
      excerpt: anchor.excerpt,
    },
  };
}

export function appendAnchorToNoteContent(note: Note | null, anchor: NoteAnchor): JSONContent {
  const base = noteContentToTiptap(note);
  const content = [...(base.content ?? [])];
  const hasOnlyEmptyParagraph =
    content.length === 1 &&
    content[0]?.type === 'paragraph' &&
    (!content[0].content || content[0].content.length === 0);
  const nextContent = hasOnlyEmptyParagraph ? [] : content;

  return {
    type: 'doc',
    content: [
      ...nextContent,
      noteAnchorBlockFromAnchor(anchor),
    ],
  };
}

export function noteMatchesFilter(note: Note, filter: string) {
  if (filter === 'current') return true;
  if (filter === 'highlight') return note.type === 'highlight' || note.type === 'area';
  if (filter === 'ai-chat') return note.type === 'ai-chat';
  if (filter === 'standalone') return note.type === 'standalone';
  return true;
}
