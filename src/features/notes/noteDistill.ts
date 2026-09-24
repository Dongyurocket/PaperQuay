import type { JSONContent } from '@tiptap/core';
import type { CreateNoteRequest, Note, NoteAnchor, UpdateNoteRequest } from '../../types/notes';
import type { SelectedExcerpt } from '../../types/reader';
import { notePolishTextToNodes } from './notePolish.ts';
import { collectText } from './notesTiptap.ts';
import { createNoteAnchorFromSelection, noteAnchorBlockFromAnchor, titleFromText } from './noteUtils.ts';

const MY_THOUGHTS_HEADING = '💭 我的想法：';

/**
 * 提炼式摘录卡（痛点 8）：锚点块在前（原文快照保真、不可手改），AI 提炼正文在后（可编辑），
 * 尾部固定「我的想法」区——提炼是忠实浓缩，想法是独立观点，二者结构分离。
 * 红线：提炼可以自由，证据必须保真——anchors[] 与锚点块携带原文 excerpt 与定位信息。
 */
export function buildDistilledExcerptNoteCreateRequest({
  paperId,
  selectedExcerpt,
  sourceTitle,
  distilledTitle,
  distilledText,
}: {
  paperId: string;
  selectedExcerpt: SelectedExcerpt;
  sourceTitle?: string;
  distilledTitle: string;
  distilledText: string;
}): CreateNoteRequest {
  const anchor = createNoteAnchorFromSelection(selectedExcerpt, paperId, sourceTitle);
  const contentJson: JSONContent = {
    type: 'doc',
    content: [
      noteAnchorBlockFromAnchor(anchor),
      ...notePolishTextToNodes(distilledText),
      { type: 'paragraph', content: [{ type: 'text', text: MY_THOUGHTS_HEADING }] },
    ],
  };
  const contentText = collectText(contentJson);

  return {
    paperId,
    type: selectedExcerpt.source === 'pdf' || selectedExcerpt.blockId ? 'highlight' : 'standalone',
    title: distilledTitle.trim() || titleFromText(anchor.excerpt),
    content: contentText,
    contentJson,
    contentText,
    excerpt: anchor.excerpt,
    pdfLocation: selectedExcerpt.pdfLocation ?? null,
    anchors: [anchor],
    tags: ['摘录卡'],
    color: '#dbeafe',
  };
}

/** 判断一条笔记是否可作为"追加提炼"的目标摘录卡（已有来源锚点）。 */
export function isExcerptCard(note: Note | null | undefined): boolean {
  return Boolean(note && Array.isArray(note.anchors) && note.anchors.length > 0);
}

/**
 * 多段累加（痛点 8：跨页累加）：把新一段选区的提炼正文 + 来源锚点追加到已有摘录卡，
 * 一条提炼挂多个来源锚点。已有锚点与原文快照原样保留，只增不改。
 */
export function buildDistilledExcerptAppendPatch({
  note,
  paperId,
  selectedExcerpt,
  sourceTitle,
  distilledText,
}: {
  note: Note;
  paperId: string;
  selectedExcerpt: SelectedExcerpt;
  sourceTitle?: string;
  distilledText: string;
}): { patch: UpdateNoteRequest; anchor: NoteAnchor } {
  const anchor = createNoteAnchorFromSelection(selectedExcerpt, paperId, sourceTitle);
  const existing = note.contentJson && typeof note.contentJson === 'object'
    ? (note.contentJson as JSONContent)
    : { type: 'doc', content: [] };
  const content = [...(existing.content ?? [])];
  // 「我的想法」区保持在末尾：新提炼内容插入到它之前（若存在）。
  const thoughtsIndex = content.findIndex(
    (node) => node?.type === 'paragraph'
      && Array.isArray(node.content)
      && node.content.some((child) => child?.type === 'text' && String(child.text ?? '').startsWith(MY_THOUGHTS_HEADING)),
  );
  const inserted: JSONContent[] = [
    noteAnchorBlockFromAnchor(anchor),
    ...notePolishTextToNodes(distilledText),
  ];
  if (thoughtsIndex >= 0) {
    content.splice(thoughtsIndex, 0, ...inserted);
  } else {
    content.push(...inserted);
  }
  const contentJson: JSONContent = { type: 'doc', content };
  const contentText = collectText(contentJson);

  return {
    anchor,
    patch: {
      content: contentText,
      contentJson,
      contentText,
      anchors: [...(note.anchors ?? []), anchor],
    },
  };
}

