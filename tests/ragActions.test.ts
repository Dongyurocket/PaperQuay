import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRagActionItems,
  ragStatusLabel,
  type RagActionContext,
} from '../src/features/literature/ragActions.ts';

const l = (zh: string, _en: string) => zh;

function context(overrides: Partial<RagActionContext> = {}): RagActionContext {
  return {
    status: 'ready',
    ragIndexAvailable: true,
    mineruParsed: true,
    indexing: false,
    busy: false,
    ...overrides,
  };
}

const actions = (overrides: Partial<RagActionContext> = {}) => (
  buildRagActionItems(context(overrides), l).map((item) => [item.action, Boolean(item.disabled)])
);

test('status labels cover every aggregate state', () => {
  assert.equal(ragStatusLabel('ready', l), '已索引');
  assert.equal(ragStatusLabel('stale', l), '待更新');
  assert.equal(ragStatusLabel('pending', l), '待索引');
  assert.equal(ragStatusLabel('failed', l), '索引失败');
  assert.equal(ragStatusLabel('none', l), '未建立');
  assert.equal(ragStatusLabel('excluded', l), '已排除');
});

test('ready and stale papers offer rebuild or update without hiding exclusion', () => {
  assert.deepEqual(actions({ status: 'ready' }), [
    ['rebuild', false],
    ['open-details', false],
    ['exclude', false],
  ]);
  assert.deepEqual(actions({ status: 'stale' }), [
    ['update', false],
    ['rebuild', false],
    ['open-details', false],
    ['exclude', false],
  ]);
});

test('failed papers retry and can open the failure details', () => {
  assert.deepEqual(actions({ status: 'failed' }), [
    ['retry', false],
    ['open-details', false],
    ['exclude', false],
  ]);
  assert.deepEqual(actions({ status: 'failed', indexing: true }), [
    ['retry', true],
    ['open-details', false],
    ['exclude', false],
  ]);
});

test('unparsed papers cannot build an index and say why', () => {
  const items = buildRagActionItems(context({ status: 'none', mineruParsed: false }), l);
  assert.equal(items[0].action, 'build');
  assert.equal(items[0].disabled, true);
  assert.match(items[0].label, /MinerU/);
  assert.ok(items[0].hint);

  assert.deepEqual(actions({ status: 'none' }), [
    ['build', false],
    ['exclude', false],
  ]);
});

test('excluded papers only offer inclusion, and busy actions are disabled', () => {
  assert.deepEqual(actions({ status: 'excluded' }), [['include', false]]);
  assert.deepEqual(actions({ status: 'excluded', busy: true }), [['include', true]]);
  assert.deepEqual(actions({ status: 'ready', busy: true }), [
    ['rebuild', true],
    ['open-details', false],
    ['exclude', true],
  ]);
});

test('unavailable RAG disables indexing but keeps membership actions', () => {
  assert.deepEqual(actions({ status: 'failed', ragIndexAvailable: false }), [
    ['retry', true],
    ['open-details', false],
    ['exclude', false],
  ]);
  assert.deepEqual(actions({ status: 'excluded', ragIndexAvailable: false }), [['include', false]]);
});
