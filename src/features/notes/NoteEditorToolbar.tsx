import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  ChevronDown,
  Code2,
  FileText,
  Heading1,
  Heading2,
  Highlighter,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Sigma,
  Sparkles,
  Strikethrough,
  Table2,
  Undo2,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { focusTextPosition } from './noteEditorBlockUtils.ts';
import {
  componentBlockNode,
  insertImageFilesIntoView,
  NOTE_TEMPLATES,
  paragraphNode,
  type NoteTemplate,
} from './noteEditorUtils';

const TOOLBAR_TEXT = {
  editorLoading: 'Loading editor...',
  linkPrompt: '\u8f93\u5165\u94fe\u63a5\u5730\u5740',
  imagePrompt: '\u8f93\u5165\u56fe\u7247\u5730\u5740\u6216\u672c\u5730 data URL',
  mathPrompt: '\u8f93\u5165 LaTeX \u516c\u5f0f',
};

const TABLE_MENU_WIDTH = 208;
const TABLE_MENU_HEIGHT = 230;
const FLOATING_MENU_GAP = 8;
const FLOATING_MENU_PADDING = 12;

function getFloatingMenuPosition(anchor: HTMLElement, width: number, height: number) {
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(
    FLOATING_MENU_PADDING,
    Math.min(rect.left, window.innerWidth - width - FLOATING_MENU_PADDING),
  );
  const bottomTop = rect.bottom + FLOATING_MENU_GAP;
  const top = bottomTop + height <= window.innerHeight - FLOATING_MENU_PADDING
    ? bottomTop
    : Math.max(FLOATING_MENU_PADDING, rect.top - height - FLOATING_MENU_GAP);

  return { left, top };
}

interface ToolbarButtonProps {
  active?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ active, buttonRef, disabled, title, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'pq-icon-button h-7 w-7 shrink-0',
        active ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]' : '',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px shrink-0 bg-[var(--pq-border)]" />;
}

interface ToolbarEditorState {
  isParagraph: boolean;
  isHeading1: boolean;
  isHeading2: boolean;
  isBold: boolean;
  isItalic: boolean;
  isStrike: boolean;
  isHighlight: boolean;
  isBulletList: boolean;
  isOrderedList: boolean;
  isTaskList: boolean;
  isBlockquote: boolean;
  isCodeBlock: boolean;
  isLink: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

const EMPTY_TOOLBAR_STATE: ToolbarEditorState = {
  isParagraph: false,
  isHeading1: false,
  isHeading2: false,
  isBold: false,
  isItalic: false,
  isStrike: false,
  isHighlight: false,
  isBulletList: false,
  isOrderedList: false,
  isTaskList: false,
  isBlockquote: false,
  isCodeBlock: false,
  isLink: false,
  canUndo: false,
  canRedo: false,
};

export function NoteEditorToolbar({
  editor,
  onPolish,
  polishActive = false,
  polishDisabled = false,
}: {
  editor: Editor | null;
  onPolish?: () => void;
  polishActive?: boolean;
  polishDisabled?: boolean;
}) {
  const [tableOpen, setTableOpen] = useState(false);
  const [tableSize, setTableSize] = useState({ rows: 3, cols: 3 });
  const [tableMenuPosition, setTableMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [inputMenu, setInputMenu] = useState<null | {
    kind: 'link' | 'image' | 'math';
    value: string;
  }>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const tableButtonRef = useRef<HTMLButtonElement | null>(null);
  const tableMenuRef = useRef<HTMLDivElement | null>(null);
  const editorState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor || currentEditor.isDestroyed) return EMPTY_TOOLBAR_STATE;

      try {
        return {
          isParagraph: currentEditor.isActive('paragraph'),
          isHeading1: currentEditor.isActive('heading', { level: 1 }),
          isHeading2: currentEditor.isActive('heading', { level: 2 }),
          isBold: currentEditor.isActive('bold'),
          isItalic: currentEditor.isActive('italic'),
          isStrike: currentEditor.isActive('strike'),
          isHighlight: currentEditor.isActive('highlight'),
          isBulletList: currentEditor.isActive('bulletList'),
          isOrderedList: currentEditor.isActive('orderedList'),
          isTaskList: currentEditor.isActive('taskList'),
          isBlockquote: currentEditor.isActive('blockquote'),
          isCodeBlock: currentEditor.isActive('codeBlock'),
          isLink: currentEditor.isActive('link'),
          canUndo: currentEditor.can().undo(),
          canRedo: currentEditor.can().redo(),
        };
      } catch {
        return EMPTY_TOOLBAR_STATE;
      }
    },
  }) ?? EMPTY_TOOLBAR_STATE;

  useEffect(() => {
    if (!tableOpen) {
      setTableMenuPosition(null);
      return undefined;
    }

    const updateTableMenuPosition = () => {
      const anchor = tableButtonRef.current;
      if (!anchor) return;

      setTableMenuPosition(getFloatingMenuPosition(anchor, TABLE_MENU_WIDTH, TABLE_MENU_HEIGHT));
    };

    updateTableMenuPosition();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (tableButtonRef.current?.contains(target) || tableMenuRef.current?.contains(target)) return;

      setTableOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setTableOpen(false);
    };

    window.addEventListener('resize', updateTableMenuPosition);
    window.addEventListener('scroll', updateTableMenuPosition, true);
    window.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('resize', updateTableMenuPosition);
      window.removeEventListener('scroll', updateTableMenuPosition, true);
      window.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [tableOpen]);

  if (!editor) {
    return (
      <div className="flex h-10 items-center border-b border-[var(--pq-border)] px-3 text-xs text-[var(--pq-text-faint)]">
        {TOOLBAR_TEXT.editorLoading}
      </div>
    );
  }

  const chain = () => editor.chain().focus();
  const toggleTableMenu = () => {
    const nextOpen = !tableOpen;

    setInputMenu(null);
    setTemplateOpen(false);
    setTableOpen(nextOpen);
    if (nextOpen && tableButtonRef.current) {
      setTableMenuPosition(getFloatingMenuPosition(tableButtonRef.current, TABLE_MENU_WIDTH, TABLE_MENU_HEIGHT));
    }
  };
  const openInputMenu = (kind: 'link' | 'image' | 'math') => {
    const previousUrl = kind === 'link'
      ? String(editor.getAttributes('link').href ?? '')
      : '';

    setTableOpen(false);
    setTemplateOpen(false);
    setInputMenu({ kind, value: kind === 'math' ? 'E = mc^2' : previousUrl });
  };
  const insertTemplate = (template: NoteTemplate) => {
    chain().insertContent([...template.content, paragraphNode()]).run();
    setTemplateOpen(false);
  };
  const insertComponentBlock = () => {
    const insertAt = editor.state.selection.to;
    chain()
      .insertContent(componentBlockNode('Component'), { updateSelection: false })
      .run();
    focusTextPosition(editor, insertAt + 2);
  };
  const submitInputMenu = () => {
    if (!inputMenu) return;

    const value = inputMenu.value.trim();
    if (inputMenu.kind === 'link') {
      if (!value) {
        chain().unsetLink().run();
      } else {
        chain().extendMarkRange('link').setLink({ href: value }).run();
      }
    } else if (inputMenu.kind === 'image') {
      if (value) chain().setImage({ src: value }).run();
    } else if (value) {
      chain().insertInlineMath({ latex: value }).run();
    }

    setInputMenu(null);
  };

  return (
    <div className="relative flex min-h-10 flex-wrap items-center gap-1 border-b border-[var(--pq-border)] bg-[var(--pq-surface)] px-3 py-1.5">
      <ToolbarButton title="Undo" disabled={!editorState.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Redo" disabled={!editorState.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton title="Paragraph" active={editorState.isParagraph} onClick={() => chain().setParagraph().run()}>
        <Pilcrow className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Heading 1" active={editorState.isHeading1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Heading 2" active={editorState.isHeading2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton title="Bold" active={editorState.isBold} onClick={() => chain().toggleBold().run()}>
        <Bold className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editorState.isItalic} onClick={() => chain().toggleItalic().run()}>
        <Italic className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Strike" active={editorState.isStrike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Highlight" active={editorState.isHighlight} onClick={() => chain().toggleHighlight({ color: '#fef3c7' }).run()}>
        <Highlighter className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton title="Bullet list" active={editorState.isBulletList} onClick={() => chain().toggleBulletList().run()}>
        <List className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Ordered list" active={editorState.isOrderedList} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Task list" active={editorState.isTaskList} onClick={() => chain().toggleTaskList().run()}>
        <ListChecks className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Quote" active={editorState.isBlockquote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Code block" active={editorState.isCodeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <Code2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton title="Component" onClick={insertComponentBlock}>
        <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <div className="relative">
        <button
          type="button"
          className="pq-button h-7 gap-1 px-2 text-xs"
          onClick={() => {
            setInputMenu(null);
            setTableOpen(false);
            setTemplateOpen((open) => !open);
          }}
          title="Templates"
        >
          <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
          <span>Template</span>
          <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
        </button>
        {templateOpen ? (
          <div className="pq-note-toolbar-menu absolute left-0 top-9 z-30 w-64">
            {NOTE_TEMPLATES.map((template) => (
              <button key={template.id} type="button" onClick={() => insertTemplate(template)}>
                <FileText className="h-4 w-4" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block truncate">{template.label}</span>
                  <span className="block truncate text-[11px] font-normal text-[var(--pq-text-faint)]">
                    {template.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="relative">
        <ToolbarButton
          buttonRef={tableButtonRef}
          title="Table"
          active={tableOpen}
          onClick={toggleTableMenu}
        >
          <Table2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </ToolbarButton>
        {tableOpen && tableMenuPosition && typeof document !== 'undefined' ? createPortal(
          <div
            ref={tableMenuRef}
            className="fixed z-[10000] rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-2 shadow-[var(--pq-shadow-dialog)]"
            style={{ left: tableMenuPosition.left, top: tableMenuPosition.top, width: TABLE_MENU_WIDTH }}
          >
            <div className="mb-2 px-1 text-xs text-[var(--pq-text-muted)]">
              {tableSize.rows} x {tableSize.cols}
            </div>
            <div className="grid grid-cols-8 gap-1">
              {Array.from({ length: 64 }, (_, index) => {
                const row = Math.floor(index / 8) + 1;
                const col = (index % 8) + 1;
                const active = row <= tableSize.rows && col <= tableSize.cols;

                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    aria-label={`Insert ${row} by ${col} table`}
                    onMouseEnter={() => setTableSize({ rows: row, cols: col })}
                    onFocus={() => setTableSize({ rows: row, cols: col })}
                    onClick={() => {
                      chain().insertTable({ rows: row, cols: col, withHeaderRow: true }).run();
                      setTableOpen(false);
                    }}
                    className={cn(
                      'h-5 w-5 rounded border transition',
                      active
                        ? 'border-[var(--pq-accent)] bg-[var(--pq-accent-bg)]'
                        : 'border-[var(--pq-border)] bg-[var(--pq-bg-secondary)] hover:border-[var(--pq-border-strong)]',
                    )}
                  />
                );
              })}
            </div>
          </div>,
          document.body,
        ) : null}
      </div>
      <ToolbarButton title="Math" onClick={() => openInputMenu('math')}>
        <Sigma className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Link" active={editorState.isLink} onClick={() => openInputMenu('link')}>
        <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      <ToolbarButton title="Image" onClick={() => openInputMenu('image')}>
        <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
      </ToolbarButton>
      {onPolish ? (
        <>
          <Divider />
          <ToolbarButton
            title="AI polish note"
            active={polishActive}
            disabled={polishDisabled}
            onClick={onPolish}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
          </ToolbarButton>
        </>
      ) : null}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          insertImageFilesIntoView(editor.view, files);
          event.currentTarget.value = '';
          setInputMenu(null);
        }}
      />
      {inputMenu ? (
        <form
          className="absolute right-3 top-9 z-30 flex w-[min(320px,calc(100%-24px))] items-center gap-2 rounded-[var(--pq-radius-md)] border border-[var(--pq-border)] bg-[var(--pq-surface)] p-2 shadow-[var(--pq-shadow-dialog)]"
          onSubmit={(event) => {
            event.preventDefault();
            submitInputMenu();
          }}
        >
          <input
            autoFocus
            value={inputMenu.value}
            onChange={(event) => setInputMenu({ ...inputMenu, value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setInputMenu(null);
            }}
            placeholder={
              inputMenu.kind === 'link'
                ? TOOLBAR_TEXT.linkPrompt
                : inputMenu.kind === 'image'
                  ? TOOLBAR_TEXT.imagePrompt
                  : TOOLBAR_TEXT.mathPrompt
            }
            className="pq-input h-8 min-w-0 flex-1 px-2 text-xs"
          />
          <button type="submit" className="pq-button-primary h-8 px-3 text-xs">
            Insert
          </button>
          {inputMenu.kind === 'image' ? (
            <button
              type="button"
              className="pq-button h-8 px-3 text-xs"
              onClick={() => imageInputRef.current?.click()}
            >
              File
            </button>
          ) : null}
          <button
            type="button"
            className="pq-icon-button h-8 w-8"
            onClick={() => setInputMenu(null)}
          >
            x
          </button>
        </form>
      ) : null}
    </div>
  );
}
