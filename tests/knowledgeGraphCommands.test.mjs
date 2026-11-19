import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createKnowledgeGraphSnapshot,
  createKnowledgeGraphCommands,
} from '../electron/backend/knowledgeGraphCommands.cjs';

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

test('retired AI relations are backed up, removed once, and manual relations survive', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-'));

  try {
    const relationPath = path.join(dir, 'paperquay-knowledge-graph-relations.json');
    await writeFile(
      relationPath,
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
    assert.equal(snapshot.edges.some((edge) => edge.id === 'rel-1'), true);
    assert.equal(snapshot.edges.some((edge) => edge.id === 'rel-2'), false);

    const persisted = JSON.parse(await readFile(relationPath, 'utf8'));
    assert.deepEqual(persisted.relations.map((relation) => relation.id), ['rel-1']);
    const backups = (await readdir(dir)).filter((name) => name.includes('ai-suggested-backup-'));
    assert.equal(backups.length, 1);
    const backup = JSON.parse(await readFile(path.join(dir, backups[0]), 'utf8'));
    assert.equal(backup.relations.some((relation) => relation.id === 'rel-2'), true);

    // Second load: no new backup and manual relation untouched.
    await createKnowledgeGraphSnapshot(createContext({ dataDir: dir }));
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.includes('ai-suggested-backup-')).length,
      1,
    );

    const hidden = await createKnowledgeGraphSnapshot(createContext({ dataDir: dir }), { includeCustomRelations: false });
    assert.equal(hidden.edges.some((edge) => edge.id === 'rel-1'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('manual relations can be updated without changing endpoints and reject invalid fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-'));
  try {
    const commands = createKnowledgeGraphCommands(createContext({ dataDir: dir }));
    const relation = commands.knowledge_graph_create_relation({ request: {
      source: 'paper:paper-1', target: 'note:note-1', label: 'explains',
    } });
    assert.throws(
      () => commands.knowledge_graph_create_relation({ request: {
        source: 'paper:paper-1', target: 'note:note-1', label: 'duplicate',
      } }),
      /already exists/,
    );

    const updated = commands.knowledge_graph_update_relation({
      relationId: relation.id,
      request: { label: 'explains better', description: 'New description', weight: 0.7 },
    });
    assert.equal(updated.source, relation.source);
    assert.equal(updated.target, relation.target);
    assert.equal(updated.label, 'explains better');
    assert.equal(updated.weight, 0.7);
    assert.ok(updated.updatedAt > relation.updatedAt);

    assert.throws(
      () => commands.knowledge_graph_update_relation({ relationId: relation.id, request: { label: 'x'.repeat(81) } }),
      /at most 80/,
    );
    assert.throws(
      () => commands.knowledge_graph_update_relation({ relationId: relation.id, request: { description: 'x'.repeat(2001) } }),
      /at most 2000/,
    );
    assert.throws(
      () => commands.knowledge_graph_update_relation({ relationId: 'missing', request: { label: 'x' } }),
      /does not exist/,
    );

    const reloaded = commands.knowledge_graph_list_relations().find((item) => item.id === relation.id);
    assert.equal(reloaded.label, 'explains better');
    assert.equal(reloaded.description, 'New description');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('knowledge graph permits manual relations but cannot generate or create AI relations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-'));
  try {
    const commands = createKnowledgeGraphCommands(createContext({ dataDir: dir }));
    assert.equal(commands.knowledge_graph_suggest_relations, undefined);
    assert.throws(() => commands.knowledge_graph_create_relation({ request: {
      source: 'paper:paper-1', target: 'note:note-1', type: 'ai_suggested',
    } }), /Invalid graph relation type/);
    const relation = commands.knowledge_graph_create_relation({ request: {
      source: 'paper:paper-1', target: 'note:note-1', label: 'explains',
    } });
    assert.equal(relation.type, 'custom_relation');
    assert.deepEqual(commands.knowledge_graph_delete_relation({ relationId: relation.id }), { deleted: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
