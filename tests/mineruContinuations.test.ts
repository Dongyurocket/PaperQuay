import test from 'node:test';
import assert from 'node:assert/strict';

import {
  flattenMineruPages,
  resolveMineruBlockContentSource,
  extractMineruAssetPathFromBlock,
  extractTextFromMineruBlock,
} from '../src/services/mineru.ts';
import type { MineruPage } from '../src/types/reader.ts';

test('empty paragraph blocks point to the previous paragraph content source', () => {
  const pages: MineruPage[] = [
    [
      {
        type: 'paragraph',
        content: { text: 'The paragraph starts on the previous page and continues after the break.' },
        bbox: [100, 100, 900, 940],
        bboxCoordinateSystem: 'normalized-1000',
      },
      {
        type: 'paragraph',
        content: { text: '' },
        bbox: [100, 50, 900, 90],
        bboxCoordinateSystem: 'normalized-1000',
      },
    ],
    [
      {
        type: 'paragraph',
        content: { text: '' },
        bbox: [100, 60, 900, 180],
        bboxCoordinateSystem: 'normalized-1000',
      },
      {
        type: 'paragraph',
        content: { text: 'A separate paragraph follows.' },
        bbox: [100, 220, 900, 360],
        bboxCoordinateSystem: 'normalized-1000',
      },
    ],
  ];

  const blocks = flattenMineruPages(pages);
  const blockById = new Map(blocks.map((block) => [block.blockId, block]));
  const samePageContinuation = blocks[1];
  const crossPageContinuation = blocks[2];
  const samePageSource = resolveMineruBlockContentSource(samePageContinuation, blockById);
  const crossPageSource = resolveMineruBlockContentSource(crossPageContinuation, blockById);

  assert.equal(samePageContinuation.contentSourceBlockId, blocks[0].blockId);
  assert.equal(crossPageContinuation.contentSourceBlockId, blocks[0].blockId);
  assert.equal(samePageSource.blockId, blocks[0].blockId);
  assert.equal(crossPageSource.blockId, blocks[0].blockId);
  assert.equal(
    extractTextFromMineruBlock(crossPageSource),
    'The paragraph starts on the previous page and continues after the break.',
  );
  assert.equal(blocks[3].contentSourceBlockId, undefined);
});

test('merged cross-page table stubs point to the first merged table fragment', () => {
  const pages: MineruPage[] = [
    [
      {
        type: 'table',
        content: {
          html: '<table><tr><td>Symbol</td><td>Meaning</td></tr></table>',
          image_source: { path: 'images/merged-table.jpg' },
        },
        bbox: [100, 100, 900, 900],
        bboxCoordinateSystem: 'normalized-1000',
      },
    ],
    [
      {
        type: 'table',
        content: { image_source: { path: 'images/' } },
        bbox: [100, 60, 900, 900],
        bboxCoordinateSystem: 'normalized-1000',
      },
    ],
    [
      {
        type: 'table',
        content: { image_source: { path: '' } },
        bbox: [100, 60, 900, 900],
        bboxCoordinateSystem: 'normalized-1000',
      },
    ],
  ];

  const blocks = flattenMineruPages(pages);
  const blockById = new Map(blocks.map((block) => [block.blockId, block]));

  assert.equal(blocks[0].contentSourceBlockId, undefined);
  assert.equal(blocks[1].contentSourceBlockId, blocks[0].blockId);
  assert.equal(blocks[2].contentSourceBlockId, blocks[0].blockId);
  assert.equal(resolveMineruBlockContentSource(blocks[1], blockById).blockId, blocks[0].blockId);
  assert.equal(resolveMineruBlockContentSource(blocks[2], blockById).blockId, blocks[0].blockId);
});

test('directory-only asset paths are rejected instead of resolving to a directory', () => {
  const pages: MineruPage[] = [
    [
      {
        type: 'table',
        content: { image_source: { path: 'images/' } },
        bbox: [100, 60, 900, 900],
        bboxCoordinateSystem: 'normalized-1000',
      },
      {
        type: 'table',
        content: {
          html: '<table><tr><td>cell</td></tr></table>',
          image_source: { path: 'images/table-a.jpg' },
        },
        bbox: [100, 60, 900, 900],
        bboxCoordinateSystem: 'normalized-1000',
      },
      {
        type: 'table',
        content: { img_path: 'images\\' },
        bbox: [100, 60, 900, 900],
        bboxCoordinateSystem: 'normalized-1000',
      },
    ],
  ];

  const blocks = flattenMineruPages(pages);

  assert.equal(extractMineruAssetPathFromBlock(blocks[0]), undefined);
  assert.equal(extractMineruAssetPathFromBlock(blocks[1]), 'images/table-a.jpg');
  assert.equal(extractMineruAssetPathFromBlock(blocks[2]), undefined);
  // 首个 stub 之前不存在可续接的表格时保持原样；后续 stub 续接到最近的有内容表格。
  assert.equal(blocks[0].contentSourceBlockId, undefined);
  assert.equal(blocks[2].contentSourceBlockId, blocks[1].blockId);
});

test('tables with html but without screenshots are not treated as stubs', () => {
  const pages: MineruPage[] = [
    [
      {
        type: 'table',
        content: {
          html: '<table><tr><td>first</td></tr></table>',
          image_source: { path: 'images/table-first.jpg' },
        },
        bbox: [100, 100, 900, 900],
        bboxCoordinateSystem: 'normalized-1000',
      },
      {
        type: 'table',
        content: { html: '<table><tr><td>second</td></tr></table>' },
        bbox: [100, 100, 900, 500],
        bboxCoordinateSystem: 'normalized-1000',
      },
    ],
  ];

  const blocks = flattenMineruPages(pages);

  assert.equal(blocks[1].contentSourceBlockId, undefined);
});
