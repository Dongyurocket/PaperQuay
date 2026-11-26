import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createKnowledgeGraphSnapshot,
  createKnowledgeGraphCommands,
} from '../electron/backend/knowledgeGraphCommands.cjs';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { writeJsonSync } = require('../electron/backend/utils.cjs');

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
    embeddingStrategy: 'mutual-knn',
    embeddingK: 10,
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

  const paperNode = snapshot.nodes.find((node) => node.id === 'paper:paper-1');
  assert.equal(typeof paperNode?.degree, 'number');
  assert.ok(paperNode.degree >= 1);
  assert.equal(typeof paperNode?.color, 'string');
  assert.ok(snapshot.metadata?.graphQuality);
  assert.equal(snapshot.metadata.graphQuality.semanticCoverage.total, 2);
  assert.equal(snapshot.metadata.graphQuality.geometryVersion, 'abtt-d2-mutual-knn-v1');
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

const RELATION_FILE = 'paperquay-knowledge-graph-relations.json';

test('corrupted relation store is backed up and reported instead of treated as empty', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-corrupt-'));
  try {
    const relationPath = path.join(dir, RELATION_FILE);
    const raw = '{"version":1,"relations":[{"id":"broken"';
    await writeFile(relationPath, raw, 'utf8');
    const commands = createKnowledgeGraphCommands(createContext({ dataDir: dir }));

    await assert.rejects(
      async () => commands.knowledge_graph_list_relations(),
      (error) => {
        assert.equal(error.code, 'GRAPH_RELATION_STORE_CORRUPT');
        assert.match(error.message, /corrupt/i);
        assert.match(error.message, /corrupt\.json/);
        return true;
      },
    );
    assert.equal(await readFile(relationPath, 'utf8'), raw, 'the damaged file must not be rewritten');
    const backupPath = path.join(dir, `${RELATION_FILE}.corrupt.json`);
    assert.equal(await readFile(backupPath, 'utf8'), raw);

    // Writes must refuse to start from the damaged file, and repeated reads must
    // reuse the existing evidence backup instead of stacking new ones.
    assert.throws(
      () => commands.knowledge_graph_create_relation({ request: {
        source: 'paper:paper-1', target: 'note:note-1', label: 'explains',
      } }),
      /corrupt/i,
    );
    assert.equal(await readFile(relationPath, 'utf8'), raw);
    assert.equal(await readFile(backupPath, 'utf8'), raw);
    const backups = (await readdir(dir)).filter((name) => name.includes('.corrupt'));
    assert.deepEqual(backups, [`${RELATION_FILE}.corrupt.json`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('failed atomic writes keep the previous relation store and leave no temp files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-atomic-'));
  try {
    const relationPath = path.join(dir, RELATION_FILE);
    const previous = JSON.stringify({ version: 1, relations: [{ id: 'keep-me' }] });
    await writeFile(relationPath, previous, 'utf8');
    const originalRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('mock rename failure'); };
    try {
      assert.throws(
        () => writeJsonSync(relationPath, { version: 1, relations: [{ id: 'must-not-land' }] }),
        /mock rename failure/,
      );
    } finally {
      fs.renameSync = originalRename;
    }
    assert.equal(await readFile(relationPath, 'utf8'), previous);
    assert.deepEqual((await readdir(dir)).filter((name) => name.includes('.tmp')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrent relation writes stay atomic and readable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-concurrent-'));
  const utilsPath = require.resolve('../electron/backend/utils.cjs');
  try {
    const relationPath = path.join(dir, RELATION_FILE);
    const childScript = [
      "const { writeJsonSync } = require(process.argv[1]);",
      "const filePath = process.argv[2];",
      "const tag = process.argv[3];",
      "const blob = tag.repeat(48000);",
      "for (let index = 0; index < 150; index += 1) {",
      "  writeJsonSync(filePath, { version: 1, relations: [{ id: tag + '-' + index, blob }] });",
      "}",
    ].join('\n');
    const runWriter = (tag) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', childScript, utilsPath, relationPath, tag], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`writer ${tag} exited with ${code}: ${stderr}`));
      });
    });

    let running = true;
    const writers = Promise.all([runWriter('a'), runWriter('b')]).finally(() => { running = false; });
    const parseErrors = [];
    let reads = 0;
    while (running) {
      try {
        JSON.parse(await readFile(relationPath, 'utf8'));
        reads += 1;
      } catch (error) {
        if (error.code !== 'ENOENT') parseErrors.push(error.message);
      }
      // 固定 4ms 延时改为让出一个 I/O 回合：读循环不需要与写入端约定节奏，
      // 只要在两个写进程存活期间持续观察即可。
      await new Promise((resolve) => setImmediate(resolve));
    }
    await writers;

    assert.equal(parseErrors.length, 0, `observed partial writes: ${parseErrors.slice(0, 3).join(' | ')}`);
    assert.ok(reads > 0, 'the reader must observe the file while writers are active');
    const persisted = JSON.parse(await readFile(relationPath, 'utf8'));
    assert.equal(persisted.relations.length, 1);
    assert.match(persisted.relations[0].id, /^[ab]-\d+$/);
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot cache returns the same revision until explicitly invalidated', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-cache-'));
  try {
    const context = createContext();
    context.appPaths.dataDir = dir;
    const commands = createKnowledgeGraphCommands(context);

    const first = await commands.knowledge_graph_get({ request: { includeTags: false } });
    const second = await commands.knowledge_graph_get({ request: { includeTags: false } });
    assert.equal(second, first, 'identical request and revision must hit the cache');

    const stats = commands.knowledge_graph_cache_stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);

    commands.knowledge_graph_invalidate_cache();
    const third = await commands.knowledge_graph_get({ request: { includeTags: false } });
    assert.notEqual(third, first, 'invalidation must force a rebuild');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('paper nodes carry tags, category names, reading progress and RAG status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paperquay-graph-fields-'));
  try {
    const context = createContext();
    context.appPaths.dataDir = dir;
    context.ragStore.listIndexStatuses = () => [{
      documentKey: 'paper-1',
      sourceType: 'mineru-markdown',
      status: 'ready',
      embeddingModelKey: 'embedding-a',
      extractorVersion: 'mineru-chunks-v3',
    }];
    const snapshot = await createKnowledgeGraphSnapshot(context, {});
    const paper = snapshot.nodes.find((node) => node.id === 'paper:paper-1');
    assert.ok(paper);
    assert.deepEqual(paper.tags, ['RAG']);
    assert.deepEqual(paper.categoryNames, ['Reading Systems']);
    assert.equal(paper.primaryCategoryId, 'cat-1');
    assert.equal(paper.readingProgress, 0.5);
    assert.equal(paper.ragStatus, 'ready');
    assert.ok(Number.isFinite(paper.degree));
    assert.ok(snapshot.metadata.graphQuality.annotationEdgesExcluded);
    assert.ok(snapshot.metadata.graphQuality.contentNodeCount <= snapshot.nodes.length);
    const semantic = snapshot.edges.find((edge) => edge.type === 'related_by_embedding');
    assert.ok(semantic);
    assert.ok(Number.isFinite(semantic.similarity));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
