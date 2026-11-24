import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { metadataFromZoteroItem } from '../src/features/literature/literatureLibraryUtils.ts';

const require = createRequire(import.meta.url);
const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const {
  collectionCategoryPath,
  buildZoteroItemMetadata,
  buildZoteroImportPlan,
} = require('../electron/shared/zoteroDomain.cjs');
const {
  buildImportedPaperRecord,
  buildImportedAttachmentFileName,
} = require('../electron/shared/libraryDomain.cjs');

function createFixture() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-zotero-shared-'));
  const appPaths = {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
  };
  const store = createLibraryStore(appPaths);
  return {
    dataDir,
    appPaths,
    store,
    close() {
      store.close();
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

function zoteroItem(overrides: Record<string, unknown> = {}) {
  return {
    itemKey: 'ITEM-1',
    attachmentKey: 'ATT-1',
    title: 'Attention Is All You Need',
    creators: 'Ashish Vaswani, Noam Shazeer',
    year: '2017',
    itemType: 'journalArticle',
    language: 'en-US',
    extra: 'Citation Key: vaswani2017',
    authors: [
      {
        name: 'Ashish Vaswani',
        givenName: 'Ashish',
        familyName: 'Vaswani',
        affiliation: 'Google Brain',
        orcid: null,
      },
    ],
    doi: '10.1000/transformer',
    publication: 'NeurIPS',
    abstractNote: 'The dominant sequence transduction models are based on complex recurrent networks.',
    attachmentFilename: 'attention.pdf',
    ...overrides,
  };
}

function writePdf(dir: string, name: string, body: string) {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, `%PDF-1.7\n${body}\n`);
  return filePath;
}

function createZoteroService(
  fixture: ReturnType<typeof createFixture>,
  collections: any[],
  itemsByCollection: Record<string, any[]>,
) {
  const allItems = [...new Map(
    Object.values(itemsByCollection).flat().map((item) => [item.itemKey, item]),
  ).values()];
  return new PaperQuayKnowledgeService({
    dataDir: fixture.dataDir,
    isAppRunning: () => false,
    // 复用 fixture 的库连接，避免测试清理时 Windows 上留下第二个 SQLite 句柄。
    libraryStoreFactory: () => fixture.store,
    zotero: {
      detectLocalZoteroDataDir: async () => '/fake/zotero',
      listLocalCollections: async () => collections,
      listLocalCollectionItems: async ({ collectionKey }: { collectionKey: string }) => itemsByCollection[collectionKey] ?? [],
      listLocalLibraryItems: async () => allItems,
      getLocalItemsByKeys: async ({ itemKeys }: { itemKeys: string[] }) => allItems.filter((item) => itemKeys.includes(item.itemKey)),
      searchLocalLibraryItems: async () => [],
    },
  });
}

test('Zotero collection paths are nested and matched case-insensitively', () => {
  const collections = [
    { collectionKey: 'root', name: 'AI Papers', parentCollectionKey: null, itemCount: 1 },
    { collectionKey: 'child', name: 'Transformers', parentCollectionKey: 'root', itemCount: 1 },
    { collectionKey: 'grand', name: 'Attention', parentCollectionKey: 'child', itemCount: 1 },
  ];
  assert.deepEqual(
    collectionCategoryPath(collections[2], collections),
    ['AI Papers', 'Transformers', 'Attention'],
  );

  const existingCategories = [
    { id: 'cat-root', name: 'ai papers', parentId: null, isSystem: false },
  ];
  const plan = buildZoteroImportPlan({
    collections,
    items: [
      { itemKey: 'filed', collectionKeys: ['grand'] },
      { itemKey: 'unfiled', collectionKeys: [] },
    ],
    existingCategories,
  });

  assert.equal(plan.categoryIdByCollectionKey.root, 'cat-root');
  assert.deepEqual(
    plan.categoriesToCreate.map((entry: any) => [entry.name, entry.parentPath]),
    [
      ['Transformers', ['AI Papers']],
      ['Attention', ['AI Papers', 'Transformers']],
      ['Zotero Unfiled', []],
    ],
  );
  assert.deepEqual(plan.unfiledItems.map((item: any) => item.itemKey), ['unfiled']);
});

test('Zotero metadata mapping is identical in the renderer helper and the shared domain module', () => {
  const item = zoteroItem();
  assert.deepEqual(buildZoteroItemMetadata(item), metadataFromZoteroItem(item));

  const fallback = zoteroItem({
    itemKey: 'ITEM-2',
    attachmentKey: 'ATT-2',
    title: '',
    authors: [],
    creators: 'Alice; Bob',
    year: '未知年份',
    language: 'not a language',
    extra: 'Citation Key: invalid key!',
    attachmentFilename: 'fallback.pdf',
  });
  assert.deepEqual(buildZoteroItemMetadata(fallback), metadataFromZoteroItem(fallback));
});

test('MCP Zotero sync creates nested categories and matches desktop metadata/file naming', async () => {
  const fixture = createFixture();
  try {
    const pdfPath = writePdf(fixture.dataDir, 'attention.pdf', 'attention-body');
    const item = zoteroItem({ localPdfPath: pdfPath });
    const collections = [
      { collectionKey: 'root', name: 'AI Papers', parentCollectionKey: null, itemCount: 1 },
      { collectionKey: 'child', name: 'Transformers', parentCollectionKey: 'root', itemCount: 1 },
    ];
    const service = createZoteroService(fixture, collections, { child: [item] });

    const result = await service.paperquaySyncFromZotero({ collectionKey: 'child', dataDir: '/fake/zotero' });
    assert.equal(result.summary.importedCount, 1);
    assert.equal(result.summary.duplicateCount, 0);

    const snapshot = fixture.store.load();
    const root = snapshot.categories.find((category: any) => category.name === 'AI Papers' && !category.isSystem);
    const child = snapshot.categories.find((category: any) => category.name === 'Transformers' && !category.isSystem);
    assert.ok(root);
    assert.ok(child);
    assert.equal(child.parentId, root.id);

    const details = service.getPaperDetails({ paperId: result.importedPapers[0].id });
    const metadata = buildZoteroItemMetadata(item);
    assert.equal(details.title, metadata.title);
    assert.equal(details.year, metadata.year);
    assert.equal(details.language, metadata.language);
    assert.equal(details.citationKey, metadata.citationKey);
    assert.deepEqual(details.authors, metadata.authors);
    assert.deepEqual(details.categoryIds, [child.id]);

    // The desktop helper builds the same record shape from the same Zotero item.
    const expected = buildImportedPaperRecord({
      paperId: details.id,
      attachmentId: details.attachments[0].id,
      metadata: metadataFromZoteroItem(item),
      source: 'zotero',
      sortOrder: details.sortOrder ?? 0,
      categoryIds: [child.id],
      attachment: {
        originalPath: pdfPath,
        storedPath: details.attachments[0].storedPath,
        relativePath: details.attachments[0].relativePath,
        fileName: 'attention.pdf',
        fileSize: details.attachments[0].fileSize,
        contentHash: details.attachments[0].contentHash,
      },
    });
    assert.equal(details.title, expected.title);
    assert.equal(details.titleZh, expected.titleZh);
    assert.equal(details.publication, expected.publication);
    assert.equal(details.doi, expected.doi);
    assert.equal(details.itemType, expected.itemType);
    assert.deepEqual(details.keywords, expected.keywords);
    assert.deepEqual(details.authors, expected.authors.map((author: any) => author.name));
    assert.equal(fixture.store.getPaper(details.id).source, 'zotero');

    const settings = fixture.store.load().settings;
    assert.equal(
      path.basename(details.attachments[0].storedPath),
      buildImportedAttachmentFileName({
        settings,
        paperId: details.id,
        attachmentId: details.attachments[0].id,
        fileName: 'attention.pdf',
        metadata,
      }),
    );
  } finally {
    fixture.close();
  }
});

test('MCP Zotero sync assigns duplicates to the collection category like the desktop import', async () => {
  const fixture = createFixture();
  try {
    const existing = buildImportedPaperRecord({
      paperId: 'paper-existing',
      attachmentId: 'att-existing',
      metadata: { title: 'Attention Is All You Need', authors: ['Ashish Vaswani'] },
      source: 'local',
      sortOrder: 0,
      categoryIds: [],
      attachment: {
        originalPath: '/tmp/existing.pdf',
        storedPath: '/tmp/existing.pdf',
        relativePath: null,
        fileName: 'existing.pdf',
        fileSize: 10,
        contentHash: 'existing-hash',
      },
    });
    fixture.store.savePaper(existing);

    const pdfPath = writePdf(fixture.dataDir, 'duplicate.pdf', 'duplicate-body');
    const item = zoteroItem({ itemKey: 'ITEM-DUP', attachmentKey: 'ATT-DUP', localPdfPath: pdfPath });
    const collections = [
      { collectionKey: 'root', name: 'AI Papers', parentCollectionKey: null, itemCount: 1 },
      { collectionKey: 'child', name: 'Transformers', parentCollectionKey: 'root', itemCount: 1 },
    ];
    const service = createZoteroService(fixture, collections, { child: [item] });

    const result = await service.paperquaySyncFromZotero({ collectionKey: 'child', dataDir: '/fake/zotero' });
    assert.equal(result.summary.importedCount, 0);
    assert.equal(result.summary.duplicateCount, 1);
    assert.equal(result.duplicates[0].existingPaperId, 'paper-existing');

    const snapshot = fixture.store.load();
    const child = snapshot.categories.find((category: any) => category.name === 'Transformers' && !category.isSystem);
    const updated = snapshot.papers.find((paper: any) => paper.id === 'paper-existing');
    assert.deepEqual(updated.categoryIds, [child.id]);
  } finally {
    fixture.close();
  }
});
