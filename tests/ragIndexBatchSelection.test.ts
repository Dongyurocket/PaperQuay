import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRagBatchForce,
  selectRagBatchTargets,
  type RagBatchTarget,
} from '../src/services/ragIndexStatus.ts';

const targets: RagBatchTarget[] = [
  { paperId: 'ready', mineruParsed: true, status: 'ready' },
  { paperId: 'stale', mineruParsed: true, status: 'stale' },
  { paperId: 'failed', mineruParsed: true, status: 'failed' },
  { paperId: 'pending', mineruParsed: true, status: 'pending' },
  { paperId: 'missing', mineruParsed: true, status: 'none' },
  { paperId: 'unparsed', mineruParsed: false, status: 'none' },
  { paperId: 'excluded', ragEnabled: false, mineruParsed: true, status: 'failed' },
];

test('batch modes select the documented candidates and skip reasons', () => {
  assert.deepEqual(selectRagBatchTargets(targets, 'missing'), {
    candidateIds: ['missing'],
    skipped: { unparsed: 1, excluded: 1, ready: 1, pending: 1, other: 2 },
  });
  assert.deepEqual(selectRagBatchTargets(targets, 'failed').candidateIds, ['failed']);
  assert.deepEqual(selectRagBatchTargets(targets, 'stale').candidateIds, ['stale']);
  assert.deepEqual(selectRagBatchTargets(targets, 'rebuild').candidateIds, [
    'ready', 'stale', 'failed', 'pending', 'missing',
  ]);
  assert.deepEqual(selectRagBatchTargets(targets, 'all-legacy').candidateIds, [
    'stale', 'failed', 'pending', 'missing',
  ]);
});

test('selected paper ids restrict the candidate list before mode filtering', () => {
  const selected = new Set(['missing', 'failed', 'ready']);
  const scoped = targets.filter((target) => selected.has(target.paperId));
  assert.deepEqual(selectRagBatchTargets(scoped, 'failed').candidateIds, ['failed']);
  assert.deepEqual(selectRagBatchTargets(scoped, 'missing').candidateIds, ['missing']);
  assert.deepEqual(selectRagBatchTargets(scoped, 'rebuild').candidateIds, ['ready', 'failed', 'missing']);
});

test('duplicate selection ids do not double-count skipped reasons', () => {
  const duplicated = [targets[0], targets[0], targets[5]];
  const result = selectRagBatchTargets(duplicated, 'missing');
  assert.deepEqual(result.candidateIds, []);
  assert.equal(result.skipped.ready, 2);
  assert.equal(result.skipped.unparsed, 1);
});

test('manual batches bypass cooldown; auto retries keep it unless explicitly forced', () => {
  assert.equal(resolveRagBatchForce('manual', undefined), true);
  assert.equal(resolveRagBatchForce(undefined, undefined), true);
  assert.equal(resolveRagBatchForce('auto', undefined), false);
  assert.equal(resolveRagBatchForce('auto', true), true);
  assert.equal(resolveRagBatchForce('manual', false), false);
});
