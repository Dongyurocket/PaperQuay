import test from 'node:test';
import assert from 'node:assert/strict';

import {
  flattenMineruPages,
  resolveMineruBlockContentSource,
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
