import test from 'node:test';
import assert from 'node:assert/strict';

import { packDisconnectedComponents } from '../src/features/graph/graphLayoutMessages.ts';

function bbox(positions: Array<{ id: string; x: number; y: number }>) {
  const xs = positions.map((position) => position.x);
  const ys = positions.map((position) => position.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test('shelf packing keeps components separated by at least the configured gap', () => {
  const nodes = [
    { id: 'a1' }, { id: 'a2' }, { id: 'b1' }, { id: 'b2' }, { id: 'c1' },
  ];
  const edges = [
    { source: 'a1', target: 'a2' },
    { source: 'b1', target: 'b2' },
  ];
  const positions = [
    { id: 'a1', x: 0, y: 0 }, { id: 'a2', x: 10, y: 0 },
    { id: 'b1', x: 500, y: 500 }, { id: 'b2', x: 520, y: 500 },
    { id: 'c1', x: -400, y: 200 },
  ];

  const packed = packDisconnectedComponents(nodes, edges, positions, { gap: 40 });
  assert.equal(packed.length, positions.length);
  assert.deepEqual(packed.map((position) => position.id).sort(), positions.map((position) => position.id).sort());

  // 三个分量（a/b/c）的包围盒两两不重叠，且水平/垂直间距不小于 gap。
  const groups = [
    packed.filter((position) => position.id.startsWith('a')),
    packed.filter((position) => position.id.startsWith('b')),
    packed.filter((position) => position.id.startsWith('c')),
  ].map(bbox);

  for (let left = 0; left < groups.length; left += 1) {
    for (let right = left + 1; right < groups.length; right += 1) {
      const a = groups[left];
      const b = groups[right];
      const separated = a.maxX + 40 <= b.minX
        || b.maxX + 40 <= a.minX
        || a.maxY + 40 <= b.minY
        || b.maxY + 40 <= a.minY;
      assert.ok(separated, `components ${left}/${right} overlap or violate the gap`);
    }
  }
});

test('single-component layouts are returned untouched', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b' }];
  const positions = [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 3, y: 4 }];
  assert.deepEqual(packDisconnectedComponents(nodes, edges, positions), positions);
});
