import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chunkNote, noteSignature, fuseNotes } = require('../electron/backend/noteSearch.cjs');
const { createRagStore } = require('../electron/backend/ragStore.cjs');
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createNoteCommands } = require('../electron/backend/noteCommands.cjs');
const { createNoteIndexer, indexNote, noteModelKey, resolveNoteEmbedding } = require('../electron/backend/noteEmbedding.cjs');
const { hybridNotes } = require('../electron/backend/noteHybridSearch.cjs');
const { createRagWorkerStore } = require('../electron/backend/ragWorkerHost.cjs');
const { createNoteVault } = require('../electron/backend/noteVault.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pq-note-search-'));
  const appPaths = {
    dataDir: dir,
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
    ragDatabasePath: path.join(dir, 'paperquay-rag.sqlite'),
    configPath: path.join(dir, '.settings', 'paperquay.config.json'),
  };
  const notes = createNoteStore(appPaths);
  const rag = createRagStore(appPaths);
  const add = (content: string, extra: any = {}) => notes.createNote({
    paperId: 'p1', type: 'standalone', title: 'Research', content, ...extra,
  });
  return {
    dir, appPaths, notes, rag, add,
    close() {
      notes.close(); rag.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

function configure(f: ReturnType<typeof fixture>, baseUrl = 'http://127.0.0.1:9/v1') {
  mkdirSync(path.dirname(f.appPaths.configPath), { recursive: true });
  writeFileSync(f.appPaths.configPath, JSON.stringify({
    settings: { embeddingBaseUrl: baseUrl, embeddingModel: 'test-note', embeddingDimensions: 3 },
    secrets: { embeddingApiKey: 'mock-key-not-a-real-secret' },
  }));
  return resolveNoteEmbedding(f.appPaths);
}

test('note chunks exclude anchor evidence and source snapshot, preserve editable prose', () => {
  const note = {
    id: 'a', title: 'Methods',
    contentJson: { content: [
      { type: 'noteAnchorBlock', attrs: { excerpt: 'SECRET EVIDENCE' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'My synthesis' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '原文快照' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'SECRET SNAPSHOT' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Discussion' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'My discussion' }] },
    ] },
  };
  const chunks = chunkNote(note);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /My synthesis/);
  assert.match(chunks[0].text, /My discussion/);
  assert.doesNotMatch(chunks[0].text, /SECRET/);
  assert.equal(noteSignature(note), noteSignature({ ...note, anchors: ['ignored'] }));
  assert.ok(chunkNote({ id: 'long', title: '', content: 'A'.repeat(3000) }).length > 1);
});

test('note RRF is deterministic and marks both channels', () => {
  const result = fuseNotes([{ id: 'b' }, { id: 'a' }], [{ id: 'a' }, { id: 'b' }], 'fts', 10);
  assert.deepEqual(result.map((row: any) => row.id), ['b', 'a']);
  assert.deepEqual(result[0].channels, ['vector', 'fts']);
});

test('note vector storage shares RAG DB and scopes eligible notes, model and signature', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pq-note-vectors-'));
  const store = createRagStore({ ragDatabasePath: path.join(dir, 'rag.sqlite') });
  try {
    for (const id of ['a', 'b']) store.indexDocument({
      documentKey: `note:${id}`, sourceType: 'note', title: id, sourceSignature: id,
      embeddingModelKey: 'model', totalChunkCount: 1,
      chunks: [{ chunkId: id, chunkIndex: 0, text: id, embedding: [1, 0, 0] }],
    });
    const request = { queryEmbedding: [1, 0, 0], modelKey: 'model', documents: [{ id: 'b', signature: 'b' }] };
    assert.deepEqual(store.retrieveNoteVectors(request).map((row: any) => row.id), ['b']);
    assert.deepEqual(store.retrieveNoteVectors({ ...request, modelKey: 'other' }), []);
    assert.deepEqual(store.retrieveNoteVectors({ ...request, documents: [{ id: 'b', signature: 'stale' }] }), []);
    assert.deepEqual(store.retrieveDocumentChunks({ queryEmbedding: [1, 0, 0], queryText: 'a', topK: 10 }), []);
    assert.deepEqual(store.listDocumentSimilarities({ minSimilarity: 0 }), []);
    store.removeNoteIndex({ id: 'b' });
    assert.deepEqual(store.retrieveNoteVectors(request), []);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unconfigured MCP and IPC preserve FTS AND and short-token LIKE without embedding calls', async () => {
  const f = fixture();
  try {
    const both = f.add('alpha intervening beta');
    f.add('alpha only');
    const short = f.add('中文短词');
    const service = new PaperQuayKnowledgeService({
      dataDir: f.dir, embedFn: () => { throw new Error('must not call embedding'); },
    });
    const result = await service.searchNotes({ query: 'alpha beta' });
    assert.equal(result.retrievalMode, 'keyword');
    assert.match(result.warning, /Embedding/);
    assert.deepEqual(result.notes.map((n: any) => n.id), [both.id]);
    assert.deepEqual(result.notes[0].channels, ['fts']);
    assert.deepEqual((await service.searchNotes({ query: '短词' })).notes.map((n: any) => n.id), [short.id]);
    const ipc = createNoteCommands({ noteStore: f.notes, appPaths: f.appPaths, ragStore: f.rag });
    const internal = await ipc.notes_search({ request: { query: 'alpha beta' } });
    assert.equal(internal.retrievalMode, 'keyword');
    assert.match(internal.warning, /Embedding/);
    assert.deepEqual(internal.notes.map((n: any) => n.id), [both.id]);
  } finally { f.close(); }
});

test('MCP mock embedding fuses vector and FTS, honors scope, stable order and deletion', async () => {
  const f = fixture();
  try {
    const embedding = configure(f);
    const exact = f.add('alpha beta', { pageKind: 'concept', tags: ['topic'] });
    const semantic = f.add('different vocabulary', { pageKind: 'concept', tags: ['topic'] });
    const excluded = f.add('alpha beta', { paperId: 'other', pageKind: 'qa' });
    for (const note of [exact, semantic, excluded]) {
      await indexNote(f.rag, { note, embedding }, async () => [[1, 0, 0]]);
    }
    let calls = 0;
    const service = new PaperQuayKnowledgeService({
      dataDir: f.dir, embedFn: async () => { calls++; return [1, 0, 0]; },
    });
    const request = { query: 'alpha beta', paperId: 'p1', pageKind: 'concept', tag: 'topic' };
    const result = await service.searchNotes(request);
    assert.equal(result.retrievalMode, 'hybrid');
    assert.equal(result.embeddingModel, 'test-note');
    assert.equal(result.notes[0].id, exact.id);
    assert.deepEqual(result.notes[0].channels, ['vector', 'fts']);
    assert.deepEqual(result.notes.find((n: any) => n.id === semantic.id).channels, ['vector']);
    assert.ok(!result.notes.some((n: any) => n.id === excluded.id));
    assert.deepEqual((await service.searchNotes(request)).notes.map((n: any) => n.id), result.notes.map((n: any) => n.id));
    f.notes.deleteNote({ id: semantic.id }); // leave its old vectors physically present
    assert.ok(!(await service.searchNotes(request)).notes.some((n: any) => n.id === semantic.id));
    const before = calls;
    const keyword = await service.searchNotes({ ...request, mode: 'keyword' });
    assert.equal(keyword.retrievalMode, 'keyword');
    assert.equal(calls, before);
  } finally { f.close(); }
});

test('MCP embedding failure, dimension and model mismatch retain keyword results with warnings', async () => {
  const f = fixture();
  try {
    const embedding = configure(f);
    const note = f.add('alpha beta');
    await indexNote(f.rag, { note, embedding }, async () => [[1, 0, 0]]);
    for (const embedFn of [
      async () => { throw new Error('mock unavailable'); },
      async () => [1, 0],
      async () => [NaN, 0, 0],
    ]) {
      const result = await new PaperQuayKnowledgeService({ dataDir: f.dir, embedFn }).searchNotes({ query: 'alpha' });
      assert.equal(result.retrievalMode, 'keyword');
      assert.ok(result.warning);
      assert.deepEqual(result.notes.map((n: any) => n.id), [note.id]);
    }
    writeFileSync(f.appPaths.configPath, JSON.stringify({
      settings: { embeddingBaseUrl: embedding.baseUrl, embeddingModel: 'changed' },
      secrets: { embeddingApiKey: 'mock' },
    }));
    const mismatch = await new PaperQuayKnowledgeService({
      dataDir: f.dir, embedFn: async () => [1, 0, 0],
    }).searchNotes({ query: 'alpha' });
    assert.equal(mismatch.retrievalMode, 'keyword');
    assert.ok(mismatch.warning);
  } finally { f.close(); }
});

test('concurrent deletion during MCP embedding invalidates keyword and vector candidates', async () => {
  const f = fixture();
  try {
    const embedding = configure(f);
    const note = f.add('alpha beta');
    await indexNote(f.rag, { note, embedding }, async () => [[1, 0, 0]]);
    const service = new PaperQuayKnowledgeService({
      dataDir: f.dir, embedFn: async () => {
        f.notes.deleteNote({ id: note.id });
        return [1, 0, 0];
      },
    });
    assert.deepEqual((await service.searchNotes({ query: 'alpha' })).notes, []);
  } finally { f.close(); }
});

test('async vector retrieval cannot resurrect modified or newly out-of-scope notes', async () => {
  const embedding = { baseUrl: 'mock', model: 'test', dimensions: 3 };
  const original = { id: 'n', title: 'A', content: 'alpha' };
  for (const current of [[], [{ ...original, content: 'new prose' }]]) {
    let eligibleRows = [original];
    const result = await hybridNotes({
      query: 'alpha', limit: 10, keyword: { rows: [original], channel: 'fts' },
      embedding, eligible: () => eligibleRows, embed: async () => [1, 0, 0],
      retrieve: async () => { eligibleRows = current; return [{ id: 'n', score: 0 }]; },
    });
    assert.deepEqual(result.notes, []);
  }
});

test('incremental queue does not delay saves, coalesces edits, skips unchanged text and removes deleted vectors', async () => {
  const f = fixture();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const embedding = configure(f);
  const indexer = createNoteIndexer({
    noteStore: f.notes, appPaths: f.appPaths,
    ragStore: {
      indexNote: (args: any) => indexNote(f.rag, args, async () => { calls++; await gate; return [[1, 0, 0]]; }),
      removeNoteIndex: (args: any) => f.rag.removeNoteIndex(args),
    },
  });
  f.notes.setMutationListener(indexer.enqueue);
  try {
    const note = f.add('old');
    f.notes.updateNote({ id: note.id, patch: { content: 'new semantic prose', contentText: 'new semantic prose' } });
    assert.equal(calls, 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(indexer.status().running, true);
    release();
    await indexer.whenIdle();
    const saved = f.notes.getNote({ id: note.id });
    assert.equal(f.rag.getDocumentIndexStatus({ documentKey: `note:${note.id}`, sourceType: 'note' }).sourceSignature, noteSignature(saved));
    f.notes.updateNote({ id: note.id, patch: { tags: ['changed-metadata'] } });
    await indexer.whenIdle();
    assert.equal(calls, 1);
    assert.equal(f.rag.retrieveNoteVectors({
      queryEmbedding: [1, 0, 0], modelKey: noteModelKey(embedding),
      documents: [{ id: note.id, signature: noteSignature(saved) }],
    }).length, 1);
    writeFileSync(f.appPaths.configPath, '{}');
    f.notes.deleteNote({ id: note.id });
    await indexer.whenIdle();
    assert.equal(f.rag.getDocumentIndexStatus({ documentKey: `note:${note.id}`, sourceType: 'note' }), null);
  } finally { release(); await indexer.whenIdle(); indexer.close(); f.close(); }
});

test('manual rebuild covers all eligible notes beyond listNotes limit and reports errors', async () => {
  const all = Array.from({ length: 5001 }, (_, i) => ({ id: String(i) }));
  const indexer = createNoteIndexer({
    noteStore: { eligibleSearchNotes: () => all, getNote: ({ id }: any) => ({ id }) },
    ragStore: { indexNote: async ({ note, force }: any) => {
      assert.equal(force, true);
      if (note.id === '0') throw new Error('mock rebuild failure');
    } },
    resolveEmbedding: () => ({ model: 'mock' }),
  });
  assert.equal(indexer.rebuild().queued, 5001);
  await indexer.whenIdle();
  assert.equal(indexer.status().completed, 5000);
  assert.equal(indexer.status().failed, 1);
  assert.match(indexer.status().lastError, /mock rebuild failure/);
  indexer.close();
  const disabled = createNoteIndexer({ resolveEmbedding: () => null });
  assert.equal(disabled.rebuild().queued, 0);
  assert.match(disabled.rebuild().warning, /Embedding/);
  disabled.close();
});

test('real Worker indexes saved and vault-imported notes, IPC semantic search uses shared configuration', async () => {
  const f = fixture();
  const requests: string[][] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push(body.input);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: body.input.map((_: string, index: number) => ({ index, embedding: [1, 0, 0] })) }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  configure(f, `http://127.0.0.1:${address.port}/v1`);
  const worker = createRagWorkerStore(f.appPaths);
  const indexer = createNoteIndexer({ noteStore: f.notes, ragStore: worker, appPaths: f.appPaths });
  f.notes.setMutationListener(indexer.enqueue);
  try {
    const saved = f.add('initial prose');
    await indexer.whenIdle();
    f.notes.updateNote({ id: saved.id, patch: { content: 'updated thematic insight', contentText: 'updated thematic insight' } });
    await indexer.whenIdle();
    const vaultDir = path.join(f.dir, 'vault');
    mkdirSync(vaultDir);
    writeFileSync(path.join(vaultDir, 'Imported.md'), 'vault semantic discovery');
    const vault = createNoteVault({
      noteStore: f.notes,
      store: { load: () => ({ settings: { notesVaultDir: vaultDir }, papers: [] }), save: async () => {} },
    });
    assert.equal(vault.syncNow().created, 1);
    await indexer.whenIdle();
    assert.equal(indexer.status().failed, 0);
    assert.ok(requests.some((texts) => texts.some((text) => text.includes('updated thematic insight'))));
    assert.ok(requests.some((texts) => texts.some((text) => text.includes('vault semantic discovery'))));
    const importedPath = path.join(vaultDir, 'Imported.md');
    writeFileSync(importedPath, readFileSync(importedPath, 'utf8').replace('vault semantic discovery', 'vault updated insight'));
    assert.equal(vault.syncNow().updated, 1);
    await indexer.whenIdle();
    assert.ok(requests.some((texts) => texts.some((text) => text.includes('vault updated insight'))));
    const ipc = createNoteCommands({ noteStore: f.notes, ragStore: worker, appPaths: f.appPaths, noteIndexer: indexer });
    const result = await ipc.notes_search({ request: { query: 'unrelated words' } });
    assert.equal(result.retrievalMode, 'hybrid');
    assert.equal(result.notes.length, 2);
    assert.ok(result.notes.every((n: any) => n.channels.includes('vector')));
  } finally {
    await indexer.whenIdle(); indexer.close();
    await worker.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.close();
  }
});

test('long note sections preserve heading context and paragraph separators', () => {
  const chunks = chunkNote({
    id: 'sections', title: 'Theme',
    content: `# First\n\n${'First words. '.repeat(100)}\n\n# Second\n\n${'Second words. '.repeat(100)}`,
  });
  assert.ok(chunks.length > 2);
  const second = chunks.filter((c: any) => c.text.includes('Second words'));
  assert.ok(second.length);
  assert.ok(second.every((c: any) => c.text.includes('# Second')));
  assert.ok(!second.some((c: any) => c.text.includes('First words')));
});
