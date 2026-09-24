import type { Range } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { Suggestion } from '@tiptap/suggestion';
import type { LiteraturePaper } from '../../../types/library';
import { formatInlineApaCitation, type NoteCitationStyle } from '../bibliography.ts';
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
  // 学术化引用呈现（痛点 7）：返回当前引用样式；gbt7714/ieee 渲染为 [n]，apa7 渲染为
  // (第一作者 et al., 年)。编号由文档实时派生（decoration），不写入文档数据，因此
  // 在中间插入/删除引用时序号自动重排，不污染 diff 与撤销栈。
  citationStyle: () => NoteCitationStyle;
  papers: () => LiteraturePaper[];
}

// 扫描文档，为每个 paperReference 节点生成引用文本 decoration。同一 paperId 多处引用共享
// 同一编号（顺序编码制惯例），位置信息只作跳转数据携带在节点 attrs 上，不进入引用文本。
function buildCitationDecorations(doc: Parameters<typeof DecorationSet.create>[0], options: PaperReferenceOptions): DecorationSet {
  const style = options.citationStyle();
  const decorations: Decoration[] = [];
  const numberByPaperId = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paperReference') return true;
    const paperId = typeof node.attrs.paperId === 'string' ? node.attrs.paperId : '';
    let citeText: string;
    if (style === 'apa7') {
      const paper = options.papers().find((item) => item.id === paperId);
      citeText = formatInlineApaCitation(paper, typeof node.attrs.label === 'string' ? node.attrs.label : '');
    } else {
      let num = numberByPaperId.get(paperId);
      if (!num) {
        num = numberByPaperId.size + 1;
        numberByPaperId.set(paperId, num);
      }
      citeText = `[${num}]`;
    }
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {
      class: 'pq-paper-ref--citation',
      'data-cite-text': citeText,
    }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
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
      citationStyle: () => 'gbt7714' as NoteCitationStyle,
      papers: () => [],
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
      // label 包一层 span：学术引用模式下由 CSS 隐藏，改用 ::after 呈现 decoration
      // 注入的 data-cite-text（[n] 或 (作者, 年)），文档数据保持不变。
      ['span', { class: 'pq-paper-ref-label' }, `@${label}`],
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
      // 引用编号/著者-出版年角标：decoration 派生自文档，写操作或样式切换时重建。
      new Plugin({
        key: new PluginKey('paperReferenceCitation'),
        state: {
          init: (_config, state) => buildCitationDecorations(state.doc, this.options),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta('noteCitationStyleChanged')
              ? buildCitationDecorations(tr.doc, this.options)
              : old,
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
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
