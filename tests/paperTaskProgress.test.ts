import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCachedTranslationTask,
  getPaperTaskProgress,
} from '../src/features/literature/paperTaskProgress.ts';

const state = (status: 'success' | 'running' | 'error', completed?: number, total?: number) => ({
  status,
  completed,
  total,
});

test('success without a total is complete and displays completed/completed', () => {
  assert.deepEqual(getPaperTaskProgress(state('success', 562)), {
    completed: 562,
    total: 562,
    percent: 100,
    countText: '562/562',
    indeterminate: false,
    showProgressBar: true,
  });
});

test('success with a total is complete and retains the known count', () => {
  assert.deepEqual(getPaperTaskProgress(state('success', 562, 600)), {
    completed: 562,
    total: 600,
    percent: 100,
    countText: '562/600',
    indeterminate: false,
    showProgressBar: true,
  });
});

test('running without a total is indeterminate', () => {
  assert.deepEqual(getPaperTaskProgress(state('running', 12)), {
    completed: 12,
    total: null,
    percent: 45,
    countText: null,
    indeterminate: true,
    showProgressBar: true,
  });
});

test('running with a total uses the completed ratio', () => {
  assert.deepEqual(getPaperTaskProgress(state('running', 25, 100)), {
    completed: 25,
    total: 100,
    percent: 25,
    countText: '25/100',
    indeterminate: false,
    showProgressBar: true,
  });
});

test('error retains the completed portion', () => {
  assert.deepEqual(getPaperTaskProgress(state('error', 25, 100)), {
    completed: 25,
    total: 100,
    percent: 25,
    countText: '25/100',
    indeterminate: false,
    showProgressBar: true,
  });
});

test('error without a total reports completed work without implying completion', () => {
  assert.deepEqual(getPaperTaskProgress(state('error', 25)), {
    completed: 25,
    total: null,
    percent: 0,
    countText: '25/?',
    indeterminate: false,
    showProgressBar: false,
  });
});

test('cached translation restoration supplies a total when the cache only has a count', () => {
  assert.deepEqual(
    buildCachedTranslationTask({ count: 562, l: (zh) => zh }),
    {
      status: 'success',
      completed: 562,
      total: 562,
      message: '全文翻译已完成（缓存），562 段',
    },
  );
});

test('cached translation restoration preserves an independently known total', () => {
  assert.equal(
    buildCachedTranslationTask({ count: 562, total: 600, l: (_zh, en) => en }).total,
    600,
  );
});
