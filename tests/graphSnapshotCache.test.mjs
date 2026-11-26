import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeGraphRevision,
  createGraphSnapshotCache,
  stableStringify,
} from '../electron/backend/graphSnapshotCache.cjs';

test('stableStringify sorts object keys and preserves arrays', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.equal(stableStringify([1, { b: 2, a: 3 }]), '[1,{"a":3,"b":2}]');
  assert.equal(stableStringify(undefined), 'undefined');
});

test('cache hits only for the same revision and request', () => {
  let now = 1_000;
  const cache = createGraphSnapshotCache({ ttlMs: 10_000, now: () => now });
  const request = { includeTags: true, search: 'rag' };
  const snapshot = { nodes: [], edges: [] };

  assert.equal(cache.get(request, 'rev-1'), null);
  cache.set(request, 'rev-1', snapshot);

  assert.equal(cache.get({ search: 'rag', includeTags: true }, 'rev-1'), snapshot);
  assert.equal(cache.get(request, 'rev-2'), null);
  assert.equal(cache.get({ ...request, search: 'graph' }, 'rev-1'), null);

  const stats = cache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 3);
});

test('cache expires entries and caps its size', () => {
  let now = 1_000;
  const cache = createGraphSnapshotCache({ ttlMs: 100, maxEntries: 2, now: () => now });
  cache.set({ id: 1 }, 'rev', { id: 1 });
  cache.set({ id: 2 }, 'rev', { id: 2 });
  cache.set({ id: 3 }, 'rev', { id: 3 });
  assert.equal(cache.stats().size, 2);
  assert.equal(cache.get({ id: 1 }, 'rev'), null, 'oldest entry is evicted');

  now += 101;
  assert.equal(cache.get({ id: 3 }, 'rev'), null, 'entries expire after the TTL');
});

test('invalidate drops every revision and increments the generation', () => {
  const cache = createGraphSnapshotCache();
  cache.set({ id: 1 }, 'rev', { id: 1 });
  assert.ok(cache.get({ id: 1 }, 'rev'));
  cache.invalidate();
  assert.equal(cache.get({ id: 1 }, 'rev'), null);
  assert.equal(cache.stats().size, 0);
  assert.equal(cache.stats().generation, 1);
});

test('revision signatures change with mtime or size and tolerate missing files', () => {
  const stats = new Map([
    ['/data/library.sqlite', { mtimeMs: 10, size: 100 }],
    ['/data/notes.sqlite', { mtimeMs: 20, size: 200 }],
    ['/data/rag.sqlite', { mtimeMs: 30, size: 300 }],
  ]);
  const appPaths = {
    dataDir: '/data',
    libraryDatabasePath: '/data/library.sqlite',
    notesDatabasePath: '/data/notes.sqlite',
    ragDatabasePath: '/data/rag.sqlite',
    configPath: '/data/settings.json',
  };
  const statSync = (filePath) => {
    const entry = stats.get(filePath);
    if (!entry) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return entry;
  };

  const first = computeGraphRevision(appPaths, { statSync });
  assert.equal(computeGraphRevision(appPaths, { statSync }), first);

  stats.get('/data/library.sqlite').mtimeMs = 11;
  assert.notEqual(computeGraphRevision(appPaths, { statSync }), first);

  stats.get('/data/library.sqlite').mtimeMs = 10;
  stats.get('/data/rag.sqlite').size = 301;
  assert.notEqual(computeGraphRevision(appPaths, { statSync }), first);

  assert.equal(
    computeGraphRevision({ dataDir: '/empty' }, { statSync }),
    computeGraphRevision({ dataDir: '/empty' }, { statSync }),
  );
});
