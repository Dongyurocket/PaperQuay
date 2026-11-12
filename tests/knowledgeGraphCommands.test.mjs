import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createKnowledgeGraphSnapshot,
  shouldFallbackToChatCompletions,
} from '../electron/backend/knowledgeGraphCommands.cjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createKnowledgeStore } = require('../electron/backend/knowledgeStore.cjs');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');

function createContext(overrides = {}) {
  return {
    appPaths: {
      dataDir: overrides.dataDir ?? '',
    },
    store: {
      load() {
        return {
          papers: [
            {
              id: 'paper-1',
              title: 'Retrieval-Augmented Paper Reading',
              authors: [{ name: 'Smith J' }, { name: 'Chen L' }],
              year: '2025',
              publication: 'PaperQuay Journal',
              readingProgress: 0.5,
              tags: [{ name: 'RAG' }],
              categoryIds: ['cat-1'],
              references: [
                {
                  title: 'Semantic Literature Graphs',
                  doi: '10.1234/graph.1',
                },
                '[2] External Graph Mining Reference. doi:10.9999/external.1',
              ],
            },
            {
              id: 'paper-2',
              title: 'Semantic Literature Graphs',
              doi: '10.1234/graph.1',
              authors: [{ name: 'Wang K' }],
              year: '2024',
              publication: 'Knowledge Systems',
              readingProgress: 0,
              tags: [{ name: 'Graph' }],
              categoryIds: ['cat-1'],
            },
          ],
          categories: [
            {
              id: 'cat-1',
              name: 'Reading Systems',
              paperCount: 2,
              isSystem: false,
            },
          ],
        };
      },
      loadAllReferences() {
        return overrides.paperReferences ?? [];
      },
    },
    noteStore: {
      listNotes() {
        return [
          {
            id: 'note-1',
            title: 'RAG reading note',
            contentText: 'Connects paper parsing, RAG retrieval, and inline notes.',
            tags: ['RAG'],
            linkedPaperId: 'native-library:paper-1',
            linkedPaperIds: ['native-library:paper-2'],
            linkedNoteIds: ['note-2'],
            anchors: [{ paperId: 'native-library:paper-1' }],
            isPinned: true,
          },
          {
            id: 'note-2',
            title: 'Graph note',
            contentText: 'Graph view helps inspect related papers.',
            tags: ['Graph'],
            linkedPaperIds: [],
            linkedNoteIds: [],
            anchors: [],
          },
        ];
      },
    },
    ragStore: {
      available: true,
      listDocumentSimilarities() {
        return [
          {
            sourceDocumentKey: 'native-library:paper-1',
            targetDocumentKey: 'native-library:paper-2',
            similarity: 0.91,
            sourceTypes: ['mineru'],
          },
        ];
      },
    },
  };
}

test('knowledge graph snapshot includes library, note, tag, category, and embedding edges', async () => {
  const snapshot = await createKnowledgeGraphSnapshot(createContext(), {
    embeddingMinSimilarity: 0.8,
    embeddingEdgeLimit: 10,
  });
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const edgeTypes = new Set(snapshot.edges.map((edge) => edge.type));

  assert.ok(nodeIds.has('paper:paper-1'));
  assert.ok(nodeIds.has('paper:paper-2'));
  assert.ok(nodeIds.has('note:note-1'));
  assert.ok(nodeIds.has('tag:rag'));
  assert.ok(nodeIds.has('category:cat-1'));
  assert.ok(edgeTypes.has('note_paper'));
  assert.ok(edgeTypes.has('note_link'));
  assert.ok(edgeTypes.has('paper_tag'));
  assert.ok(edgeTypes.has('note_tag'));
  assert.ok(edgeTypes.has('paper_category'));
  assert.ok(edgeTypes.has('related_by_embedding'));
  assert.ok(edgeTypes.has('paper_cites_paper'));
  assert.ok(!edgeTypes.has('paper_reference'));

  const semanticEdge = snapshot.edges.find((edge) => edge.type === 'related_by_embedding');
  assert.equal(semanticEdge?.source, 'paper:paper-1');
  assert.equal(semanticEdge?.target, 'paper:paper-2');
  assert.equal(semanticEdge?.weight, 0.91);
});

test('knowledge graph builds citation edges from cached paper references', async () => {
  const snapshot = await createKnowledgeGraphSnapshot(createContext({
    paperReferences: [
      {
        id: 'ref:paper-2:1',
        paperId: 'paper-2',
        seq: 1,
        doi: '10.1234/graph.1',
        title: 'Retrieval-Augmented Paper Reading',
        authors: 'Smith J',
        year: '2025',
        journal: 'PaperQuay Journal',
        pages: '1-10',
        unstructured: '',
        fetchedAt: Date.now(),
      },
      {
        id: 'ref:paper-2:2',
        paperId: 'paper-2',
        seq: 2,
        doi: '10.7777/external.2',
        title: 'External Cached Reference',
        unstructured: 'External Cached Reference. doi:10.7777/external.2',
        fetchedAt: Date.now(),
      },
    ],
  }), {
    includeReferences: true,
  });

  const citeEdge = snapshot.edges.find((edge) =>
    edge.type === 'paper_cites_paper' &&
    edge.source === 'paper:paper-2' &&
    edge.target === 'paper:paper-1',
  );
  const externalNode = snapshot.nodes.find((node) =>
    node.type === 'reference' &&
    node.label === 'External Cached Reference',
  );
  const externalReferenceEdge = snapshot.edges.find((edge) => edge.type === 'paper_reference');

  assert.ok(citeEdge);
  assert.equal(externalNode, undefined);
  assert.equal(externalReferenceEdge, undefined);
});

test('knowledge graph includes persisted custom and AI-approved relations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-'));

  try {
    await writeFile(
      path.join(dir, 'paperquay-knowledge-graph-relations.json'),
      JSON.stringify({
        version: 1,
        relations: [
          {
            id: 'rel-1',
            source: 'paper:paper-1',
            target: 'note:note-1',
            type: 'custom_relation',
            label: 'explains',
            description: 'The note explains the paper.',
          },
          {
            id: 'rel-2',
            source: 'note:note-1',
            target: 'paper:paper-2',
            type: 'ai_suggested',
            label: 'contrasts_with',
            confidence: 0.82,
          },
        ],
      }),
      'utf8',
    );

    const snapshot = await createKnowledgeGraphSnapshot(createContext({ dataDir: dir }));
    const customEdge = snapshot.edges.find((edge) => edge.id === 'rel-1');
    const aiEdge = snapshot.edges.find((edge) => edge.id === 'rel-2');

    assert.equal(customEdge?.type, 'custom_relation');
    assert.equal(customEdge?.label, 'explains');
    assert.equal(aiEdge?.type, 'ai_suggested');
    assert.equal(aiEdge?.confidence, 0.82);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('knowledge store migrates legacy relations once and snapshots durable writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-knowledge-store-'));
  const appPaths = { dataDir: dir, knowledgeDatabasePath: path.join(dir, 'paperquay-knowledge.sqlite') };
  let store;
  try {
    const legacyPath = path.join(dir, 'paperquay-knowledge-graph-relations.json');
    await writeFile(legacyPath, JSON.stringify({ version: 1, relations: [{
      id: 'legacy-1', source: 'paper:a', target: 'note:b', type: 'ai_suggested', label: 'supports',
      confidence: 0.81, createdAt: 12, updatedAt: 13,
    }] }), 'utf8');
    store = createKnowledgeStore(appPaths);
    assert.equal(store.listRelations().length, 1);
    store.close(); store = null;

    store = createKnowledgeStore(appPaths);
    assert.equal(store.listRelations().length, 1, 'startup retry must not duplicate imported rows');
    store.saveRelation({ id: 'new-1', source: 'paper:a', target: 'paper:c', type: 'custom_relation',
      label: 'contrasts', description: '', createdAt: 20, updatedAt: 20 });
    const snapshotPath = path.join(dir, 'snapshot.sqlite');
    store.snapshotTo(snapshotPath);
    store.close(); store = null;
    assert.equal(JSON.parse(await readFile(legacyPath, 'utf8')).relations.length, 1);
    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(snapshot.prepare('SELECT COUNT(*) AS n FROM kg_custom_relations').get().n, 2);
    } finally { snapshot.close(); }
    store = createKnowledgeStore(appPaths);
    assert.equal(store.deleteRelation('new-1'), true);
    assert.equal(store.deleteRelation('new-1'), false);
  } finally { store?.close(); await rm(dir, { recursive: true, force: true }); }
});

test('knowledge relation migration leaves malformed source unmarked for safe retry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-knowledge-migration-'));
  const appPaths = { dataDir: dir, knowledgeDatabasePath: path.join(dir, 'paperquay-knowledge.sqlite') };
  try {
    await writeFile(path.join(dir, 'paperquay-knowledge-graph-relations.json'), '{broken', 'utf8');
    assert.throws(() => createKnowledgeStore(appPaths));
    const db = new DatabaseSync(appPaths.knowledgeDatabasePath, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM knowledge_meta WHERE key='legacy_relations_json_v1'").get().n, 0);
    } finally { db.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('document generations publish only complete page coverage and reject stale workers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-generation-store-'));
  const appPaths = { dataDir: dir, knowledgeDatabasePath: path.join(dir, 'paperquay-knowledge.sqlite') };
  const store = createKnowledgeStore(appPaths);
  const partition = (index, startPage, endPage) => ({ index, startPage, endPage, inputHash: `hash-${index}` });
  const registerArtifacts = (generationId) => store.setGenerationArtifacts(generationId, {
    artifactPath: path.join(dir, generationId),
    manifest: [{ path: 'full.md', size: 4, sha256: 'a'.repeat(64) }],
  });
  try {
    const first = store.beginGeneration({ sourceId: 'document-1', sourceVersion: 'v1', partitions: [partition(0, 1, 2)] });
    assert.equal(store.setPartitionStatus(first.generationId, 0, 'running'), true);
    assert.equal(store.setPartitionStatus(first.generationId, 0, 'complete'), true);
    assert.equal(store.publishGeneration(first.generationId, { sourceVersion: 'v1', expectedPageCount: 2 }), false,
      'a generation without a persisted artifact manifest cannot become current');
    assert.equal(registerArtifacts(first.generationId), true);
    assert.equal(store.publishGeneration(first.generationId, { sourceVersion: 'v1', expectedPageCount: 3 }), false,
      'page coverage mismatch must keep the first generation unpublished');
    assert.equal(store.publishGeneration(first.generationId, { sourceVersion: 'v1', expectedPageCount: 2 }), true);

    const stale = store.beginGeneration({ sourceId: 'document-1', sourceVersion: 'v1', partitions: [partition(0, 1, 2)] });
    const current = store.beginGeneration({ sourceId: 'document-1', sourceVersion: 'v2', partitions: [partition(0, 1, 2)] });
    assert.equal(store.setPartitionStatus(stale.generationId, 0, 'running'), false,
      'a late task for the old source version cannot write partition state');
    assert.equal(store.publishGeneration(stale.generationId, { sourceVersion: 'v1', expectedPageCount: 2 }), false);
    store.failGeneration(current.generationId, 'cancelled');
    assert.equal(store.listGenerations('document-1').find((item) => item.generationId === first.generationId).currentGeneration, first.generationId,
      'a failed replacement keeps the prior published generation pointer');

    const replacement = store.beginGeneration({ sourceId: 'document-1', sourceVersion: 'v2', partitions: [partition(0, 1, 1), partition(1, 2, 2)] });
    for (const index of [0, 1]) {
      store.setPartitionStatus(replacement.generationId, index, 'running');
      store.setPartitionStatus(replacement.generationId, index, 'complete');
    }
    assert.equal(registerArtifacts(replacement.generationId), true);
    assert.equal(store.publishGeneration(replacement.generationId, { sourceVersion: 'v2', expectedPageCount: 2 }), true);
    const db = new DatabaseSync(appPaths.knowledgeDatabasePath, { readOnly: true });
    try {
      assert.deepEqual(db.prepare('SELECT physical_page FROM document_pages WHERE generation_id=? ORDER BY physical_page')
        .all(replacement.generationId).map((row) => row.physical_page), [1, 2]);
    } finally { db.close(); }
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('knowledge graph AI generation falls back when responses upstream fails', () => {
  assert.equal(
    shouldFallbackToChatCompletions(
      new Error('OpenAI-compatible responses HTTP 502: {"error":{"message":"Upstream request failed","type":"upstream_error"}}'),
    ),
    true,
  );
  assert.equal(shouldFallbackToChatCompletions(new Error('Model returned invalid JSON')), false);
});

test('knowledge graph local mode keeps only nodes within the requested depth', async () => {
  const snapshot = await createKnowledgeGraphSnapshot(createContext(), {
    localNodeId: 'paper:paper-1',
    localDepth: 1,
  });
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));

  assert.ok(nodeIds.has('paper:paper-1'));
  assert.ok(nodeIds.has('note:note-1'));
  assert.ok(nodeIds.has('tag:rag'));
  assert.ok(nodeIds.has('category:cat-1'));
  assert.equal(nodeIds.has('note:note-2'), false);
});

test('knowledge graph local scope fails closed for missing focus, unknown focus, and invalid depth', async () => {
  const globalSnapshot = await createKnowledgeGraphSnapshot(createContext(), { localDepth: 0 });
  assert.ok(globalSnapshot.nodes.length > 0);

  for (const request of [
    { localDepth: 2 },
    { localNodeId: 'paper:missing', localDepth: 2 },
    { localNodeId: 'paper:paper-1', localDepth: 'invalid' },
    { localNodeId: 'paper:paper-1', localDepth: 5 },
  ]) {
    const result = await createKnowledgeGraphSnapshot(createContext(), request);
    assert.deepEqual(result.nodes, [], JSON.stringify(request));
    assert.deepEqual(result.edges, [], JSON.stringify(request));
  }
});
