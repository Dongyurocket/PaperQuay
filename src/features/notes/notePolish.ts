import type { JSONContent } from '@tiptap/core';
import { paragraphNode } from './noteEditorUtils.ts';

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
