import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { build } from 'esbuild';

const require = createRequire(import.meta.url);

interface ReaderRagModule {
  estimateRagTokens: (text: string) => number;
  trimDocumentTextToTokenBudget: (
    text: string,
    tokenBudget?: number,
  ) => { text: string; truncated: boolean };
  buildRagContextText: (input: Record<string, unknown>) => {
    documentText: string;
    sectionCount: number;
    budgetSkippedCount?: number;
  };
}

interface ReaderQaContextModule {
  buildQaContext: (input: Record<string, unknown>) => {
    budgetSkippedCount?: number;
    retrievalState: string;
  };
}

async function bundle<T>(entryPoint: string): Promise<T> {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} as T };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  return module.exports;
}

const readerRag = await bundle<ReaderRagModule>('src/features/reader/readerRag.ts');
const readerQaContext = await bundle<ReaderQaContextModule>('src/features/reader/readerQaContext.ts');

test('full-text fallback is trimmed to the requested token budget', () => {
  const text = Array.from({ length: 400 }, (_, index) => `Sentence ${index} with some evidence text.`).join('\n');
  const budget = 500;
  const trimmed = readerRag.trimDocumentTextToTokenBudget(text, budget);

  assert.equal(trimmed.truncated, true);
  assert.ok(
    readerRag.estimateRagTokens(trimmed.text) <= budget,
    'trimmed text plus the truncation marker must stay within the budget',
  );
  assert.match(trimmed.text, /\[truncated\]/);
});

test('text already within budget is returned untouched', () => {
  const text = 'short evidence';
  const trimmed = readerRag.trimDocumentTextToTokenBudget(text, 500);
  assert.deepEqual(trimmed, { text, truncated: false });
});

test('RAG context drops lower-ranked sections and reports how many were skipped', () => {
  const results = Array.from({ length: 20 }, (_, index) => ({
    chunkId: `chunk-${index}`,
    sourceType: 'mineru-markdown',
    pageIndex: 0,
    blockId: `block-${index}`,
    text: `Paragraph ${index} with retrieved evidence text for the question.`,
    score: 1 - index * 0.01,
  }));

  const context = readerRag.buildRagContextText({
    results,
    topK: 20,
    mineruBlocks: [],
    preparedSources: [],
    paperId: 'paper-1',
    paperTitle: 'Paper',
    question: 'What is the result?',
    tokenBudget: 120,
  });

  assert.ok(context.documentText.length > 0);
  assert.ok(context.sectionCount < 20);
  assert.ok((context.budgetSkippedCount ?? 0) > 0);
  assert.ok(readerRag.estimateRagTokens(context.documentText) <= 120);
});

test('QA context carries the skipped-evidence count through to the UI', () => {
  const context = readerQaContext.buildQaContext({
    origin: 'local-rag',
    rag: {
      kind: 'retrieved',
      documentText: 'evidence',
      retrievedChunkCount: 1,
      citations: [],
      retrievals: [],
      budgetSkippedCount: 4,
    },
  });

  assert.equal(context.retrievalState, 'retrieved');
  assert.equal(context.budgetSkippedCount, 4);
});

test('a single oversized RAG section is hard-trimmed to the budget', () => {
  const context = readerRag.buildRagContextText({
    results: [{
      chunkId: 'oversized',
      sourceType: 'mineru-markdown',
      pageIndex: 0,
      blockId: 'block-0',
      text: 'Very long retrieved evidence. '.repeat(400),
      score: 1,
    }],
    topK: 1,
    mineruBlocks: [],
    preparedSources: [],
    paperId: 'paper-1',
    paperTitle: 'Paper',
    question: 'What is the result?',
    tokenBudget: 120,
  });

  assert.equal(context.sectionCount, 1);
  // 没有丢弃整条证据，只是正文被截断；用文本标记表示，不污染丢弃计数。
  assert.equal(context.budgetSkippedCount, undefined);
  assert.match(context.documentText, /\[truncated\]/);
  assert.ok(
    readerRag.estimateRagTokens(context.documentText) <= 120,
    'the final prompt text must respect the model budget even for one section',
  );
});
