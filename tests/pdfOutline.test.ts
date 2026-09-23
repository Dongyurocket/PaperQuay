import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMineruOutline,
  collectOutlineIds,
  countOutlineItems,
  filterOutline,
  findActiveOutlineId,
  flattenOutline,
  normalizePdfOutline,
} from '../src/features/pdf/pdfOutline.ts';
import type { PositionedMineruBlock } from '../src/types/reader.ts';

function titleBlock(
  blockId: string,
  pageIndex: number,
  text: string,
  textLevel?: number,
): PositionedMineruBlock {
  const content: Record<string, unknown> = { text };
  if (typeof textLevel === 'number') {
    content.text_level = textLevel;
  }
  return {
    blockId,
    pageIndex,
    blockIndex: 0,
    type: 'title',
    content,
  } as unknown as PositionedMineruBlock;
}

test('normalizePdfOutline keeps hierarchy and destinations', () => {
  const items = normalizePdfOutline([
    {
      title: 'Chapter 1',
      dest: 'chap1',
      items: [
        { title: 'Section 1.1', dest: [{ num: 3, gen: 0 }, { name: 'Fit' }] },
        { title: '', items: [] },
      ],
    },
    { title: '  Chapter   2  ', dest: 'chap2' },
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Chapter 1');
  assert.equal(items[0].depth, 1);
  assert.equal(items[0].source, 'pdf-outline');
  assert.equal(items[0].destination, 'chap1');
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].title, 'Section 1.1');
  assert.equal(items[0].children[0].depth, 2);
  // 标题空白被压缩为单空格
  assert.equal(items[1].title, 'Chapter 2');
  assert.equal(countOutlineItems(items), 3);
});

test('normalizePdfOutline skips empty titleless nodes and accepts null input', () => {
  assert.deepEqual(normalizePdfOutline(null), []);
  assert.deepEqual(normalizePdfOutline([{ title: '', items: [] }]), []);
});

test('buildMineruOutline nests known levels and flattens unknown levels', () => {
  const items = buildMineruOutline([
    titleBlock('b1', 0, 'Intro', 1),
    titleBlock('b2', 1, 'Background', 2),
    { blockId: 'x1', pageIndex: 1, blockIndex: 1, type: 'text', content: { text: 'body' } } as unknown as PositionedMineruBlock,
    titleBlock('b3', 2, 'Methods', 1),
    titleBlock('b4', 3, 'Loose heading'),
    titleBlock('b5', 4, ''),
  ]);

  // b5 空标题跳过；b4 未知层级平铺到根
  assert.equal(items.length, 3);
  assert.equal(items[0].blockId, 'b1');
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].blockId, 'b2');
  assert.equal(items[0].children[0].depth, 2);
  assert.equal(items[1].blockId, 'b3');
  assert.equal(items[2].blockId, 'b4');
  assert.equal(items[2].depth, 1);
  assert.equal(items[0].pageIndex, 0);
  assert.equal(items[0].source, 'mineru-heading');
});

test('flattenOutline respects collapsed ids', () => {
  const items = buildMineruOutline([
    titleBlock('b1', 0, 'Intro', 1),
    titleBlock('b2', 1, 'Background', 2),
    titleBlock('b3', 2, 'Methods', 1),
  ]);

  const expanded = flattenOutline(items, new Set());
  assert.equal(expanded.length, 3);
  assert.deepEqual(expanded.map((entry) => entry.depth), [1, 2, 1]);

  const collapsed = flattenOutline(items, new Set([items[0].id]));
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].collapsed, true);
  assert.equal(collapsed[0].hasChildren, true);
});

test('filterOutline keeps matches with their ancestors', () => {
  const items = buildMineruOutline([
    titleBlock('b1', 0, 'Introduction', 1),
    titleBlock('b2', 1, 'Related Work', 2),
    titleBlock('b3', 2, 'Experiments', 1),
  ]);

  const filtered = filterOutline(items, 'related');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, 'Introduction');
  assert.equal(filtered[0].children[0].title, 'Related Work');

  assert.equal(filterOutline(items, 'missing').length, 0);
  assert.equal(filterOutline(items, '  ').length, 2);
});

test('findActiveOutlineId picks the last heading at or before the current page', () => {
  const items = buildMineruOutline([
    titleBlock('b1', 0, 'Intro', 1),
    titleBlock('b2', 4, 'Methods', 1),
    titleBlock('b3', 9, 'Results', 1),
  ]);

  assert.equal(findActiveOutlineId(items, 0), items[0].id);
  assert.equal(findActiveOutlineId(items, 5), items[1].id);
  assert.equal(findActiveOutlineId(items, 100), items[2].id);
  assert.equal(findActiveOutlineId([], 3), null);
});

test('collectOutlineIds returns every node in pre-order', () => {
  const items = normalizePdfOutline([
    { title: 'A', items: [{ title: 'A1' }, { title: 'A2' }] },
    { title: 'B' },
  ]);
  const ids = collectOutlineIds(items);
  assert.equal(ids.length, 4);
  assert.equal(ids[0], items[0].id);
  assert.equal(ids[3], items[1].id);
});
