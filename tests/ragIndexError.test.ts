import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRagIndexError,
  isRagAuthOrBillingError,
  ragIndexErrorHint,
  ragIndexErrorLabel,
} from '../src/services/ragIndexError.ts';

const l = (zh: string, _en: string) => zh;

test('classifies authentication and billing failures as non-retryable', () => {
  for (const message of ['HTTP 401', 'HTTP 403', 'Invalid API key', 'Unauthorized']) {
    const info = classifyRagIndexError(message);
    assert.equal(info.kind, 'auth', message);
    assert.equal(info.retryable, false);
  }

  for (const message of ['HTTP 402', 'Insufficient balance', 'quota exceeded']) {
    const info = classifyRagIndexError(message);
    assert.equal(info.kind, 'billing', message);
    assert.equal(info.retryable, false);
  }

  assert.equal(isRagAuthOrBillingError('HTTP 401'), true);
  assert.equal(isRagAuthOrBillingError('HTTP 429'), false);
});

test('classifies transient failures as retryable', () => {
  assert.deepEqual(classifyRagIndexError('HTTP 429 Too Many Requests'), {
    kind: 'rate-limit',
    retryable: true,
  });
  assert.deepEqual(classifyRagIndexError('fetch failed: ENOTFOUND'), {
    kind: 'network',
    retryable: true,
  });
  assert.deepEqual(classifyRagIndexError('Embedding service returned an incomplete vector batch'), {
    kind: 'incomplete-vectors',
    retryable: true,
  });
  assert.deepEqual(classifyRagIndexError('something unexpected'), {
    kind: 'unknown',
    retryable: true,
  });
});

test('labels and hints cover every error kind', () => {
  const kinds = ['auth', 'billing', 'rate-limit', 'network', 'incomplete-vectors', 'excluded', 'unknown'] as const;

  for (const kind of kinds) {
    assert.ok(ragIndexErrorLabel(kind, l).length > 0, kind);
  }
  assert.match(ragIndexErrorLabel('auth', l), /认证/);
  assert.match(ragIndexErrorHint('billing', l) ?? '', /余额/);
  assert.equal(ragIndexErrorHint('unknown', l), null);
});
