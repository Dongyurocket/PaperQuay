import test from 'node:test';
import assert from 'node:assert/strict';

import {
  previewSummarySyncField,
  resolveSummaryModelConfigIssue,
  shouldAutoLoadCachedSummary,
  shouldUsePreviewSummaryFallback,
} from '../src/features/reader/paperSummaryAutoLoad.ts';
import type { PaperSummary } from '../src/types/reader.ts';

const summary = { title: 'T', abstract: 'A' } as unknown as PaperSummary;

function autoLoad(overrides: Partial<Parameters<typeof shouldAutoLoadCachedSummary>[0]> = {}) {
  return shouldAutoLoadCachedSummary({
    sourceKey: 'key-1',
    currentSourceKey: '',
    attemptedSourceKey: '',
    loading: false,
    taskRunning: false,
    ...overrides,
  });
}

test('auto-loads cached summary once a source key exists, regardless of auto-generate settings', () => {
  assert.equal(autoLoad(), true);
});

test('does not auto-load without a source key (content not ready)', () => {
  assert.equal(autoLoad({ sourceKey: '' }), false);
  assert.equal(autoLoad({ sourceKey: '   ' }), false);
});

test('does not auto-load while generating or while the library overview task runs', () => {
  assert.equal(autoLoad({ loading: true }), false);
  assert.equal(autoLoad({ taskRunning: true }), false);
});

test('does not reload when the displayed summary already matches the key', () => {
  assert.equal(autoLoad({ currentSourceKey: 'key-1' }), false);
});

test('tries each source key at most once, but retries when the key changes', () => {
  assert.equal(autoLoad({ attemptedSourceKey: 'key-1' }), false);
  assert.equal(autoLoad({ attemptedSourceKey: 'key-0' }), true);
});

test('history summary under an older key is still refreshed from cache for the new key', () => {
  assert.equal(autoLoad({ currentSourceKey: 'old-key' }), true);
});

test('preview fallback only fills an empty reader summary', () => {
  assert.equal(shouldUsePreviewSummaryFallback({ currentSummary: null, previewSummary: summary, loading: false }), true);
  assert.equal(shouldUsePreviewSummaryFallback({ currentSummary: summary, previewSummary: summary, loading: false }), false);
  assert.equal(shouldUsePreviewSummaryFallback({ currentSummary: null, previewSummary: null, loading: false }), false);
  assert.equal(shouldUsePreviewSummaryFallback({ currentSummary: null, previewSummary: undefined, loading: false }), false);
  assert.equal(shouldUsePreviewSummaryFallback({ currentSummary: null, previewSummary: summary, loading: true }), false);
});

test('model config issues are reported in base-url, api-key, model order', () => {
  assert.equal(resolveSummaryModelConfigIssue(null), 'base-url');
  assert.equal(resolveSummaryModelConfigIssue(undefined), 'base-url');
  assert.equal(resolveSummaryModelConfigIssue({ baseUrl: ' ', apiKey: '', model: '' }), 'base-url');
  assert.equal(resolveSummaryModelConfigIssue({ baseUrl: 'http://x', apiKey: ' ', model: '' }), 'api-key');
  assert.equal(resolveSummaryModelConfigIssue({ baseUrl: 'http://x', apiKey: 'k', model: ' ' }), 'model');
  assert.equal(resolveSummaryModelConfigIssue({ baseUrl: 'http://x', apiKey: 'k', model: 'm' }), null);
});

test('sync payload omits summary when the reader has none, so library cache is not overwritten', () => {
  assert.deepEqual(previewSummarySyncField(null), {});
  assert.equal(Object.prototype.hasOwnProperty.call(previewSummarySyncField(null), 'summary'), false);
  assert.deepEqual(previewSummarySyncField(summary), { summary });
});
