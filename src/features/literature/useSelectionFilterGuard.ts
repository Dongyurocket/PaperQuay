import { useRef } from 'react';
import { createSelectionFilterGuard, type SelectionFilterSnapshot } from './selectionFilterGuard';

export function useSelectionFilterGuard(snapshot: SelectionFilterSnapshot) {
  const guard = useRef<ReturnType<typeof createSelectionFilterGuard> | null>(null);
  if (!guard.current) guard.current = createSelectionFilterGuard(snapshot);
  guard.current.update(snapshot);
  return guard.current;
}
