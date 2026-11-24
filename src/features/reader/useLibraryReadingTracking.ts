import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '../../platform/electron/core.ts';
import { LIBRARY_READING_UPDATED_EVENT } from '../literature/libraryEvents.ts';
import type { PdfScrollPosition, WorkspaceItem } from '../../types/reader';
import { createLibraryReadingWriter, libraryReadingProgress, nativeLibraryPaperId } from './libraryReadingProgress.ts';

export function useLibraryReadingTracking(options: {
  document: WorkspaceItem;
  expectedWorkspaceId: string;
  active: boolean;
  sourceKey: string;
  pageCount: number;
  position: PdfScrollPosition | null;
}) {
  const writerRef = useRef<ReturnType<typeof createLibraryReadingWriter> | null>(null);
  if (!writerRef.current) {
    writerRef.current = createLibraryReadingWriter(async (request) => {
      const updated = await invoke<boolean>('library_record_reading', { request });
      if (updated) {
        window.dispatchEvent(new CustomEvent(LIBRARY_READING_UPDATED_EVENT, { detail: request }));
      }
    });
  }
  const writer = writerRef.current;
  const paperId = options.active && options.sourceKey && options.document.workspaceId === options.expectedWorkspaceId
    ? nativeLibraryPaperId(options.document)
    : null;

  useEffect(() => {
    if (!paperId) return undefined;
    writer.record({ paperId, lastReadAt: Date.now() });
    writer.flush();
    const flush = () => writer.flush();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [paperId, writer]);

  const recordPosition = useCallback((position: PdfScrollPosition) => {
    if (!paperId || position.sourceKey !== options.sourceKey) return;
    const progress = libraryReadingProgress(position, options.pageCount);
    if (progress === null) return;
    writer.record({ paperId, lastReadAt: Date.now(), readingProgress: progress });
  }, [paperId, options.pageCount, options.sourceKey, writer]);

  useEffect(() => {
    if (options.position) {
      recordPosition(options.position);
    } else if (options.pageCount === 1 && options.sourceKey) {
      recordPosition({ sourceKey: options.sourceKey, page: 1, top: 0, left: 0, pageOffsetTop: 0, updatedAt: Date.now() });
    }
  }, [options.pageCount, options.position, options.sourceKey, recordPosition]);

  return recordPosition;
}
