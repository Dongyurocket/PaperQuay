import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dataUrlByteLength,
  matchRagVisionCandidates,
  prepareAgentVisionAttachments,
} from '../src/services/agentVision.ts';

function dataUrl(bytes: number): string {
  return `data:image/jpeg;base64,${Buffer.alloc(bytes).toString('base64')}`;
}

test('vision candidates map only exact RAG blockId matches and preserve score order', () => {
  const candidates = matchRagVisionCandidates({
    paperId: 'paper-a',
    paperTitle: 'Paper A',
    figures: [
      { id: 'F1', caption: 'Architecture', path: '/tmp/a.png', blockId: 'b1', kind: 'image', pageIndex: 1 },
      { id: 'F2', caption: 'Unmatched', path: '/tmp/b.png', blockId: 'b2', kind: 'image', pageIndex: 2 },
      { id: 'F3', caption: 'Results', path: '/tmp/c.png', blockId: 'b3', kind: 'table', pageIndex: 3 },
    ],
    retrievals: [
      { chunkId: 'c3', sourceType: 'mineru-markdown', pageIndex: 3, blockId: 'b3', text: 'results', score: 0.2 },
      { chunkId: 'c1', sourceType: 'mineru-markdown', pageIndex: 1, blockId: 'b1', text: 'architecture', score: 0.1 },
    ],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.id), ['paper-a:F1', 'paper-a:F3']);
  assert.equal(candidates[0]?.caption, 'Architecture');
});

test('vision preparation enforces image count and byte limits with caption summaries', async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    id: `figure-${index}`,
    source: 'rag' as const,
    caption: `Caption ${index}`,
    path: `/tmp/${index}.png`,
    kind: 'image',
    score: index,
  }));
  const prepared = await prepareAgentVisionAttachments({
    candidates,
    supportsVision: true,
    loadDataUrl: async () => dataUrl(10),
    compress: async (value) => value,
    limits: { maxImagesPerTurn: 2, maxTotalBytes: 15 },
  });

  assert.equal(prepared.attachments.length, 1);
  assert.equal(prepared.attachments[0]?.summary, 'Caption 0');
  assert.equal(prepared.skippedCount, 4);
  assert.match(prepared.notice ?? '', /另有 4 张/);
  assert.equal(dataUrlByteLength(dataUrl(10)), 10);
});

test('non-vision presets skip image loading and report a clear fallback', async () => {
  let loads = 0;
  const prepared = await prepareAgentVisionAttachments({
    candidates: [{
      id: 'figure-1',
      source: 'rag',
      caption: 'Figure 1',
      path: '/tmp/figure.png',
      kind: 'image',
      score: 0,
    }],
    supportsVision: false,
    loadDataUrl: async () => {
      loads += 1;
      return dataUrl(10);
    },
  });

  assert.equal(loads, 0);
  assert.equal(prepared.attachments.length, 0);
  assert.equal(prepared.skippedCount, 1);
  assert.match(prepared.notice ?? '', /不支持视觉/);
});
