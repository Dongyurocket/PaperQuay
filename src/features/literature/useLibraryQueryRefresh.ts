import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LiteratureCategory } from '../../types/library';
import {
  LIBRARY_READING_UPDATED_EVENT,
  NATIVE_PAPER_UPDATED_EVENT,
  type LibraryReadingUpdatedEventDetail,
} from './libraryEvents.ts';
import { RAG_INDEX_STATUS_UPDATED_EVENT } from '../../services/ragIndexStatus.ts';

interface Options {
  enabled: boolean;
  ready: boolean;
  /** 正在按 RAG 状态筛选时，索引状态变化会改变成员资格。 */
  ragStatusActive?: boolean;
  refreshPapers: () => Promise<unknown>;
  listCategories: () => Promise<LiteratureCategory[]>;
  setCategories: Dispatch<SetStateAction<LiteratureCategory[]>>;
  /**
   * 阅读进度事件可被调用方按 id 增量处理；返回 true 表示已处理、不需要
   * 全量重查（分类计数与筛选成员资格不变）。缺少 detail 或调用方未提供
   * 处理器时保持原有全量刷新语义。
   */
  handleReadingUpdated?: (detail: LibraryReadingUpdatedEventDetail | null) => boolean;
}

const UPDATE_EVENTS = [
  'paperquay:native-summary-updated',
  NATIVE_PAPER_UPDATED_EVENT,
];

/** Requery membership, totals and ordering after writes, including while the library is hidden. */
export function useLibraryQueryRefresh(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const resumeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!options.enabled) return undefined;
    let cancelled = false;
    let pending = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      timer = null;
      const current = latest.current;
      if (!current.enabled || !current.ready) return;
      pending = false;
      const request = ++generation;
      void current.refreshPapers().catch((error) => console.error('Failed to refresh library query', error));
      void current.listCategories().then((categories) => {
        if (!cancelled && request === generation) latest.current.setCategories(categories);
      }).catch((error) => console.error('Failed to refresh library categories', error));
    };
    const schedule = () => {
      pending = true;
      if (timer !== null) clearTimeout(timer);
      timer = latest.current.ready ? setTimeout(refresh, 100) : null;
    };
    const handleReadingUpdated = (event: Event) => {
      const detail = (event as CustomEvent<LibraryReadingUpdatedEventDetail>).detail ?? null;
      if (latest.current.handleReadingUpdated?.(detail)) {
        return;
      }
      schedule();
    };
    const handleRagStatusUpdated = () => {
      if (latest.current.ragStatusActive) schedule();
    };
    resumeRef.current = () => { if (pending) schedule(); };
    for (const event of UPDATE_EVENTS) window.addEventListener(event, schedule);
    window.addEventListener(LIBRARY_READING_UPDATED_EVENT, handleReadingUpdated);
    window.addEventListener(RAG_INDEX_STATUS_UPDATED_EVENT, handleRagStatusUpdated);
    return () => {
      cancelled = true;
      resumeRef.current = null;
      if (timer !== null) clearTimeout(timer);
      for (const event of UPDATE_EVENTS) window.removeEventListener(event, schedule);
      window.removeEventListener(LIBRARY_READING_UPDATED_EVENT, handleReadingUpdated);
      window.removeEventListener(RAG_INDEX_STATUS_UPDATED_EVENT, handleRagStatusUpdated);
    };
  }, [options.enabled]);

  useEffect(() => {
    if (options.ready) resumeRef.current?.();
  }, [options.ready]);
}
