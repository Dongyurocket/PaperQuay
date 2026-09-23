import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRagContextText } from '../src/features/reader/readerRag.ts';
import type { RagChunkInput, RagRetrievalResult } from '../src/types/reader.ts';

const BODY_SEED_TEXT =
  'This paragraph describes the experimental setup in detail with several sentences of plain body text that cannot be confused with a section heading.';

function makeChunk(overrides: Partial<RagChunkInput> & { chunkId: string; chunkIndex: number }): RagChunkInput {
  return {
    pageIndex: null,
    blockId: null,
    text: '',
    ...overrides,
  };
}

function makeHit(overrides: Partial<RagRetrievalResult> & { chunkId: string }): RagRetrievalResult {
  return {
    sourceType: 'mineru-markdown',
    pageIndex: null,
    blockId: null,
    text: '',
    score: 0.1,
    ...overrides,
  };
}

function makePreparedSource(chunks: RagChunkInput[]) {
  return [{ sourceType: 'mineru-markdown' as const, sourceSignature: 'sig', chunks }];
}

test('buildRagContextText expands plain-text hits with before/after neighbors in reading order', () => {
  const chunks = [
    makeChunk({ chunkId: 'c0', chunkIndex: 0, pageIndex: 0, blockId: 'b0', text: 'Previous paragraph context.' }),
    makeChunk({ chunkId: 'c1', chunkIndex: 1, pageIndex: 1, blockId: 'b1', text: BODY_SEED_TEXT }),
    makeChunk({ chunkId: 'c2', chunkIndex: 2, pageIndex: 1, blockId: 'b2', text: 'Following paragraph context.' }),
  ];
  const seed = makeHit({ chunkId: 'c1', pageIndex: 1, blockId: 'b1', text: BODY_SEED_TEXT });

  const context = buildRagContextText({
    results: [seed],
    topK: 1,
    mineruBlocks: [],
    preparedSources: makePreparedSource(chunks),
  });

  // 阅读顺序：前文切片 → 命中切片 → 后文切片。
  const i0 = context.documentText.indexOf('Previous paragraph context.');
  const i1 = context.documentText.indexOf(BODY_SEED_TEXT);
  const i2 = context.documentText.indexOf('Following paragraph context.');
  assert.ok(i0 >= 0 && i1 > i0 && i2 > i1, `expected before<hit<after order, got ${i0},${i1},${i2}`);

  // 引用锚点保留真实命中位置，不被补充段顶替。
  assert.equal(context.citations.length, 1);
  assert.equal(context.citations[0]?.chunkId, 'c1');
  assert.equal(context.citations[0]?.pageIndex, 1);

  // 直接命中在前；上下文补充标记 retrievalRole/expandedFrom 后追加，不冒充独立命中。
  assert.equal(context.retrievals.length, 3);
  assert.equal(context.retrievals[0]?.chunkId, 'c1');
  assert.equal(context.retrievals[0]?.retrievalRole, undefined);
  const supplements = context.retrievals.slice(1);
  assert.deepEqual(
    supplements.map((r) => `${r.chunkId}:${r.retrievalRole}:${r.expandedFrom}`).sort(),
    ['c0:context:c1', 'c2:context:c1'],
  );
});

test('buildRagContextText skips neighbors that exceed the per-target token budget', () => {
  const hugeBefore = `前文${'文'.repeat(5000)}`;
  const chunks = [
    makeChunk({ chunkId: 'big', chunkIndex: 0, text: hugeBefore }),
    makeChunk({ chunkId: 'hit', chunkIndex: 1, text: 'short body hit.' }),
    makeChunk({ chunkId: 'small', chunkIndex: 2, text: 'short after.' }),
  ];
  const seed = makeHit({ chunkId: 'hit', text: 'short body hit.' });

  const context = buildRagContextText({
    results: [seed],
    topK: 1,
    mineruBlocks: [],
    preparedSources: makePreparedSource(chunks),
  });

  // 超大前片超出单目标窗口预算被跳过；小后片仍补充。
  assert.ok(!context.documentText.includes(hugeBefore));
  assert.ok(context.documentText.includes('short after.'));
  assert.deepEqual(
    context.retrievals.map((r) => r.chunkId),
    ['hit', 'small'],
  );
});

test('buildRagContextText caps total context expansion at the per-question budget', () => {
  // 每个后片约 1300 tokens（CJK 1 token/字），单目标预算内可容纳；
  // 5 个命中共享 6000 tokens 问答预算，最后一个因剩余预算不足而跳过补充。
  const chunks: RagChunkInput[] = [];
  const seeds: RagRetrievalResult[] = [];

  for (let i = 0; i < 5; i += 1) {
    const hitText = `plain body hit number ${i} with enough words to stay a body paragraph.`;
    const afterText = `CTX${i}：${'文'.repeat(1300)}`;
    chunks.push(makeChunk({ chunkId: `hit-${i}`, chunkIndex: i * 2, text: hitText }));
    chunks.push(makeChunk({ chunkId: `after-${i}`, chunkIndex: i * 2 + 1, text: afterText }));
    seeds.push(makeHit({ chunkId: `hit-${i}`, text: hitText }));
  }

  const context = buildRagContextText({
    results: seeds,
    topK: 5,
    mineruBlocks: [],
    preparedSources: makePreparedSource(chunks),
  });

  for (let i = 0; i < 4; i += 1) {
    assert.ok(context.documentText.includes(`CTX${i}：`), `expected neighbor ${i} included`);
  }
  assert.ok(!context.documentText.includes('CTX4：'), 'expected last neighbor budget-capped');
});

test('buildRagContextText keeps heading expansion and marks supplements as context', () => {
  const mineruBlocks = [
    { blockId: 'b-title', pageIndex: 0, blockIndex: 0, type: 'title', content: '1. Introduction' },
    { blockId: 'b-p1', pageIndex: 0, blockIndex: 1, type: 'paragraph', content: 'Body paragraph follows the heading.' },
  ] as never;
  const chunks = [
    makeChunk({ chunkId: 'mineru:b-title:0', chunkIndex: 0, pageIndex: 0, blockId: 'b-title', text: '1. Introduction' }),
    makeChunk({ chunkId: 'mineru:b-p1:0', chunkIndex: 1, pageIndex: 0, blockId: 'b-p1', text: 'Body paragraph follows the heading.' }),
  ];
  const seed = makeHit({
    chunkId: 'mineru:b-title:0',
    pageIndex: 0,
    blockId: 'b-title',
    text: '1. Introduction',
  });

  const context = buildRagContextText({
    results: [seed],
    topK: 1,
    mineruBlocks,
    preparedSources: makePreparedSource(chunks),
  });

  assert.ok(context.documentText.includes('Body paragraph follows the heading.'));
  assert.equal(context.citations[0]?.chunkId, 'mineru:b-title:0');
  const supplement = context.retrievals.find((r) => r.chunkId === 'mineru:b-p1:0');
  assert.equal(supplement?.retrievalRole, 'context');
  assert.equal(supplement?.expandedFrom, 'mineru:b-title:0');
});
