import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');

function createStore() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-notes-folder-versions-test-'));
  const store = createNoteStore({
    dataDir,
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
  });
  return { dataDir, store };
}

test('deleteFolder requires expectedFolderVersions to cover every removed folder', () => {
  const { dataDir, store } = createStore();
  try {
    const root = store.createFolder({ name: 'Root' });
    const child = store.createFolder({ name: 'Child', parentId: root.id });
    const note = store.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: 'Folder note',
      content: 'body',
      folderId: child.id,
    });

    // 只带目标文件夹版本、遗漏子文件夹：整批拒绝，不能部分删除。
    assert.throws(
      () => store.deleteFolder({
        id: root.id,
        expectedFolderVersions: { [root.id]: root.updatedAt },
      }),
      (error: any) => error?.code === 'NOTE_CONFLICT',
    );
    assert.equal(store.listFolders().length, 2, 'partial map must not delete anything');
    assert.equal(store.getNote({ id: note.id }).folderId, child.id);

    // 版本不一致同样拒绝。
    assert.throws(
      () => store.deleteFolder({
        id: root.id,
        expectedFolderVersions: { [root.id]: root.updatedAt, [child.id]: child.updatedAt + 1 },
      }),
      (error: any) => error?.code === 'NOTE_CONFLICT',
    );

    const result = store.deleteFolder({
      id: root.id,
      expectedFolderVersions: { [root.id]: root.updatedAt, [child.id]: child.updatedAt },
    });
    assert.deepEqual([...result.deletedFolderIds].sort(), [root.id, child.id].sort());
    assert.deepEqual(result.affectedNoteIds, [note.id]);
    assert.equal(store.getNote({ id: note.id }).folderId, null);
    assert.equal(store.listFolders().length, 0);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('deleteFolder without a version map keeps desktop compatibility', () => {
  const { dataDir, store } = createStore();
  try {
    const root = store.createFolder({ name: 'Root' });
    const child = store.createFolder({ name: 'Child', parentId: root.id });

    const result = store.deleteFolder({ id: root.id });
    assert.equal(result.deletedFolderIds.length, 2);
    assert.deepEqual([...result.deletedFolderIds].sort(), [root.id, child.id].sort());
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
