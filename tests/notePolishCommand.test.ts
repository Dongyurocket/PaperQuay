import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');
const { createRagStore } = require('../electron/backend/ragStore.cjs');

function createContext(receivedDocumentKeySets: string[][], receivedModelKeys: string[] = []) {
  return {
    agentMemoryStore: {},
    store: {
      load() {
        return { papers: [{ id: 'paper-1', title: 'Scoped evidence paper' }] };
      },
    },
    ragStore: {
      retrieveDocumentChunks({ documentKeys, embeddingModelKey }: { documentKeys?: string[]; embeddingModelKey?: string }) {
        const keys = Array.isArray(documentKeys) ? documentKeys : [];
        receivedDocumentKeySets.push(keys);
        receivedModelKeys.push(embeddingModelKey ?? '');
        if (!keys.includes('paper-1')) return [];
        return [{
          documentKey: 'paper-1',
          chunkId: 'chunk-1',
          blockId: 'block-1',
          pageIndex: 2,
          sourceType: 'mineru-markdown',
          text: 'The indexed supporting passage.',
          score: 0.1,
        }];
      },
    },
  };
}

test('note polish maps only server-known citation IDs to scoped RAG evidence', async (t) => {
  const receivedDocumentKeySets: string[][] = [];
  const receivedModelKeys: string[] = [];
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount += 1;
    if (callCount === 1) {
      return Response.json({ data: [{ index: 0, embedding: [0.2, 0.1, 0.3] }] });
    }

    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            text: '## Polished note\n\nClearer wording.',
            citations: ['S1', 'fabricated-source'],
          }),
        },
      }],
    });
  });

  const commands = createAiCommands(createContext(receivedDocumentKeySets, receivedModelKeys));
  const result = await commands.notes_polish_openai_compatible({
    options: {
      baseUrl: 'https://example.test/v1',
      apiKey: 'chat-key',
      model: 'chat-model',
      text: 'Draft note.',
      scope: 'linked-papers',
      linkedPaperIds: ['native-library:paper-1'],
      embedding: {
        baseUrl: 'https://embedding.example.test/v1',
        apiKey: 'embedding-key',
        model: 'embedding-model',
      },
    },
  });

  // 回归：索引 documentKey 为裸 paper.id，检索必须带裸键（兼容旧前缀键）。
  assert.equal(receivedDocumentKeySets.length > 0, true);
  assert.equal(receivedDocumentKeySets[0].includes('paper-1'), true);
  assert.equal(receivedDocumentKeySets[0].includes('native-library:paper-1'), true);
  assert.deepEqual(receivedModelKeys, ['https://embedding.example.test/v1::embedding-model::default']);

  assert.equal(result.text, '## Polished note\n\nClearer wording.');
  assert.deepEqual(result.citations, [{
    id: 'S1',
    paperId: 'paper-1',
    paperTitle: 'Scoped evidence paper',
    chunkId: 'chunk-1',
    blockId: 'block-1',
    pageIndex: 2,
    excerpt: 'The indexed supporting passage.',
    sourceType: 'mineru-markdown',
  }]);
});

test('note polish falls back to plain text when a provider ignores JSON mode', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: '<think>hidden</think>\nPolished plain text.' } }],
  }));

  const commands = createAiCommands(createContext([]));
  const result = await commands.notes_polish_openai_compatible({
    options: {
      baseUrl: 'https://example.test/v1',
      apiKey: 'chat-key',
      model: 'chat-model',
      text: 'Draft note.',
      scope: 'none',
    },
  });

  assert.equal(result.text, 'Polished plain text.');
  assert.deepEqual(result.citations, []);
});

test('note polish excludes same-dimension evidence from another embedding model', async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-polish-rag-'));
  const ragStore = createRagStore({ ragDatabasePath: path.join(dataDir, 'rag.sqlite') }, { deferVectorBackfill: true });
  try {
    for (const [sourceType, model, text, vector] of [
      ['pdf-text', 'current', 'Current model evidence about rotor noise.', [0, 1]],
      ['mineru-markdown', 'old', 'Old model evidence about rotor noise.', [1, 0]],
    ] as const) {
      ragStore.indexDocument({ documentKey: 'paper-1', title: 'Scoped evidence paper', sourceType,
        sourceSignature: sourceType, embeddingModelKey: `https://embedding.example.test/v1::${model}::default`,
        totalChunkCount: 1, chunks: [{ chunkId: sourceType, chunkIndex: 0, pageIndex: 0, text, embedding: vector }] });
    }
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return calls % 2 === 1
        ? Response.json({ data: [{ index: 0, embedding: [1, 0] }] })
        : Response.json({ choices: [{ message: { content: JSON.stringify({ text: 'Polished.', citations: ['S1'] }) } }] });
    });
    const commands = createAiCommands({ ...createContext([]), ragStore });
    const result = await commands.notes_polish_openai_compatible({ options: {
      baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'chat', text: 'rotor noise',
      scope: 'linked-papers', linkedPaperIds: ['paper-1'],
      embedding: { baseUrl: 'https://embedding.example.test/embeddings', apiKey: 'key', model: 'current' },
    } });
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].sourceType, 'pdf-text');
    assert.match(result.citations[0].excerpt, /Current model evidence/);
    assert.doesNotMatch(result.citations[0].excerpt, /Old model evidence/);
    const unmatched = await commands.notes_polish_openai_compatible({ options: {
      baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'chat', text: 'rotor noise',
      scope: 'linked-papers', linkedPaperIds: ['paper-1'],
      embedding: { baseUrl: 'https://embedding.example.test/embeddings', apiKey: 'key', model: 'unmatched' },
    } });
    assert.deepEqual(unmatched.citations, []);
    assert.match(unmatched.notice, /向量模型与当前模型不一致/);
  } finally {
    ragStore.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
