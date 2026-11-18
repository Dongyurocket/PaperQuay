import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createRagStore } = require('../electron/backend/ragStore.cjs');
const { indexNote } = require('../electron/backend/noteEmbedding.cjs');
const { hybridNotes } = require('../electron/backend/noteHybridSearch.cjs');
const { chunkNote } = require('../electron/backend/noteSearch.cjs');

const documents = [
  ['graph', 'concept', 'graph neural networks GNN 图神经网络 message passing'],
  ['rag', 'qa', 'retrieval augmented generation RAG 检索增强生成 page 12'],
  ['vision', 'paper-card', 'vision transformer ViT 视觉变换器 image patches'],
  ['climate', 'synthesis', 'climate change 气候变化 temperature extremes'],
  ['battery', 'excerpt', 'lithium battery 锂电池 energy storage page 7'],
  ['privacy', 'concept', 'differential privacy DP 差分隐私 data protection'],
  ['quantum', 'paper-card', 'quantum computing 量子计算 qubit error correction'],
  ['protein', 'synthesis', 'protein folding 蛋白质折叠 structure prediction'],
];

const queries = [
  ['graph neural networks', 'graph'], ['GNN', 'graph'], ['图网络', 'graph'],
  ['retrieval augmented generation', 'rag'], ['RAG', 'rag'], ['检索增强生成', 'rag'],
  ['vision transformer', 'vision'], ['ViT', 'vision'], ['visual transformer', 'vision'],
  ['climate change', 'climate'], ['temperature extremes', 'climate'], ['global warming', 'climate'],
  ['lithium battery', 'battery'], ['energy storage', 'battery'], ['锂电池', 'battery'],
  ['differential privacy', 'privacy'], ['DP', 'privacy'], ['差分隐私', 'privacy'],
  ['quantum computing', 'quantum'], ['qubit', 'quantum'], ['量子计算', 'quantum'],
  ['protein folding', 'protein'], ['structure prediction', 'protein'], ['polypeptide folding', 'protein'],
  ['page 12', 'rag', { pageKind: 'qa' }], ['page 7', 'battery', { paperId: 'paper-battery' }],
  ['不存在的词', null, { noteIds: [] }], ['GNN', null, { noteIds: ['rag'] }],
];

const aliases = [
  /graph|gnn|图神经|图网络/i, /retrieval|rag|检索增强|page 12/i,
  /vision|visual|vit|视觉/i, /climate|temperature|气候|global warming/i,
  /lithium|energy storage|锂电池|page 7/i, /privacy|\bdp\b|隐私/i,
  /quantum|qubit|量子/i, /protein|polypeptide|structure prediction|蛋白质/i,
];

function mockEmbedding(text) {
  const vector = aliases.map((pattern) => pattern.test(text) ? 1 : 0);
  return vector.some(Boolean) ? vector : vector.map(() => 0.001);
}

function metrics(rows, expected) {
  if (!expected) return null;
  return rows.slice(0, 5).some((row) => row.id === expected) ? 1 : 0;
}

test('labelled synthetic note retrieval benchmark reports reproducible metrics and fallback', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-benchmark-'));
  const paths = { notesDatabasePath: path.join(directory, 'notes.sqlite'), ragDatabasePath: path.join(directory, 'rag.sqlite') };
  const notes = createNoteStore(paths);
  const rag = createRagStore(paths);
  const embedding = { baseUrl: 'mock://local', model: 'handwritten-topics', dimensions: 8 };
  try {
    for (const [id, pageKind, content] of documents) {
      const note = notes.createNote({ id, paperId: `paper-${id}`, type: 'standalone', pageKind, title: id, content });
      await indexNote(rag, { note, embedding }, async (texts) => texts.map(mockEmbedding));
    }
    const totals = { keyword: 0, hybrid: 0, positives: 0, keywordZero: 0, hybridZero: 0, negativeHybridNonempty: 0 };
    const firstRun = [];
    for (const [query, relevant, scope = {}] of queries) {
      const request = { ...scope, query, limit: 10 };
      const keyword = notes.searchNotes(request);
      const hybrid = await hybridNotes({ query, limit: 5, keyword, embedding,
        eligible: () => notes.eligibleSearchNotes(scope),
        embed: async (text) => mockEmbedding(text), retrieve: (args) => rag.retrieveNoteVectors(args) });
      const keywordRows = keyword.rows.slice(0, 5);
      firstRun.push([keywordRows.map((row) => row.id), hybrid.notes.map((row) => row.id)]);
      totals.keywordZero += Number(keywordRows.length === 0);
      totals.hybridZero += Number(hybrid.notes.length === 0);
      if (relevant) {
        totals.positives += 1;
        totals.keyword += metrics(keywordRows, relevant);
        totals.hybrid += metrics(hybrid.notes, relevant);
      } else {
        totals.negativeHybridNonempty += Number(hybrid.notes.length > 0);
        assert.equal(hybrid.notes.some((row) => row.id === 'graph' && scope.noteIds), false);
      }
    }
    const request = { query: 'GNN', limit: 10 };
    const keyword = notes.searchNotes(request);
    const common = { query: request.query, limit: 5, keyword, embedding, eligible: () => notes.eligibleSearchNotes({}), embed: async (text) => mockEmbedding(text) };
    const missing = await hybridNotes({ ...common, retrieve: () => [] });
    const failed = await hybridNotes({ ...common, embed: async () => { throw new Error('offline'); }, retrieve: () => [] });
    assert.equal(missing.retrievalMode, 'keyword');
    assert.match(missing.warning, /降级/);
    assert.equal(failed.retrievalMode, 'keyword');
    assert.match(failed.warning, /offline/);
    assert.equal(totals.positives, 26);
    assert.equal(firstRun.length, 28);
    assert.ok(totals.keyword >= 22);
    assert.ok(totals.hybrid >= 26);
    for (let index = 0; index < queries.length; index += 1) {
      const [query, , scope = {}] = queries[index];
      const keyword = notes.searchNotes({ ...scope, query, limit: 10 });
      const hybrid = await hybridNotes({ query, limit: 5, keyword, embedding,
        eligible: () => notes.eligibleSearchNotes(scope),
        embed: async (text) => mockEmbedding(text), retrieve: (args) => rag.retrieveNoteVectors(args) });
      assert.deepEqual([keyword.rows.slice(0, 5).map((row) => row.id), hybrid.notes.map((row) => row.id)], firstRun[index]);
    }
    context.diagnostic(JSON.stringify({ queries: queries.length, ...totals,
      keywordHitAt5: totals.keyword / totals.positives, keywordRecallAt5: totals.keyword / totals.positives,
      hybridHitAt5: totals.hybrid / totals.positives, hybridRecallAt5: totals.hybrid / totals.positives,
      embedding: 'handwritten topic vectors, not a real embedding model' }));
  } finally {
    notes.close(); rag.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('labelled note retrieval benchmark with a local multilingual embedding model', {
  skip: !process.env.PAPERQUAY_BENCHMARK_MODEL_DIR,
}, async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-real-benchmark-'));
  const paths = { notesDatabasePath: path.join(directory, 'notes.sqlite'), ragDatabasePath: path.join(directory, 'rag.sqlite') };
  const notes = createNoteStore(paths);
  const rag = createRagStore(paths);
  const embedding = { baseUrl: 'local://benchmark', model: 'paraphrase-multilingual-MiniLM-L12-v2-quantized', dimensions: 384 };
  try {
    const created = documents.map(([id, pageKind, content]) => notes.createNote({
      id, paperId: `paper-${id}`, type: 'standalone', pageKind, title: id, content,
    }));
    const texts = [...created.flatMap((note) => chunkNote(note).map((chunk) => chunk.text)), ...queries.map(([query]) => query)];
    assert.ok(texts.every((text) => typeof text === 'string'), JSON.stringify(texts.filter((text) => typeof text !== 'string')));
    const processResult = spawnSync(process.env.PAPERQUAY_BENCHMARK_PYTHON || 'python',
      [path.join(import.meta.dirname, 'noteBenchmarkEmbedding.py')],
      { input: JSON.stringify(texts), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(processResult.status, 0, processResult.stderr || String(processResult.error));
    const vectors = JSON.parse(processResult.stdout);
    assert.equal(vectors.length, texts.length);
    const byText = new Map(texts.map((text, index) => [text, vectors[index]]));
    for (const note of created) {
      await indexNote(rag, { note, embedding }, async (batch) => batch.map((text) => byText.get(text)));
    }
    const totals = { keyword: 0, hybrid: 0, positives: 0, keywordZero: 0, hybridZero: 0, negativeHybridNonempty: 0 };
    const runs = [];
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const results = [];
      for (const [query, relevant, scope = {}] of queries) {
        const keyword = notes.searchNotes({ ...scope, query, limit: 10 });
        const hybrid = await hybridNotes({ query, limit: 5, keyword, embedding,
          eligible: () => notes.eligibleSearchNotes(scope),
          embed: async (text) => byText.get(text), retrieve: (args) => rag.retrieveNoteVectors(args) });
        const keywordRows = keyword.rows.slice(0, 5);
        results.push([keywordRows.map((row) => row.id), hybrid.notes.map((row) => row.id)]);
        if (iteration !== 0) continue;
        totals.keywordZero += Number(keywordRows.length === 0);
        totals.hybridZero += Number(hybrid.notes.length === 0);
        if (relevant) {
          totals.positives += 1;
          totals.keyword += metrics(keywordRows, relevant);
          totals.hybrid += metrics(hybrid.notes, relevant);
        } else {
          totals.negativeHybridNonempty += Number(hybrid.notes.length > 0);
        }
      }
      runs.push(results);
    }
    assert.deepEqual(runs[1], runs[0]);
    context.diagnostic(JSON.stringify({ ...totals, queries: queries.length,
      keywordHitAt5: totals.keyword / totals.positives, hybridHitAt5: totals.hybrid / totals.positives,
      keywordRecallAt5: totals.keyword / totals.positives, hybridRecallAt5: totals.hybrid / totals.positives,
      model: embedding.model }));
  } finally {
    notes.close(); rag.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
