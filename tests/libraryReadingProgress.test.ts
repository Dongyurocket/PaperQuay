import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryReadingWriter, libraryReadingProgress, nativeLibraryPaperId } from '../src/features/reader/libraryReadingProgress.ts';
import type { WorkspaceItem, PdfScrollPosition } from '../src/types/reader.ts';

const position = (page: number, pageOffsetRatio = 0): PdfScrollPosition => ({
  sourceKey: 'pdf', page, pageOffsetRatio, top: 0, left: 0, pageOffsetTop: 0, updatedAt: 1,
});

test('only native library workspace items are eligible for reading updates', () => {
  const item = { source: 'native-library', itemKey: 'p1', workspaceId: 'native-library:p1' } as WorkspaceItem;
  assert.equal(nativeLibraryPaperId(item), 'p1');
  assert.equal(nativeLibraryPaperId({ ...item, source: 'standalone' }), null);
  assert.equal(nativeLibraryPaperId({ ...item, source: 'zotero-local' }), null);
  assert.equal(nativeLibraryPaperId({ ...item, workspaceId: 'native-library:p2' }), null);
});

test('progress uses the current PDF page count and treats the last page as finished', () => {
  assert.equal(libraryReadingProgress(position(1, 0.5), 4), 0.125);
  assert.equal(libraryReadingProgress(position(3, 0.5), 4), 0.625);
  assert.equal(libraryReadingProgress(position(4), 4), 1);
  assert.equal(libraryReadingProgress(position(1), 1), 1);
  assert.equal(libraryReadingProgress(position(1), 0), null);
  assert.equal(libraryReadingProgress(position(NaN), 4), null);
});

test('reading writer coalesces events and flushes pending updates on close', async () => {
  const writes: Array<{ paperId: string; lastReadAt: number; readingProgress?: number }> = [];
  const writer = createLibraryReadingWriter(async (update) => { writes.push(update); }, 60_000);
  writer.record({ paperId: 'a', lastReadAt: 10, readingProgress: 0.6 });
  writer.record({ paperId: 'a', lastReadAt: 20, readingProgress: 0.3 });
  writer.record({ paperId: 'b', lastReadAt: 15 });
  assert.equal(writes.length, 0);
  writer.flush();
  assert.deepEqual(writes, [
    { paperId: 'a', lastReadAt: 20, readingProgress: 0.6 },
    { paperId: 'b', lastReadAt: 15 },
  ]);
  writer.flush();
  assert.equal(writes.length, 2);
});
