import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { createRagStore } = require('../electron/backend/ragStore.cjs');
const { createAiCommands } = require('../electron/backend/aiCommands.cjs');
const {
  createPaperRagLock,
  guardRagIndexCommands,
  setLibraryRagMembership,
} = require('../electron/backend/ragMembership.cjs');

function createAppPaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-rag-membership-'));
  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
}

function seedPaper(store: ReturnType<typeof createLibraryStore>, id: string) {
  const library = store.load();
  library.papers.push({
    id,
    title: id,
    titleZh: null,
    year: null,
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
    keywords: [],
    importedAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    source: 'local',
    sortOrder: 0,
    authors: [],
    tags: [],
    categoryIds: [],
    attachments: [],
  });
  store.save(library);
}

test('excluded paper index writes are rejected without a failed row', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const rag = createRagStore({ ragDatabasePath: appPaths.ragDatabasePath });
  const lock = createPaperRagLock();
  const commands: Record<string, (args: any) => Promise<unknown>> = {
    async rag_index_document({ request }) {
      rag.indexDocument(request);
    },
    async rag_report_document_index_failure({ request }) {
      rag.reportFailure(request);
    },
    async rag_finalize_document_index({ request }) {
      return rag.finalizeDocumentIndex(request);
    },
  };

  try {
    seedPaper(store, 'paper-1');
    store.setPapersRagEnabled(['paper-1'], false);
    guardRagIndexCommands(commands, { store, withPaperRagLock: lock.withPaperRagLock });

    const request = {
      documentKey: 'paper-1',
      title: 'Paper',
      sourceType: 'pdf-text',
      sourceSignature: 'sig',
      embeddingModelKey: 'embedding-test',
      totalChunkCount: 1,
      errorMessage: 'should not be stored',
      chunks: [{
        chunkId: 'c-1',
        chunkIndex: 0,
        text: 'body',
        embedding: [0.1, 0.2, 0.3, 0.4],
      }],
    };

    await assert.rejects(
      () => commands.rag_report_document_index_failure({ request }),
      /rag_index_excluded/,
    );
    await assert.rejects(
      () => commands.rag_index_document({ request }),
      /rag_index_excluded/,
    );
    await assert.rejects(
      () => commands.rag_index_document({ request: { ...request, documentKey: 'native-library:paper-1' } }),
      /rag_index_excluded/,
    );
    assert.equal(rag.getDocumentIndexStatus({ documentKey: 'paper-1', sourceType: 'pdf-text' }), null);

    await commands.rag_index_document({
      request: { ...request, documentKey: 'note:1', sourceType: 'note' },
    });
    assert.equal(rag.getDocumentIndexStatus({ documentKey: 'note:1', sourceType: 'note' })?.status, 'ready');

    await commands.rag_index_document({
      request: { ...request, documentKey: 'missing-paper' },
    });
    assert.equal(
      rag.getDocumentIndexStatus({ documentKey: 'missing-paper', sourceType: 'pdf-text' })?.status,
      'ready',
    );
  } finally {
    rag.close();
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('membership removal waits for an in-flight index write', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const rag = createRagStore({ ragDatabasePath: appPaths.ragDatabasePath });
  const lock = createPaperRagLock();
  let releaseWrite: (() => void) | null = null;
  const commands: Record<string, (args: any) => Promise<unknown>> = {
    async rag_index_document({ request }) {
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      rag.indexDocument(request);
    },
    async rag_report_document_index_failure() {},
    async rag_finalize_document_index() {},
  };

  try {
    seedPaper(store, 'paper-1');
    guardRagIndexCommands(commands, { store, withPaperRagLock: lock.withPaperRagLock });
    const writing = commands.rag_index_document({
      request: {
        documentKey: 'paper-1',
        title: 'Paper',
        sourceType: 'pdf-text',
        sourceSignature: 'sig',
        embeddingModelKey: 'embedding-test',
        totalChunkCount: 1,
        chunks: [{
          chunkId: 'c-1',
          chunkIndex: 0,
          text: 'body',
          embedding: [0.1, 0.2, 0.3, 0.4],
        }],
      },
    });
    const removing = setLibraryRagMembership({
      store,
      ragStore: rag,
      withPaperRagLock: lock.withPaperRagLock,
    }, { request: { paperIds: ['paper-1'], enabled: false } });

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (releaseWrite) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
    assert.equal(store.getPaper('paper-1').ragEnabled, true);
    releaseWrite?.();
    await writing;
    const result = await removing;
    assert.equal(result.failures.length, 0);
    assert.equal(result.papers[0].removed, true);
    assert.equal(store.getPaper('paper-1').ragEnabled, false);
    assert.equal(rag.getDocumentIndexStatus({ documentKey: 'paper-1', sourceType: 'pdf-text' }), null);
  } finally {
    rag.close();
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('membership rejects the whole batch when one paper is missing', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const lock = createPaperRagLock();

  try {
    seedPaper(store, 'paper-1');
    await assert.rejects(
      () => setLibraryRagMembership({
        store,
        ragStore: { removeDocumentIndex: () => ({ removed: false }) },
        withPaperRagLock: lock.withPaperRagLock,
      }, { request: { paperIds: ['paper-1', 'missing'], enabled: false } }),
      /Unknown paper ids: missing/,
    );
    assert.equal(store.getPaper('paper-1').ragEnabled, true);
  } finally {
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('retrieval excludes stale paper indexes before ranking while preserving note sources', async () => {
  const appPaths = createAppPaths();
  const store = createLibraryStore(appPaths);
  const rag = createRagStore({ ragDatabasePath: appPaths.ragDatabasePath });
  try {
    seedPaper(store, 'excluded');
    seedPaper(store, 'included');
    for (const [documentKey, sourceType, embedding, count] of [
      ['excluded', 'pdf-text', [1, 0], 12],
      ['native-library:excluded', 'pdf-text', [1, 0], 12],
      ['included', 'pdf-text', [0, 1], 2],
      ['excluded', 'note', [1, 0], 1],
    ] as const) {
      rag.indexDocument({
        documentKey, sourceType, title: documentKey, sourceSignature: 'sig', embeddingModelKey: 'model',
        totalChunkCount: count,
        chunks: Array.from({ length: count }, (_, index) => ({
          chunkId: `${sourceType}-${index}`, chunkIndex: index, text: 'shared search phrase', embedding,
        })),
      });
    }
    store.setPapersRagEnabled(['excluded'], false);
    const commands = createAiCommands({ store, ragStore: rag });
    const coverage = await commands.rag_retrieve_document_chunks({ request: {
      queryEmbedding: [1, 0], queryText: 'shared', topK: 2, embeddingModelKey: 'model',
      documentKeys: ['excluded', 'included', 'unindexed'], includeDiagnostics: true, includeIndexCoverage: true,
    } });
    assert.deepEqual(coverage.indexCoverage, { total: 3, excluded: 1, ready: 1, unavailable: 1 });
    const wrongModel = await commands.rag_retrieve_document_chunks({ request: {
      queryEmbedding: [1, 0], topK: 2, embeddingModelKey: 'other', documentKeys: ['included'],
      includeDiagnostics: true, includeIndexCoverage: true,
    } });
    assert.deepEqual(wrongModel.indexCoverage, { total: 1, excluded: 0, ready: 0, unavailable: 1 });
    const wrongDimension = await commands.rag_retrieve_document_chunks({ request: {
      queryEmbedding: [1, 0, 0], topK: 2, embeddingModelKey: 'model', documentKeys: ['included'],
      includeDiagnostics: true, includeIndexCoverage: true,
    } });
    assert.deepEqual(wrongDimension.indexCoverage, { total: 1, excluded: 0, ready: 0, unavailable: 1 });
    for (const embeddingModelKey of ['model', undefined]) {
      const result = await commands.rag_retrieve_document_chunks({ request: {
        queryEmbedding: [1, 0], queryText: 'shared search phrase', topK: 2, embeddingModelKey,
        documentKeys: ['excluded', 'native-library:excluded', 'included'], includeDiagnostics: true,
      } });
      assert.equal(result.results.length, 2);
      assert.ok(result.results.every((row: any) => row.documentKey === 'included'));
      const global = await commands.rag_retrieve_document_chunks({ request: {
        queryEmbedding: [1, 0], queryText: 'shared search phrase', topK: 2, embeddingModelKey,
      } });
      assert.equal(global.length, 2);
      assert.ok(global.every((row: any) => row.documentKey === 'included'));
    }
    store.setPapersRagEnabled(['included'], false);
    const allExcluded = await commands.rag_retrieve_document_chunks({ request: {
      queryEmbedding: [1, 0], queryText: 'shared', topK: 2,
    } });
    assert.deepEqual(allExcluded, []);
    const single = await commands.rag_retrieve_document_chunks({ request: {
      documentKey: 'native-library:excluded', queryEmbedding: [1, 0], queryText: 'shared', topK: 2,
    } });
    assert.deepEqual(single, []);
    const note = await commands.rag_retrieve_document_chunks({ request: {
      documentKey: 'excluded', sourceType: 'note', queryEmbedding: [1, 0], queryText: 'shared', topK: 2,
    } });
    assert.equal(note.length, 1);
    const context = await commands.rag_get_chunk_context({ request: {
      documentKey: 'native-library:excluded', sourceType: 'pdf-text', chunkId: 'pdf-text-0',
    } });
    assert.equal(context.status, 'not-ready');
  } finally {
    rag.close();
    store.close();
    rmSync(appPaths.dataDir, { recursive: true, force: true });
  }
});

test('retrieval retries when membership changes during worker execution', async () => {
  let disabled: string[] = [];
  let calls = 0;
  const store = { listRagDisabledPaperIds: () => disabled };
  const ragStore = {
    async retrieveDocumentChunks(request: any) {
      calls += 1;
      if (calls === 1) {
        disabled = ['excluded'];
        return [{ documentKey: 'excluded', sourceType: 'pdf-text' }];
      }
      assert.ok(request.excludedDocumentKeys.includes('excluded'));
      assert.ok(request.excludedDocumentKeys.includes('native-library:excluded'));
      return [{ documentKey: 'included', sourceType: 'pdf-text' }];
    },
    async getChunkContext() {
      disabled = ['excluded'];
      return { status: 'ready', slices: [{ text: 'stale' }] };
    },
  };
  const commands = createAiCommands({ store, ragStore });
  const result = await commands.rag_retrieve_document_chunks({ request: {} });
  assert.equal(calls, 2);
  assert.equal(result[0].documentKey, 'included');
  disabled = [];
  const context = await commands.rag_get_chunk_context({ request: { documentKey: 'excluded', sourceType: 'pdf-text' } });
  assert.equal(context.status, 'not-ready');
  assert.deepEqual(context.slices, []);
});
