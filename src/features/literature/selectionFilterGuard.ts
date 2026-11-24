export interface SelectionFilterSnapshot {
  categoryId: string | null;
  search: string;
  filters: object;
}

export function createSelectionFilterGuard(initialSnapshot: SelectionFilterSnapshot) {
  let snapshot = initialSnapshot;
  let revision = 0;
  let request = 0;
  return {
    update(nextSnapshot: SelectionFilterSnapshot) {
      // 只看用户条件：MinerU 后台状态发现会改变可用 paper id 集合，但不改变
      // 用户选择语义，不能因此丢弃在途的全选结果或清空选择。
      if (snapshot.categoryId !== nextSnapshot.categoryId
        || snapshot.search !== nextSnapshot.search
        || snapshot.filters !== nextSnapshot.filters) {
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
