import assert from 'node:assert/strict';
import test from 'node:test';
import type { Note } from '../src/types/notes.ts';
import {
  buildBatchNotePatches,
  buildBatchTagPatches,
  compareNotes,
  normalizeVaultAutoSyncInterval,
  shouldRunVaultAutoSync,
  sortNotes,
} from '../src/features/notes/notesQuickWins.ts';

function note(overrides: Partial<Note>): Note {
  return {
    id: 'note-1',
    paperId: 'global-notes',
    type: 'standalone',
    pageKind: null,
    title: '未命名',
    content: '',
    aiChatMessageIds: [],
    anchors: [],
    tags: [],
    color: '',
    createdAt: 100,
    updatedAt: 200,
    linkedNoteIds: [],
    linkedPaperIds: [],
    ...overrides,
  };
}

test('笔记列表排序按选项工作，并用稳定次序消除并列', () => {
  const notes = [
    note({ id: 'b', title: '同名', createdAt: 100, updatedAt: 300 }),
    note({ id: 'a', title: '同名', createdAt: 100, updatedAt: 300 }),
    note({ id: 'c', title: '更早', createdAt: 500, updatedAt: 100 }),
  ];

  assert.deepEqual(sortNotes(notes, 'updatedAt').map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(sortNotes(notes, 'createdAt').map((item) => item.id), ['c', 'a', 'b']);
  assert.equal(compareNotes(notes[0], notes[1], 'title'), 1);
});

test('批量标签保留已有标签并去重，批量文件夹只组装元数据 patch', () => {
  const notes = [
    note({ id: 'n1', tags: ['既有'] }),
    note({ id: 'n2', tags: [] }),
  ];

  assert.deepEqual(buildBatchTagPatches(notes, ['n1', 'n2'], '既有'), [
    { noteId: 'n1', patch: { tags: ['既有'] } },
    { noteId: 'n2', patch: { tags: ['既有'] } },
  ]);
  assert.deepEqual(buildBatchNotePatches(['n1', 'n1', 'n2'], { folderId: 'folder-1' }), [
    { noteId: 'n1', patch: { folderId: 'folder-1' } },
    { noteId: 'n2', patch: { folderId: 'folder-1' } },
  ]);
});

test('Vault 自动同步间隔归一化到 15-60 分钟', () => {
  assert.equal(normalizeVaultAutoSyncInterval(10), 15);
  assert.equal(normalizeVaultAutoSyncInterval(45.9), 45);
  assert.equal(normalizeVaultAutoSyncInterval(90), 60);
  assert.equal(normalizeVaultAutoSyncInterval('bad'), 30);
  assert.equal(shouldRunVaultAutoSync({ now: 60_000, lastRunAt: null, intervalMinutes: 30 }), true);
  assert.equal(shouldRunVaultAutoSync({ now: 1_799_999, lastRunAt: 0, intervalMinutes: 30 }), false);
  assert.equal(shouldRunVaultAutoSync({ now: 1_800_000, lastRunAt: 0, intervalMinutes: 30 }), true);
});
