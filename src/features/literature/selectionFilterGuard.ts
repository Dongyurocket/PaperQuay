export interface SelectionFilterSnapshot {
  categoryId: string | null;
  search: string;
  filters: object;
  mineruIdKey: string;
}

export function createSelectionFilterGuard(initialSnapshot: SelectionFilterSnapshot) {
  let snapshot = initialSnapshot;
  let revision = 0;
  let request = 0;
  return {
    update(nextSnapshot: SelectionFilterSnapshot) {
      if (snapshot.categoryId !== nextSnapshot.categoryId
        || snapshot.search !== nextSnapshot.search
        || snapshot.filters !== nextSnapshot.filters
        || snapshot.mineruIdKey !== nextSnapshot.mineruIdKey) {
        snapshot = nextSnapshot;
        revision += 1;
      }
    },
    capture() {
      request += 1;
      return { revision, request };
    },
    isCurrent(token: { revision: number; request: number }) {
      return token.revision === revision && token.request === request;
    },
    isLatest(token: { request: number }) {
      return token.request === request;
    },
  };
}
