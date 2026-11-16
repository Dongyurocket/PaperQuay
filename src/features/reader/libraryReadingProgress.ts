import type { PdfScrollPosition, WorkspaceItem } from '../../types/reader';

export interface LibraryReadingUpdate {
  paperId: string;
  lastReadAt: number;
  readingProgress?: number;
}

export function nativeLibraryPaperId(item: WorkspaceItem): string | null {
  const id = item.itemKey?.trim();
  return item.source === 'native-library' && id && item.workspaceId === `native-library:${id}` ? id : null;
}

/** Reaching the final page marks the document finished; earlier pages use the viewer's scroll ratio. */
export function libraryReadingProgress(position: PdfScrollPosition, pageCount: number): number | null {
  if (!Number.isInteger(pageCount) || pageCount <= 0 || !Number.isFinite(position.page) || position.page < 1) {
    return null;
  }
  const page = Math.min(pageCount, Math.round(position.page));
  if (page === pageCount) return 1;
  const offset = typeof position.pageOffsetRatio === 'number' && Number.isFinite(position.pageOffsetRatio)
    ? Math.min(1, Math.max(0, position.pageOffsetRatio))
    : 0;
  return (page - 1 + offset) / pageCount;
}

/** Coalesce frequent scroll events; flushing on tab close keeps the latest pending update. */
export function createLibraryReadingWriter(
  send: (update: LibraryReadingUpdate) => Promise<void>,
  delayMs = 1000,
) {
  const pending = new Map<string, LibraryReadingUpdate>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const updates = [...pending.values()];
    pending.clear();
    for (const update of updates) {
      void send(update).catch((error) => console.error('Failed to save library reading progress', error));
    }
  };

  return {
    record(update: LibraryReadingUpdate) {
      const previous = pending.get(update.paperId);
      const progress = update.readingProgress === undefined ? previous?.readingProgress
        : previous?.readingProgress === undefined ? update.readingProgress
          : Math.max(previous.readingProgress, update.readingProgress);
      pending.set(update.paperId, {
        paperId: update.paperId,
        lastReadAt: Math.max(previous?.lastReadAt ?? 0, update.lastReadAt),
        ...(progress === undefined ? {} : { readingProgress: progress }),
      });
      if (timer === null) timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}
