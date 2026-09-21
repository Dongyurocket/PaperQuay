import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');

function createContext(receivedDocumentKeySets: string[][]) {
  return {
    agentMemoryStore: {},
    store: {
      load() {
        return { papers: [{ id: 'paper-1', title: 'Scoped evidence paper' }] };
      },
    },
    ragStore: {
      retrieveDocumentChunks({ documentKeys }: { documentKeys?: string[] }) {
        const keys = Array.isArray(documentKeys) ? documentKeys : [];
        receivedDocumentKeySets.push(keys);
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

  const commands = createAiCommands(createContext(receivedDocumentKeySets));
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
