import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRefreshingGate,
  paperQueryConditionsKey,
  resolveRefreshedSelection,
  shouldRefreshForMineruDiscovery,
  shouldSkipDebouncedQuery,
} from '../src/features/literature/libraryQueryPolicy.ts';
import type { LibraryFilterState } from '../src/features/literature/libraryFilters.ts';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const filters: LibraryFilterState = {
  favorite: false,
  recentlyRead: false,
  tagIds: [],
  yearFrom: null,
  yearTo: null,
  itemTypes: [],
  readStatus: null,
  hasPdf: false,
  hasTranslatedPdf: false,
  missingFile: false,
  hasSummary: false,
  mineruParsed: true,
  source: '',
  ragMembership: 'all',
};

test('query conditions key ignores MinerU status discovery but tracks user conditions', () => {
  const base = paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-all');
  const sameConditions = paperQueryConditionsKey({ ...filters }, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-all');
  assert.equal(base, sameConditions, 'status updates create new filter objects but not new user conditions');

  assert.notEqual(
    base,
    paperQueryConditionsKey({ ...filters, favorite: true }, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-all'),
  );
  assert.notEqual(
    base,
    paperQueryConditionsKey(filters, { sortBy: 'title', sortDirection: 'asc' }, '', 'cat-all'),
  );
  assert.notEqual(
    base,
    paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, 'kv cache', 'cat-all'),
  );
  assert.notEqual(
    base,
    paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-other'),
  );
});

test('MinerU discovery only requests a trailing refresh when the filter is on', () => {
  assert.equal(shouldRefreshForMineruDiscovery({
    loading: false, mineruParsed: true, discoveryVersion: 3, handledVersion: 2,
  }), true);
  assert.equal(shouldRefreshForMineruDiscovery({
    loading: false, mineruParsed: true, discoveryVersion: 2, handledVersion: 2,
  }), false, 'one refresh per discovery burst');
  assert.equal(shouldRefreshForMineruDiscovery({
    loading: false, mineruParsed: false, discoveryVersion: 5, handledVersion: 0,
  }), false, 'background discovery must not requery while the filter is off');
  assert.equal(shouldRefreshForMineruDiscovery({
    loading: true, mineruParsed: true, discoveryVersion: 5, handledVersion: 0,
  }), false, 'first load must not race the initial page query');
});

test('the first-screen duplicate query is skipped only when user conditions are unchanged', () => {
  const firstScreenKey = paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-all');

  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'first-screen', conditionKey: firstScreenKey },
    currentKey: firstScreenKey,
  }), true, 'unchanged conditions may reuse the first page query');

  const userChangedKey = paperQueryConditionsKey(
    { ...filters, favorite: true },
    { sortBy: 'manual', sortDirection: 'asc' },
    '',
    'cat-all',
  );
  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'first-screen', conditionKey: firstScreenKey },
    currentKey: userChangedKey,
  }), false, 'a filter changed during first load must not be swallowed');
  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'first-screen', conditionKey: firstScreenKey },
    currentKey: paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, 'kv cache', 'cat-all'),
  }), false, 'a search changed during first load must not be swallowed');
  assert.equal(shouldSkipDebouncedQuery({ skip: null, currentKey: firstScreenKey }), false);
});

test('a category click skips the debounced query only for its own condition key', () => {
  const currentKey = paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-user');
  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'conditions', conditionKey: currentKey },
    currentKey,
  }), true, 'the direct category query already ran for these conditions');

  const differentCategoryKey = paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-other');
  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'conditions', conditionKey: currentKey },
    currentKey: differentCategoryKey,
  }), false, 'a different category must not reuse the category-click skip');

  const changedFilterKey = paperQueryConditionsKey({ ...filters, favorite: true }, { sortBy: 'manual', sortDirection: 'asc' }, '', 'cat-user');
  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'conditions', conditionKey: currentKey },
    currentKey: changedFilterKey,
  }), false, 'a filter change after a category click must not be swallowed');

  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'conditions', conditionKey: currentKey },
    currentKey: paperQueryConditionsKey(filters, { sortBy: 'manual', sortDirection: 'asc' }, 'kv cache', 'cat-user'),
  }), false, 'a search change after a category click must not be swallowed');

  assert.equal(shouldSkipDebouncedQuery({
    skip: { kind: 'conditions', conditionKey: currentKey },
    currentKey: paperQueryConditionsKey(filters, { sortBy: 'title', sortDirection: 'asc' }, '', 'cat-user'),
  }), false, 'a sort change after a category click must not be swallowed');
});

test('the unconditional category-click skip kind no longer exists', () => {
  const policy = read('src/features/literature/libraryQueryPolicy.ts');
  assert.equal(policy.includes("'unconditional'"), false, 'no caller may skip every pending debounced query');
  assert.doesNotMatch(policy, /kind: 'unconditional'/);
});

test('concurrent refreshes only clear the refreshing flag after the last one finishes', () => {
  const gate = createRefreshingGate();
  gate.begin();
  assert.equal(gate.inFlight, 1);
  gate.begin();
  assert.equal(gate.inFlight, 2);

  assert.equal(gate.end(), false, 'the first finally must not hide the second refresh');
  assert.equal(gate.inFlight, 1);
  assert.equal(gate.end(), true, 'the last refresh clears the flag');
  assert.equal(gate.inFlight, 0);
  assert.equal(gate.end(), true, 'never negative');
});

test('background refresh preserves selection while user condition changes re-resolve it', () => {
  const papers = [{ id: 'paper-2' }] as any[];
  const fallback = (current: string | null) => (current === 'paper-1' ? 'paper-2' : current);
  assert.equal(resolveRefreshedSelection('paper-1', papers, true, fallback), 'paper-1');
  assert.equal(resolveRefreshedSelection('paper-1', papers, false, fallback), 'paper-2');
  assert.equal(resolveRefreshedSelection(null, papers, true, fallback), null);
});

test('catalog records the resolved first-screen category and wires both skip modes', () => {
  const catalog = read('src/features/literature/hooks/useLibraryCatalog.ts');

  // 首屏键必须用 loadLibraryFirstScreen 解析出的 initialCategoryId；
  // 挂载时的 selectedCategoryId 是 null，用它会导致跳过逻辑永远失效。
  const skipAssignment = catalog.slice(
    catalog.indexOf('skipNextDebouncedQueryRef.current = {'),
    catalog.indexOf('setSettings(snapshot.settings)'),
  );
  assert.match(skipAssignment, /kind: 'first-screen'/);
  assert.match(skipAssignment, /initialCategoryId/);
  assert.doesNotMatch(skipAssignment, /queryState\.selectedCategoryId/);

  assert.equal(
    catalog.includes("kind: 'unconditional'"),
    false,
    'category clicks must not write an unconditional skip',
  );
  assert.match(
    catalog,
    /skipNextDebouncedQueryRef\.current = \{\s*kind: 'conditions',\s*conditionKey: paperQueryConditionsKey\(/,
    'category queries bind the skip to the queried condition key',
  );
  assert.match(catalog, /shouldSkipDebouncedQuery\(\{ skip, currentKey: queryConditionsKey \}\)/);

  // 分类点击与分类动作（创建/删除/拖放）共用同一个登记方法，
  // 避免直接 setSelectedCategoryId + refreshPapers 再被防抖 effect 重查一次。
  assert.match(
    catalog,
    /markCategoryQueryHandled: \(categoryId: string \| null\) => void;/,
    'catalog 接口暴露 markCategoryQueryHandled 供分类动作复用',
  );
  const markStart = catalog.indexOf('const markCategoryQueryHandled = useCallback(');
  assert.notEqual(markStart, -1, 'markCategoryQueryHandled 必须是稳定回调');
  const markEnd = catalog.indexOf('const handleSelectCategory', markStart);
  assert.notEqual(markEnd, -1, 'markCategoryQueryHandled 必须定义在 handleSelectCategory 之前');
  const markBlock = catalog.slice(markStart, markEnd);
  assert.match(markBlock, /queryState\.filters/);
  assert.match(markBlock, /queryState\.paperSort/);
  assert.match(markBlock, /queryState\.searchQuery/);
  assert.match(markBlock, /categoryId/);
  assert.match(markBlock, /paperQueryConditionsKey\(/);
  assert.match(markBlock, /kind: 'conditions'/);

  const selectStart = catalog.indexOf('const handleSelectCategory = (categoryId: string) => {');
  assert.notEqual(selectStart, -1, 'handleSelectCategory must exist');
  const selectEnd = catalog.indexOf('const reloadAfterPaperUpdate', selectStart);
  const selectBlock = catalog.slice(selectStart, selectEnd);
  assert.match(
    selectBlock,
    /markCategoryQueryHandled\(categoryId\);/,
    'category clicks delegate skip recording to markCategoryQueryHandled',
  );
  assert.doesNotMatch(
    selectBlock,
    /skipNextDebouncedQueryRef\.current = \{/,
    'category clicks no longer write the skip inline',
  );
  assert.match(
    catalog,
    /markCategoryQueryHandled,\r?\n/,
    'catalog 返回值必须包含 markCategoryQueryHandled',
  );
  assert.match(
    selectBlock,
    /if \(selectedCategoryIdRef\.current === categoryId\) \{\s*return;/,
    'clicking the already selected category must return before writing skip/error or querying',
  );
  assert.match(
    selectBlock,
    /selectedCategoryIdRef\.current = categoryId;/,
    'the ref must update synchronously so same-tick double clicks only query once',
  );
  const selectedCategoryState = catalog.indexOf(
    'const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);',
  );
  assert.notEqual(selectedCategoryState, -1);
  assert.match(
    catalog.slice(selectedCategoryState, selectedCategoryState + 400),
    /selectedCategoryIdRef\.current = selectedCategoryId;/,
    'the sync ref must track committed state on every render',
  );
  assert.equal(catalog.includes('skipNextDebouncedQueryRef.current = true;'), false);
  assert.equal(
    catalog.includes('skipNextDebouncedQueryRef.current = !queryState.filters.mineruParsed'),
    false,
  );
  assert.equal(catalog.includes('const queryState = queryStateRef.current;'), true);
  assert.equal(catalog.includes("source: 'status'"), true);
  assert.equal(catalog.includes('preserveSelection: true'), true);
  assert.equal(catalog.includes('setPapersRefreshing(true)'), true);
  assert.match(catalog, /refreshGateRef\.current\.begin\(\)/);
  assert.match(catalog, /if \(refreshGateRef\.current\.end\(\)\) setPapersRefreshing\(false\)/);
  assert.equal(catalog.includes("options.source !== 'status'"), true);

  // refreshPapers 的依赖不应包含会随状态发现变化的 mineruPaperIds/filters。
  const refreshStart = catalog.indexOf('const refreshPapers = useCallback(');
  const refreshEnd = catalog.indexOf('useLibraryQueryRefresh({', refreshStart);
  const refreshBlock = catalog.slice(refreshStart, refreshEnd);
  assert.equal(refreshBlock.includes('mineruPaperIds'), true, 'query reads the latest ids from the ref');
  assert.equal(
    /\[demoLibrary[^\]]*mineruPaperIds/.test(refreshBlock.slice(-300)),
    false,
    'refreshPapers identity must not depend on status-derived ids',
  );
});

test('onAllPapersChange dead wiring is gone', () => {
  const files = [
    'src/features/literature/hooks/useLibraryCatalog.ts',
    'src/features/literature/hooks/useMetadataJobs.ts',
    'src/features/literature/LiteratureLibraryView.tsx',
  ];
  for (const file of files) {
    assert.equal(read(file).includes('onAllPapersChange'), false, `${file} must not keep the unused callback`);
  }
});
