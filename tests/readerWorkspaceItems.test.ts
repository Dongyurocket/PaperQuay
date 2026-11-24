import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(
  path.join(repoRoot, 'src/features/reader/Reader.tsx'),
  'utf8',
);

test('Reader resolves workspace items on demand instead of loading the full library', () => {
  assert.equal(source.includes('allLibraryPapers'), false);
  assert.equal(source.includes('libraryWorkspaceItems'), false);
  assert.equal(source.includes('setPapers(snapshot.papers)'), false);

  // 持久化标签页按 id 单条查询。
  assert.equal(source.includes('workspaceId.slice(\'native-library:\'.length)'), true);
  assert.equal(source.includes('getLibraryPaper(paperId)'), true);

  // 全库候选只在助手侧栏打开后按需加载，不再挂载时拉取。
  assert.equal(source.includes('showReaderAssistantSidebar || notePaperCandidatesRequestedRef.current'), true);
  assert.equal(source.includes('listAllLibraryPapers({ sortBy: \'updatedAt\', sortDirection: \'desc\' })'), true);

  // 概览使用按需缓存，而不是全库数组查找。
  assert.equal(source.includes('resolvedLibraryPapers[item.itemKey]'), true);
  assert.equal(source.includes('overviewPaper={item.source'), true);
});

test('Reader no longer forwards a full-library callback from the library view', () => {
  assert.equal(source.includes('onAllPapersChange={setAllLibraryPapers}'), false);
  assert.equal(source.includes('onOpenPaper={handleOpenLibraryPaperFromShelf}'), true);
});
