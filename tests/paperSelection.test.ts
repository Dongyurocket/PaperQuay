import test from 'node:test';
import assert from 'node:assert/strict';

import {
  capturePaperSelection,
  EMPTY_PAPER_SELECTION,
  replacePaperSelection,
  selectionCheckState,
  selectionCount,
  togglePaperSelection,
} from '../src/features/literature/paperSelection.ts';

test('select-all freezes the id snapshot and stays complete until an item changes', () => {
  const captured = capturePaperSelection(['p3', 'p1', 'p3', 'p2']);

  assert.deepEqual(captured.ids, ['p3', 'p1', 'p2']);
  assert.equal(captured.mode, 'all');
  assert.equal(selectionCheckState(captured), 'all');
  assert.equal(selectionCount(captured), 3);

  const partial = togglePaperSelection(captured, 'p1');
  assert.deepEqual(partial.ids, ['p3', 'p2']);
  assert.equal(partial.mode, 'manual');
  assert.equal(selectionCheckState(partial), 'partial');

  assert.equal(selectionCheckState(togglePaperSelection(partial, 'p2')), 'partial');
  assert.deepEqual(togglePaperSelection(togglePaperSelection(partial, 'p2'), 'p3'), EMPTY_PAPER_SELECTION);
});

test('manual range selection is partial and does not claim the whole filter', () => {
  const range = replacePaperSelection(['b', 'a', 'b']);

  assert.deepEqual(range, { ids: ['b', 'a'], mode: 'manual' });
  assert.equal(selectionCheckState(range), 'partial');
  assert.equal(selectionCheckState(range, 2), 'all');
  assert.equal(selectionCheckState(range, 3), 'partial');
  assert.deepEqual(replacePaperSelection([]), EMPTY_PAPER_SELECTION);
  assert.equal(selectionCheckState(EMPTY_PAPER_SELECTION), 'none');
});

test('an explicit click can add a paper that was not in the select-all snapshot', () => {
  const captured = capturePaperSelection(['p1', 'p2']);
  const expanded = togglePaperSelection(captured, 'p9');

  assert.deepEqual(expanded.ids, ['p1', 'p2', 'p9']);
  assert.equal(expanded.mode, 'manual');
  assert.equal(selectionCheckState(expanded), 'partial');
});
