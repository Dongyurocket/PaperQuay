import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMountedReaderTabIds } from '../src/features/reader/readerResourceBudget.ts';
import { sliceMineruPages } from '../src/features/reader/mineruSegments.ts';

test('inactive reader tabs hibernate after the mounted limit', () => {
  const mounted = chooseMountedReaderTabIds({
    readerTabIds: ['a', 'b', 'c'],
    activeTabId: 'c',
    recentTabIds: ['b', 'a'],
  });

  assert.deepEqual(mounted, ['b', 'c']);
});

test('a translating tab stays mounted even when it is not recent', () => {
  const mounted = chooseMountedReaderTabIds({
    readerTabIds: ['a', 'b', 'c'],
    activeTabId: 'home',
    recentTabIds: ['c'],
    busyTabIds: ['a'],
  });

  assert.deepEqual(mounted, ['a', 'c']);
});

test('MinerU page segments keep order and stop at the document end', () => {
  const pages = ['p0', 'p1', 'p2', 'p3'];
  assert.deepEqual(sliceMineruPages(pages, 1, 2), ['p1', 'p2']);
  assert.deepEqual(sliceMineruPages(pages, -4, 2), ['p0', 'p1']);
  assert.deepEqual(sliceMineruPages(pages, 3, 5), ['p3']);
});
