import type { MouseEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { Note } from '../../types/notes';
import { cn } from '../../utils/cn';

interface NoteCardProps {
  note: Note;
  active: boolean;
  onSelect: (note: Note) => void;
  onDelete: (note: Note) => void;
  onContextMenu?: (event: MouseEvent, note: Note) => void;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}

export function NoteCard({
  note,
  active,
  onSelect,
  onDelete,
  onContextMenu,
  selected = false,
  onSelectedChange,
}: NoteCardProps) {
  return (
    <article
      onContextMenu={(event) => onContextMenu?.(event, note)}
      className={cn(
        'group relative overflow-hidden rounded-[var(--pq-radius-sm)] border transition',
        active
          ? 'border-[var(--pq-accent-border)] bg-[var(--pq-accent-bg)]'
          : 'border-transparent bg-transparent hover:border-[var(--pq-border-subtle)] hover:bg-[var(--pq-hover)]',
      )}
    >
      {active ? <div className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--pq-accent)]" /> : null}

      <div className="flex items-start">
        {onSelectedChange ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
            className="ml-3 mt-2 shrink-0"
            aria-label={`选择 ${note.title}`}
          />
        ) : null}
        <button type="button" onClick={() => onSelect(note)} className="block min-w-0 flex-1 py-2 pl-3 pr-10 text-left">
          <div className="truncate text-sm font-medium text-[var(--pq-text)]">
            {note.title || 'Untitled Note'}
          </div>
        </button>
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onDelete(note)}
          className="pq-icon-button h-7 w-7 rounded-md"
          aria-label="Delete note"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>
    </article>
  );
}
