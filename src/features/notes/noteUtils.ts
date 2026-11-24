import type { JSONContent } from '@tiptap/core';
import type { Note, NoteAnchor, NoteFolder, NoteType } from '../../types/notes';
import type { SelectedExcerpt } from '../../types/reader';
import { pickDocumentLocaleText } from '../../i18n/documentLocale.ts';
import { collectText, noteContentToTiptap } from './notesTiptap.ts';

/** notes_list 单次最多返回的条数（主进程侧同样的上限）。 */
export const NOTE_LIST_PAGE_SIZE = 5000;

export interface NoteFolderCounts {
  /** 未分类数量：folderId 为空或指向已删除/未知 folder 的笔记都算未分类。 */
  uncategorizedCount: number;
  /** 每个 folder 的后代计数（包含直接笔记与所有子 folder 的笔记）。 */
  folderCounts: Map<string, number>;
}

/**
 * 一次遍历计算 folder 树计数。
 *
 * 旧实现为每个 folder 调一次 filterNotesByFolder（O(folders × notes)），5000 条
 * 笔记 + 多级 folder 时会明显卡顿。这里先按笔记的直接 folder 归并（未知 folder
 * 归入未分类，与 noteMatchesFolder 的归一化一致），再沿父子边把子计数累加到父级，
 * 复杂度 O(notes + folders)。
 *
 * folder 环（只可能来自历史脏数据）用 visiting 集合截断，不会死循环。
 */
export function countNotesInFolderTree(
  notes: Array<Pick<Note, 'folderId'>>,
  folders: Array<Pick<NoteFolder, 'id' | 'parentId'>>,
): NoteFolderCounts {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const directCounts = new Map<string, number>();
  const childrenByParent = new Map<string | null, string[]>();
  for (const folder of folders) {
    directCounts.set(folder.id, 0);
    const siblings = childrenByParent.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    childrenByParent.set(folder.parentId, siblings);
  }

  let uncategorizedCount = 0;
  for (const note of notes) {
    const folderId = note.folderId && folderIds.has(note.folderId) ? note.folderId : null;
    if (!folderId) {
      uncategorizedCount += 1;
      continue;
    }
    directCounts.set(folderId, (directCounts.get(folderId) ?? 0) + 1);
  }

  const folderCounts = new Map<string, number>();
  const visiting = new Set<string>();
  const resolveFolderCount = (folderId: string): number => {
    const cached = folderCounts.get(folderId);
    if (cached !== undefined) return cached;
    if (visiting.has(folderId)) return 0;
    visiting.add(folderId);
    let count = directCounts.get(folderId) ?? 0;
    for (const childId of childrenByParent.get(folderId) ?? []) {
      count += resolveFolderCount(childId);
    }
    visiting.delete(folderId);
    folderCounts.set(folderId, count);
    return count;
  };
  for (const folder of folders) {
    resolveFolderCount(folder.id);
  }

  return { uncategorizedCount, folderCounts };
}

export interface NotePageRequest {
  offset: number;
  limit: number;
}

/**
 * 分页拉取全部笔记：notes_list 每次最多 5000 条且没有无限列表语义，这里按
 * offset 逐页请求，直到返回短页（或空页）。分页期间若有并发写入导致行移位，
 * 以 id 去重；整页都没有新 id 时视为服务端不支持 offset 并立即结束，避免死循环。
 */
export async function collectPagedNotes(
  fetchPage: (request: NotePageRequest) => Promise<Note[]>,
  options: {
    pageSize?: number;
    /** 每页到达后回调；accumulated 是当前累计结果的快照（可安全放进 state）。 */
    onPage?: (page: Note[], accumulated: Note[]) => void;
  } = {},
): Promise<Note[]> {
  const pageSize = Math.max(1, Math.trunc(options.pageSize ?? NOTE_LIST_PAGE_SIZE));
  const notes: Note[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (;;) {
    const page = await fetchPage({ offset, limit: pageSize });
    let added = 0;
    for (const note of page) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      notes.push(note);
      added += 1;
    }
    // 传快照而不是内部数组：调用方（zustand store）把它放进 state 后，
    // 后续页不能原地改写已提交的引用，否则 useMemo/selector 看不到更新。
    options.onPage?.(page, notes.slice());
    if (page.length < pageSize) return notes;
    if (added === 0) return notes;
    offset += page.length;
  }
}

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

export function titleFromText(text: string, fallback = '') {
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
      aiEnhanced: anchor.aiEnhanced === true,
    },
  };
}

export function isAiEnhancedAnchor(anchor: Pick<NoteAnchor, 'aiEnhanced'> | null | undefined): boolean {
  return anchor?.aiEnhanced === true;
}

export function noteAnchorProvenanceLabel(
  anchor: Pick<NoteAnchor, 'aiEnhanced'> | null | undefined,
  l?: <T>(zh: T, en: T) => T,
): string {
  if (!isAiEnhancedAnchor(anchor)) return '';
  if (l) return l('AI 重识别', 'AI re-recognition');
  return pickDocumentLocaleText('AI 重识别', 'AI re-recognition');
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
  if (['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'].includes(filter)) {
    return note.pageKind === filter;
  }
  return true;
}
