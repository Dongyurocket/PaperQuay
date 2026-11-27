import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTextFromMineruBlock, extractTranslatableMarkdownFromMineruBlock } from '../src/services/mineru.ts';
import {
  applyMineruBlockEdits,
  applyMineruOutlineEdits,
  computeMineruBlockFingerprint,
  resolveMineruBlockEdits,
  sanitizeMineruBlockEdits,
} from '../src/services/parseEdits.ts';
import type { PositionedMineruBlock } from '../src/types/reader.ts';

function paragraph(blockId: string, text: string, pageIndex = 0): PositionedMineruBlock {
  return {
    type: 'paragraph',
    content: { text },
    blockId,
    pageIndex,
    blockIndex: 0,
  };
}

test('block fingerprint is stable and sensitive to content and type', () => {
  const block = paragraph('page-1-block-1', 'Running header');
  const same = { ...block, bbox: [1, 2, 3, 4] as [number, number, number, number] };
  const changedText = paragraph('page-1-block-1', 'Running header 2');
  const changedType = { ...block, type: 'title' as const };

  assert.equal(computeMineruBlockFingerprint(block), computeMineruBlockFingerprint(same));
  assert.notEqual(computeMineruBlockFingerprint(block), computeMineruBlockFingerprint(changedText));
  assert.notEqual(computeMineruBlockFingerprint(block), computeMineruBlockFingerprint(changedType));
});

test('applyMineruBlockEdits applies text overrides and removes hidden blocks', () => {
  const kept = paragraph('page-1-block-1', 'Original paragraph');
  const hidden = paragraph('page-1-block-2', 'Extra page header');
  const edits = {
    [kept.blockId]: {
      hash: computeMineruBlockFingerprint(kept),
      text: 'Corrected paragraph',
    },
    [hidden.blockId]: {
      hash: computeMineruBlockFingerprint(hidden),
      deleted: true,
    },
  };

  const applied = applyMineruBlockEdits([kept, hidden], edits);

  assert.equal(applied.appliedCount, 2);
  assert.equal(applied.staleBlockIds.length, 0);
  assert.equal(applied.blocks.length, 1);
  assert.equal(applied.blocks[0].blockId, kept.blockId);
  assert.equal(applied.blocks[0].textOverride, 'Corrected paragraph');
  assert.equal(applied.hiddenBlockIds.has(hidden.blockId), true);
  assert.equal(extractTextFromMineruBlock(applied.blocks[0]), 'Corrected paragraph');
  assert.equal(extractTranslatableMarkdownFromMineruBlock(applied.blocks[0]), 'Corrected paragraph');
});

test('stale edits are ignored after the original block changes', () => {
  const block = paragraph('page-1-block-1', 'Reparsed content');
  const staleHash = computeMineruBlockFingerprint(paragraph('page-1-block-1', 'Old content'));
  const edits = { [block.blockId]: { hash: staleHash, deleted: true } };

  const resolved = resolveMineruBlockEdits([block], edits);
  assert.equal(Object.keys(resolved.edits).length, 0);
  assert.deepEqual(resolved.staleBlockIds, [block.blockId]);

  const applied = applyMineruBlockEdits([block], edits);
  assert.equal(applied.blocks.length, 1);
  assert.equal(applied.appliedCount, 0);
  assert.deepEqual(applied.staleBlockIds, [block.blockId]);
});

test('sanitizeMineruBlockEdits drops malformed ids, hashes and empty edits', () => {
  const validHash = 'a'.repeat(16);
  const { edits, dropped } = sanitizeMineruBlockEdits({
    'page-1-block-1': { hash: validHash, text: 'ok' },
    'page-0-block-1': { hash: validHash, text: 'bad id' },
    'page-1-block-2': { hash: 'not-a-hash', text: 'bad hash' },
    'page-1-block-3': { hash: validHash },
    'page-1-block-4': { hash: validHash, deleted: true },
  });

  assert.deepEqual(Object.keys(edits).sort(), ['page-1-block-1', 'page-1-block-4']);
  assert.deepEqual(dropped.sort(), ['page-0-block-1', 'page-1-block-2', 'page-1-block-3']);
});

test('outline edits drop hidden titles and use edited heading text', () => {
  const items = [
    { blockId: 'page-1-block-1', pageIndex: 0, level: 1, title: 'Original title' },
    { blockId: 'page-1-block-2', pageIndex: 0, level: 2, title: 'Extra heading' },
  ];

  const edited = applyMineruOutlineEdits(items, {
    'page-1-block-1': { hash: 'a'.repeat(16), text: 'Renamed title' },
    'page-1-block-2': { hash: 'b'.repeat(16), deleted: true },
  });

  assert.deepEqual(edited, [
    { blockId: 'page-1-block-1', pageIndex: 0, level: 1, title: 'Renamed title' },
  ]);
});
