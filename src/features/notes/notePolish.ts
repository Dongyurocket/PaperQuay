import type { JSONContent } from '@tiptap/core';
import type { NoteAnchor, NotePolishCitation, NotePolishScope } from '../../types/notes';
import { paragraphNode } from './noteEditorUtils.ts';

export function normalizeNotePolishScope(value: unknown): NotePolishScope {
  return value === 'linked-papers' || value === 'library' ? value : 'none';
}

export function buildNotePolishAnchor(citation: NotePolishCitation): NoteAnchor {
  const pageLabel = typeof citation.pageIndex === 'number' ? `P${citation.pageIndex + 1}` : '引用';

  return {
    id: `note-polish:${citation.paperId}:${citation.chunkId}`,
    paperId: citation.paperId,
    label: pageLabel,
    sourceTitle: citation.paperTitle,
    excerpt: citation.excerpt,
    source: 'blocks',
    blockId: citation.blockId,
    pageIndex: citation.pageIndex,
    createdAt: Date.now(),
  };
}

function textNode(text: string): JSONContent {
  return { type: 'text', text };
}

/** Converts the model's limited Markdown response into editor nodes without executing HTML. */
export function notePolishTextToNodes(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let listItems: string[] = [];
  let ordered = false;

  const flushList = () => {
    if (listItems.length === 0) return;
    nodes.push({
      type: ordered ? 'orderedList' : 'bulletList',
      content: listItems.map((item) => ({ type: 'listItem', content: [paragraphNode(item)] })),
    });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const orderedItem = /^\d+[.)]\s+(.+)$/.exec(line);

    if (!line) {
      flushList();
      continue;
    }

    if (heading) {
      flushList();
      nodes.push({
        type: 'heading',
        attrs: { level: heading[1].length },
        content: [textNode(heading[2])],
      });
      continue;
    }

    if (bullet || orderedItem) {
      const nextOrdered = Boolean(orderedItem);
      if (listItems.length > 0 && ordered !== nextOrdered) flushList();
      ordered = nextOrdered;
      listItems.push((bullet ?? orderedItem)![1]);
      continue;
    }

    flushList();
    nodes.push(paragraphNode(line));
  }

  flushList();
  return nodes.length > 0 ? nodes : [paragraphNode(text.trim())];
}

function notePolishAnchorBlock(anchor: NoteAnchor): JSONContent {
  return {
    type: 'noteAnchorBlock',
    attrs: {
      anchorId: anchor.id,
      label: anchor.label,
      sourceLabel: '正文摘录',
      sourceTitle: anchor.sourceTitle || '文献',
      excerpt: anchor.excerpt,
    },
  };
}

export function buildNotePolishNodes(text: string, citations: NotePolishCitation[]): {
  anchors: NoteAnchor[];
  content: JSONContent[];
} {
  const anchors = citations.map(buildNotePolishAnchor);
  const content = notePolishTextToNodes(text);

  for (const anchor of anchors) {
    content.push(notePolishAnchorBlock(anchor), paragraphNode());
  }

  return { anchors, content };
}
