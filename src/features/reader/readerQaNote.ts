import type { JSONContent } from '@tiptap/core';
import type { NoteAnchor } from '../../types/notes';
import type { DocumentChatCitation } from '../../types/reader';
import { parseMarkdownToTiptap } from '../../shared/markdownToTiptap.cjs';
import { noteAnchorBlockFromAnchor } from '../notes/noteUtils.ts';

export function buildQaNoteContent(input: {
  content: string;
  citations: DocumentChatCitation[];
  paperId: string;
  paperTitle: string;
  messageId: string;
  createdAt: number;
}): { content: string; contentJson: JSONContent; anchors: NoteAnchor[] } {
  const anchors: NoteAnchor[] = [];
  const unlocated: string[] = [];
  for (const [index, citation] of input.citations.entries()) {
    const pageIndex = Number.isInteger(citation.pageIndex) && Number(citation.pageIndex) >= 0
      ? citation.pageIndex : null;
    const blockId = typeof citation.blockId === 'string' && citation.blockId.trim() ? citation.blockId.trim() : null;
    if (pageIndex === null && !blockId) {
      unlocated.push(`${citation.label}: ${citation.previewText ?? ''}`.trim());
      continue;
    }
    anchors.push({
      id: `qa:${input.messageId}:${index}`,
      paperId: citation.paperId?.trim() || input.paperId,
      label: pageIndex === null ? citation.label : `P${pageIndex + 1}`,
      sourceTitle: citation.paperTitle?.trim() || input.paperTitle,
      excerpt: citation.previewText ?? '',
      source: citation.sourceType === 'pdf-text' ? 'pdf' : 'blocks',
      pageIndex,
      blockId,
      createdAt: input.createdAt,
    });
  }
  const content = unlocated.length
    ? `${input.content}\n\n## Sources without a location\n\n${unlocated.map((value) => `- ${value}`).join('\n')}`
    : input.content;
  const document = parseMarkdownToTiptap(content) as JSONContent;
  return { content, anchors, contentJson: { ...document, content: [...(document.content ?? []), ...anchors.map(noteAnchorBlockFromAnchor)] } };
}
