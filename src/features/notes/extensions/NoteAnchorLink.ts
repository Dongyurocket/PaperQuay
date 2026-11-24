import { mergeAttributes, Node } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { pickDocumentLocaleText } from '../../../i18n/uiLanguage';

/** 非 React 扩展的默认锚点标签：跟随 <html lang>，中文兜底「定位」。 */
function defaultAnchorLabel() {
  return pickDocumentLocaleText('定位', 'Locate');
}

export interface NoteAnchorLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  onClick: ((anchorId: string) => void) | null;
}

export const NoteAnchorLink = Node.create<NoteAnchorLinkOptions>({
  name: 'noteAnchorLink',
  priority: 102,
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onClick: null,
    };
  },

  addAttributes() {
    return {
      anchorId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note-anchor-id'),
        renderHTML: (attributes) =>
          attributes.anchorId ? { 'data-note-anchor-id': attributes.anchorId } : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note-anchor-label'),
        renderHTML: (attributes) =>
          attributes.label ? { 'data-note-anchor-label': attributes.label } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-type="${this.name}"]` }];
  },

  renderHTML({ node, HTMLAttributes }): DOMOutputSpec {
    const label = node.attrs.label || defaultAnchorLabel();

    return [
      'span',
      mergeAttributes(
        {
          'data-type': this.name,
          'data-note-anchor-id': node.attrs.anchorId,
          'data-note-anchor-label': label,
          title: pickDocumentLocaleText('点击定位到原文', 'Jump to the source text'),
        },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      `↗ ${label}`,
    ];
  },

  renderText({ node }) {
    return `Reference · ${node.attrs.label || defaultAnchorLabel()}`;
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('noteAnchorLinkClick'),
        props: {
          handleClick: (_view, _pos, event) => {
            const target = event.target as HTMLElement | null;
            const element = target?.closest?.('span[data-type="noteAnchorLink"]') as HTMLElement | null;
            const anchorId = element?.getAttribute('data-note-anchor-id');

            if (!anchorId || !this.options.onClick) return false;
            event.preventDefault();
            this.options.onClick(anchorId);
            return true;
          },
        },
      }),
    ];
  },
});
