import type { LiteraturePaper } from '../../types/library';
import type { LibraryFilterState } from './libraryFilters';

/**
 * 查询触发键：只包含用户可控条件（筛选/排序/搜索/分类）。
 * MinerU 状态发现写回 `paperStatuses` / `mineruPaperIds`，但不进入该键，
 * 因此后台 stat 不会反复触发整页重查或清空当前选择。
 */
export function paperQueryConditionsKey(
  filters: LibraryFilterState,
  sort: { sortBy: string; sortDirection: string },
  search: string,
  categoryId: string | null,
): string {
  return JSON.stringify([filters, sort.sortBy, sort.sortDirection, search, categoryId]);
}

/**
 * MinerU「已解析」筛选依赖运行时状态：发现结束后只在筛选开启时补一次
 * 尾部查询；每个版本只处理一次，未开启筛选时把版本视为已处理。
 */
export function shouldRefreshForMineruDiscovery(input: {
  loading: boolean;
  mineruParsed: boolean;
  discoveryVersion: number;
  handledVersion: number;
}): boolean {
  if (input.loading) return false;
  if (!input.mineruParsed) return false;
  return input.discoveryVersion > input.handledVersion;
}

export type DebouncedQuerySkip =
  | { kind: 'first-screen'; conditionKey: string }
  | { kind: 'conditions'; conditionKey: string };

/**
 * 防抖查询跳过规则：skip 只在记录的条件键与当前条件键一致时才生效。
 * - `first-screen`：初始化已完成第一页查询，只有当前用户条件仍与首屏查询一致时
 *   才跳过；初始化期间用户改了筛选/搜索/排序/分类则必须重查；
 * - `conditions`：分类点击已经直接查询过，同样只在条件键未变时跳过。
 * 条件键一旦变化（筛选/搜索/排序/分类）立刻丢弃 skip，不能吞掉下一次查询。
 */
export function shouldSkipDebouncedQuery(input: {
  skip: DebouncedQuerySkip | null;
  currentKey: string;
}): boolean {
  if (!input.skip) return false;
  return input.skip.conditionKey === input.currentKey;
}

/**
 * 并发刷新计数闸门：`begin()` 增加在途刷新，`end()` 返回是否应清除
 * refreshing（只有最后一个结束者返回 true）。
 */
export function createRefreshingGate() {
  let inFlight = 0;
  return {
    begin(): void {
      inFlight += 1;
    },
    end(): boolean {
      inFlight = Math.max(0, inFlight - 1);
      return inFlight === 0;
    },
    get inFlight(): number {
      return inFlight;
    },
  };
}

/**
 * 后台状态刷新保留当前选择；用户条件变化仍按原规则解析，避免旧选择
 * 指向已不在结果集中的文献。
 */
export function resolveRefreshedSelection(
  current: string | null,
  nextPapers: LiteraturePaper[],
  preserveSelection: boolean,
  fallback: (current: string | null, nextPapers: LiteraturePaper[]) => string | null,
): string | null {
  if (preserveSelection && current) return current;
  return fallback(current, nextPapers);
}
