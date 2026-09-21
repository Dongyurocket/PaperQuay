import type { Range } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { Suggestion } from '@tiptap/suggestion';
import { createSuggestionMenu, type NoteSuggestionItem } from './suggestionMenu';

export interface PaperReferenceLocation {
  anchorId?: string | null;
  blockId?: string | null;
  pageIndex?: number | null;
  sourceType?: string | null;
}

export interface PaperReferenceOptions {
  HTMLAttributes: Record<string, unknown>;
  items: (query: string) => NoteSuggestionItem[];
  onClick: (paperId: string, location?: PaperReferenceLocation) => void;
}

export const PaperReference = Node.create<PaperReferenceOptions>({
  name: 'paperReference',
  priority: 100,
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      items: () => [],
      onClick: () => undefined,
    };
  },

  addAttributes() {
    return {
      paperId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-paper-id'),
        renderHTML: (attributes) => attributes.paperId ? { 'data-paper-id': attributes.paperId } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) => attributes.label ? { 'data-label': attributes.label } : {},
      },
      // 可选：引用指向文献中的具体位置（来自润色引用锚点等），用于点击时跳转到具体页/块。
      anchorId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-anchor-id'),
        renderHTML: (attributes) => attributes.anchorId ? { 'data-anchor-id': attributes.anchorId } : {},
      },
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => attributes.blockId ? { 'data-block-id': attributes.blockId } : {},
      },
      pageIndex: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-page-index');
          const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : null;
        },
        renderHTML: (attributes) => (attributes.pageIndex === null || attributes.pageIndex === undefined)
          ? {}
          : { 'data-page-index': String(attributes.pageIndex) },
      },
      sourceType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-type'),
        renderHTML: (attributes) => attributes.sourceType ? { 'data-source-type': attributes.sourceType } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const paperId = node.attrs.paperId || '';
    const label = node.attrs.label || paperId;

    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name, 'data-paper-id': paperId, 'data-label': label },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `@${label}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.paperId || node.attrs.label || ''}`;
  },

  addProseMirrorPlugins() {
    const suggestion: SuggestionOptions<NoteSuggestionItem, NoteSuggestionItem> = {
      editor: this.editor,
      char: '@',
      pluginKey: new PluginKey('paperReferenceSuggestion'),
      allowSpaces: false,
      allowedPrefixes: null,
      items: ({ query }) => this.options.items(query),
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range as Range, [
            {
              type: this.name,
              attrs: {
                paperId: props.id,
                label: props.label,
              },
            },
            { type: 'text', text: ' ' },
          ])
          .run();
      },
      render: createSuggestionMenu,
    };

    return [
      Suggestion(suggestion),
      new Plugin({
        key: new PluginKey('paperReferenceClick'),
        props: {
          handleClick: (_view, _pos, event) => {
            const target = event.target as HTMLElement | null;
            const element = target?.closest?.('span[data-type="paperReference"]') as HTMLElement | null;
            const paperId = element?.getAttribute('data-paper-id');

            if (!paperId || !element) return false;
            const pageIndexAttr = element.getAttribute('data-page-index');
            const pageIndex = pageIndexAttr === null ? null : Number.parseInt(pageIndexAttr, 10);
            const location: PaperReferenceLocation = {
              anchorId: element.getAttribute('data-anchor-id'),
              blockId: element.getAttribute('data-block-id'),
              pageIndex: Number.isFinite(pageIndex) ? pageIndex : null,
              sourceType: element.getAttribute('data-source-type'),
            };
            const hasLocation = Boolean(location.anchorId || location.blockId || location.pageIndex !== null);
            this.options.onClick(paperId, hasLocation ? location : undefined);
            return true;
          },
        },
      }),
    ];
  },
});
