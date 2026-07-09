import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPaperMineruStatusUpdate,
  applyPaperSummaryStatusUpdate,
  buildImportDraftsFromPdfPaths,
  buildInitialPaperStatuses,
  categorySignature,
  clampDetailsPanelWidth,
  filterDemoPapers,
  hasMineruOutputForPaper,
  markPaperStatusesCheckingMineru,
  metadataFromDraft,
  metadataFromZoteroItem,
  metadataUpdateForPaper,
  mineruOutputPathCandidatesForPaper,
  normalizeImportPdfPaths,
  reorderPaperList,
  resolveDefaultImportCategoryId,
  resolveSelectedPaperId,
  splitAuthors,
  type LiteratureLibraryDemoState,
} from '../src/features/literature/literatureLibraryUtils.ts';
import type { ImportDraftItem } from '../src/features/literature/importTypes.ts';
import type {
  LibrarySettings,
  LiteratureAttachment,
  LiteratureCategory,
  LiteraturePaper,
} from '../src/types/library.ts';
import type { MetadataLookupResult } from '../src/types/metadata.ts';
import type { ZoteroLibraryItem } from '../src/types/reader.ts';

function category(overrides: Partial<LiteratureCategory> & Pick<LiteratureCategory, 'id' | 'name'>): LiteratureCategory {
  return {
    id: overrides.id,
    name: overrides.name,
    parentId: overrides.parentId ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    isSystem: overrides.isSystem ?? false,
    systemKey: overrides.systemKey ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    paperCount: overrides.paperCount ?? 0,
  };
}

function attachment(overrides: Partial<LiteratureAttachment> = {}): LiteratureAttachment {
  return {
    id: overrides.id ?? 'a1',
    paperId: overrides.paperId ?? 'p1',
    kind: overrides.kind ?? 'pdf',
    originalPath: overrides.originalPath ?? null,
    storedPath: overrides.storedPath ?? 'D:/papers/sample.pdf',
    relativePath: overrides.relativePath ?? null,
    fileName: overrides.fileName ?? 'sample.pdf',
    mimeType: overrides.mimeType ?? 'application/pdf',
    fileSize: overrides.fileSize ?? 100,
    contentHash: overrides.contentHash ?? null,
    createdAt: overrides.createdAt ?? 1,
    missing: overrides.missing ?? false,
  };
}

function paper(overrides: Partial<LiteraturePaper> & Pick<LiteraturePaper, 'id' | 'title'>): LiteraturePaper {
  return {
    id: overrides.id,
    title: overrides.title,
    year: overrides.year ?? null,
    publication: overrides.publication ?? null,
    doi: overrides.doi ?? null,
    url: overrides.url ?? null,
    abstractText: overrides.abstractText ?? null,
    keywords: overrides.keywords ?? [],
    importedAt: overrides.importedAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    lastReadAt: overrides.lastReadAt ?? null,
    readingProgress: overrides.readingProgress ?? 0,
    isFavorite: overrides.isFavorite ?? false,
    userNote: overrides.userNote ?? null,
    aiSummary: overrides.aiSummary ?? null,
    citation: overrides.citation ?? null,
    source: overrides.source ?? 'local',
    sortOrder: overrides.sortOrder ?? 0,
    authors: overrides.authors ?? [],
    tags: overrides.tags ?? [],
    categoryIds: overrides.categoryIds ?? [],
    attachments: overrides.attachments ?? [],
  };
}

function settings(): LibrarySettings {
  return {
    storageDir: '',
    zoteroLocalDataDir: '',
    importMode: 'copy',
    autoRenameFiles: false,
    fileNamingRule: '',
    createCategoryFolders: false,
    folderWatchEnabled: false,
    backupEnabled: false,
    preserveOriginalPath: false,
    openAlexEnabled: false,
    openAlexApiKey: '',
    openAlexMailto: '',
  };
}

function draft(overrides: Partial<ImportDraftItem> = {}): ImportDraftItem {
  return {
    path: 'D:/papers/deep-learning.pdf',
    title: ' Deep Learning ',
    authors: 'Alice; Bob，Carol',
    year: ' 2015 ',
    publication: ' Nature ',
    doi: ' 10.1/test ',
    url: ' https://example.test ',
    abstractText: ' Abstract ',
    categoryId: '',
    ...overrides,
  };
}

function zoteroItem(overrides: Partial<ZoteroLibraryItem> = {}): ZoteroLibraryItem {
  return {
    itemKey: 'ITEM',
    title: ' Zotero Paper ',
    creators: 'Alice; Unknown Authors; Bob',
    year: ' 2024 ',
    itemType: 'journalArticle',
    attachmentFilename: 'fallback.pdf',
    ...overrides,
  };
}

function metadata(overrides: Partial<MetadataLookupResult> = {}): MetadataLookupResult {
  return {
    source: 'test',
    doi: null,
    title: null,
    authors: [],
    year: null,
    publication: null,
    url: null,
    abstractText: null,
    ...overrides,
  };
}

test('metadata helpers normalize draft and Zotero input', () => {
  assert.deepEqual(splitAuthors('Alice; Bob，Carol；Dave'), ['Alice', 'Bob', 'Carol', 'Dave']);
  assert.deepEqual(metadataFromDraft(draft()), {
    title: 'Deep Learning',
    authors: ['Alice', 'Bob', 'Carol'],
    year: '2015',
    publication: 'Nature',
    doi: '10.1/test',
    url: 'https://example.test',
    abstractText: 'Abstract',
  });
  assert.deepEqual(metadataFromZoteroItem(zoteroItem({ title: '', year: '未知年份' })), {
    title: 'fallback.pdf',
    authors: ['Alice', 'Bob'],
    year: null,
    publication: null,
    doi: null,
  });
});

test('filterDemoPapers applies category and search filters', () => {
  const favorites = category({ id: 'favorites', name: 'Favorites', isSystem: true, systemKey: 'favorites' });
  const ai = category({ id: 'ai', name: 'AI' });
  const demo: LiteratureLibraryDemoState = {
    settings: settings(),
    categories: [favorites, ai],
    papers: [
      paper({ id: 'p1', title: 'Graph Retrieval', isFavorite: true, categoryIds: [ai.id] }),
      paper({ id: 'p2', title: 'Visualization', categoryIds: [ai.id] }),
      paper({ id: 'p3', title: 'Other', isFavorite: true }),
    ],
    statusMessage: '',
  };

  assert.deepEqual(filterDemoPapers(demo, favorites.id, '').map((item) => item.id), ['p1', 'p3']);
  assert.deepEqual(filterDemoPapers(demo, ai.id, 'retrieval').map((item) => item.id), ['p1']);
});

test('reorderPaperList moves an item relative to the target', () => {
  const papers = [
    paper({ id: 'p1', title: 'One' }),
    paper({ id: 'p2', title: 'Two' }),
    paper({ id: 'p3', title: 'Three' }),
  ];

  assert.deepEqual(reorderPaperList(papers, 'p1', 'p3', 'after').map((item) => item.id), ['p2', 'p3', 'p1']);
  assert.equal(reorderPaperList(papers, 'missing', 'p3', 'after'), papers);
});

test('resolveSelectedPaperId preserves valid selection and falls back to first paper', () => {
  const papers = [
    paper({ id: 'p1', title: 'One' }),
    paper({ id: 'p2', title: 'Two' }),
  ];

  assert.equal(resolveSelectedPaperId('p2', papers), 'p2');
  assert.equal(resolveSelectedPaperId('missing', papers), 'p1');
  assert.equal(resolveSelectedPaperId(null, papers), 'p1');
  assert.equal(resolveSelectedPaperId('missing', []), null);
});

test('panel width and category signature helpers are stable', () => {
  assert.equal(clampDetailsPanelWidth(100), 320);
  assert.equal(clampDetailsPanelWidth(400.4), 400);
  assert.equal(clampDetailsPanelWidth(900), 760);
  assert.equal(categorySignature('  AI ', null), 'root::ai');
  assert.equal(categorySignature('AI', 'parent'), 'parent::ai');
});

test('import draft helpers filter PDFs and choose non-system default categories', () => {
  const systemCategory = category({ id: 'favorites', name: 'Favorites', isSystem: true, systemKey: 'favorites' });
  const aiCategory = category({ id: 'ai', name: 'AI' });

  assert.deepEqual(
    normalizeImportPdfPaths([' D:/papers/a.pdf ', 'D:/papers/a.pdf', 'D:/papers/b.PDF', 'notes.txt']),
    ['D:/papers/a.pdf', 'D:/papers/b.PDF'],
  );
  assert.equal(resolveDefaultImportCategoryId([systemCategory, aiCategory], systemCategory.id), '');
  assert.equal(resolveDefaultImportCategoryId([systemCategory, aiCategory], aiCategory.id), aiCategory.id);

  const result = buildImportDraftsFromPdfPaths({
    paths: [' D:/papers/a.pdf ', 'D:/papers/b.pdf', 'D:/papers/c.txt'],
    existingDrafts: [draft({ path: 'D:/papers/a.pdf' })],
    categories: [aiCategory],
    selectedCategoryId: aiCategory.id,
  });

  assert.deepEqual(result.pdfPaths, ['D:/papers/a.pdf', 'D:/papers/b.pdf']);
  assert.deepEqual(result.drafts, [
    {
      path: 'D:/papers/b.pdf',
      title: 'b',
      authors: '',
      year: '',
      publication: '',
      doi: '',
      url: '',
      abstractText: '',
      categoryId: aiCategory.id,
    },
  ]);
});

test('paper status helpers initialize and merge MinerU and summary status', () => {
  const targetPapers = [
    paper({ id: 'p1', title: 'One', aiSummary: 'Summary' }),
    paper({ id: 'p2', title: 'Two' }),
  ];
  const initial = buildInitialPaperStatuses(targetPapers);

  assert.deepEqual(initial, {
    p1: { mineruParsed: false, overviewGenerated: true, checkingMineru: false },
    p2: { mineruParsed: false, overviewGenerated: false, checkingMineru: false },
  });

  const checking = markPaperStatusesCheckingMineru(initial, targetPapers, new Set(['p2']));

  assert.deepEqual(checking.p2, {
    mineruParsed: false,
    overviewGenerated: false,
    checkingMineru: true,
  });
  assert.equal(markPaperStatusesCheckingMineru(checking, targetPapers, new Set(['p2'])), checking);

  const summarized = applyPaperSummaryStatusUpdate(checking, 'p2', 'Done');
  assert.equal(summarized.p2.overviewGenerated, true);
  assert.equal(summarized.p2.checkingMineru, true);

  const mineruUpdated = applyPaperMineruStatusUpdate(summarized, 'p2', true);
  assert.deepEqual(mineruUpdated.p2, {
    mineruParsed: true,
    overviewGenerated: true,
    checkingMineru: false,
  });
});

test('metadataUpdateForPaper only returns changed metadata fields', () => {
  const target = paper({
    id: 'p1',
    title: 'sample',
    year: null,
    authors: [{ id: 'a1', name: 'Alice', givenName: null, familyName: null, sortOrder: 0 }],
    attachments: [attachment()],
  });

  const update = metadataUpdateForPaper(target, metadata({
    title: 'Real Paper Title',
    year: '2024',
    authors: ['Alice', 'Bob'],
  }));

  assert.deepEqual(update, {
    paperId: 'p1',
    title: 'Real Paper Title',
    year: '2024',
    authors: ['Alice', 'Bob'],
  });
  assert.equal(metadataUpdateForPaper(target, metadata({ title: 'sample', authors: ['Alice'] })), null);
});

test('MinerU helpers expose cache and sibling output candidates', async () => {
  const target = paper({
    id: 'p1',
    title: 'Sample Paper',
    attachments: [attachment({ storedPath: 'D:/papers/sample.pdf' })],
  });
  const candidates = mineruOutputPathCandidatesForPaper(target, 'D:/cache', true);

  assert.equal(candidates.some((path) => path.endsWith('content_list_v2.json')), true);
  assert.equal(candidates.includes('D:/cache/content_list_v2.json'), false);
  assert.equal(candidates.includes('D:/cache/content_list.json'), false);
  assert.equal(candidates.includes('D:/cache/middle.json'), false);
  assert.equal(candidates.includes('D:/papers/content_list_v2.json'), true);
  assert.equal(candidates.includes('D:/papers/content_list.json'), true);
  assert.equal(candidates.includes('D:/papers/middle.json'), true);
  assert.equal(candidates.includes('D:/papers/full.md'), true);

  const exists = await hasMineruOutputForPaper(
    target,
    'D:/cache',
    true,
    async (path) => path === 'D:/papers/full.md',
  );

  assert.equal(exists, true);
});

test('MinerU helpers resolve sibling candidates from the current library storage directory', async () => {
  const target = paper({
    id: 'p-storage',
    title: 'Moved Storage Paper',
    attachments: [attachment({
      storedPath: 'D:/old-library/nested/sample.pdf',
      relativePath: 'nested/sample.pdf',
    })],
  });
  const candidates = mineruOutputPathCandidatesForPaper(
    target,
    'D:/cache',
    true,
    'D:/new-library',
  );

  assert.equal(candidates.includes('D:/new-library/nested/content_list_v2.json'), true);
  assert.equal(candidates.includes('D:/old-library/nested/content_list_v2.json'), false);

  const exists = await hasMineruOutputForPaper(
    target,
    'D:/cache',
    true,
    async (path) => path === 'D:/new-library/nested/full.md',
    'D:/new-library',
  );

  assert.equal(exists, true);
});
