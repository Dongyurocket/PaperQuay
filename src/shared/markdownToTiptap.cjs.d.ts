import type { JSONContent } from '@tiptap/core';

export interface MarkdownParseOptions {
  anchors?: Array<{ id: string }>;
  papers?: Array<{ id: string; title?: string; doi?: string }>;
  notes?: Array<{ id: string; title: string }>;
}

export function parseMarkdownToTiptap(markdown: string, options?: MarkdownParseOptions): JSONContent;
