import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RESTORE_MARKER_KEY, restoreRendererStorage } = require('../src/shared/rendererStorageRestore.cjs');

class MemoryStorage {
  map = new Map<string, string>();
  clearCalls = 0;
  failKeys = new Set<string>();
  clearError: Error | null = null;

  get length() {
    return this.map.size;
  }

  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string) {
    if (this.failKeys.has(key)) throw new Error('QuotaExceededError');
    this.map.set(key, String(value));
  }

  removeItem(key: string) {
    this.map.delete(key);
  }

  clear() {
    this.clearCalls += 1;
    if (this.clearError) throw this.clearError;
    this.map.clear();
  }
}

function payload(restoreId: string, state: Record<string, string>) {
  return {
    restoreId,
    state,
    pathMap: {},
    rootMap: {},
    hasMineruCache: false,
  };
}

test('restore applies once and a repeated load with the same restoreId keeps newer user state', () => {
  const storage = new MemoryStorage();
  storage.setItem('stale-key', 'stale');
  const first = restoreRendererStorage(storage, payload('restore-1', { 'paper-reader-settings-v3': '{"a":1}' }), { platform: 'win32' });

  assert.equal(first.skipped, false);
  assert.deepEqual(first.failedKeys, []);
  assert.equal(storage.getItem('stale-key'), null);
  assert.equal(storage.getItem('paper-reader-settings-v3'), '{"a":1}');
  assert.equal(JSON.parse(storage.getItem(RESTORE_MARKER_KEY)!).restoreId, 'restore-1');

  // ack 丢失或页面重复加载：用户恢复后新写的设置不能被再次 clear() 抹掉。
  storage.setItem('user-setting-after-restore', 'changed');
  const second = restoreRendererStorage(storage, payload('restore-1', { 'paper-reader-settings-v3': '{"a":1}' }), { platform: 'win32' });

  assert.equal(second.skipped, true);
  assert.deepEqual(second.failedKeys, []);
  assert.equal(storage.clearCalls, 1);
  assert.equal(storage.getItem('user-setting-after-restore'), 'changed');
});

test('a different restoreId replaces the snapshot again', () => {
  const storage = new MemoryStorage();
  restoreRendererStorage(storage, payload('restore-1', { 'paper-reader-settings-v3': '{"a":1}' }), { platform: 'win32' });
  storage.setItem('user-setting-after-restore', 'changed');

  const result = restoreRendererStorage(storage, payload('restore-2', { 'paper-reader-settings-v3': '{"b":2}' }), { platform: 'win32' });

  assert.equal(result.skipped, false);
  assert.equal(storage.clearCalls, 2);
  assert.equal(storage.getItem('user-setting-after-restore'), null);
  assert.equal(storage.getItem('paper-reader-settings-v3'), '{"b":2}');
  assert.equal(JSON.parse(storage.getItem(RESTORE_MARKER_KEY)!).restoreId, 'restore-2');
});

test('a failed write still marks the restore complete and retries the ack without clearing again', () => {
  const storage = new MemoryStorage();
  storage.failKeys.add('oversized-key');

  const first = restoreRendererStorage(storage, payload('restore-1', {
    'paper-reader-settings-v3': '{"a":1}',
    'oversized-key': 'x'.repeat(10),
  }), { platform: 'win32' });

  assert.equal(first.skipped, false);
  assert.deepEqual(first.failedKeys, ['oversized-key']);
  assert.equal(storage.clearCalls, 1);
  assert.equal(JSON.parse(storage.getItem(RESTORE_MARKER_KEY)!).restoreId, 'restore-1');

  const retry = restoreRendererStorage(storage, payload('restore-1', {
    'paper-reader-settings-v3': '{"a":1}',
    'oversized-key': 'x'.repeat(10),
  }), { platform: 'win32' });

  assert.equal(retry.skipped, true);
  assert.deepEqual(retry.failedKeys, ['oversized-key'], 'the retry ack keeps reporting the quota failure');
  assert.equal(storage.clearCalls, 1);
});

test('a failed clear leaves no completion marker so the next load retries', () => {
  const storage = new MemoryStorage();
  storage.clearError = new Error('storage unavailable');

  const first = restoreRendererStorage(storage, payload('restore-1', { 'paper-reader-settings-v3': '{"a":1}' }), { platform: 'win32' });
  assert.equal(first.skipped, false);
  assert.deepEqual(first.failedKeys, ['__localStorage_restore__']);
  assert.equal(storage.getItem(RESTORE_MARKER_KEY), null);

  storage.clearError = null;
  const second = restoreRendererStorage(storage, payload('restore-1', { 'paper-reader-settings-v3': '{"a":1}' }), { platform: 'win32' });
  assert.equal(second.skipped, false);
  assert.equal(storage.clearCalls, 2);
  assert.equal(storage.getItem('paper-reader-settings-v3'), '{"a":1}');
});

test('restore ignores payloads without a restoreId or state', () => {
  const storage = new MemoryStorage();
  assert.equal(restoreRendererStorage(storage, null), null);
  assert.equal(restoreRendererStorage(storage, { restoreId: 'r1' }), null);
  assert.equal(restoreRendererStorage(storage, { state: { a: 'b' } }), null);
  assert.equal(storage.clearCalls, 0);
});
