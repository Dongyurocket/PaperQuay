import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionFilterGuard, type SelectionFilterSnapshot } from '../src/features/literature/selectionFilterGuard.ts';

const initialSnapshot = (): SelectionFilterSnapshot => ({
  categoryId: 'category A', search: '', filters: { source: 'all' },
});

test('discard an in-flight select-all after the filter changes, even if it changes back', async () => {
  const initial = initialSnapshot();
  const guard = createSelectionFilterGuard(initial);
  let resolve!: (ids: string[]) => void;
  const result = new Promise<string[]>((done) => { resolve = done; });
  const token = guard.capture();
  const selected: string[] = [];
  const applying = result.then((ids) => { if (guard.isCurrent(token)) selected.push(...ids); });
  guard.update({ ...initial, categoryId: 'category B' });
  guard.update(initial);
  resolve(['old-paper']);
  await applying;
  assert.deepEqual(selected, []);
  assert.equal(guard.isLatest(token), true);
  const latest = guard.capture();
  assert.equal(guard.isCurrent(token), false);
  assert.equal(guard.isCurrent(latest), true);
});

test('category, search and filter identity each invalidate a pending select-all', () => {
  const initial = initialSnapshot();
  const changes: Partial<SelectionFilterSnapshot>[] = [
    { categoryId: null },
    { search: 'new search' },
    { filters: { source: 'all' } },
  ];
  for (const change of changes) {
    const guard = createSelectionFilterGuard(initial);
    const token = guard.capture();
    guard.update({ ...initial, ...change });
    assert.equal(guard.isCurrent(token), false, JSON.stringify(change));
  }
});

test('MinerU status discovery does not invalidate a pending select-all', () => {
  const initial = initialSnapshot();
  const guard = createSelectionFilterGuard(initial);
  const token = guard.capture();
  // 状态发现只更新 paperStatuses / mineruPaperIds，不改变用户筛选对象。
  guard.update({ ...initial });
  assert.equal(guard.isCurrent(token), true);
});

test('unrelated renders keep the snapshot valid and only the latest request may apply', () => {
  const initial = initialSnapshot();
  const guard = createSelectionFilterGuard(initial);
  const first = guard.capture();
  guard.update({ ...initial });
  assert.equal(guard.isCurrent(first), true);
  const second = guard.capture();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isLatest(first), false);
  assert.equal(guard.isCurrent(second), true);
});
