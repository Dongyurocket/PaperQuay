import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  Copy,
  FilePlus2,
  FileText,
  ListTree,
  MapPin,
  PanelRightClose,
  Plus,
  Quote,
  Search,
  Trash2,
} from 'lucide-react';
import type { Note, NoteAnchor, NoteAnchorInsertRequest, NoteFolder, NotePageKind, UpdateNoteRequest } from '../../types/notes';
import { listNoteFolders, searchNotes, type NoteMutationOptions, type NoteSearchResponse } from '../../services/notes';
import type { LiteraturePaper } from '../../types/library';
import type { SelectedExcerpt } from '../../types/reader';
import { cn } from '../../utils/cn';
import { useLocaleText } from '../../i18n/uiLanguage';
import { NoteEditor } from './NoteEditor';
import {
  copyTextToClipboard,
  NotesContextMenu,
  shouldUseNativeTextContextMenu,
  type NotesContextMenuEntry,
} from './NotesContextMenu';
import { NotesList } from './NotesList';
import { buildQuoteMarkdown, noteMatchesFilter } from './noteUtils';

type NotesFilterKey = 'all' | 'highlight' | 'ai-chat' | 'standalone' | NotePageKind;
type DrawerTab = 'anchors' | 'notes';

type SidebarContextMenu =
  | { kind: 'surface'; x: number; y: number }
  | { kind: 'anchor'; x: number; y: number; note: Note; anchor: NoteAnchor }
  | { kind: 'note'; x: number; y: number; note: Note };

type Localizer = <T,>(zh: T, en: T) => T;

interface NotesSidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  papers?: LiteraturePaper[];
  documentTitle?: string;
  loading: boolean;
  saving: boolean;
  error: string;
  selectedExcerpt: SelectedExcerpt | null;
  pendingAnchorInsert?: NoteAnchorInsertRequest | null;
  onPendingAnchorInsertHandled?: (requestId: string) => void;
  externalUpdateNote?: Note | null;
  noteEditorSourceId?: string;
  onExternalUpdateApply?: (note: Note) => void;
  onAddSelectionToNote: () => void;
  onCreateStandaloneNote: () => void;
  onSelectNote: (note: Note) => void;
  onUpdateNote: (noteId: string, patch: UpdateNoteRequest, options?: NoteMutationOptions) => Note | void | Promise<Note | void>;
  onDeleteNote: (noteId: string) => void;
  onJumpToNoteAnchor: (note: Note, anchor: NoteAnchor) => void;
  onPaperClick?: (paperId: string) => void;
  onCollapse?: () => void;
}

const FILTERS: Array<{ key: NotesFilterKey; zh: string; en: string }> = [
  { key: 'all', zh: '全部', en: 'All' },
  { key: 'highlight', zh: 'PDF', en: 'PDF' },
  { key: 'ai-chat', zh: 'AI', en: 'AI' },
  { key: 'standalone', zh: '笔记', en: 'Notes' },
];
const PAGE_KIND_FILTERS: Array<{ key: NotePageKind; zh: string; en: string }> = [
  { key: 'paper-card', zh: '论文卡', en: 'Paper card' }, { key: 'concept', zh: '概念', en: 'Concept' },
  { key: 'synthesis', zh: '综述', en: 'Review' }, { key: 'qa', zh: '问答', en: 'Q&A' },
  { key: 'excerpt', zh: '摘录', en: 'Excerpt' }, { key: 'index', zh: '索引', en: 'Index' },
  { key: 'log', zh: '日志', en: 'Log' }, { key: 'overview', zh: '总览', en: 'Overview' },
];

function anchorPageLabel(anchor: NoteAnchor, l: Localizer) {
  if (anchor.pdfLocation?.pageNumber) return `P${anchor.pdfLocation.pageNumber}`;

  const normalized = anchor.label.replace(/\s+/g, ' ').trim();
  const pageMatch = normalized.match(/\bP\s*(\d+)\b/i);
  if (pageMatch) return `P${pageMatch[1]}`;

  return normalized || l('定位', 'Location');
}

function anchorSourceTitle(anchor: NoteAnchor, fallbackTitle: string | undefined, l: Localizer) {
  const explicitTitle = anchor.sourceTitle?.replace(/\s+/g, ' ').trim();
  if (explicitTitle && !/^PDF\b/i.test(explicitTitle) && !/^P\s*\d+\b/i.test(explicitTitle)) {
    return explicitTitle;
  }

  const fallback = fallbackTitle?.replace(/\s+/g, ' ').trim();
  if (fallback) return fallback;

  return l('文献', 'Paper');
}

function excerptPreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function notePlainText(note: Note) {
  return note.contentText || note.content || note.excerpt || '';
}

function anchorHasLocation(anchor: NoteAnchor) {
  return Boolean(
    anchor.blockId ||
      typeof anchor.pageIndex === 'number' ||
      (anchor.pdfLocation?.bbox && anchor.pdfLocation.pageNumber),
  );
}

export function NotesSidebar({
  notes,
  activeNoteId,
  papers = [],
  documentTitle,
  loading,
  saving,
  error,
  selectedExcerpt,
  pendingAnchorInsert = null,
  onPendingAnchorInsertHandled,
  externalUpdateNote = null,
  noteEditorSourceId,
  onExternalUpdateApply,
  onAddSelectionToNote,
  onCreateStandaloneNote,
  onSelectNote,
  onUpdateNote,
  onDeleteNote,
  onJumpToNoteAnchor,
  onPaperClick,
  onCollapse,
}: NotesSidebarProps) {
  const l = useLocaleText();
  const [filter, setFilter] = useState<NotesFilterKey>('all');
  const [search, setSearch] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [searchResult, setSearchResult] = useState<{ key: string; result?: NoteSearchResponse; error?: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('anchors');
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? notes[0] ?? null,
    [activeNoteId, notes],
  );
  const activeAnchors = activeNote?.anchors ?? [];
  const canAddSelection = Boolean(selectedExcerpt?.text.trim());

  const scopedNotes = useMemo(() => notes.filter((note) => noteMatchesFilter(note, filter)
    && (!folderId || (folderId === '__uncategorized__' ? !note.folderId : note.folderId === folderId))), [filter, folderId, notes]);
  const scopeIds = JSON.stringify(scopedNotes.map((note) => note.id).sort());
  const query = search.trim();
  const searchKey = JSON.stringify([query, scopeIds, scopedNotes.map((note) => [note.id, note.updatedAt])]);
  const currentSearch = searchResult?.key === searchKey ? searchResult : null;
  const channelsById = useMemo(() => Object.fromEntries((currentSearch?.result?.notes ?? [])
    .map((note) => [note.id, note.channels])), [currentSearch]);
  const filteredNotes = query ? scopedNotes.filter((note) => channelsById[note.id]) : scopedNotes;

  useEffect(() => {
    if (!drawerOpen || drawerTab !== 'notes') return;
    let cancelled = false;
    void listNoteFolders().then((items) => { if (!cancelled) setFolders(items); })
      .catch(() => { if (!cancelled) setFolders([]); });
    return () => { cancelled = true; };
  }, [drawerOpen, drawerTab]);

  useEffect(() => {
    if (!drawerOpen || drawerTab !== 'notes' || !query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchNotes({ query, noteIds: JSON.parse(scopeIds) as string[], limit: 50 })
        .then((result) => { if (!cancelled) setSearchResult({ key: searchKey, result }); })
        .catch((error: unknown) => { if (!cancelled) setSearchResult({ key: searchKey, error: error instanceof Error ? error.message : l('笔记检索失败', 'Note search failed') }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [drawerOpen, drawerTab, query, scopeIds, searchKey, l]);

  const openSurfaceContextMenu = (event: MouseEvent) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    setContextMenu({ kind: 'surface', x: event.clientX, y: event.clientY });
  };

  const openAnchorContextMenu = (
    event: MouseEvent,
    note: Note,
    anchor: NoteAnchor,
  ) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'anchor', x: event.clientX, y: event.clientY, note, anchor });
  };

  const openNoteContextMenu = (event: MouseEvent, note: Note) => {
    if (shouldUseNativeTextContextMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'note', x: event.clientX, y: event.clientY, note });
  };

  const contextMenuEntries = useMemo<NotesContextMenuEntry[]>(() => {
    if (!contextMenu) return [];

    if (contextMenu.kind === 'anchor') {
      const { note, anchor } = contextMenu;
      const hasLocation = anchorHasLocation(anchor);

      return [
        {
          id: 'jump',
          label: l('定位到原文', 'Go to source'),
          disabled: !hasLocation,
          tone: 'accent',
          icon: <MapPin className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => onJumpToNoteAnchor(note, anchor),
        },
        {
          id: 'copy-excerpt',
          label: l('复制摘录', 'Copy excerpt'),
          icon: <Copy className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(anchor.excerpt),
        },
        {
          id: 'copy-quote',
          label: l('复制 Markdown 引用', 'Copy Markdown quote'),
          icon: <Quote className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(buildQuoteMarkdown(anchor.excerpt)),
        },
        { type: 'separator', id: 'anchor-danger-separator' },
        {
          id: 'remove-anchor',
          label: l('从定位列表移除', 'Remove from locations'),
          tone: 'danger',
          icon: <Trash2 className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => {
            onUpdateNote(note.id, {
              anchors: note.anchors.filter((item) => item.id !== anchor.id),
            });
          },
        },
      ];
    }

    if (contextMenu.kind === 'note') {
      const { note } = contextMenu;

      return [
        {
          id: 'open-note',
          label: l('打开笔记', 'Open note'),
          tone: 'accent',
          icon: <FileText className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => {
            onSelectNote(note);
            setDrawerOpen(false);
          },
        },
        {
          id: 'copy-title',
          label: l('复制标题', 'Copy title'),
          icon: <Copy className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(note.title || l('未命名笔记', 'Untitled note')),
        },
        {
          id: 'copy-content',
          label: l('复制正文', 'Copy body'),
          disabled: !notePlainText(note).trim(),
          icon: <Copy className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => copyTextToClipboard(notePlainText(note)),
        },
        { type: 'separator', id: 'note-danger-separator' },
        {
          id: 'delete-note',
          label: l('删除笔记', 'Delete note'),
          tone: 'danger',
          icon: <Trash2 className="h-4 w-4" strokeWidth={1.8} />,
          onSelect: () => onDeleteNote(note.id),
        },
      ];
    }

    return [
      {
        id: 'new-note',
        label: l('新建笔记', 'New note'),
        tone: 'accent',
        icon: <Plus className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: onCreateStandaloneNote,
      },
      {
        id: 'add-selection',
        label: l('加入当前笔记', 'Add to current note'),
        disabled: !canAddSelection,
        icon: <FilePlus2 className="h-4 w-4" strokeWidth={1.8} />,
        onSelect: onAddSelectionToNote,
      },
    ];
  }, [
    canAddSelection,
    contextMenu,
    onAddSelectionToNote,
    onCreateStandaloneNote,
    onDeleteNote,
    onJumpToNoteAnchor,
    onSelectNote,
    onUpdateNote,
  ]);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-[var(--pq-surface-1)]"
      onContextMenu={openSurfaceContextMenu}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--pq-border-subtle)] px-2 py-2">
        <button
          type="button"
          onClick={() => {
            setDrawerTab('anchors');
            setDrawerOpen((open) => !open);
          }}
          className={cn(
            'inline-flex min-w-0 items-center gap-2 rounded-[var(--pq-radius-sm)] px-2.5 py-1.5 text-sm font-medium transition',
            drawerOpen
              ? 'bg-[var(--pq-accent-bg)] text-[var(--pq-text)]'
              : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
          )}
          aria-expanded={drawerOpen}
        >
          <ListTree className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="shrink-0">{l('摘录', 'Excerpts')}</span>
          <span className="rounded-md bg-[var(--pq-bg-secondary)] px-1.5 py-0.5 text-[11px] text-[var(--pq-text-faint)]">
            {activeAnchors.length}
          </span>
          {error ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pq-error)]" title={error} /> : null}
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onAddSelectionToNote}
            disabled={!canAddSelection}
            className="pq-icon-button h-8 w-8 disabled:opacity-40"
            title={l('加入当前笔记', 'Add to current note')}
            aria-label={l('加入当前笔记', 'Add to current note')}
          >
            <FilePlus2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onCreateStandaloneNote}
            className="pq-icon-button h-8 w-8 bg-[var(--pq-accent-bg)] text-[var(--pq-accent)]"
            title={l('新建笔记', 'New note')}
            aria-label={l('新建笔记', 'New note')}
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} />
          </button>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="pq-icon-button h-8 w-8"
              title={l('收起侧边栏', 'Collapse sidebar')}
              aria-label={l('收起侧边栏', 'Collapse sidebar')}
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </div>

      {drawerOpen ? (
        <div className="pq-card absolute left-2 right-2 top-12 z-30 flex max-h-[min(480px,62%)] min-h-[180px] flex-col overflow-hidden p-2 shadow-[var(--pq-shadow-dialog)]">
          <div className="flex shrink-0 items-center gap-1 rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)] p-1">
            {([
              ['anchors', l(`定位 ${activeAnchors.length}`, `Locations ${activeAnchors.length}`)],
              ['notes', l(`笔记 ${notes.length}`, `Notes ${notes.length}`)],
            ] as Array<[DrawerTab, string]>).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDrawerTab(tab)}
                className={cn(
                  'h-7 flex-1 rounded-md px-2 text-xs font-medium transition',
                  drawerTab === tab
                    ? 'bg-[var(--pq-surface)] text-[var(--pq-text)] shadow-[var(--pq-shadow-soft)]'
                    : 'text-[var(--pq-text-muted)] hover:text-[var(--pq-text)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="mt-2 shrink-0 rounded-[var(--pq-radius-sm)] border border-[var(--pq-error-bg)] bg-[var(--pq-error-bg)] px-2.5 py-1.5 text-xs text-[var(--pq-error)]">
              {error}
            </div>
          ) : null}

          {drawerTab === 'anchors' ? (
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              {activeNote && activeAnchors.length > 0 ? (
                <div className="space-y-1.5">
                  {activeAnchors.map((anchor) => {
                    const hasLocation = anchorHasLocation(anchor);
                    const sourceTitle = anchorSourceTitle(anchor, documentTitle, l);
                    const pageLabel = anchorPageLabel(anchor, l);

                    return (
                      <div
                        key={anchor.id}
                        onContextMenu={(event) => openAnchorContextMenu(event, activeNote, anchor)}
                        className={cn(
                          'group w-full rounded-[var(--pq-radius-sm)] border bg-[var(--pq-surface)] px-2.5 py-2.5 text-left shadow-[var(--pq-shadow-soft)] transition',
                          hasLocation
                            ? 'border-[var(--pq-border-subtle)] hover:border-[var(--pq-border)]'
                            : 'border-transparent opacity-55',
                        )}
                      >
                        <span className="block border-l-2 border-[var(--pq-border-strong)] pl-2 text-xs leading-5 text-[var(--pq-text-secondary)]">
                          <span className="line-clamp-3 break-words">
                            “{excerptPreview(anchor.excerpt) || l('无摘录文本', 'No excerpt text')}”
                          </span>
                        </span>
                        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 pl-2">
                          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--pq-text-faint)]" title={sourceTitle}>
                            {sourceTitle}
                          </span>
                          {hasLocation ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onJumpToNoteAnchor(activeNote, anchor);
                              }}
                              className="rounded-md px-1 text-[11px] font-semibold text-[var(--pq-accent)] transition hover:bg-[var(--pq-accent-bg)] hover:text-[var(--pq-accent-hover)]"
                              title={l('点击定位到原文', 'Click to go to source')}
                              aria-label={l(`点击定位到原文 ${pageLabel}`, `Click to go to source ${pageLabel}`)}
                            >
                              {pageLabel}
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-[var(--pq-text-faint)]">
                              {pageLabel}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-28 items-center justify-center rounded-[var(--pq-radius-sm)] border border-dashed border-[var(--pq-border-subtle)] text-xs text-[var(--pq-text-faint)]">
                  {l('暂无摘录', 'No excerpts yet')}
                </div>
              )}
            </div>
          ) : null}

          {drawerTab === 'notes' ? (
            <div className="mt-2 flex min-h-0 flex-1 flex-col">
              <label className="pq-input flex h-8 shrink-0 items-center gap-2 px-2.5">
                <Search className="h-3.5 w-3.5 text-[var(--pq-text-faint)]" strokeWidth={1.8} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={l('搜索笔记', 'Search notes')}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--pq-text-faint)]"
                />
              </label>

              <select value={folderId} onChange={(event) => setFolderId(event.target.value)}
                className="pq-input mt-2 h-8 shrink-0 px-2 text-xs" aria-label={l('筛选笔记文件夹', 'Filter note folders')}>
                <option value="">{l('全部文件夹', 'All folders')}</option>
                <option value="__uncategorized__">{l('未分类', 'Uncategorized')}</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>

              <div className="mt-2 flex shrink-0 items-center gap-1 overflow-x-auto">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={cn(
                      'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition',
                      filter === item.key
                        ? 'bg-[var(--pq-bg-tertiary)] text-[var(--pq-text)]'
                        : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]',
                    )}
                  >
                    {l(item.zh, item.en)}
                  </button>
                ))}
              </div>

              {query ? <div className="mt-1 text-[11px] text-[var(--pq-text-faint)]" role="status">
                {!currentSearch
            ? l('正在检索…', 'Searching…')
            : currentSearch.error
              || l(
                `${currentSearch.result?.retrievalMode === 'hybrid' ? '混合检索' : '关键词检索'} · 当前文档 ${scopedNotes.length} 篇${currentSearch.result?.notes.length === 50 ? ' · 最多显示 50 条' : ''}${currentSearch.result?.warning ? ` · ${currentSearch.result.warning}` : ''}`,
                `${currentSearch.result?.retrievalMode === 'hybrid' ? 'Hybrid search' : 'Keyword search'} · ${scopedNotes.length} in this document${currentSearch.result?.notes.length === 50 ? ' · showing up to 50' : ''}${currentSearch.result?.warning ? ` · ${currentSearch.result.warning}` : ''}`,
              )}
              </div> : null}
              <div className="mt-1 flex shrink-0 items-center gap-1 overflow-x-auto">
                {PAGE_KIND_FILTERS.map((item) => (
                  <button key={item.key} type="button" onClick={() => setFilter(item.key)}
                    className={cn('shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition',
                      filter === item.key ? 'bg-[var(--pq-bg-tertiary)] text-[var(--pq-text)]' : 'text-[var(--pq-text-muted)] hover:bg-[var(--pq-hover)] hover:text-[var(--pq-text)]')}>
                    {l(item.zh, item.en)}
                  </button>
                ))}
              </div>

              <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="space-y-1.5">
                    <div className="h-9 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
                    <div className="h-9 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
                    <div className="h-9 animate-pulse rounded-[var(--pq-radius-sm)] bg-[var(--pq-bg-secondary)]" />
                  </div>
                ) : (
                  <NotesList
                    notes={filteredNotes}
                    channelsById={query ? channelsById : undefined}
                    activeNoteId={activeNoteId}
                    onSelect={(note) => {
                      onSelectNote(note);
                      setDrawerOpen(false);
                    }}
                    onDelete={(note) => onDeleteNote(note.id)}
                    onContextMenu={openNoteContextMenu}
                    onBatchUpdate={(patches) => {
                      void Promise.all(patches.map(({ noteId, patch }) => onUpdateNote(noteId, patch)));
                    }}
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 p-2">
        <NoteEditor
          key={activeNote?.id ?? 'no-note'}
          note={activeNote}
          saving={saving}
          onUpdate={onUpdateNote}
          notes={notes}
          papers={papers}
          pendingAnchorInsert={pendingAnchorInsert}
          onPendingAnchorInsertHandled={onPendingAnchorInsertHandled}
          editorSourceId={noteEditorSourceId}
          externalUpdateNote={externalUpdateNote}
          onExternalUpdateApply={onExternalUpdateApply}
          onJumpToNoteAnchor={onJumpToNoteAnchor}
          onPageKindChange={(nextPageKind) => {
            if (activeNote) void onUpdateNote(activeNote.id, { pageKind: nextPageKind });
          }}
          onPaperClick={onPaperClick}
          compact
        />
      </div>

      {contextMenu ? (
        <NotesContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={
            contextMenu.kind === 'anchor'
              ? contextMenu.anchor.label || l('摘录', 'Excerpt')
              : contextMenu.kind === 'note'
                ? contextMenu.note.title || l('未命名笔记', 'Untitled note')
                : l('笔记', 'Notes')
          }
          entries={contextMenuEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}
