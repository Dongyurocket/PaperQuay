import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore
import { fetchPaddleResource, mapConcurrent, createPaddleTaskRegistry } from '../electron/backend/paddleOcrRuntime.cjs';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('request timeout includes a stalled body and aborts its signal', async () => {
  const original = globalThis.fetch;
  let signal: AbortSignal | undefined;
  try {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return { text: () => new Promise(() => {}) };
    }) as typeof fetch;
    await assert.rejects(fetchPaddleResource('https://example.test', {}, (response: Response) => response.text(), { requestTimeoutMs: 20 }), /超时/);
    assert.equal(signal?.aborted, true);
  } finally { globalThis.fetch = original; }
});

test('expired overall deadline does not start another request', async () => {
  await assert.rejects(fetchPaddleResource('https://example.test', {}, () => '', { deadline: Date.now() - 1 }), /总时限/);
});

test('assets have bounded concurrency and preserve order', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapConcurrent([0, 1, 2, 3, 4, 5], 4, async (value: number) => {
    peak = Math.max(peak, ++active);
    await delay(5);
    active--;
    return value * 2;
  });
  assert.equal(peak, 4);
  assert.deepEqual(result, [0, 2, 4, 6, 8, 10]);
});

test('worker failure settles active workers and stops queued work before rejecting', async () => {
  let active = 0;
  const started: number[] = [];
  await assert.rejects(mapConcurrent([0, 1, 2, 3, 4], 2, async (value: number) => {
    started.push(value);
    active++;
    try { if (value === 0) throw new Error('disk full'); await delay(20); }
    finally { active--; }
  }), /disk full/);
  assert.equal(active, 0);
  assert.ok(started.length <= 2);
});

test('registry preserves terminal state after sender closes and rejects duplicate active documents', async () => {
  const registry = createPaddleTaskRegistry();
  let finish!: () => void;
  let progress!: (value: object) => void;
  const pending = registry.run({ documentKey: 'paper', pdfPath: 'paper.pdf', taskId: 'one' },
    { sender: { isDestroyed: () => true } }, async (options: any) => {
      progress = options.onProgress;
      await new Promise<void>((resolve) => { finish = resolve; });
      return { contentJsonPath: 'out.json', blockCount: 3 };
    });
  await assert.rejects(registry.run({ documentKey: 'paper' }, null, async () => ({})), /正在执行/);
  finish();
  await pending;
  assert.equal(registry.list()[0].status, 'success');
  const revision = registry.list()[0].revision;
  progress({ stage: 'assets' });
  assert.equal(registry.list()[0].revision, revision);
  await assert.rejects(registry.run({ documentKey: 'paper', taskId: 'two' }, null, async () => { throw new Error('broken'); }), /broken/);
  progress({ stage: 'assets' });
  assert.equal(registry.list()[0].taskId, 'two');
  assert.equal(registry.list()[0].status, 'error');
  assert.ok(registry.list()[0].revision > revision);
});
