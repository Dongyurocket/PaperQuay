import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createAttachmentAvailabilityCache,
  resolveAttachmentFilters,
} = require('../electron/backend/libraryAttachmentAvailability.cjs');

function makeLibrary(papers) {
  return { settings: { storageDir: '' }, papers };
}

test('attachment availability caches positive and negative stats within the TTL', async () => {
  let now = 1_000;
  let calls = 0;
  const present = new Map([['/present.pdf', true], ['/later.pdf', false]]);
  const cache = createAttachmentAvailabilityCache({
    ttlMs: 1_000,
    negativeTtlMs: 500,
    now: () => now,
    stat: async (filePath) => {
      calls += 1;
      if (!present.get(filePath)) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return { isFile: () => true };
    },
  });
  const library = makeLibrary([
    { id: 'p1', attachments: [{ id: 'a1', kind: 'pdf', storedPath: '/present.pdf', missing: true }] },
    { id: 'p2', attachments: [{ id: 'a2', kind: 'pdf', storedPath: '/later.pdf', missing: false }] },
  ]);

  let result = await resolveAttachmentFilters({ hasPdf: true }, library, { cache });
  assert.deepEqual(result.request.paperIds, ['p1']);
  assert.equal(calls, 2);

  result = await resolveAttachmentFilters({ hasPdf: true }, library, { cache });
  assert.deepEqual(result.request.paperIds, ['p1']);
  assert.equal(calls, 2, 'repeated filter queries must not restat');

  present.set('/later.pdf', true);
  now += 600;
  result = await resolveAttachmentFilters({ hasPdf: true }, library, { cache });
  assert.deepEqual(result.request.paperIds, ['p1', 'p2']);
  assert.equal(calls, 3, 'negative entries expire before positive entries');

  present.set('/present.pdf', false);
  now += 500;
  result = await resolveAttachmentFilters({ hasPdf: true }, library, { cache });
  assert.deepEqual(result.request.paperIds, ['p2']);
  assert.equal(calls, 4, 'positive entries expire after the positive TTL');
});

test('attachment availability dedupes concurrent stats and supports explicit invalidation', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createAttachmentAvailabilityCache({
    ttlMs: 10_000,
    negativeTtlMs: 10_000,
    stat: async () => {
      calls += 1;
      await gate;
      return { isFile: () => true };
    },
  });
  const library = makeLibrary([
    { id: 'p1', attachments: [{ id: 'a1', kind: 'pdf', storedPath: '/same.pdf', missing: false }] },
    { id: 'p2', attachments: [{ id: 'a2', kind: 'pdf', storedPath: '/same.pdf', missing: false }] },
  ]);

  const first = resolveAttachmentFilters({ hasPdf: true }, library, { cache });
  const second = resolveAttachmentFilters({ missingFile: true }, library, { cache });
  await Promise.resolve();
  assert.equal(calls, 1, 'the same path under two attachments is statted once');
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);

  cache.invalidate(['/same.pdf']);
  await resolveAttachmentFilters({ hasPdf: true }, library, { cache });
  assert.equal(calls, 2, 'explicit invalidation forces a new stat');
});
