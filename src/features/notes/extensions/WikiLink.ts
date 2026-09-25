import type { Range } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { SuggestionOptions, Trigger } from '@tiptap/suggestion';
import { Suggestion } from '@tiptap/suggestion';
import { createSuggestionMenu, type NoteSuggestionItem } from './suggestionMenu';

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  items: (query: string) => NoteSuggestionItem[];
  onClick: (noteId: string, label: string) => void;
}

function findWikiLinkSuggestionMatch(config: Trigger) {
  const text = config.$position.nodeBefore?.isText && config.$position.nodeBefore.text;
  if (!text) return null;

  const textFrom = config.$position.pos - text.length;
  const match = Array.from(text.matchAll(/\[\[([^\]\n]{0,160})$/g)).pop();
  if (!match || match.index === undefined) return null;

  const from = textFrom + match.index;
  const to = config.$position.pos;

  if (from < config.$position.pos && to >= config.$position.pos) {
    return {
      range: { from, to },
      query: match[1] ?? '',
      text: match[0],
    };
  }

  return null;
}

function normalizeLookupValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

function findExactWikiLinkItem(items: NoteSuggestionItem[], label: string) {
  const normalized = normalizeLookupValue(label);
  if (!normalized) return null;

  return (
    items.find((item) => normalizeLookupValue(item.label) === normalized) ??
    items.find((item) => normalizeLookupValue(item.id) === normalized) ??
    null
  );
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikiLink',
  priority: 101,
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
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => attributes.id ? { 'data-id': attributes.id } : {},
      },
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note-id'),
        renderHTML: (attributes) => attributes.noteId ? { 'data-note-id': attributes.noteId } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) => attributes.label ? { 'data-label': attributes.label } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const current = node.attrs.noteId
      ? this.options.items('').find((item) => item.id === node.attrs.noteId)
      : null;
    const label = current?.label || node.attrs.label || node.attrs.id || '';
    return [
      'span',
      mergeAttributes(
        { 'data-type': this.name, 'data-note-id': node.attrs.noteId || node.attrs.id, 'data-note-label': label },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `[[${label}]]`,
    ];
  },

  renderText({ node }) {
    const current = node.attrs.noteId
      ? this.options.items('').find((item) => item.id === node.attrs.noteId)
      : null;
    return `[[${current?.label || node.attrs.label || node.attrs.id || ''}]]`;
  },

  addProseMirrorPlugins() {
    const suggestion: SuggestionOptions<NoteSuggestionItem, NoteSuggestionItem> = {
      editor: this.editor,
      char: '[[',
      pluginKey: new PluginKey('wikiLinkSuggestion'),
      allowSpaces: true,
      allowedPrefixes: null,
      findSuggestionMatch: findWikiLinkSuggestionMatch,
      items: ({ query }) => this.options.items(query),
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range as Range, [
            {
              type: this.name,
              attrs: {
                id: props.id,
                noteId: props.id,
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
        key: new PluginKey('wikiLinkInputAndClick'),
        props: {
          handleTextInput: (view, from, to, text) => {
            if (text !== ']') return false;

            const $from = view.state.doc.resolve(from);
            const textBefore = $from.nodeBefore?.isText ? $from.nodeBefore.text : '';
            const match = `${textBefore}${text}`.match(/\[\[([^\]\n]{1,160})\]\]$/);
            const label = match?.[1]?.trim();
            if (!match || !label) return false;

            const item = findExactWikiLinkItem(this.options.items(label), label);
            if (!item) return false;

            const replaceFrom = from - (match[0].length - text.length);
            this.editor
              .chain()
              .focus()
              .insertContentAt({ from: replaceFrom, to }, [
                {
                  type: this.name,
                  attrs: {
                    id: item.id,
                    noteId: item.id,
                    label: item.label,
                  },
                },
                { type: 'text', text: ' ' },
              ])
              .run();

            return true;
          },
          handleClick: (_view, _pos, event) => {
            const target = event.target as HTMLElement | null;
            const element = target?.closest?.('span[data-type="wikiLink"]') as HTMLElement | null;
            const noteId = element?.getAttribute('data-note-id') || element?.getAttribute('data-id');
            const label = element?.getAttribute('data-note-label') || element?.getAttribute('data-label') || '';

            if (!noteId) return false;
            this.options.onClick(noteId, label);
            return true;
          },
        },
      }),
    ];
  },
});
