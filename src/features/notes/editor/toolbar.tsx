import type { Editor } from '@tiptap/core';
import {
  Bold,
  ClipboardPaste,
  Code2,
  Copy,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Plus,
  Quote,
  RefreshCw,
  RemoveFormatting,
  Save,
  Scissors,
  Strikethrough,
  Tag,
  Trash2,
} from 'lucide-react';
import type { RefObject } from 'react';
import type { NoteTagSummary } from '../../../types/notes';
import { cn } from '../../../utils/cn';
import { copyTextToClipboard, type NotesContextMenuEntry } from '../NotesContextMenu';
import {
  deleteNoteBlock,
  duplicateNoteBlock,
  focusNoteBlock,
  getBlockLabelFromNode,
  insertComponentBelowBlock,
  insertParagraphBelowBlock,
  type NoteEditorContextMenuState,
} from '../noteEditorBlockUtils';
import { buildTableContextMenuEntries, iconNode } from './tableCell';

const NOTE_TEXT = {
  editorLoading: ['加载编辑器…', 'Loading editor...'],
  linkPrompt: ['输入链接地址', 'Enter link URL'],
  imagePrompt: ['输入图片地址或本地 data URL', 'Enter an image URL or a local data URL'],
  mathPrompt: ['输入 LaTeX 公式', 'Enter a LaTeX formula'],
  headingPlaceholder: ['输入标题...', 'Enter a heading...'],
  bodyPlaceholder: ['开始写作...', 'Start writing...'],
  noNote: ['未选择笔记', 'No note selected'],
  untitled: ['未命名笔记', 'Untitled note'],
  tagsPlaceholder: ['标签', 'Tags'],
  tagsHeading: ['标签', 'Tags'],
  removeTag: ['移除此标签', 'Remove this tag'],
  commonTags: ['常用标签', 'Common tags'],
  saving: ['保存中…', 'Saving...'],
  dirty: ['未保存', 'Unsaved'],
  saved: ['已保存', 'Saved'],
  save: ['保存', 'Save'],
  externalUpdate: ['有外部更新', 'External update available'],
  externalUpdateDescription: ['这条笔记已在其他位置保存。刷新后会加载最新版本。', 'This note was saved elsewhere. Refresh to load the latest version.'],
  externalUpdateDirtyDescription: ['这条笔记已在其他位置保存。当前编辑器还有未保存内容，刷新会用最新版本覆盖当前编辑器。', 'This note was saved elsewhere and the editor still has unsaved changes. Refreshing overwrites the editor with the latest version.'],
  refresh: ['刷新', 'Refresh'],
} satisfies Record<string, [string, string]>;

export type NoteTextKey = keyof typeof NOTE_TEXT;

export type NoteEditorText = Record<NoteTextKey, string>;

export type LocaleText = <T>(zh: T, en: T) => T;

export function localizeNoteText(l: LocaleText): NoteEditorText {
  const entries = Object.entries(NOTE_TEXT) as Array<[NoteTextKey, [string, string]]>;

  return Object.fromEntries(entries.map(([key, value]) => [key, l(value[0], value[1])])) as NoteEditorText;
}

const CJK_PATTERN = /[㐀-䶿一-鿿぀-ヿ가-힯]/;

// 中文按字数报计量，西文按词数；原先统一显示 “N words” 对中文笔记没有意义。
export function formatNoteLength(wordCount: number, text: string, l: LocaleText) {
  const trimmed = text.trim();

  if (!trimmed) {
    return l('0 字', '0 words');
  }

  if (CJK_PATTERN.test(trimmed)) {
    const characters = Array.from(trimmed.replace(/\s+/g, '')).length;

    return l(`${characters} 字`, `${characters} characters`);
  }

  return l(`${wordCount} words`, `${wordCount} words`);
}

async function readTextFromClipboard() {
  const bridgeText = window.paperquay?.clipboard?.readText?.();
  const normalizedBridgeText = bridgeText?.trim() ?? '';
  if (normalizedBridgeText) return normalizedBridgeText;

  try {
    return (await navigator.clipboard?.readText?.())?.trim() ?? '';
  } catch {
    return '';
  }
}

export function buildEditorContextMenuEntries(
  editor: Editor,
  context: NoteEditorContextMenuState,
  l: LocaleText,
): NotesContextMenuEntry[] {
  const { from, to } = editor.state.selection;
  const hasSelection = from !== to && context.position >= from && context.position <= to;
  const blockTitleZh = getBlockLabelFromNode(context.block.node, (zh) => zh);
  const blockTitleEn = getBlockLabelFromNode(context.block.node, (_zh, en) => en);
  const runContextCommand = (command: () => void, preserveSelection = false) => {
    if (!editor || editor.isDestroyed) return;

    if (!preserveSelection) {
      focusNoteBlock(editor, context.block, context.position);
    } else {
      editor.commands.focus();
    }

    command();
  };
  const run = (command: () => void, preserveSelection = false) => () =>
    runContextCommand(command, preserveSelection);
  const getSelectedText = () => editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    '\n',
  );
  const copySelectionOrBlock = async () => {
    const selectedText = hasSelection ? getSelectedText() : '';
    await copyTextToClipboard(selectedText || context.block.node.textContent);
  };
  const cutSelection = async () => {
    const selectedText = getSelectedText();

    if (!selectedText.trim()) return;

    await copyTextToClipboard(selectedText);
    editor.chain().focus().deleteSelection().run();
  };
  const pasteClipboardText = async () => {
    const text = await readTextFromClipboard();

    if (!text || editor.isDestroyed) return;

    if (hasSelection) {
      editor.chain().focus().insertContent(text).run();
      return;
    }

    focusNoteBlock(editor, context.block, context.position);
    editor.commands.insertContent(text);
  };

  const tableEntries: NotesContextMenuEntry[] = context.inTable
    ? buildTableContextMenuEntries(editor, run, l)
    : [];

  return [
    ...tableEntries,
    {
      id: 'context-title',
      label: hasSelection
        ? l('复制选中文本', 'Copy selected text')
        : l(`复制${blockTitleZh}`, `Copy ${blockTitleEn}`),
      icon: iconNode(<Copy className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: copySelectionOrBlock,
    },
    {
      id: 'cut',
      label: l('剪切', 'Cut'),
      icon: iconNode(<Scissors className="h-4 w-4" strokeWidth={1.8} />),
      disabled: !hasSelection,
      onSelect: cutSelection,
    },
    {
      id: 'paste',
      label: l('粘贴', 'Paste'),
      icon: iconNode(<ClipboardPaste className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: pasteClipboardText,
    },
    { type: 'separator', id: 'context-separator-inline' },
    {
      id: 'bold',
      label: l('加粗', 'Bold'),
      icon: iconNode(<Bold className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleBold().run(), hasSelection),
    },
    {
      id: 'italic',
      label: l('斜体', 'Italic'),
      icon: iconNode(<Italic className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleItalic().run(), hasSelection),
    },
    {
      id: 'strike',
      label: l('删除线', 'Strikethrough'),
      icon: iconNode(<Strikethrough className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleStrike().run(), hasSelection),
    },
    {
      id: 'highlight',
      label: l('高亮', 'Highlight'),
      icon: iconNode(<Highlighter className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleHighlight({ color: '#fef3c7' }).run(), hasSelection),
    },
    {
      id: 'clear-marks',
      label: l('清除文字样式', 'Clear formatting'),
      icon: iconNode(<RemoveFormatting className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().unsetAllMarks().run(), hasSelection),
    },
    { type: 'separator', id: 'context-separator-block-style' },
    {
      id: 'paragraph',
      label: l('设为正文', 'Set as paragraph'),
      icon: iconNode(<Pilcrow className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().setParagraph().run()),
    },
    {
      id: 'heading-1',
      label: l('设为一级标题', 'Set as heading 1'),
      icon: iconNode(<Heading1 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleHeading({ level: 1 }).run()),
    },
    {
      id: 'heading-2',
      label: l('设为二级标题', 'Set as heading 2'),
      icon: iconNode(<Heading2 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleHeading({ level: 2 }).run()),
    },
    {
      id: 'heading-3',
      label: l('设为三级标题', 'Set as heading 3'),
      icon: iconNode(<Heading3 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleHeading({ level: 3 }).run()),
    },
    {
      id: 'bullet-list',
      label: l('转换为无序列表', 'Convert to bullet list'),
      icon: iconNode(<List className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleBulletList().run()),
    },
    {
      id: 'ordered-list',
      label: l('转换为有序列表', 'Convert to ordered list'),
      icon: iconNode(<ListOrdered className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleOrderedList().run()),
    },
    {
      id: 'task-list',
      label: l('转换为任务列表', 'Convert to task list'),
      icon: iconNode(<ListChecks className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleTaskList().run()),
    },
    {
      id: 'quote',
      label: l('转换为引用', 'Convert to quote'),
      icon: iconNode(<Quote className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleBlockquote().run()),
    },
    {
      id: 'code-block',
      label: l('转换为代码块', 'Convert to code block'),
      icon: iconNode(<Code2 className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => editor.chain().focus().toggleCodeBlock().run()),
    },
    { type: 'separator', id: 'context-separator-block-actions' },
    {
      id: 'insert-below',
      label: l('在下方插入一行', 'Insert a line below'),
      icon: iconNode(<Plus className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => insertParagraphBelowBlock(editor, context.block)),
    },
    {
      id: 'insert-component',
      label: l('在下方插入组件块', 'Insert a component block below'),
      icon: iconNode(<FileText className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => insertComponentBelowBlock(editor, context.block)),
    },
    {
      id: 'duplicate-block',
      label: l('复制并插入当前块', 'Duplicate current block'),
      icon: iconNode(<FileText className="h-4 w-4" strokeWidth={1.8} />),
      onSelect: run(() => duplicateNoteBlock(editor, context.block)),
    },
    {
      id: 'delete-block',
      label: l('删除当前块', 'Delete current block'),
      icon: iconNode(<Trash2 className="h-4 w-4" strokeWidth={1.8} />),
      tone: 'danger',
      onSelect: run(() => deleteNoteBlock(editor, context.block)),
    },
  ];
}

export interface NoteEditorHeaderProps {
  compact: boolean;
  text: NoteEditorText;
  title: string;
  onTitleChange: (title: string) => void;
  saving: boolean;
  dirty: boolean;
  externalUpdateAvailable: boolean;
  onRefresh: () => void;
  tagText: string;
  onTagTextChange: (tagText: string) => void;
  tagEditorOpen: boolean;
  onTagEditorToggle: () => void;
  tagEditorRef: RefObject<HTMLDivElement>;
  currentTags: string[];
  tags: NoteTagSummary[];
}

export function NoteEditorHeader({
  compact,
  text,
  title,
  onTitleChange,
  saving,
  dirty,
  externalUpdateAvailable,
  onRefresh,
  tagText,
  onTagTextChange,
  tagEditorOpen,
  onTagEditorToggle,
  tagEditorRef,
  currentTags,
  tags,
}: NoteEditorHeaderProps) {
  return (
    <>
      <div className={cn('border-b border-[var(--pq-border)]', compact ? 'px-3 py-2.5' : 'px-4 py-3')}>
        <div className="flex min-w-0 items-start gap-3">
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder={text.untitled}
            className={cn(
              'min-w-0 flex-1 bg-transparent font-semibold leading-tight text-[var(--pq-text)] outline-none placeholder:text-[var(--pq-text-faint)]',
              compact ? 'text-base' : 'text-xl',
            )}
          />

          <div className="flex shrink-0 items-center gap-2 pt-1 text-xs text-[var(--pq-text-faint)]">
            {externalUpdateAvailable ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--pq-accent)]">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {text.externalUpdate}
              </span>
            ) : null}
            <span>{saving ? text.saving : dirty ? text.dirty : ''}</span>

            <div ref={tagEditorRef} className="relative">
              <button
                type="button"
                onClick={onTagEditorToggle}
                className={cn(
                  'pq-icon-button relative h-8 w-8 border',
                  currentTags.length > 0
                    ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]'
                    : 'border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] text-[var(--pq-text-muted)] hover:border-[var(--pq-border-strong)] hover:text-[var(--pq-text)]',
                )}
                aria-expanded={tagEditorOpen}
                aria-label={text.tagsPlaceholder}
                title={currentTags.length > 0 ? currentTags.map((item) => `#${item}`).join(' ') : text.tagsPlaceholder}
              >
                <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                {currentTags.length > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--pq-accent)] px-1 text-[11px] font-semibold leading-none text-[var(--pq-accent-button-text)]">
                    {currentTags.length > 9 ? '9+' : currentTags.length}
                  </span>
                ) : null}
              </button>

              {tagEditorOpen ? (
                <div className="pq-card absolute right-0 top-full z-40 mt-1.5 w-[min(320px,calc(100vw-48px))] p-3 shadow-[var(--pq-shadow-dialog)]">
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--pq-text-faint)]">
                      {text.tagsHeading}
                    </span>
                    <input
                      value={tagText}
                      onChange={(event) => onTagTextChange(event.target.value)}
                      placeholder="tag1, tag2"
                      autoFocus
                      className="pq-input h-8 w-full px-3 text-xs"
                    />
                  </label>

                  {currentTags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {currentTags.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => onTagTextChange(currentTags.filter((tag) => tag !== item).join(', '))}
                          className="rounded-full bg-[var(--pq-accent-bg)] px-2 py-1 text-[11px] font-medium text-[var(--pq-accent)] transition hover:bg-[var(--pq-active)]"
                          title={text.removeTag}
                        >
                          #{item}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {tags.length > 0 ? (
                    <div className="mt-3 border-t border-[var(--pq-border-subtle)] pt-2">
                      <div className="mb-1.5 text-[11px] text-[var(--pq-text-faint)]">{text.commonTags}</div>
                      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                        {tags.slice(0, 12).map((item) => {
                          const active = currentTags.includes(item.tag);

                          return (
                            <button
                              key={item.tag}
                              type="button"
                              onClick={() => {
                                if (active) return;
                                onTagTextChange([...currentTags, item.tag].join(', '));
                              }}
                              disabled={active}
                              className={cn(
                                'rounded-full border px-2 py-1 text-[11px] transition disabled:opacity-60',
                                active
                                  ? 'border-[var(--pq-accent-bg)] bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]'
                                  : 'border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] text-[var(--pq-text-muted)] hover:border-[var(--pq-border-strong)] hover:text-[var(--pq-text)]',
                              )}
                            >
                              #{item.tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {externalUpdateAvailable ? (
        <div className="flex items-start gap-3 border-b border-[var(--pq-border)] bg-[var(--pq-accent-bg)] px-4 py-2.5 text-xs text-[var(--pq-text)]">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-[var(--pq-accent)]" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[var(--pq-text)]">{text.externalUpdate}</div>
            <div className="mt-0.5 leading-5 text-[var(--pq-text-muted)]">
              {dirty ? text.externalUpdateDirtyDescription : text.externalUpdateDescription}
            </div>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="pq-button h-7 shrink-0 px-2.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            {text.refresh}
          </button>
        </div>
      ) : null}
    </>
  );
}

export interface NoteEditorFooterProps {
  l: LocaleText;
  text: NoteEditorText;
  wordCount: number;
  contentText: string;
  externalUpdateAvailable: boolean;
  onRefresh: () => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}

export function NoteEditorFooter({
  l,
  text,
  wordCount,
  contentText,
  externalUpdateAvailable,
  onRefresh,
  dirty,
  saving,
  onSave,
}: NoteEditorFooterProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--pq-border)] px-3 py-2 text-xs text-[var(--pq-text-faint)]">
      <span>{formatNoteLength(wordCount, contentText, l)}</span>
      <div className="flex items-center gap-2">
        {externalUpdateAvailable ? (
          <button
            type="button"
            onClick={onRefresh}
            className="pq-button h-8 px-3 text-sm"
            title={text.refresh}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
            {text.refresh}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className={cn(
            'pq-button-primary h-8 px-3 text-sm disabled:opacity-50',
            !dirty && !saving ? 'hidden' : '',
          )}
          title="Ctrl / Cmd + S"
        >
          <Save className="h-4 w-4" strokeWidth={1.8} />
          {saving ? text.saving : text.save}
        </button>
      </div>
    </div>
  );
}
