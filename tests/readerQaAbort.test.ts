import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitQaRequest } from '../src/features/reader/readerQaAbort.ts';

test('stopping during retrieval immediately rejects without accepting its late result', async () => {
  const controller = new AbortController();
  let complete!: (value: string) => void;
  const request = awaitQaRequest(new Promise<string>((resolve) => { complete = resolve; }), controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  complete('late result');
});
