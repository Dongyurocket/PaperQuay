import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LiteratureCategory } from '../../types/library';
import { LIBRARY_READING_UPDATED_EVENT, NATIVE_PAPER_UPDATED_EVENT } from './libraryEvents.ts';

interface Options {
  enabled: boolean;
  ready: boolean;
  refreshPapers: () => Promise<unknown>;
  listCategories: () => Promise<LiteratureCategory[]>;
  setCategories: Dispatch<SetStateAction<LiteratureCategory[]>>;
}

const UPDATE_EVENTS = [
  'paperquay:native-summary-updated',
  NATIVE_PAPER_UPDATED_EVENT,
  LIBRARY_READING_UPDATED_EVENT,
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
    resumeRef.current = () => { if (pending) schedule(); };
    for (const event of UPDATE_EVENTS) window.addEventListener(event, schedule);
    return () => {
      cancelled = true;
      resumeRef.current = null;
      if (timer !== null) clearTimeout(timer);
      for (const event of UPDATE_EVENTS) window.removeEventListener(event, schedule);
    };
  }, [options.enabled]);

  useEffect(() => {
    if (options.ready) resumeRef.current?.();
  }, [options.ready]);
}
