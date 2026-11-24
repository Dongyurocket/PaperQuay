import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocumentOpenGeneration } from '../src/features/reader/documentOpenGeneration.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface ReaderState {
  workspaceId: string;
  pdfSource: string;
  currentDocument: string;
  loading: boolean;
  error: string;
}

test('switching pdfSource in the same workspace keeps only the latest commit', () => {
  const generation = createDocumentOpenGeneration();
  const state: ReaderState = {
    workspaceId: 'paper-1',
    pdfSource: 'original.pdf',
    currentDocument: 'paper-1',
    loading: true,
    error: '',
  };

  // 原始 PDF 仍在打开时，同一 workspace 切换到批注版。
  const openToken = generation.begin();
  const switchToken = generation.begin();

  // 旧 open 晚到：pdfSource/currentDocument/loading/error 都不得被它写回。
  generation.ifCurrent(openToken, () => {
    state.pdfSource = 'stale-original.pdf';
    state.currentDocument = 'paper-1';
    state.loading = false;
    state.error = 'stale open failed';
  });

  assert.equal(state.pdfSource, 'original.pdf');
  assert.equal(state.currentDocument, 'paper-1');
  assert.equal(state.loading, true, 'a stale request must not clear loading');
  assert.equal(state.error, '');

  assert.equal(
    generation.ifCurrent(switchToken, () => {
      state.pdfSource = 'annotated.pdf';
      state.loading = false;
      return true;
    }),
    true,
  );
  assert.equal(state.pdfSource, 'annotated.pdf');
  assert.equal(state.loading, false);
});

test('out-of-order async opens apply only the latest resolved pdfSource', async () => {
  const generation = createDocumentOpenGeneration();
  const state: ReaderState = {
    workspaceId: 'paper-1',
    pdfSource: 'original.pdf',
    currentDocument: 'paper-1',
    loading: true,
    error: '',
  };
  const slowOriginal = deferred<string>();

  const openOriginal = (async () => {
    const token = generation.begin();
    const path = await slowOriginal.promise;
    generation.ifCurrent(token, () => {
      state.pdfSource = path;
      state.loading = false;
    });
  })();

  const openAnnotated = (async () => {
    const token = generation.begin();
    await Promise.resolve();
    generation.ifCurrent(token, () => {
      state.pdfSource = 'annotated.pdf';
      state.loading = false;
    });
  })();

  await openAnnotated;
  slowOriginal.resolve('original.pdf');
  await openOriginal;

  assert.equal(state.pdfSource, 'annotated.pdf', 'the older open must not overwrite the newer source');
  assert.equal(state.loading, false);
});

test('a later open cancels deferred MinerU restoration from the previous document', async () => {
  const generation = createDocumentOpenGeneration();
  let applied = '';

  const openToken = generation.begin();
  const switchedToken = generation.begin();

  const restoreDeferredWork = async () => {
    await Promise.resolve();
    if (!generation.isCurrent(openToken)) return;
    applied = 'cached-mineru';
  };

  await restoreDeferredWork();
  assert.equal(applied, '');

  if (generation.isCurrent(switchedToken)) applied = 'switched';
  assert.equal(applied, 'switched');
});

test('stale error and loading settle callbacks are ignored', () => {
  const generation = createDocumentOpenGeneration();
  const state: ReaderState = {
    workspaceId: 'paper-1',
    pdfSource: 'original.pdf',
    currentDocument: 'paper-1',
    loading: false,
    error: '',
  };

  const staleToken = generation.begin();
  const currentToken = generation.begin();

  generation.ifCurrent(staleToken, () => {
    state.error = 'stale failure';
    state.loading = true;
  });
  assert.equal(state.error, '');
  assert.equal(state.loading, false);

  generation.ifCurrent(currentToken, () => {
    state.error = 'current failure';
    state.loading = true;
  });
  assert.equal(state.error, 'current failure');
  assert.equal(state.loading, true);
  assert.equal(generation.isCurrent(currentToken), true);
  assert.equal(generation.isCurrent(staleToken), false);
});
