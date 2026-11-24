import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Note, NoteFolder } from '../src/types/notes.ts';
import { collectPagedNotes, countNotesInFolderTree } from '../src/features/notes/noteUtils.ts';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createNoteCommands } = require('../electron/backend/noteCommands.cjs');

const UNCATEGORIZED_FOLDER_ID = '__uncategorized__';

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

function folder(id: string, parentId: string | null = null): NoteFolder {
  return { id, name: id, parentId, sortOrder: 0, createdAt: 0, updatedAt: 0 };
}

// 旧实现的参照版本：逐个 folder 调用 filterNotesByFolder。只用于比对新 helper
// 的计数完全一致，避免把实现细节写死进断言。
function legacyDescendantIds(folderId: string, folders: NoteFolder[]) {
  const result: string[] = [];
  const stack = folders.filter((item) => item.parentId === folderId).map((item) => item.id);
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || result.includes(id)) continue;
    result.push(id);
    stack.push(...folders.filter((item) => item.parentId === id).map((item) => item.id));
  }
  return result;
}

function legacyFolderCount(notes: Note[], folders: NoteFolder[], activeFolderId: string) {
  const known = new Set(folders.map((item) => item.id));
  const scope = new Set([activeFolderId, ...legacyDescendantIds(activeFolderId, folders)]);
  return notes.filter((item) => {
    const folderId = item.folderId && known.has(item.folderId) ? item.folderId : null;
    if (activeFolderId === UNCATEGORIZED_FOLDER_ID) return !folderId;
    return Boolean(folderId && scope.has(folderId));
  }).length;
}

test('5000 条笔记的 folder 计数与逐 folder 过滤结果一致（嵌套 + 未知 folder）', () => {
  // a > b > c 三层嵌套，d 是空的独立 folder，另有两条重名但不同父级的子树。
  const folders = [
    folder('a'),
    folder('b', 'a'),
    folder('c', 'b'),
    folder('d'),
    folder('a2'),
    folder('b2', 'a2'),
  ];
  const folderIds = ['a', 'b', 'c', 'a2', 'b2'];
  const notes: Note[] = [];
  let uncategorized = 0;
  for (let index = 0; index < 5000; index += 1) {
    const bucket = index % 7;
    if (bucket === 0) {
      notes.push(note({ id: `note-${index}`, folderId: null }));
      uncategorized += 1;
    } else if (bucket === 1) {
      // 未知 folder：必须和未分类一起计数，不能算进任何真实 folder。
      notes.push(note({ id: `note-${index}`, folderId: `missing-${index % 3}` }));
      uncategorized += 1;
    } else {
      notes.push(note({ id: `note-${index}`, folderId: folderIds[bucket % folderIds.length] }));
    }
  }

  const counts = countNotesInFolderTree(notes, folders);

  assert.equal(counts.uncategorizedCount, uncategorized);
  assert.equal(counts.uncategorizedCount, legacyFolderCount(notes, folders, UNCATEGORIZED_FOLDER_ID));
  for (const item of folders) {
    assert.equal(
      counts.folderCounts.get(item.id),
      legacyFolderCount(notes, folders, item.id),
      `folder ${item.id} 的后代计数应与逐 folder 过滤一致`,
    );
  }
  assert.equal(counts.folderCounts.get('d'), 0);
  // 汇总抽查：c 只包含 c 自身的直接笔记；b 包含 b + c；a 包含 a + b + c。
  const direct = new Map<string, number>();
  for (const item of notes) {
    const folderId = item.folderId && folders.some((entry) => entry.id === item.folderId)
      ? item.folderId
      : null;
    if (folderId) direct.set(folderId, (direct.get(folderId) ?? 0) + 1);
  }
  assert.equal(counts.folderCounts.get('c'), direct.get('c') ?? 0);
  assert.equal(
    counts.folderCounts.get('b'),
    (direct.get('b') ?? 0) + (counts.folderCounts.get('c') ?? 0),
  );
  assert.equal(
    counts.folderCounts.get('a'),
    (direct.get('a') ?? 0) + (counts.folderCounts.get('b') ?? 0),
  );
});

test('collectPagedNotes 按页拉取直到短页，offset 连续且无重复', async () => {
  const pages = [
    Array.from({ length: 100 }, (_, index) => note({ id: `p0-${index}` })),
    Array.from({ length: 100 }, (_, index) => note({ id: `p1-${index}` })),
    Array.from({ length: 100 }, (_, index) => note({ id: `p2-${index}` })),
    Array.from({ length: 100 }, (_, index) => note({ id: `p3-${index}` })),
    Array.from({ length: 40 }, (_, index) => note({ id: `p4-${index}` })),
  ];
  const calls: Array<{ offset: number; limit: number }> = [];
  const snapshots: Note[][] = [];

  const loaded = await collectPagedNotes(async (request) => {
    calls.push(request);
    return pages[calls.length - 1] ?? [];
  }, {
    pageSize: 100,
    onPage: (_page, accumulated) => snapshots.push(accumulated),
  });

  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map((call) => call.offset), [0, 100, 200, 300, 400]);
  assert.ok(calls.every((call) => call.limit === 100));
  assert.equal(loaded.length, 440);
  assert.equal(loaded[0].id, 'p0-0');
  assert.equal(loaded[439].id, 'p4-39');
  // onPage 必须收到不可变的快照：已交给 store 的引用不能被后续页原地改写。
  assert.deepEqual(snapshots.map((snapshot) => snapshot.length), [100, 200, 300, 400, 440]);
  assert.equal(snapshots[0][0].id, 'p0-0');
  assert.equal(snapshots[0].length, 100);
});

test('collectPagedNotes 在整页整数倍时用空页收尾', async () => {
  const calls: Array<{ offset: number; limit: number }> = [];
  const loaded = await collectPagedNotes(async (request) => {
    calls.push(request);
    if (request.offset >= 500) return [];
    return Array.from({ length: 100 }, (_, index) => note({ id: `page-${request.offset}-${index}` }));
  }, { pageSize: 100 });

  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map((call) => call.offset), [0, 100, 200, 300, 400, 500]);
  assert.equal(loaded.length, 500);
});

test('collectPagedNotes 遇到整页重复（服务端忽略 offset）时停止而不是死循环', async () => {
  const calls: Array<{ offset: number; limit: number }> = [];
  const loaded = await collectPagedNotes(async (request) => {
    calls.push(request);
    return Array.from({ length: 100 }, (_, index) => note({ id: `same-${index}` }));
  }, { pageSize: 100 });

  assert.equal(calls.length, 2);
  assert.equal(loaded.length, 100);
});

test('notes_list IPC 支持 offset 分页并返回稳定切片', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pq-note-page-'));
  const noteStore = createNoteStore({
    dataDir: dir,
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
  });
  try {
    for (let index = 0; index < 7; index += 1) {
      noteStore.createNote({ title: `分页笔记 ${index}`, content: `内容 ${index}` });
    }
    const commands = createNoteCommands({ noteStore });
    const all = commands.notes_list({ request: {} });
    assert.equal(all.length, 7);

    const page = commands.notes_list({ request: { offset: 2, limit: 3 } });
    assert.deepEqual(page.map((item: Note) => item.id), all.slice(2, 5).map((item: Note) => item.id));

    const tail = commands.notes_list({ request: { offset: 6, limit: 3 } });
    assert.deepEqual(tail.map((item: Note) => item.id), all.slice(6).map((item: Note) => item.id));

    assert.deepEqual(commands.notes_list({ request: { offset: 99, limit: 3 } }), []);
  } finally {
    noteStore.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
