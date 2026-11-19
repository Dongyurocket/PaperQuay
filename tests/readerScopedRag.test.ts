import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { PositionedMineruBlock, WorkspaceItem } from '../src/types/reader.ts';

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents: `export { resolveScopedLocalRag } from './src/services/localRag';
      export { buildRagEmbeddingModelKey } from './src/services/rag';
      export { prepareReaderRagDocument } from './src/features/reader/readerRag';
      export { ensurePreparedSourceIndexed } from './src/services/localRag';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
});
const compiled = { exports: {} as any };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, compiled, compiled.exports);
const { resolveScopedLocalRag, buildRagEmbeddingModelKey, prepareReaderRagDocument, ensurePreparedSourceIndexed } = compiled.exports;

const embedding = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'key',
  model: 'embed',
  dimensions: 3,
  timeoutSeconds: 30,
};
const modelKey = buildRagEmbeddingModelKey(embedding);

function makeItem(id: string, ragEnabled = true): WorkspaceItem {
  return {
    itemKey: id,
    workspaceId: id,
    source: 'native-library',
    groupKey: '',
    title: `Paper ${id}`,
    creators: 'Author',
    year: '2024',
    itemType: 'journalArticle',
    localPdfPath: `C:/papers/${id}.pdf`,
    ragEnabled,
  } as WorkspaceItem;
}

function makeBlocks(text: string): PositionedMineruBlock[] {
  return [{
    type: 'paragraph',
    blockId: `${text}-block`,
    pageIndex: 0,
    blockIndex: 0,
    content: { paragraph_content: [{ type: 'text', content: text }] },
  } as PositionedMineruBlock];
}

function makeStatus(documentKey: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    documentKey,
    sourceType: 'mineru-markdown',
    sourceSignature: 'sig',
    embeddingModelKey: modelKey,
    embeddingDimension: 3,
    totalChunkCount: 1,
    chunkCount: 1,
    indexedChunkCount: status === 'ready' ? 1 : 0,
    indexedAt: 1,
    status,
    lastError: null,
    ...extra,
  };
}

function installBridge(handlers: Record<string, (args: any) => unknown>) {
  const calls: Array<{ command: string; args: any }> = [];
  const previous = (globalThis as any).window;
  (globalThis as any).window = {
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    paperquay: {
      invoke: async (command: string, args: any) => {
        calls.push({ command, args });
        const handler = handlers[command];
        if (!handler) throw new Error(`unexpected invoke: ${command}`);
        return handler(args);
      },
    },
  };
  return {
    calls,
    restore() { (globalThis as any).window = previous; },
  };
}

function result(documentKey: string, chunkId: string, text: string, blockId: string) {
  return {
    documentKey,
    chunkId,
    sourceType: 'mineru-markdown',
    pageIndex: 0,
    blockId,
    text,
    score: 0.1,
  };
}

test('library scope retrieves only ready indexes with one global topK and never indexes', async () => {
  const items = [makeItem('a'), makeItem('b'), makeItem('c', false), makeItem('d')];
  const statuses = [
    makeStatus('a', 'ready'),
    makeStatus('b', 'ready'),
    makeStatus('c', 'ready'),
    makeStatus('d', 'pending'),
  ];
  const bridge = installBridge({
    rag_list_index_statuses: () => statuses,
    rag_embed_text: () => [0.1, 0.2, 0.3],
    rag_retrieve_document_chunks: () => ({
      results: [
        result('a', 'a:0', 'Evidence from A', 'a-block'),
        result('b', 'b:0', 'Evidence from B', 'b-block'),
      ],
      ftsStatus: 'searched',
      ftsHitCount: 2,
    }),
  });
  try {
    const scoped = await resolveScopedLocalRag({
      scope: { mode: 'library' },
      documents: [],
      libraryItems: items,
      settings: { localRagEnabled: true, localRagTopK: 6, ragSourceMode: 'mineru-markdown', embeddingBatchSize: 4 },
      embedding,
      question: 'rotor noise',
    });
    assert.equal(scoped.resolution.kind, 'retrieved');
    if (scoped.resolution.kind !== 'retrieved') return;
    assert.deepEqual(new Set(scoped.resolution.citations.map((citation) => citation.paperId)), new Set(['a', 'b']));
    const retrieveCall = bridge.calls.find((call) => call.command === 'rag_retrieve_document_chunks');
    assert.deepEqual(new Set(retrieveCall?.args.request.documentKeys), new Set(['a', 'b']));
    assert.equal(bridge.calls.some((call) => call.command === 'rag_index_document'), false);
  } finally {
    bridge.restore();
  }
});

test('selected scope lazy-indexes missing papers and reports failures as skipped', async () => {
  const items = [makeItem('a'), makeItem('b')];
  const documentA = { item: items[0], mineruBlocks: makeBlocks('Alpha evidence'), mineruDocumentText: 'Alpha evidence', pdfDocumentText: '' };
  const documentB = { item: items[1], mineruBlocks: makeBlocks('Beta evidence'), mineruDocumentText: 'Beta evidence', pdfDocumentText: '' };
  const preparedA = prepareReaderRagDocument({
    item: items[0],
    settings: { ragSourceMode: 'mineru-markdown' },
    mineruBlocks: documentA.mineruBlocks,
    mineruDocumentText: documentA.mineruDocumentText,
    pdfDocumentText: '',
  });
  const statuses = new Map([
    ['a', makeStatus('a', 'ready', { sourceSignature: preparedA.sources[0].sourceSignature })],
    ['b', makeStatus('b', 'pending')],
  ]);
  const bridge = installBridge({
    rag_get_document_index_status: (args) => statuses.get(args.request.documentKey) ?? null,
    rag_list_indexed_chunk_ids: () => [],
    rag_index_document: (args) => {
      if (args.request.documentKey === 'b') throw new Error('embedding failed');
      return { indexed: 1 };
    },
    rag_finalize_document_index: () => null,
    rag_report_document_index_failure: () => null,
    rag_embed_chunks: (args) => args.request.chunks.map((chunk: any) => ({ ...chunk, embedding: [0.1, 0.2, 0.3] })),
    rag_embed_text: () => [0.1, 0.2, 0.3],
    rag_retrieve_document_chunks: (args) => ({
      results: args.request.documentKey === 'a'
        ? [result('a', 'a:0', 'Alpha evidence', 'Alpha evidence-block')]
        : [],
      ftsStatus: 'searched',
      ftsHitCount: 1,
    }),
  });
  try {
    const scoped = await resolveScopedLocalRag({
      scope: { mode: 'selected', paperIds: ['a', 'b'] },
      documents: [documentA, documentB],
      libraryItems: items,
      settings: { localRagEnabled: true, localRagTopK: 3, ragSourceMode: 'mineru-markdown', embeddingBatchSize: 4 },
      embedding,
      question: 'evidence',
    });
    assert.equal(scoped.resolution.kind, 'retrieved');
    assert.equal(scoped.skippedDocuments.some((entry) => entry.paperId === 'b'), true);
    assert.equal(bridge.calls.some((call) => call.command === 'rag_index_document' && call.args.request.documentKey === 'b'), true);
    if (scoped.resolution.kind === 'retrieved') {
      assert.equal(scoped.resolution.citations[0]?.paperId, 'a');
    }
  } finally {
    bridge.restore();
  }
});

test('selected scope stops with a clear state when every paper is excluded or indexing', async () => {
  const items = [makeItem('a'), makeItem('b')];
  const bridge = installBridge({
    rag_get_document_index_status: () => null,
    rag_list_indexed_chunk_ids: () => [],
    rag_index_document: () => ({ indexed: 1 }),
    rag_finalize_document_index: () => null,
    rag_report_document_index_failure: () => null,
    rag_embed_chunks: (args) => args.request.chunks.map((chunk: any) => ({ ...chunk, embedding: [0.1, 0.2, 0.3] })),
    rag_embed_text: () => [0.1, 0.2, 0.3],
    rag_retrieve_document_chunks: () => ({ results: [], ftsStatus: 'searched', ftsHitCount: 0 }),
  });
  try {
    const scoped = await resolveScopedLocalRag({
      scope: { mode: 'selected', paperIds: ['a', 'b'] },
      documents: [
        { item: items[0], mineruBlocks: makeBlocks('A'), mineruDocumentText: 'A', pdfDocumentText: '' },
        { item: items[1], mineruBlocks: makeBlocks('B'), mineruDocumentText: 'B', pdfDocumentText: '' },
      ],
      libraryItems: items,
      settings: { localRagEnabled: true, localRagTopK: 3, ragSourceMode: 'mineru-markdown', embeddingBatchSize: 4 },
      embedding,
      question: 'question',
    });
    assert.notEqual(scoped.resolution.kind, 'retrieved');
    assert.equal(scoped.skippedDocuments.length, 2);
  } finally {
    bridge.restore();
  }
});


test('automatic batch indexing skips a ready index with an older extractor signature', async () => {
  const bridge = installBridge({
    rag_get_document_index_status: () => makeStatus('paper-old', 'ready', { sourceSignature: 'old-signature' }),
  });
  try {
    const result = await ensurePreparedSourceIndexed({
      documentKey: 'paper-old',
      title: 'Paper old',
      sourceType: 'mineru-markdown',
      sourceSignature: 'new-signature',
      chunks: [{ chunkId: 'c1', chunkIndex: 0, pageIndex: 0, blockId: 'b1', text: 'Body' }],
      embedding,
      batchSize: 4,
      skipIfSignatureMismatch: true,
    });
    assert.equal(result.outcome, 'skipped');
    assert.equal(bridge.calls.some((call) => call.command === 'rag_index_document'), false);
  } finally {
    bridge.restore();
  }
});
