import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { listLiteratureFileLocations, mineruCacheDirectories } = require('../electron/backend/literatureFileLocations.cjs');
const { createFileCommands } = require('../electron/backend/fileCommands.cjs');
const { createKnowledgeStore } = require('../electron/backend/knowledgeStore.cjs');

test('lists registered original and translated PDFs and only artifacts tied to registered source paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-locations-'));
  try {
    const storageDir = path.join(root, '文献 库');
    const cacheDir = path.join(root, 'cache');
    const source = path.join(storageDir, 'paper-a.pdf');
    const translationA = path.join(storageDir, 'translated-a.pdf');
    const translationB = path.join(storageDir, 'translated-b.pdf');
    const sibling = path.join(storageDir, 'full.md');
    await fs.mkdir(storageDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await Promise.all([source, translationA, translationB, sibling].map((file) => fs.writeFile(file, 'fixture')));
    const paper = {
      id: 'paper-a', title: 'A title that must not be used to scan', source: 'local',
      attachments: [
        { id: 'src', kind: 'pdf', fileName: 'paper-a.pdf', storedPath: source, relativePath: null, contentHash: 'sha-a' },
        { id: 'zh', kind: 'translated-pdf', fileName: 'translated-a.pdf', language: 'zh-CN', storedPath: translationA, contentHash: 'sha-zh' },
        { id: 'en', kind: 'translated-pdf', fileName: 'translated-b.pdf', language: 'en', storedPath: translationB, contentHash: 'sha-en' },
      ],
    };
    const cache = mineruCacheDirectories({ mineruCacheDir: cacheDir }, paper, source)[0];
    await fs.mkdir(path.join(cache, 'images'), { recursive: true });
    await fs.writeFile(path.join(cache, 'content_list_v2.json'), '{}');
    await fs.writeFile(path.join(cache, 'full.md'), '# parsed');
    const locations = await listLiteratureFileLocations({ paper, appPaths: { mineruCacheDir: cacheDir }, settings: { storageDir } });
    assert.equal(locations.filter((item) => item.role === 'original-pdf' && item.status === 'available').length, 1);
    assert.deepEqual(locations.filter((item) => item.role === 'translated-pdf').map((item) => [item.language, item.fileName]).sort(), [
      ['en', 'translated-b.pdf'], ['zh-CN', 'translated-a.pdf'],
    ]);
    assert.ok(locations.some((item) => item.role === 'parsed-markdown' && item.path === path.join(cache, 'full.md')));
    assert.ok(locations.some((item) => item.role === 'parse-images' && item.targetKind === 'directory'));
    assert.ok(locations.some((item) => item.role === 'parsed-markdown' && item.path === sibling));
    assert.equal(locations.some((item) => item.path?.includes('A title that must not be used')), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('marks missing registered sources and remote-only records without manufacturing paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-locations-'));
  try {
    const appPaths = { mineruCacheDir: path.join(root, 'cache') };
    const missing = {
      id: 'missing', title: 'Missing', source: 'local',
      attachments: [{ id: 'm', kind: 'pdf', fileName: 'gone.pdf', storedPath: path.join(root, 'gone.pdf'), contentHash: 'old-hash' }],
    };
    const missingLocations = await listLiteratureFileLocations({ paper: missing, appPaths, settings: {} });
    assert.equal(missingLocations[0].status, 'missing');
    assert.equal(missingLocations[0].versionStatus, 'version-unverified');

    const remote = await listLiteratureFileLocations({
      paper: { id: 'remote', title: 'Remote', source: 'zotero', attachments: [] }, appPaths, settings: {},
    });
    assert.equal(remote.length, 1);
    assert.equal(remote[0].status, 'remote-only');
    assert.equal(remote[0].path, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('reveal re-resolves a paper-scoped location and dispatches files and directories through the proper shell call', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-reveal-'));
  const opened = [];
  const library = {
    settings: { storageDir: root },
    papers: [{
      id: 'paper-b', title: 'B', source: 'local',
      attachments: [{ id: 'b-pdf', kind: 'pdf', fileName: 'b.pdf', storedPath: path.join(root, 'b.pdf'), contentHash: 'hb' }],
    }],
  };
  const appPaths = {
    dataDir: root,
    configPath: path.join(root, 'config.json'),
    mineruCacheDir: path.join(root, 'cache'),
    remotePdfDownloadDir: path.join(root, 'downloads'),
  };
  const commands = createFileCommands({
    appPaths,
    approvedWritePaths: new Set(),
    store: { load: () => library },
    shellApi: {
      showItemInFolder: (target) => opened.push(['file', target]),
      openPath: async (target) => { opened.push(['directory', target]); return ''; },
    },
  });
  try {
    const pdfPath = path.join(root, 'b.pdf');
    await fs.writeFile(pdfPath, 'pdf');
    const parsedDir = path.join(appPaths.mineruCacheDir, 'manual-associated');
    await fs.mkdir(parsedDir, { recursive: true });
    const listed = await commands.list_literature_file_locations({ paperId: 'paper-b' });
    const pdf = listed.find((item) => item.role === 'original-pdf');
    assert.equal(pdf.status, 'available');
    await commands.reveal_literature_file_location({ paperId: 'paper-b', locationId: pdf.id });
    assert.deepEqual(opened, [['file', pdfPath]]);
    await assert.rejects(commands.reveal_literature_file_location({ paperId: 'paper-a', locationId: pdf.id }), /Paper not found/);
    await assert.rejects(commands.reveal_literature_file_location({ paperId: 'paper-b', locationId: 'arbitrary-path' }), /location changed/);
    assert.equal(opened.length, 1);

    // A historical evidence locator is tied to the source attachment version;
    // if the registered PDF is replaced, never resolve the old locator to its new bytes.
    library.papers[0].attachments[0].contentHash = 'replacement-hash';
    await assert.rejects(
      commands.reveal_literature_file_location({ paperId: 'paper-b', locationId: pdf.id }),
      /location changed/,
    );
    assert.equal(opened.length, 1);
    library.papers[0].attachments[0].contentHash = 'hb';

    const cachePath = mineruCacheDirectories(appPaths, library.papers[0], pdfPath)[0];
    await fs.mkdir(cachePath, { recursive: true });
    const refreshed = await commands.list_literature_file_locations({ paperId: 'paper-b' });
    const directory = refreshed.find((item) => item.role === 'parse-directory');
    await commands.reveal_literature_file_location({ paperId: 'paper-b', locationId: directory.id });
    assert.deepEqual(opened[1], ['directory', cachePath]);

    await fs.rm(pdfPath);
    await assert.rejects(commands.reveal_literature_file_location({ paperId: 'paper-b', locationId: pdf.id }), /missing/);
    assert.equal(opened.length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('generation artifact locators remain version-specific across replacement and never fall forward', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-generation-locations-'));
  const opened = [];
  const knowledgeStore = createKnowledgeStore({ dataDir: root, knowledgeDatabasePath: path.join(root, 'knowledge.sqlite') });
  const paperId = 'paper-history';
  const pdfPath = path.join(root, 'source.pdf');
  const library = { settings: { storageDir: root }, papers: [{
    id: paperId, title: 'History', source: 'local',
    attachments: [{ id: 'pdf', kind: 'pdf', fileName: 'source.pdf', storedPath: pdfPath, contentHash: 'registered-hash' }],
  }] };
  const appPaths = {
    dataDir: root, configPath: path.join(root, 'config.json'), mineruCacheDir: path.join(root, 'cache'),
    remotePdfDownloadDir: path.join(root, 'downloads'),
  };
  const commands = createFileCommands({ appPaths, approvedWritePaths: new Set(), store: { load: () => library }, knowledgeStore,
    shellApi: { showItemInFolder: (target) => opened.push(['file', target]), openPath: async (target) => { opened.push(['directory', target]); return ''; } },
  });
  const publish = async (generationId, sourceVersion, content) => {
    const directory = path.join(root, generationId);
    await fs.mkdir(directory, { recursive: true });
    const artifactPath = path.join(directory, 'full.md');
    await fs.writeFile(artifactPath, content);
    const bytes = await fs.readFile(artifactPath);
    const generation = knowledgeStore.beginGeneration({ sourceId: `native-library:${paperId}`, sourceVersion, generationId,
      partitions: [{ index: 0, startPage: 1, endPage: 1, inputHash: `input-${generationId}` }],
    });
    assert.equal(knowledgeStore.setPartitionStatus(generation.generationId, 0, 'running'), true);
    assert.equal(knowledgeStore.setPartitionStatus(generation.generationId, 0, 'complete'), true);
    assert.equal(knowledgeStore.setGenerationArtifacts(generation.generationId, { artifactPath: directory, manifest: [{
      path: 'full.md', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }] }), true);
    assert.equal(knowledgeStore.publishGeneration(generation.generationId, { sourceVersion, expectedPageCount: 1 }), true);
    return artifactPath;
  };
  try {
    await fs.writeFile(pdfPath, 'source');
    const oldPath = await publish('generation-old', 'pdf-v1', 'old generation evidence');
    const oldLocation = (await commands.list_literature_file_locations({ paperId })).find((item) => item.generationId === 'generation-old');
    assert.equal(oldLocation.status, 'available');
    assert.equal(oldLocation.versionStatus, 'version-verified');
    await commands.reveal_literature_file_location({ paperId, locationId: oldLocation.id });
    assert.deepEqual(opened, [['file', oldPath]]);
    const oldSourceVersion = knowledgeStore.listSourceVersions(`native-library:${paperId}`)
      .find((item) => item.parseGeneration === 'generation-old');
    const oldEvidence = knowledgeStore.createEvidenceSpan({
      sourceVersionId: oldSourceVersion.sourceVersionId,
      quote: 'old generation evidence',
      evidenceText: 'old generation evidence',
      pageIndex: 0,
      blockId: 'block-old',
      locatorStatus: 'exact',
    });
    const evidenceLocations = await commands.list_literature_file_locations({ paperId, evidenceId: oldEvidence.evidenceId });
    assert.equal(evidenceLocations.length, 1);
    assert.equal(evidenceLocations[0].generationId, 'generation-old');
    assert.equal(evidenceLocations[0].evidenceId, oldEvidence.evidenceId);
    assert.equal(evidenceLocations[0].status, 'available');
    await commands.reveal_literature_file_location({ paperId, locationId: evidenceLocations[0].id, evidenceId: oldEvidence.evidenceId });
    assert.deepEqual(opened.at(-1), ['file', oldPath]);

    const currentPath = await publish('generation-current', 'pdf-v2', 'current generation evidence');
    const locations = await commands.list_literature_file_locations({ paperId });
    const retainedOld = locations.find((item) => item.generationId === 'generation-old');
    const current = locations.find((item) => item.generationId === 'generation-current');
    assert.equal(retainedOld.isCurrentGeneration, false);
    assert.equal(current.isCurrentGeneration, true);
    assert.equal(current.status, 'available');

    await fs.rm(oldPath);
    const afterRemoval = await commands.list_literature_file_locations({ paperId });
    assert.equal(afterRemoval.find((item) => item.generationId === 'generation-old').status, 'missing');
    await assert.rejects(commands.reveal_literature_file_location({ paperId, locationId: retainedOld.id }), /missing/);
    const missingEvidence = await commands.list_literature_file_locations({ paperId, evidenceId: oldEvidence.evidenceId });
    assert.equal(missingEvidence.length, 1);
    assert.equal(missingEvidence[0].generationId, 'generation-old');
    assert.equal(missingEvidence[0].status, 'missing');
    await assert.rejects(commands.reveal_literature_file_location({
      paperId, locationId: missingEvidence[0].id, evidenceId: oldEvidence.evidenceId,
    }), /missing/);
    assert.equal(opened.length, 2, 'a missing historical evidence artifact must never reveal the newer generation');

    await fs.writeFile(currentPath, 'tampered new bytes');
    const afterTamper = await commands.list_literature_file_locations({ paperId });
    const tampered = afterTamper.find((item) => item.generationId === 'generation-current');
    assert.equal(tampered.status, 'version-mismatch');
    assert.equal(tampered.versionStatus, 'version-unverified');
    await assert.rejects(commands.reveal_literature_file_location({ paperId, locationId: current.id }), /version/);
    assert.equal(opened.length, 2);
  } finally {
    knowledgeStore.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
