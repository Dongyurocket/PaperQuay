import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibraryFirstScreen, LIBRARY_FIRST_SCREEN_PAGE_SIZE } from '../src/features/literature/libraryFirstScreen.ts';
import type { LibrarySnapshot, ListPapersRequest, QueryPapersResult } from '../src/types/library.ts';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function paper(index: number) {
  return { id: `paper-${index}`, title: `Paper ${index}` } as any;
}

test('first screen loads settings/categories then exactly one paged paper query', async () => {
  const requests: ListPapersRequest[] = [];
  let initializeCalls = 0;
  const snapshot: LibrarySnapshot = {
    settings: { storageDir: '', zoteroLocalDataDir: '', importMode: 'copy' } as any,
    categories: [
      { id: 'cat-all', name: 'All', systemKey: 'all', isSystem: true, parentId: null, sortOrder: 0, createdAt: 1, updatedAt: 1, paperCount: 5000 } as any,
      { id: 'cat-user', name: 'User', systemKey: null, isSystem: false, parentId: null, sortOrder: 0, createdAt: 1, updatedAt: 1, paperCount: 10 } as any,
    ],
  };
  const result = await loadLibraryFirstScreen({
    initialize: async () => {
      initializeCalls += 1;
      return snapshot;
    },
    query: async (request) => {
      requests.push(request);
      const limit = Number(request.limit);
      const offset = Number(request.offset) || 0;
      const papers = Array.from({ length: limit }, (_, index) => paper(offset + index));
      return { papers, total: 5000, offset, limit } satisfies QueryPapersResult;
    },
    buildRequest: (categoryId) => ({
      categoryId,
      search: '',
      sortBy: 'manual',
      sortDirection: 'asc',
    }),
  });

  assert.equal(initializeCalls, 1);
  assert.equal(requests.length, 1, 'first screen must issue exactly one page query');
  assert.equal(requests[0].limit, LIBRARY_FIRST_SCREEN_PAGE_SIZE);
  assert.equal(requests[0].offset, 0);
  assert.equal(requests[0].categoryId, 'cat-all');
  assert.equal(result.categoryId, 'cat-all');
  assert.equal(result.page.papers.length, LIBRARY_FIRST_SCREEN_PAGE_SIZE);
  assert.equal(result.page.total, 5000);
});

test('first screen orchestration never reads a papers snapshot from library_init', () => {
  const source = readFileSync(
    path.join(repoRoot, 'src/features/literature/hooks/useLibraryCatalog.ts'),
    'utf8',
  );
  const helperSource = readFileSync(
    path.join(repoRoot, 'src/features/literature/libraryFirstScreen.ts'),
    'utf8',
  );

  assert.equal(source.includes('snapshot.papers'), false);
  assert.equal(source.includes('setPapers(snapshot'), false);
  assert.equal(helperSource.includes('snapshot.papers'), false);
  assert.equal(source.includes('loadLibraryFirstScreen'), true);
});
