import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScopedRagLibraryItems,
  describeScopedRagFailure,
  loadScopedRagDocuments,
} from '../src/features/reader/readerQaScope.ts';
import type { LiteraturePaper } from '../src/types/library.ts';
import type { PositionedMineruBlock, WorkspaceItem } from '../src/types/reader.ts';
import type { ScopedRagDocument } from '../src/services/localRag.ts';

function paper(id: string, patch: Partial<LiteraturePaper> = {}): LiteraturePaper {
  return {
    id,
    title: `Paper ${id}`,
    titleZh: null,
    year: '2024',
    publication: null,
    doi: null,
    url: null,
    abstractText: null,
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
    categoryIds: [],
    attachments: [],
    ragEnabled: true,
    ...patch,
  } as LiteraturePaper;
}

function item(id: string): WorkspaceItem {
  const workspaceId = `native-library:${id}`;
  return {
    itemKey: id,
    title: `Paper ${id}`,
    creators: 'Author',
    year: '2024',
    itemType: 'pdf',
    localPdfPath: `C:/papers/${id}.pdf`,
    source: 'native-library',
    workspaceId,
    groupKey: workspaceId,
    ragEnabled: true,
  } as WorkspaceItem;
}

function blocks(text: string): PositionedMineruBlock[] {
  return [{
    type: 'paragraph',
    blockId: `${text}-block`,
    pageIndex: 0,
    blockIndex: 0,
    content: { paragraph_content: [{ type: 'text', content: text }] },
  } as PositionedMineruBlock];
}

function deps(overrides: Partial<Parameters<typeof loadScopedRagDocuments>[0]['deps']> = {}) {
  return {
    createItem: (entry: LiteraturePaper) => item(entry.id),
    loadLibraryPreviewBlocks: async (entry: WorkspaceItem) => ({ blocks: blocks(entry.itemKey) }),
    readLocalBinaryFile: async () => new Uint8Array(),
    extractPdfTextByPdfJs: async () => '',
    buildMineruMarkdownDocument: (value: PositionedMineruBlock[]) => value[0]?.blockId ?? '',
    ...overrides,
  };
}

test('library items include papers without a PDF so exclusion and title mapping still work', () => {
  const items = buildScopedRagLibraryItems(
    [paper('a'), paper('b', { ragEnabled: false })],
    (entry) => (entry.id === 'a' ? item('a') : null),
  );

  assert.equal(items.length, 2);
  assert.equal(items[0].itemKey, 'a');
  assert.equal(items[1].itemKey, 'b');
  assert.equal(items[1].workspaceId, 'native-library:b');
  assert.equal(items[1].ragEnabled, false);
});

test('selected scope reuses the current document and caches other papers', async () => {
  const current: ScopedRagDocument = {
    item: item('a'),
    mineruBlocks: blocks('a'),
    mineruDocumentText: 'a',
    pdfDocumentText: '',
  };
  const cache = new Map<string, ScopedRagDocument>();
  let loads = 0;
  const loader = deps({
    loadLibraryPreviewBlocks: async (entry) => {
      loads += 1;
      return { blocks: blocks(entry.itemKey) };
    },
  });

  const first = await loadScopedRagDocuments({
    papers: [paper('a'), paper('b')],
    paperIds: ['a', 'b'],
    currentDocument: current,
    ragSourceMode: 'mineru-markdown',
    cache,
    deps: loader,
  });

  assert.equal(first.documents.length, 2);
  assert.equal(first.documents[0], current);
  assert.equal(first.documents[1].mineruDocumentText, 'b-block');
  assert.equal(loads, 1);
  assert.equal(cache.size, 1);

  const second = await loadScopedRagDocuments({
    papers: [paper('a'), paper('b')],
    paperIds: ['a', 'b'],
    currentDocument: current,
    ragSourceMode: 'mineru-markdown',
    cache,
    deps: loader,
  });

  assert.equal(second.documents.length, 2);
  assert.equal(loads, 1);
});

test('missing records and papers without a PDF are reported as skipped', async () => {
  const result = await loadScopedRagDocuments({
    papers: [paper('a')],
    paperIds: ['a', 'ghost'],
    ragSourceMode: 'mineru-markdown',
    deps: deps({ createItem: () => null }),
  });

  assert.deepEqual(result.missing.map((entry) => entry.paperId), ['a', 'ghost']);
  assert.equal(result.missing[0].reason, 'missing');
  assert.equal(result.missing[1].title, 'ghost');
  assert.equal(result.documents.length, 0);
});

test('PDF text is extracted only when the RAG source mode includes pdf-text', async () => {
  let pdfReads = 0;
  const loader = deps({
    readLocalBinaryFile: async () => {
      pdfReads += 1;
      return new Uint8Array([1, 2, 3]);
    },
    extractPdfTextByPdfJs: async () => 'pdf body',
  });

  const mineruOnly = await loadScopedRagDocuments({
    papers: [paper('a')],
    paperIds: ['a'],
    ragSourceMode: 'mineru-markdown',
    deps: loader,
  });
  assert.equal(mineruOnly.documents[0].pdfDocumentText, '');
  assert.equal(pdfReads, 0);

  const hybrid = await loadScopedRagDocuments({
    papers: [paper('a')],
    paperIds: ['a'],
    ragSourceMode: 'hybrid',
    deps: loader,
  });
  assert.equal(hybrid.documents[0].pdfDocumentText, 'pdf body');
  assert.equal(pdfReads, 1);
});

test('an aborted load rejects with AbortError before reading more papers', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => loadScopedRagDocuments({
      papers: [paper('a')],
      paperIds: ['a'],
      ragSourceMode: 'mineru-markdown',
      signal: controller.signal,
      deps: deps(),
    }),
    (error: unknown) => (error as Error).name === 'AbortError',
  );
});

test('scoped failure messages carry the state and skipped paper titles', () => {
  const l = (zh: string) => zh;
  const indexing = describeScopedRagFailure({
    resolution: { kind: 'indexing' },
    skippedDocuments: [{ paperId: 'b', title: 'Paper b', reason: 'indexing' }],
  }, l);
  assert.match(indexing, /已就绪索引/);
  assert.match(indexing, /Paper b/);

  const failed = describeScopedRagFailure({
    resolution: { kind: 'failed', errorMessage: 'boom' },
    skippedDocuments: [],
  }, l);
  assert.match(failed, /boom/);

  const excluded = describeScopedRagFailure({
    resolution: { kind: 'excluded' },
    skippedDocuments: [],
  }, l);
  assert.match(excluded, /移出本地知识库/);
});
