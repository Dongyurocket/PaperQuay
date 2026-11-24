import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { fetchJsonLimited, downloadUrlToFile } = require('../electron/backend/httpIO.cjs');

const originalFetch = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function chunkedResponse(chunks: string[], init: ResponseInit = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), init);
}

function failingStreamResponse() {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial'));
      controller.error(new Error('socket hang up'));
    },
  }));
}

function neverSettlingFetch() {
  return (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });
}

test('fetchJsonLimited parses bounded JSON responses', async () => {
  globalThis.fetch = async () => chunkedResponse(['{"title":', '"Paper"}']);

  try {
    const data = await fetchJsonLimited('https://example.test/works/1', 'Test metadata', {
      timeoutMs: 5000,
      maxBytes: 1024,
    });
    assert.deepEqual(data, { title: 'Paper' });
  } finally {
    restoreFetch();
  }
});

test('fetchJsonLimited aborts requests that exceed the timeout', async () => {
  globalThis.fetch = neverSettlingFetch() as typeof fetch;

  try {
    await assert.rejects(
      () => fetchJsonLimited('https://example.test/works/1', 'Test metadata', { timeoutMs: 20 }),
      /timed out/i,
    );
  } finally {
    restoreFetch();
  }
});

test('fetchJsonLimited rejects a declared Content-Length over the limit', async () => {
  globalThis.fetch = async () => new Response('small', {
    headers: { 'content-length': '2048' },
  });

  try {
    await assert.rejects(
      () => fetchJsonLimited('https://example.test/works/1', 'Test metadata', { maxBytes: 64 }),
      /too large|exceeds/i,
    );
  } finally {
    restoreFetch();
  }
});

test('fetchJsonLimited enforces the limit while streaming chunks', async () => {
  globalThis.fetch = async () => chunkedResponse(['{"value":"', 'x'.repeat(128), '"}"']);

  try {
    await assert.rejects(
      () => fetchJsonLimited('https://example.test/works/1', 'Test metadata', { maxBytes: 32 }),
      /too large|exceeds/i,
    );
  } finally {
    restoreFetch();
  }
});

test('downloadUrlToFile streams chunks to disk without buffering the whole file', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-httpio-test-'));
  const target = path.join(directory, 'paper.pdf');
  globalThis.fetch = async () => chunkedResponse(['%PDF-1.7\n', 'chunk-2\n', 'chunk-3\n']);

  try {
    const result = await downloadUrlToFile('https://example.test/paper.pdf', target, {
      label: 'Test download',
      timeoutMs: 5000,
      maxBytes: 1024,
    });

    assert.equal(readFileSync(target, 'utf8'), '%PDF-1.7\nchunk-2\nchunk-3\n');
    assert.equal(result.bytes, 25);
    assert.deepEqual(readdirSync(directory), ['paper.pdf']);
  } finally {
    restoreFetch();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('downloadUrlToFile rejects oversized Content-Length and removes the partial file', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-httpio-test-'));
  const target = path.join(directory, 'paper.pdf');
  globalThis.fetch = async () => new Response('x', { headers: { 'content-length': '4096' } });

  try {
    await assert.rejects(
      () => downloadUrlToFile('https://example.test/paper.pdf', target, { label: 'Test download', maxBytes: 64 }),
      /too large|exceeds/i,
    );
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    restoreFetch();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('downloadUrlToFile stops a chunked body over the limit and cleans up', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-httpio-test-'));
  const target = path.join(directory, 'paper.pdf');
  globalThis.fetch = async () => chunkedResponse(['a'.repeat(40), 'b'.repeat(40)]);

  try {
    await assert.rejects(
      () => downloadUrlToFile('https://example.test/paper.pdf', target, { label: 'Test download', maxBytes: 64 }),
      /too large|exceeds/i,
    );
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    restoreFetch();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('downloadUrlToFile removes the partial file when the body stream fails', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-httpio-test-'));
  const target = path.join(directory, 'paper.pdf');
  globalThis.fetch = async () => failingStreamResponse();

  try {
    await assert.rejects(
      () => downloadUrlToFile('https://example.test/paper.pdf', target, { label: 'Test download', maxBytes: 1024 }),
      /socket hang up/,
    );
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    restoreFetch();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('downloadUrlToFile aborts stalled downloads and cleans up', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-httpio-test-'));
  const target = path.join(directory, 'paper.pdf');
  globalThis.fetch = neverSettlingFetch() as typeof fetch;

  try {
    await assert.rejects(
      () => downloadUrlToFile('https://example.test/paper.pdf', target, { label: 'Test download', timeoutMs: 20 }),
      /timed out/i,
    );
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    restoreFetch();
    rmSync(directory, { recursive: true, force: true });
  }
});
