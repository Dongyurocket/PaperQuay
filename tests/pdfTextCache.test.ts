import test from 'node:test';
import assert from 'node:assert/strict';

import { createPdfTextCache } from '../src/features/reader/pdfTextCache.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('the in-flight extraction is shared only within the same PDF identity', async () => {
  const cache = createPdfTextCache();
  const first = deferred<string>();
  const pending = cache.start('pdf-a', () => first.promise);

  assert.equal(cache.getPending('pdf-a'), pending);
  assert.equal(cache.getPending('pdf-b'), null, 'a different PDF must not reuse the pending promise');

  first.resolve('text-a');
  assert.equal(await pending, 'text-a');
  assert.equal(cache.getCached('pdf-a'), 'text-a');
  assert.equal(cache.getPending('pdf-a'), null);
});

test('switching PDF identity discards the stale result instead of caching it', async () => {
  const cache = createPdfTextCache();
  const oldRequest = deferred<string>();

  void cache.start('pdf-a', () => oldRequest.promise);
  cache.invalidate();

  const newRequest = deferred<string>();
  const newPending = cache.start('pdf-b', () => newRequest.promise);
  assert.equal(cache.getPending('pdf-b'), newPending);

  oldRequest.resolve('old-pdf-text');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(cache.getCached('pdf-a'), null, 'stale results must not enter the cache');
  assert.equal(cache.getPending('pdf-b'), newPending, 'the new PDF keeps its own pending request');

  newRequest.resolve('new-pdf-text');
  assert.equal(await newPending, 'new-pdf-text');
  assert.equal(cache.getCached('pdf-b'), 'new-pdf-text');
});

test('invalidate also drops the pending entry for the same key', () => {
  const cache = createPdfTextCache();
  const request = deferred<string>();

  void cache.start('pdf-a', () => request.promise);
  cache.invalidate();

  assert.equal(cache.getPending('pdf-a'), null);
});
