import { useEffect, useMemo, useState } from 'react';
import type { LibraryTagCount, LiteratureCategory, LiteraturePaper } from '../../types/library';
import { listLibraryTags } from '../../services/library';
import { loadLibraryFilters, persistLibraryFilters } from './libraryFilters';

interface Options {
  demoPapers?: LiteraturePaper[];
  categories: LiteratureCategory[];
  paperStatuses: Record<string, { mineruParsed: boolean }>;
}

/** Own persistence and full-library filter metadata outside the workspace view. */
export function useLibraryFilters({ demoPapers, categories, paperStatuses }: Options) {
  const [filters, setFilters] = useState(loadLibraryFilters);
  const [libraryTags, setLibraryTags] = useState<LibraryTagCount[]>([]);
  const mineruIdKey = filters.mineruParsed
    ? JSON.stringify(Object.entries(paperStatuses).filter(([, status]) => status.mineruParsed).map(([id]) => id).sort())
    : '[]';
  const mineruPaperIds = useMemo<string[]>(() => JSON.parse(mineruIdKey) as string[], [mineruIdKey]);

  useEffect(() => persistLibraryFilters(filters), [filters]);
  useEffect(() => {
    if (demoPapers) {
      const counts = new Map<string, LibraryTagCount>();
      for (const paper of demoPapers) {
        for (const tag of new Map(paper.tags.map((item) => [item.id, item])).values()) {
          counts.set(tag.id, { ...tag, count: (counts.get(tag.id)?.count ?? 0) + 1 });
        }
      }
      setLibraryTags([...counts.values()]);
      return;
    }
    let cancelled = false;
    void listLibraryTags().then((tags) => { if (!cancelled) setLibraryTags(tags); }).catch(() => {});
    return () => { cancelled = true; };
  }, [demoPapers, categories]);

  return { filters, setFilters, libraryTags, mineruIdKey, mineruPaperIds };
}
