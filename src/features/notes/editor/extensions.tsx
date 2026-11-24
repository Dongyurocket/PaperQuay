import { mergeAttributes, Node as TiptapNode } from '@tiptap/core';
import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import Placeholder from '@tiptap/extension-placeholder';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { all, createLowlight } from 'lowlight';
import type { MutableRefObject } from 'react';
import type { LiteraturePaper } from '../../../types/library';
import type { Note, NoteAnchor, NotePageKind, NoteTagSummary } from '../../../types/notes';
import type { UiLanguage } from '../../../types/reader';
import { pickDocumentLocaleText, useLocaleText } from '../../../i18n/uiLanguage';
import { cn } from '../../../utils/cn';
import { HashTag } from '../extensions/HashTag';
import { NoteAnchorLink } from '../extensions/NoteAnchorLink';
import { PaperReference, type PaperReferenceLocation } from '../extensions/PaperReference';
import { SlashCommand } from '../extensions/SlashCommand';
import { WikiLink } from '../extensions/WikiLink';
import type { NoteSuggestionItem } from '../extensions/suggestionMenu';
import type { NoteCitationStyle } from '../bibliography';
import { NoteMathText } from '../NoteMathText';
import { noteAnchorDisplayText } from '../notesDisplay';
import {
  normalizeAnchorPageLabel,
  normalizeAnchorSourceTitle,
  normalizeSuggestionQuery,
  type NoteSlashCommandItem,
} from '../noteEditorUtils';
import {
  extractNoteReferences,
  referenceListHeadingForLocale,
  upsertNoteReferenceList,
} from '../noteReferences';
import { isAiEnhancedAnchor, noteAnchorProvenanceLabel } from '../noteUtils';
import { runSlashCommand } from './slashMenu';
import { EditableTable } from './tableCell';

const lowlight = createLowlight(all);

function NoteComponentBlockView({ node, selected, updateAttributes }: NodeViewProps) {
  const l = useLocaleText();
  const title = typeof node.attrs.title === 'string' && node.attrs.title.trim()
    ? node.attrs.title
    : 'Component';

  return (
    <NodeViewWrapper
      as="section"
      className={cn('pq-note-component-block', selected ? 'is-selected' : '')}
    >
      <div className="pq-note-component-header" contentEditable={false}>
        <div className="pq-note-component-kicker">{l('组件', 'Component')}</div>
        <input
          value={title}
          onChange={(event) => updateAttributes({ title: event.target.value })}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="pq-note-component-title-input"
          aria-label={l('组件标题', 'Component title')}
        />
      </div>
      <NodeViewContent className="pq-note-component-content" />
    </NodeViewWrapper>
  );
}

const NoteComponentBlock = TiptapNode.create({
  name: 'noteComponentBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      title: {
        default: 'Component',
      },
      variant: {
        default: 'note',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-type="note-component-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, { 'data-type': 'note-component-block' }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteComponentBlockView);
  },
});

interface NoteAnchorBlockOptions {
  HTMLAttributes: Record<string, unknown>;
  onClick: ((anchorId: string) => void) | null;
}

function NoteAnchorBlockView({ node, selected, extension }: NodeViewProps) {
  const l = useLocaleText();
  const anchorId = String(node.attrs.anchorId || '');
  const label = normalizeAnchorPageLabel(String(node.attrs.label || '定位'));
  const labelText = noteAnchorDisplayText(label, l);
  const sourceLabel = String(node.attrs.sourceLabel || '摘录');
  const sourceTitle = noteAnchorDisplayText(
    normalizeAnchorSourceTitle(String(node.attrs.sourceTitle || ''), sourceLabel),
    l,
  );
  const excerpt = String(node.attrs.excerpt || '');
  const aiEnhanced = isAiEnhancedAnchor({ aiEnhanced: node.attrs.aiEnhanced === true });
  const provenanceLabel = noteAnchorProvenanceLabel({ aiEnhanced }, l);
  const onClick = (extension.options as NoteAnchorBlockOptions).onClick;
  const jumpTitle = l('点击定位到原文', 'Jump to the source text');

  return (
    <NodeViewWrapper
      as="figure"
      className={cn('pq-note-anchor-card', selected ? 'is-selected' : '')}
      data-type="note-anchor-block"
      spellCheck={false}
    >
      <blockquote className="pq-note-anchor-card-quote" contentEditable={false}>
        <span aria-hidden="true">“</span>
        {excerpt ? <NoteMathText value={excerpt} /> : l('无摘录文本', 'No excerpt text')}
        <span aria-hidden="true">”</span>
      </blockquote>
      <figcaption className="pq-note-anchor-card-meta" contentEditable={false}>
        <span className="pq-note-anchor-card-source" title={sourceTitle}>{sourceTitle}</span>
        {provenanceLabel ? (
          <span
            className="pq-note-anchor-card-provenance"
            title={l('原文快照经用户确认的 AI 重识别', 'AI re-recognition confirmed by the user')}
          >
            {provenanceLabel}
          </span>
        ) : null}
        <button
          type="button"
          className="pq-note-anchor-card-page"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (anchorId) onClick?.(anchorId);
          }}
          title={jumpTitle}
          aria-label={`${jumpTitle} ${labelText}`}
        >
          {labelText}
        </button>
      </figcaption>
    </NodeViewWrapper>
  );
}

const NoteAnchorBlock = TiptapNode.create<NoteAnchorBlockOptions>({
  name: 'noteAnchorBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

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
        default: '定位',
        parseHTML: (element) => element.getAttribute('data-note-anchor-label') || '定位',
        renderHTML: (attributes) =>
          attributes.label ? { 'data-note-anchor-label': attributes.label } : {},
      },
      sourceLabel: {
        default: '摘录',
        parseHTML: (element) => element.getAttribute('data-note-anchor-source') || '摘录',
        renderHTML: (attributes) =>
          attributes.sourceLabel ? { 'data-note-anchor-source': attributes.sourceLabel } : {},
      },
      sourceTitle: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-note-anchor-source-title') ||
          element.querySelector('[data-note-anchor-source-title]')?.textContent ||
          '',
        renderHTML: (attributes) =>
          attributes.sourceTitle ? { 'data-note-anchor-source-title': attributes.sourceTitle } : {},
      },
      excerpt: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-note-anchor-excerpt') ||
          element.querySelector('[data-note-anchor-excerpt]')?.textContent ||
          '',
        renderHTML: (attributes) =>
          attributes.excerpt ? { 'data-note-anchor-excerpt': attributes.excerpt } : {},
      },
      aiEnhanced: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-note-anchor-ai-enhanced') === 'true',
        renderHTML: (attributes) =>
          attributes.aiEnhanced ? { 'data-note-anchor-ai-enhanced': 'true' } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-type="note-anchor-block"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = normalizeAnchorPageLabel(String(node.attrs.label || '定位'));
    const labelText = noteAnchorDisplayText(label, pickDocumentLocaleText);
    const sourceLabel = String(node.attrs.sourceLabel || '摘录');
    const sourceTitle = noteAnchorDisplayText(
      normalizeAnchorSourceTitle(String(node.attrs.sourceTitle || ''), sourceLabel),
      pickDocumentLocaleText,
    );
    const excerpt = String(node.attrs.excerpt || '');
    const provenanceLabel = noteAnchorProvenanceLabel(
      { aiEnhanced: node.attrs.aiEnhanced === true },
      pickDocumentLocaleText,
    );

    return [
      'figure',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        { 'data-type': 'note-anchor-block', class: 'pq-note-anchor-card' },
      ),
      ['blockquote', { 'data-note-anchor-excerpt': 'true', class: 'pq-note-anchor-card-quote' }, [
        'span',
        { 'aria-hidden': 'true' },
        '“',
      ], excerpt || pickDocumentLocaleText('无摘录文本', 'No excerpt text'), [
        'span',
        { 'aria-hidden': 'true' },
        '”',
      ]],
      [
        'figcaption',
        { 'data-note-anchor-meta': 'true', class: 'pq-note-anchor-card-meta' },
        ['span', {
          'data-note-anchor-source-title': 'true',
          class: 'pq-note-anchor-card-source',
          title: sourceTitle,
        }, sourceTitle],
        ...(provenanceLabel
          ? [['span', {
              class: 'pq-note-anchor-card-provenance',
              title: pickDocumentLocaleText('原文快照经用户确认的 AI 重识别', 'AI re-recognition confirmed by the user'),
            }, provenanceLabel]]
          : []),
        [
          'span',
          {
            'data-type': 'noteAnchorLink',
            'data-note-anchor-id': node.attrs.anchorId,
            'data-note-anchor-label': label,
            class: 'pq-note-anchor-card-page pq-tiptap-note-anchor',
            title: pickDocumentLocaleText('点击定位到原文', 'Jump to the source text'),
          },
          labelText,
        ],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteAnchorBlockView);
  },
});

interface NoteEditorCandidateSources {
  notes: Note[];
  tags: NoteTagSummary[];
  papers: LiteraturePaper[];
}

export interface NoteEditorExtensionOptions {
  text: {
    untitled: string;
    headingPlaceholder: string;
    bodyPlaceholder: string;
  };
  noteId: string | null;
  /** 当前界面语言：斜杠命令插入模板正文时使用。 */
  locale: UiLanguage;
  slashCommandItems: (query: string) => NoteSlashCommandItem[];
  latestCandidatesRef: MutableRefObject<NoteEditorCandidateSources>;
  latestAnchorsRef: MutableRefObject<NoteAnchor[]>;
  latestCitationStyleRef: MutableRefObject<NoteCitationStyle>;
  jumpToAnchorId: (anchorId: string) => void;
  onOpenNote?: (noteId: string) => void;
  onTagClick?: (tag: string) => void;
  onPaperClick?: (paperId: string, location?: PaperReferenceLocation) => void;
  setReferencePickerOpen: (open: boolean) => void;
  setPageKind: (pageKind: NotePageKind) => void;
  onPageKindChange?: (pageKind: NotePageKind) => void;
}

export function createNoteEditorExtensions({
  text,
  noteId,
  locale,
  slashCommandItems,
  latestCandidatesRef,
  latestAnchorsRef,
  latestCitationStyleRef,
  jumpToAnchorId,
  onOpenNote,
  onTagClick,
  onPaperClick,
  setReferencePickerOpen,
  setPageKind,
  onPageKindChange,
}: NoteEditorExtensionOptions) {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: false,
      dropcursor: {
        color: 'rgba(13, 148, 136, 0.72)',
        width: 2,
      },
    }),
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Image.configure({ allowBase64: true }),
    EditableTable.configure({ resizable: true, allowTableNodeSelection: false }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'heading' ? text.headingPlaceholder : text.bodyPlaceholder,
    }),
    CharacterCount,
    CodeBlockLowlight.configure({ lowlight }),
    // Block formulas need display mode for constructs such as `\tag{4.24}`.
    // Keep inline formulas in the default inline mode so their layout is not changed.
    BlockMath.configure({ katexOptions: { displayMode: true, throwOnError: false } }),
    InlineMath.configure({ katexOptions: { displayMode: false, throwOnError: false } }),
    NoteComponentBlock,
    NoteAnchorBlock.configure({
      onClick: jumpToAnchorId,
    }),
    SlashCommand.configure({
      items: slashCommandItems,
      command: ({ editor, range, item }) => {
        if (item.id === 'paper-reference') {
          // 打开工具栏的参考文献选择器（由 NoteEditor 状态驱动，与工具栏按钮共用）。
          editor.chain().focus().deleteRange(range).run();
          setReferencePickerOpen(true);
          return;
        }
        if (item.id === 'reference-list') {
          editor.chain().focus().deleteRange(range).run();
          const headingLocale = typeof document !== 'undefined' && document.documentElement?.lang
            ? document.documentElement.lang
            : locale;
          upsertNoteReferenceList(
            editor,
            extractNoteReferences(editor.getJSON(), latestAnchorsRef.current),
            latestCandidatesRef.current.papers ?? [],
            latestCitationStyleRef.current,
            referenceListHeadingForLocale(headingLocale),
          );
          return;
        }
        runSlashCommand(editor, range, item, (nextPageKind) => {
          setPageKind(nextPageKind);
          onPageKindChange?.(nextPageKind);
        }, locale);
      },
    }),
    NoteAnchorLink.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-note-anchor' },
      onClick: jumpToAnchorId,
    }),
    WikiLink.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-wiki-link' },
      items: (query) => {
        const normalized = normalizeSuggestionQuery(query, ['[[']);
        return latestCandidatesRef.current.notes
          .filter((item) => item.id !== noteId)
          .filter((item) => !normalized || item.title.toLocaleLowerCase().includes(normalized))
          .slice(normalized ? 0 : undefined, normalized ? 8 : undefined)
          .map((item): NoteSuggestionItem => ({
            id: item.id,
            label: item.title || text.untitled,
            description: item.contentText || item.excerpt || item.content || '',
          }));
      },
      onClick: (noteId) => onOpenNote?.(noteId),
    }),
    HashTag.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-hash-tag' },
      items: (query) => {
        const normalized = normalizeSuggestionQuery(query, ['#']);
        const values = new Map<string, number>();
        for (const item of latestCandidatesRef.current.tags) values.set(item.tag, item.count);
        for (const item of latestCandidatesRef.current.notes) {
          for (const tag of item.tags) values.set(tag, values.get(tag) ?? 0);
        }
        return Array.from(values.entries())
          .filter(([tag]) => !normalized || tag.toLocaleLowerCase().includes(normalized))
          .slice(0, 8)
          .map(([tag, count]) => ({
            id: tag,
            label: tag,
            description: `${count || 0} notes`,
          }));
      },
      onClick: (tag) => onTagClick?.(tag),
    }),
    PaperReference.configure({
      HTMLAttributes: { class: 'pq-tiptap-token pq-tiptap-paper-ref' },
      citationStyle: () => latestCitationStyleRef.current,
      papers: () => latestCandidatesRef.current.papers ?? [],
      items: (query) => {
        const normalized = normalizeSuggestionQuery(query, ['@']);
        return latestCandidatesRef.current.papers
          .filter((paper) =>
            !normalized ||
            paper.id.toLocaleLowerCase().includes(normalized) ||
            paper.title.toLocaleLowerCase().includes(normalized),
          )
          .slice(0, 8)
          .map((paper) => ({
            id: paper.id,
            label: paper.title || paper.id,
            description: paper.authors.map((author) => author.name).join(', ') || paper.year || paper.id,
          }));
      },
      onClick: (paperId, location) => onPaperClick?.(paperId, location),
    }),
  ];
}
