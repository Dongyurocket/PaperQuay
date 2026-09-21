import test from 'node:test';
import assert from 'node:assert/strict';

import {
  areVirtualWindowsEqual,
  getVirtualOffset,
  resolveVirtualWindow,
} from '../src/utils/virtualWindow.ts';

test('resolveVirtualWindow returns an empty window for no items', () => {
  assert.deepEqual(
    resolveVirtualWindow({
      itemCount: 0,
      getItemSize: () => 40,
      scrollOffset: 0,
      viewportSize: 200,
      overscan: 2,
    }),
    {
      startIndex: 0,
      endIndex: 0,
      paddingStart: 0,
      paddingEnd: 0,
      totalSize: 0,
    },
  );
});

test('resolveVirtualWindow keeps only the viewport plus overscan', () => {
  const window = resolveVirtualWindow({
    itemCount: 100,
    getItemSize: () => 50,
    scrollOffset: 1000,
    viewportSize: 200,
    overscan: 2,
  });

  assert.equal(window.totalSize, 5000);
  assert.equal(window.startIndex, 17);
  assert.equal(window.endIndex, 26);
  assert.equal(window.paddingStart, 850);
  assert.equal(window.paddingEnd, 3700);
  assert.equal(window.endIndex - window.startIndex, 9);
});

test('resolveVirtualWindow clamps to the document bounds', () => {
  const window = resolveVirtualWindow({
    itemCount: 5,
    getItemSize: (index) => (index === 4 ? 80 : 40),
    scrollOffset: 0,
    viewportSize: 1000,
    overscan: 12,
  });

  assert.equal(window.startIndex, 0);
  assert.equal(window.endIndex, 5);
  assert.equal(window.paddingStart, 0);
  assert.equal(window.paddingEnd, 0);
  assert.equal(window.totalSize, 240);
});

test('getVirtualOffset sums sizes before the target index', () => {
  assert.equal(
    getVirtualOffset(3, (index) => (index + 1) * 10),
    60,
  );
  assert.equal(getVirtualOffset(0, () => 40), 0);
});

test('areVirtualWindowsEqual compares the rendered range and spacers', () => {
  const left = {
    startIndex: 2,
    endIndex: 8,
    paddingStart: 100,
    paddingEnd: 400,
    totalSize: 900,
  };

  assert.equal(areVirtualWindowsEqual(left, { ...left }), true);
  assert.equal(areVirtualWindowsEqual(left, { ...left, startIndex: 3 }), false);
});
