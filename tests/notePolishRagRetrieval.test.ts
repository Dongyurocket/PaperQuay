import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');
const { createRagStore } = require('../electron/backend/ragStore.cjs');

// 回归：索引侧 documentKey 为裸 paper.id（readerRag.ts buildReaderRagDocumentKey），
// 润色检索曾用 native-library: 前缀键导致永远不匹配。本测试用真实 ragStore
// 以裸键索引，端到端验证润色命令能检索到证据并把引用映射回文献。

function createFixture() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-note-polish-rag-'));
  const ragStore = createRagStore({
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
  });

  ragStore.indexDocument({
    documentKey: 'paper-1',
    title: 'Quantum retrieval paper',
    sourceType: 'mineru-markdown',
    sourceSignature: 'sig-1',
    embeddingModelKey: 'embedding-test',
    totalChunkCount: 2,
    chunks: [
      {
        chunkId: 'chunk-near',
        chunkIndex: 0,
        pageIndex: 2,
        blockId: 'block-near',
        text: 'Quantum retrieval improves note drafting with indexed evidence.',
        embedding: [1, 0.1, 0, 0],
      },
      {
        chunkId: 'chunk-far',
        chunkIndex: 1,
        pageIndex: 5,
        blockId: 'block-far',
        text: 'Unrelated cooking instructions for a completely different topic.',
        embedding: [0, 0, 1, 1],
      },
    ],
  });

  const commands = createAiCommands({
    agentMemoryStore: {},
    ragStore,
    store: {
      load() {
        return { papers: [{ id: 'paper-1', title: 'Quantum retrieval paper' }] };
      },
    },
  });

  return { commands, dataDir, ragStore };
}

function polishOptions(overrides = {}) {
  return {
    baseUrl: 'https://example.test/v1',
    apiKey: 'chat-key',
    model: 'chat-model',
    text: 'Draft note about quantum retrieval.',
    scope: 'linked-papers',
    linkedPaperIds: ['paper-1'],
    embedding: {
      baseUrl: 'https://embedding.example.test/v1',
      apiKey: 'embedding-key',
      model: 'embedding-model',
    },
    ...overrides,
  };
}

test('note polish retrieves evidence indexed under the bare paper id', async (t) => {
  const { commands, dataDir, ragStore } = createFixture();
  try {
    let callCount = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      callCount += 1;
      if (callCount === 1) {
        return Response.json({ data: [{ index: 0, embedding: [0.9, 0.1, 0.1, 0.1] }] });
      }
      return Response.json({
        choices: [{
          message: {
            content: JSON.stringify({ text: 'Polished note.', citations: ['S1'] }),
          },
        }],
      });
    });

    const result = await commands.notes_polish_openai_compatible({ options: polishOptions() });

    assert.equal(result.text, 'Polished note.');
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].paperId, 'paper-1');
    assert.equal(result.citations[0].paperTitle, 'Quantum retrieval paper');
    assert.equal(result.citations[0].chunkId, 'chunk-near');
    assert.equal(result.citations[0].pageIndex, 2);
    assert.equal(result.notice, null);
  } finally {
    ragStore.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('note polish surfaces an explicit notice when the index dimension mismatches', async (t) => {
  const { commands, dataDir, ragStore } = createFixture();
  try {
    let callCount = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      callCount += 1;
      if (callCount === 1) {
        // 3 维查询向量 vs 4 维索引 → 检索必为空，应提示维度不一致而非"未检索到"。
        return Response.json({ data: [{ index: 0, embedding: [0.3, 0.3, 0.4] }] });
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ text: 'Polished note.', citations: [] }) } }],
      });
    });

    const result = await commands.notes_polish_openai_compatible({ options: polishOptions() });

    assert.equal(typeof result.notice, 'string');
    assert.equal(result.notice.includes('维度'), true);
  } finally {
    ragStore.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
