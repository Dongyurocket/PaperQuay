import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Note, NoteFolder } from '../../types/notes';
import { listNoteFolders } from '../../services/notes';
import { NoteCard } from './NoteCard';
import { buildBatchNotePatches, buildBatchTagPatches, sortNotes, type NoteListSort } from './notesQuickWins';

interface NotesListProps {
  notes: Note[];
  activeNoteId: string | null;
  onSelect: (note: Note) => void;
  onDelete: (note: Note) => void;
  onContextMenu?: (event: MouseEvent, note: Note) => void;
  onBatchUpdate?: (patches: Array<{ noteId: string; patch: { tags?: string[]; folderId?: string | null } }>) => void;
}

export function NotesList({
  notes,
  activeNoteId,
  onSelect,
  onDelete,
  onContextMenu,
  onBatchUpdate,
}: NotesListProps) {
  const [sort, setSort] = useState<NoteListSort>('updatedAt');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const sortedNotes = useMemo(() => sortNotes(notes, sort), [notes, sort]);
  const canBatchUpdate = Boolean(onBatchUpdate);

  useEffect(() => {
    if (!canBatchUpdate) return;
    let cancelled = false;
    void listNoteFolders()
      .then((items) => {
        if (!cancelled) setFolders(items);
      })
      .catch(() => {
        if (!cancelled) setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canBatchUpdate]);

  if (notes.length === 0) {
    return (
      <div className="rounded-[var(--pq-radius-md)] border border-dashed border-[var(--pq-border-subtle)] bg-[var(--pq-surface-1)] px-4 py-7 text-center text-sm text-[var(--pq-text-faint)]">
        No notes
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as NoteListSort)}
          className="pq-input h-7 min-w-0 flex-1 px-2 text-[11px]"
          aria-label="笔记排序"
        >
          <option value="updatedAt">按更新时间</option>
          <option value="createdAt">按创建时间</option>
          <option value="title">按标题</option>
        </select>
        {selectedIds.size > 0 && onBatchUpdate ? (
          <>
            <button
              type="button"
              className="pq-icon-button h-7 px-2 text-[11px]"
              onClick={() => {
                const tag = window.prompt('添加标签')?.trim();
                if (!tag) return;
                onBatchUpdate(buildBatchTagPatches(notes, [...selectedIds], tag));
                setSelectedIds(new Set());
              }}
            >
              标签
            </button>
            <select
              className="pq-input h-7 max-w-36 px-2 text-[11px]"
              value=""
              aria-label="批量移动到文件夹"
              onChange={(event) => {
                onBatchUpdate(buildBatchNotePatches([...selectedIds], {
                  folderId: event.target.value === '__uncategorized__' ? null : event.target.value,
                }));
                setSelectedIds(new Set());
              }}
            >
              <option value="">移动到...</option>
              <option value="__uncategorized__">未分类</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      {sortedNotes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          active={note.id === activeNoteId}
          onSelect={onSelect}
          onDelete={onDelete}
          onContextMenu={onContextMenu}
          selected={selectedIds.has(note.id)}
          onSelectedChange={onBatchUpdate ? (selected) => setSelectedIds((current) => {
            const next = new Set(current);
            if (selected) next.add(note.id);
            else next.delete(note.id);
            return next;
          }) : undefined}
        />
      ))}
    </div>
  );
}
