import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
const { createPaddleOcrCommands, recoverCompatibilityCachePublications } = require('../electron/backend/paddleOcrCommands.cjs');
const { createKnowledgeStore } = require('../electron/backend/knowledgeStore.cjs');

async function setup(t: any, { persistent = false } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-paddle-lifecycle-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  const pdfPath = path.join(directory, 'fixture.pdf');
  await fsp.writeFile(pdfPath, await pdf.save());
  const appPaths = { mineruCacheDir: directory };
  const knowledgeStore = persistent ? createKnowledgeStore({
    dataDir: directory,
    knowledgeDatabasePath: path.join(directory, 'paperquay-knowledge.sqlite'),
  }) : undefined;
  const commands = createPaddleOcrCommands({ appPaths, knowledgeStore });
  const options = {
    pdfPath, extractDir: path.join(directory, 'parse'), documentKey: 'fixture', taskId: 'fixture-task',
    apiToken: 'fixture-secret', timeoutSecs: 20, pollIntervalSecs: 1, requestTimeoutMs: 1000,
  };
  return { commands, options, knowledgeStore };
}

function cloudResponse(url: string) {
  if (url.endsWith('/jobs')) return Response.json({ data: { jobId: 'fixture-job' } });
  if (url.endsWith('/jobs/fixture-job')) return Response.json({ data: {
    state: 'done', resultUrl: { jsonUrl: 'https://example.invalid/result.jsonl?secret=signed' },
    extractProgress: { extractedPages: 1, totalPages: 1 },
  } });
  return null;
}

test('Paddle command publishes success only after the readable result is saved', async (t) => {
  const { commands, options } = await setup(t);
  const events: any[] = [];
  const completedFiles: boolean[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => cloudResponse(String(url)) ?? Response.json({ result: {
    layoutParsingResults: [{
      prunedResult: { width: 600, height: 800, parsing_res_list: [
        { block_label: 'text', block_content: 'A preserved paragraph.', block_bbox: [20, 20, 500, 80] },
      ] },
      markdown: { text: 'A preserved paragraph.', images: {} },
    }],
  } }));
  const result = await commands.run_paddleocr_cloud_parse({ options }, { sender: {
    isDestroyed: () => false,
    send: (_channel: string, _eventName: string, task: any) => {
      events.push(task);
      if (task.status === 'success') completedFiles.push(fs.existsSync(task.contentJsonPath));
    },
  } });
  assert.deepEqual(completedFiles, [true]);
  assert.match(await fsp.readFile(result.contentJsonPath, 'utf8'), /A preserved paragraph/);
  const snapshot = await commands.list_paddleocr_parse_tasks();
  assert.equal(snapshot[0].status, 'success');
  assert.equal(snapshot[0].blockCount, 1);
  assert.ok(events.some((event) => event.stage === 'downloading'));
  assert.ok(events.some((event) => event.stage === 'saving'));
  assert.doesNotMatch(JSON.stringify(snapshot), /fixture-secret|secret=signed|contentJsonText/);
});

test('Paddle parse publishes a durable source generation after page coverage is complete', async (t) => {
  const { commands, options, knowledgeStore: initialKnowledgeStore } = await setup(t, { persistent: true });
  let knowledgeStore = initialKnowledgeStore;
  const staleBackupSentinel = path.join(options.extractDir, 'images.bak-123', 'sentinel.txt');
  await fsp.mkdir(path.dirname(staleBackupSentinel), { recursive: true });
  await fsp.writeFile(staleBackupSentinel, 'keep until its owning attempt is recovered');
  t.mock.method(globalThis, 'fetch', async (url: string) => cloudResponse(String(url)) ?? Response.json({ result: {
    layoutParsingResults: [{
      prunedResult: { width: 600, height: 800, parsing_res_list: [
        { block_label: 'doc_title', block_content: 'Chapter One', block_bbox: [20, 10, 500, 55] },
        { block_label: 'paragraph_title', block_content: '1.1 Test setup', block_bbox: [20, 70, 500, 105] },
        { block_label: 'text', block_content: 'Persistent page body.', block_bbox: [20, 20, 500, 80] },
      ] },
      markdown: { text: 'Persistent page body.', images: {} },
    }],
  } }));
  try {
    await commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } });
    knowledgeStore.close();
    knowledgeStore = createKnowledgeStore({
      dataDir: path.dirname(options.extractDir),
      knowledgeDatabasePath: path.join(path.dirname(options.extractDir), 'paperquay-knowledge.sqlite'),
    });
    const generations = knowledgeStore.listGenerations('fixture');
    assert.equal(generations.length, 1);
    assert.equal(generations[0].status, 'published');
    assert.equal(generations[0].currentGeneration, generations[0].generationId);
    const parseSource = knowledgeStore.listSourceVersions('fixture').find((item: any) => item.sourceType === 'paddle-normalized');
    assert.equal(parseSource?.parseGeneration, generations[0].generationId);
    assert.equal(parseSource?.sourceVersion, generations[0].sourceVersion);
    assert.equal(parseSource?.state, 'current');
    assert.equal(knowledgeStore.listGenerationPartitions(generations[0].generationId)[0].remoteJobId, 'fixture-job');
    const units = knowledgeStore.listDocumentUnits(generations[0].generationId);
    const chapter = units.find((unit: any) => unit.title === 'Chapter One');
    const section = units.find((unit: any) => unit.title === '1.1 Test setup');
    assert.ok(chapter);
    assert.equal(chapter.unitKind, 'chapter');
    assert.equal(section?.unitKind, 'section');
    assert.equal(section?.parentUnitId, chapter.unitId);
    assert.equal(section?.physicalStart, 1);
    assert.equal(section?.physicalEnd, 1);
    const db = new (require('../electron/backend/nodeSqlite.cjs').DatabaseSync)(
      path.join(path.dirname(options.extractDir), 'paperquay-knowledge.sqlite'), { readOnly: true });
    try {
      assert.deepEqual(db.prepare('SELECT physical_page FROM document_pages WHERE generation_id=?').all(generations[0].generationId)
        .map((row: any) => row.physical_page), [1]);
      const pageMap = db.prepare('SELECT physical_page,unit_id,mapping_revision FROM document_pages WHERE generation_id=?').get(generations[0].generationId) as any;
      assert.equal(pageMap.unit_id, section.unitId);
      assert.match(pageMap.mapping_revision, /^[a-f0-9]{64}$/);
      const published = db.prepare('SELECT artifact_path,artifact_manifest FROM document_generations WHERE generation_id=?').get(generations[0].generationId) as any;
      const manifest = JSON.parse(published.artifact_manifest);
      assert.ok(published.artifact_path.includes(`${path.sep}.document-generations${path.sep}`));
      assert.ok(published.artifact_path.endsWith(generations[0].generationId));
      assert.notEqual(published.artifact_path, path.resolve(options.extractDir));
      assert.ok(manifest.some((entry: any) => entry.path === 'full.md' && entry.size > 0 && /^[a-f0-9]{64}$/.test(entry.sha256)));
      assert.match(await fsp.readFile(path.join(options.extractDir, 'content_list_v2.json'), 'utf8'), /Persistent page body/,
        'a verified generation is mirrored to the legacy reader cache only after staging succeeds');
      assert.equal(await fsp.readFile(staleBackupSentinel, 'utf8'), 'keep until its owning attempt is recovered');
    } finally { db.close(); }
  } finally {
    knowledgeStore.close();
  }
});

test('tampered staged parse artifacts cannot replace a previously published generation', async (t) => {
  const { commands, options, knowledgeStore } = await setup(t, { persistent: true });
  const response = () => Response.json({ result: { layoutParsingResults: [{
    prunedResult: { width: 600, height: 800, parsing_res_list: [
      { block_label: 'text', block_content: 'Staged artifact body.', block_bbox: [20, 20, 500, 80] },
    ] },
    markdown: { text: 'Staged artifact body.', images: {} },
  }] } });
  t.mock.method(globalThis, 'fetch', async (url: string) => cloudResponse(String(url)) ?? response());
  try {
    await commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } });
    const originalGeneration = knowledgeStore.listGenerations('fixture').find((item: any) => item.status === 'published')!;
    const originalArtifact = knowledgeStore.listGenerationArtifacts('fixture')
      .find((item: any) => item.generationId === originalGeneration.generationId)!;
    const originalMarkdownPath = path.join(originalArtifact.artifactPath, 'full.md');
    const originalMarkdown = await fsp.readFile(originalMarkdownPath, 'utf8');
    const stableCachePath = path.join(options.extractDir, 'content_list_v2.json');
    options.extractDir = path.join(path.dirname(options.extractDir), 'replacement-parse');
    const register = knowledgeStore.setGenerationArtifacts.bind(knowledgeStore);
    knowledgeStore.setGenerationArtifacts = (generationId: string, artifacts: any) => {
      const saved = register(generationId, artifacts);
      if (saved) fs.writeFileSync(path.join(artifacts.artifactPath, 'full.md'), 'tampered after manifest');
      return saved;
    };
    await assert.rejects(commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } }), /changed during validation/);
    const generations = knowledgeStore.listGenerations('fixture');
    assert.equal(generations.find((item: any) => item.generationId === originalGeneration.generationId)?.currentGeneration,
      originalGeneration.generationId, 'an artifact integrity failure must leave the previous current generation intact');
    assert.equal(await fsp.readFile(originalMarkdownPath, 'utf8'), originalMarkdown,
      'a failed replacement attempt must not overwrite artifacts referenced by the previous generation');

    const stableCacheBefore = await fsp.readFile(stableCachePath, 'utf8');
    options.extractDir = path.dirname(stableCachePath);
    knowledgeStore.setGenerationArtifacts = register;
    const publish = knowledgeStore.publishGeneration.bind(knowledgeStore);
    knowledgeStore.publishGeneration = () => false;
    try {
      await assert.rejects(commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } }), /page coverage/);
    } finally {
      knowledgeStore.publishGeneration = publish;
    }
    assert.equal(await fsp.readFile(stableCachePath, 'utf8'), stableCacheBefore,
      'a failed current-generation switch must restore the previous compatibility cache');
    assert.equal(knowledgeStore.listGenerations('fixture').find((item: any) => item.generationId === originalGeneration.generationId)?.currentGeneration,
      originalGeneration.generationId);
  } finally {
    knowledgeStore.close();
  }
});

test('invalid chapter page mappings cannot publish a new current generation', async (t) => {
  const { commands, options, knowledgeStore } = await setup(t, { persistent: true });
  const response = (body: string) => Response.json({ result: { layoutParsingResults: [{
    prunedResult: { width: 600, height: 800, parsing_res_list: [
      { block_label: 'paragraph_title', block_content: body, block_bbox: [20, 10, 500, 55] },
      { block_label: 'text', block_content: body, block_bbox: [20, 60, 500, 100] },
    ] },
    markdown: { text: body, images: {} },
  }] } });
  let body = 'First verified version';
  t.mock.method(globalThis, 'fetch', async (url: string) => cloudResponse(String(url)) ?? response(body));
  try {
    await commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } });
    const original = knowledgeStore.listGenerations('fixture').find((item: any) => item.status === 'published')!;
    const publish = knowledgeStore.publishGeneration.bind(knowledgeStore);
    knowledgeStore.publishGeneration = (generationId: string, publication: any) => publish(generationId, {
      ...publication,
      pageMappings: [{ ...publication.pageMappings[0], physicalPage: 2 }],
    });
    body = 'Second invalid mapping';

    await assert.rejects(commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } }), /page coverage or source version validation/);
    const generations = knowledgeStore.listGenerations('fixture');
    assert.equal(generations.find((item: any) => item.generationId === original.generationId)?.status, 'published');
    assert.equal(generations.find((item: any) => item.status === 'published')?.generationId, original.generationId);
    assert.equal(knowledgeStore.listDocumentPages(original.generationId).length, 1);
    assert.equal(knowledgeStore.listDocumentPages(original.generationId)[0].physicalPage, 1);
  } finally {
    knowledgeStore.close();
  }
});

test('a stalled result body reaches error after tab closure without using an old cache as success', async (t) => {
  const { commands, options } = await setup(t);
  await fsp.mkdir(options.extractDir, { recursive: true });
  await fsp.writeFile(path.join(options.extractDir, 'content_list_v2.json'), 'old cached result');
  t.mock.method(globalThis, 'fetch', async (url: string) => cloudResponse(String(url)) ?? {
    ok: true, text: () => new Promise(() => {}),
  } as Response);
  await assert.rejects(commands.run_paddleocr_cloud_parse({ options: { ...options, requestTimeoutMs: 20 } }, {
    sender: { isDestroyed: () => true },
  }), /超时/);
  const snapshot = await commands.list_paddleocr_parse_tasks();
  assert.equal(snapshot[0].status, 'error');
  assert.equal(snapshot[0].contentJsonPath, undefined);
  assert.equal(await fsp.readFile(path.join(options.extractDir, 'content_list_v2.json'), 'utf8'), 'old cached result');
});

test('startup recovery rolls back an interrupted cache swap before commit and finishes cleanup after commit', async (t) => {
  const { options, knowledgeStore } = await setup(t, { persistent: true });
  const root = options.extractDir;
  const target = path.join(root, 'full.md');
  await fsp.mkdir(root, { recursive: true });

  const runRecoveryCase = async (commit: boolean) => {
    const generationId = commit ? '22222222-2222-4222-8222-222222222222' : '11111111-1111-4111-8111-111111111111';
    const backup = `${target}.generation-backup-${generationId}`;
    const sourceId = `recovery-${generationId}`;
    const generation = knowledgeStore.beginGeneration({ sourceId, sourceVersion: 'pdf-hash', generationId,
      partitions: [{ index: 0, startPage: 1, endPage: 1, inputHash: 'input-hash' }] });
    knowledgeStore.setPartitionStatus(generationId, 0, 'running');
    knowledgeStore.setPartitionStatus(generationId, 0, 'complete');
    const artifactPath = path.join(root, 'fixture-artifact');
    await fsp.mkdir(artifactPath, { recursive: true });
    await fsp.writeFile(path.join(artifactPath, 'full.md'), 'artifact');
    knowledgeStore.setGenerationArtifacts(generationId, { artifactPath, manifest: [{ path: 'full.md', size: 8,
      sha256: 'f0f3303f7fdfcfd7c7b8c55f8df6d3d70a9b8cd050d80cfc89ed07ac95b7a6f2' }] });
    if (commit) {
      const bytes = await fsp.readFile(path.join(artifactPath, 'full.md'));
      const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
      knowledgeStore.setGenerationArtifacts(generationId, { artifactPath, manifest: [{ path: 'full.md', size: bytes.length, sha256: hash }] });
      assert.equal(knowledgeStore.publishGeneration(generationId, { sourceVersion: 'pdf-hash', expectedPageCount: 1 }), true);
    }
    await fsp.writeFile(target, 'new cache');
    await fsp.writeFile(backup, 'old cache');
    const journalDir = path.join(root, '.paperquay-publication-journals');
    await fsp.mkdir(journalDir, { recursive: true });
    const journalPath = path.join(journalDir, `${generationId}.json`);
    await fsp.writeFile(journalPath, JSON.stringify({ version: 1, cacheRoot: root, sourceId, generationId,
      moved: [{ target: 'full.md', backup: path.basename(backup) }], backups: [path.basename(backup)], written: ['full.md'] }));

    await recoverCompatibilityCachePublications(root, knowledgeStore);
    assert.equal(await fsp.readFile(target, 'utf8'), commit ? 'new cache' : 'old cache');
    assert.equal(fs.existsSync(backup), false, 'recovery removes only the attempt backup after restoring or accepting its generation');
    assert.equal(fs.existsSync(journalPath), false);
  };

  try {
    await runRecoveryCase(false);
    await runRecoveryCase(true);
  } finally {
    knowledgeStore.close();
  }
});

test('a retried parse resumes the persisted remote job after the knowledge store is reopened', async (t) => {
  const setupResult = await setup(t, { persistent: true });
  const { options } = setupResult;
  let knowledgeStore = setupResult.knowledgeStore;
  const sourceVersion = require('node:crypto').createHash('sha256').update(await fsp.readFile(options.pdfPath)).digest('hex');
  const inputHash = require('node:crypto').createHash('sha256')
    .update(`${sourceVersion}:PaddleOCR-VL-1.6:1:1`).digest('hex');
  const generation = knowledgeStore.beginGeneration({ sourceId: options.documentKey, sourceVersion, sourceKind: 'pdf',
    generationId: '33333333-3333-4333-8333-333333333333',
    partitions: [{ index: 0, startPage: 1, endPage: 1, inputHash }] });
  knowledgeStore.setPartitionStatus(generation.generationId, 0, 'running');
  assert.equal(knowledgeStore.setPartitionRemoteJobId(generation.generationId, 0, 'persisted-job-42'), true);
  knowledgeStore.close();
  knowledgeStore = createKnowledgeStore({ dataDir: path.dirname(options.extractDir),
    knowledgeDatabasePath: path.join(path.dirname(options.extractDir), 'paperquay-knowledge.sqlite') });
  const commands = createPaddleOcrCommands({ appPaths: { mineruCacheDir: path.dirname(options.extractDir) }, knowledgeStore });
  let submissions = 0;
  const polled: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const value = String(url);
    if (value.endsWith('/jobs')) { submissions += 1; return Response.json({ data: { jobId: 'unexpected-new-job' } }); }
    if (value.endsWith('/jobs/persisted-job-42')) {
      polled.push(value);
      return Response.json({ data: { state: 'done', resultUrl: { jsonUrl: 'https://example.invalid/resumed.jsonl' },
        extractProgress: { extractedPages: 1, totalPages: 1 } } });
    }
    if (value.endsWith('/resumed.jsonl')) return new Response(`${JSON.stringify({ result: { layoutParsingResults: [{
      prunedResult: { width: 600, height: 800, parsing_res_list: [
        { block_label: 'text', block_content: 'Recovered after restart.', block_bbox: [20, 20, 500, 80] },
      ] }, markdown: { text: 'Recovered after restart.', images: {} },
    }] } })}\n`, { status: 200 });
    return Response.json({ error: `Unexpected URL ${value}` }, { status: 404 });
  });
  try {
    const result = await commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } });
    assert.equal(submissions, 0, 'retry must not submit a billable duplicate job');
    assert.deepEqual(polled, ['https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/persisted-job-42']);
    assert.match(await fsp.readFile(result.contentJsonPath, 'utf8'), /Recovered after restart/);
    const saved = knowledgeStore.listGenerations(options.documentKey).find((item: any) => item.generationId === generation.generationId);
    assert.equal(saved.status, 'published');
    assert.equal(saved.currentGeneration, generation.generationId);
  } finally {
    knowledgeStore.close();
  }
});

test('a verified completed partition is reused after restart when generation publication must be retried', async (t) => {
  const setupResult = await setup(t, { persistent: true });
  const { options } = setupResult;
  let knowledgeStore = setupResult.knowledgeStore;
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    networkCalls += 1;
    return cloudResponse(String(url)) ?? Response.json({ result: { layoutParsingResults: [{
      prunedResult: { width: 600, height: 800, parsing_res_list: [
        { block_label: 'text', block_content: 'Durably staged partition.', block_bbox: [20, 20, 500, 80] },
      ] }, markdown: { text: 'Durably staged partition.', images: {} },
    }] } });
  });
  const originalPublish = knowledgeStore.publishGeneration.bind(knowledgeStore);
  knowledgeStore.publishGeneration = () => false;
  try {
    await assert.rejects(setupResult.commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } }), /page coverage/);
    const firstGeneration = knowledgeStore.listGenerations('fixture')[0];
    const partition = knowledgeStore.listGenerationPartitions(firstGeneration.generationId)[0];
    assert.equal(firstGeneration.status, 'building', 'a publication failure leaves the generation resumable');
    assert.equal(partition.status, 'complete');
    assert.equal(partition.stagedManifest?.pageCount, 1);
    assert.ok(partition.stagedManifest?.entries.some((entry: any) => entry.path === 'full.md'));
    const callsAfterFirstAttempt = networkCalls;

    knowledgeStore.close();
    knowledgeStore = createKnowledgeStore({ dataDir: path.dirname(options.extractDir),
      knowledgeDatabasePath: path.join(path.dirname(options.extractDir), 'paperquay-knowledge.sqlite') });
    const commands = createPaddleOcrCommands({ appPaths: { mineruCacheDir: path.dirname(options.extractDir) }, knowledgeStore });
    assert.equal(await fsp.readFile(path.join(partition.stagedPath, 'full.md'), 'utf8').then((text) => text.includes('Durably staged partition.')), true);
    assert.equal(await commands.run_paddleocr_cloud_parse({ options }, { sender: { isDestroyed: () => true } }).then(() => true), true);
    assert.equal(networkCalls, callsAfterFirstAttempt, 'a valid staged partition is reused without a remote submission, poll or download');
    assert.equal(knowledgeStore.listGenerations('fixture')[0].status, 'published');
  } finally {
    knowledgeStore.publishGeneration = originalPublish;
    knowledgeStore.close();
  }
});
