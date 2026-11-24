import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('reading progress refreshes the list by id with a generation guard', () => {
  const catalog = read('src/features/literature/hooks/useLibraryCatalog.ts');
  const refreshHook = read('src/features/literature/useLibraryQueryRefresh.ts');

  assert.equal(catalog.includes('handleReadingUpdated'), true);
  assert.equal(catalog.includes('getLibraryPaperSummary(paperId)'), true);
  assert.equal(catalog.includes('papersQueryGenerationRef.current'), true);
  assert.equal(catalog.includes('mergePaperListSummary'), true);
  assert.equal(refreshHook.includes('LIBRARY_READING_UPDATED_EVENT'), true);
  assert.equal(refreshHook.includes('handleReadingUpdated?.(detail)'), true);
  const updateEventsBlock = refreshHook.slice(
    refreshHook.indexOf('const UPDATE_EVENTS'),
    refreshHook.indexOf('];', refreshHook.indexOf('const UPDATE_EVENTS')),
  );
  assert.equal(
    updateEventsBlock.includes('LIBRARY_READING_UPDATED_EVENT'),
    false,
    'reading events must not be in the blanket full-refresh event list',
  );

  // 阅读事件只在筛选/排序依赖阅读状态时才全量重查。
  assert.equal(catalog.includes('filters.readStatus || filters.recentlyRead'), true);
  assert.equal(catalog.includes("paperSort.sortBy === 'lastReadAt'"), true);
});

test('batch operations call one transactional command instead of per-paper IPC', () => {
  const source = read('src/features/literature/hooks/useBatchOperations.ts');

  assert.equal(source.includes('batchUpdateLibraryPapers({ paperIds, isFavorite: favorite })'), true);
  assert.equal(source.includes('batchUpdateLibraryPapers({ paperIds, addCategoryId: categoryId })'), true);
  assert.equal(source.includes('batchDeleteLibraryPapers({ paperIds, deleteFiles })'), true);
  assert.equal(source.includes('for (const paperId of paperIds)'), false);
  assert.equal(source.includes('await updateLibraryPaper({ paperId, isFavorite'), false);
  assert.equal(source.includes('await assignPaperToLibraryCategory({ paperId, categoryId })'), false);
});

test('select-all enumerates ids once and batch delete does not hydrate every paper', () => {
  const selection = read('src/features/literature/hooks/usePaperSelection.ts');
  const commands = read('electron/backend/libraryCommands.cjs');

  assert.equal(selection.includes('listAllLibraryPaperIds'), true);
  assert.equal(selection.includes('for (const paperId of'), false);
  assert.equal(commands.includes('store.applyPaperChanges'), true);
  assert.equal(commands.includes('store.deletePapers(paperIds)'), true);
  assert.equal(commands.includes('for (const paperId of paperIds) {\n        try {'), false);
});
