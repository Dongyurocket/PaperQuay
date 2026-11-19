import test from 'node:test';
import assert from 'node:assert/strict';

import type { LiteratureCategory, LiteraturePaper } from '../src/types/library.ts';
import type { MetadataLookupResult } from '../src/types/metadata.ts';
import {
  buildPaperDraftUpdateRequest,
  createPaperDetailsDraft,
  hasDuplicateCitationKey,
  normalizeCategorySelection,
  normalizeDoi,
  paperDraftChanged,
  splitAuthorString,
  validatePaperDraft,
} from '../src/features/literature/details/paperDetailsDraft.ts';
import {
  buildManualMetadataUpdateRequest,
  buildPaperMetadataDifferences,
  mergeSelectedPaperMetadata,
} from '../src/features/literature/details/paperMetadataRecognition.ts';
import {
  DEFAULT_PAPER_DETAILS_SECTIONS,
  loadPaperDetailsSections,
  parsePaperDetailsSections,
  persistPaperDetailsSections,
  serializePaperDetailsSections,
} from '../src/features/literature/details/paperDetailsSections.ts';

function makePaper(overrides: Partial<LiteraturePaper> = {}): LiteraturePaper {
  return {
    id: 'paper-1',
    title: 'Existing title',
    titleZh: null,
    year: null,
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
    itemType: 'journalArticle',
    publisher: null,
    institution: null,
    reportNumber: null,
    volume: null,
    issue: null,
    pages: null,
    isbn: null,
    issn: null,
    language: null,
    citationKey: null,
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
    categoryIds: ['category-a'],
    attachments: [],
    ragEnabled: true,
    ...overrides,
  };
}

const categories: LiteratureCategory[] = [
  {
    id: 'category-a', name: 'A', parentId: null, sortOrder: 0, isSystem: false,
    systemKey: null, createdAt: 1, updatedAt: 1, paperCount: 1,
  },
  {
    id: 'category-b', name: 'B', parentId: null, sortOrder: 1, isSystem: false,
    systemKey: null, createdAt: 1, updatedAt: 1, paperCount: 0,
  },
  {
    id: 'all', name: 'All', parentId: null, sortOrder: -1, isSystem: true,
    systemKey: 'all', createdAt: 1, updatedAt: 1, paperCount: 1,
  },
];

test('DOI validation accepts DOI URLs and draft requests store the normalized DOI', () => {
  const paper = makePaper();
  const draft = { ...createPaperDetailsDraft(paper), doi: ' https://doi.org/10.1234/Example ' };

  assert.equal(normalizeDoi(draft.doi), '10.1234/Example');
  assert.deepEqual(validatePaperDraft(draft, 2026), {});
  assert.equal(buildPaperDraftUpdateRequest(paper, draft).doi, '10.1234/Example');
});

test('draft validation checks year, DOI, ISSN, URL, language, citation key, and ORCID', () => {
  const draft = {
    ...createPaperDetailsDraft(makePaper()),
    year: '0999',
    doi: 'not-a-doi',
    issn: '1234-5678',
    url: 'file:///tmp/paper.pdf',
    language: 'not a language tag?',
    citationKey: 'invalid key',
    authors: [{ name: 'Ada', orcid: '0000-0002-1825-0098' }],
  };

  assert.deepEqual(validatePaperDraft(draft, 2026), {
    year: 'invalid-year',
    doi: 'invalid-doi',
    issn: 'invalid-issn',
    url: 'invalid-url',
    language: 'invalid-language',
    citationKey: 'invalid-citation-key',
    orcid: 'invalid-orcid',
  });
});

test('draft validation accepts the next year and a valid ORCID check digit', () => {
  const draft = {
    ...createPaperDetailsDraft(makePaper()),
    year: '2027',
    issn: '0378-5955',
    citationKey: 'Ada_2027:paper.v1',
    authors: [{ name: 'Ada', affiliation: 'Analytical Engines Lab', orcid: '0000-0002-1825-0097' }],
  };

  assert.deepEqual(validatePaperDraft(draft, 2026), {});
});

test('draft update includes detailed authors and trims chip values', () => {
  const paper = makePaper();
  const draft = {
    ...createPaperDetailsDraft(paper),
    authors: [{ name: ' Ada Lovelace ', givenName: ' Ada ', familyName: ' Lovelace ', affiliation: ' Lab ', orcid: 'https://orcid.org/0000-0002-1825-0097' }],
    keywords: [' graphs ', 'systems'],
    tags: [' review '],
    categories: ['category-b', 'category-a'],
    language: ' en-us ',
  };
  const request = buildPaperDraftUpdateRequest(paper, draft);

  assert.deepEqual(request.authorDetails, [{
    name: 'Ada Lovelace',
    givenName: 'Ada',
    familyName: 'Lovelace',
    affiliation: 'Lab',
    orcid: '0000-0002-1825-0097',
  }]);
  assert.deepEqual(request.keywords, ['graphs', 'systems']);
  assert.deepEqual(request.tags, ['review']);
  assert.equal(request.language, 'en-US');
  assert.deepEqual(request.authors, undefined);
});

test('author paste splitting preserves family-name comma pairs and splits whole lists', () => {
  assert.deepEqual(splitAuthorString('Doe, Jane; Lin, Wei\nAda Lovelace'), [
    'Doe, Jane', 'Lin, Wei', 'Ada Lovelace',
  ]);
  assert.deepEqual(splitAuthorString('Doe, Jane, Ada Lovelace'), [
    'Doe', 'Jane', 'Ada Lovelace',
  ]);
});

test('duplicate citation keys compare without case and exclude the current paper', () => {
  const papers = [
    makePaper({ id: 'paper-1', citationKey: 'CurrentKey' }),
    makePaper({ id: 'paper-2', citationKey: 'Shared_Key' }),
  ];

  assert.equal(hasDuplicateCitationKey(' shared_key ', papers, 'paper-1'), true);
  assert.equal(hasDuplicateCitationKey('currentkey', papers, 'paper-1'), false);
  assert.equal(hasDuplicateCitationKey('', papers, 'paper-1'), false);
});

test('category normalization drops system and unknown categories and removes duplicates', () => {
  assert.deepEqual(
    normalizeCategorySelection(['category-b', 'all', 'category-a', 'category-b', 'missing'], categories),
    ['category-a', 'category-b'],
  );
});

test('paper draft dirty checking includes category and metadata changes', () => {
  const paper = makePaper({ categoryIds: ['category-a', 'category-b'] });
  const draft = createPaperDetailsDraft(paper);

  assert.equal(paperDraftChanged(paper, draft), false);
  assert.equal(paperDraftChanged(paper, { ...draft, categories: ['category-b', 'category-a'] }), false);
  assert.equal(paperDraftChanged(paper, { ...draft, categories: ['category-a'] }), true);
  assert.equal(paperDraftChanged(paper, { ...draft, language: 'en' }), true);
});

test('metadata differences list changed fields and merge only checked fields', () => {
  const paper = makePaper({ year: '2020', language: null });
  const proposed = { paperId: paper.id, title: 'New title', year: '2025', language: 'en' };
  const differences = buildPaperMetadataDifferences(paper, proposed);

  assert.deepEqual(differences.map(({ key, current, next, checked }) => ({ key, current, next, checked })), [
    { key: 'title', current: 'Existing title', next: 'New title', checked: true },
    { key: 'year', current: '2020', next: '2025', checked: true },
    { key: 'language', current: null, next: 'en', checked: true },
  ]);
  assert.deepEqual(mergeSelectedPaperMetadata(paper.id, proposed, ['year', 'language']), {
    paperId: paper.id,
    year: '2025',
    language: 'en',
  });
  assert.equal(mergeSelectedPaperMetadata(paper.id, proposed, []), null);
});

test('manual metadata request is pure and includes only changed manual values', () => {
  const paper = makePaper();
  const before = structuredClone(paper);
  const request = buildManualMetadataUpdateRequest(paper, null, {
    title: ' Manually corrected title ',
    doi: '10.1000/manual',
  });

  assert.deepEqual(request, {
    paperId: paper.id,
    expectedUpdatedAt: paper.updatedAt,
    title: 'Manually corrected title',
    doi: '10.1000/manual',
  });
  assert.deepEqual(paper, before);
  assert.equal(buildManualMetadataUpdateRequest(paper, null, { title: paper.title, doi: '' }), null);
});

test('section state persists through storage and serializes only supported keys', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const state = { ...DEFAULT_PAPER_DETAILS_SECTIONS, information: true, abstract: false };

  persistPaperDetailsSections(state, storage);
  assert.deepEqual(loadPaperDetailsSections(storage), state);
  assert.deepEqual(JSON.parse(serializePaperDetailsSections(state)), state);
});

test('invalid or incomplete section state falls back safely to defaults', () => {
  assert.deepEqual(parsePaperDetailsSections('{bad json'), DEFAULT_PAPER_DETAILS_SECTIONS);
  assert.deepEqual(parsePaperDetailsSections('[]'), DEFAULT_PAPER_DETAILS_SECTIONS);
  assert.deepEqual(parsePaperDetailsSections('{"information":"yes","abstract":false,"future":true}'), {
    ...DEFAULT_PAPER_DETAILS_SECTIONS,
    abstract: false,
  });
});

test('manual recognition builder accepts a null lookup result without changing its input', () => {
  const paper = makePaper();
  const metadata: MetadataLookupResult | null = null;
  const result = buildManualMetadataUpdateRequest(paper, metadata, { title: '', doi: '' });

  assert.equal(result, null);
  assert.equal(paper.title, 'Existing title');
});
