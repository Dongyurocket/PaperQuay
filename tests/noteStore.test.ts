import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');

function createStore() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-notes-store-test-'));
  const store = createNoteStore({
    dataDir,
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
  });

  return { dataDir, store };
}

test('anchors keep blockId/pageIndex across a save and reload', () => {
  const { dataDir, store } = createStore();

  try {
    const created = store.createNote({
      paperId: 'native-library:paper-1',
      type: 'standalone',
      title: '飞机设计的三个阶段',
      content: '正文',
      anchors: [
        {
          id: 'note-polish:paper-1:mineru:page-20-block-3:0',
          paperId: 'paper-1',
          label: 'P20',
          sourceTitle: '民用飞机总体设计',
          excerpt: '飞机这样一个复杂的工程系统的设计过程是一个不断迭代的过程',
          source: 'blocks',
          blockId: 'page-20-block-3',
          pageIndex: 19,
          createdAt: 1,
        },
      ],
    });

    assert.equal(created.anchors.length, 1);
    assert.equal(created.anchors[0].blockId, 'page-20-block-3');
    assert.equal(created.anchors[0].pageIndex, 19);

    // 读回来仍要带上位置，否则引用芯片只能打开文献、无法定位。
    const reloaded = store.getNote({ id: created.id });
    assert.equal(reloaded.anchors.length, 1);
    assert.equal(reloaded.anchors[0].blockId, 'page-20-block-3');
    assert.equal(reloaded.anchors[0].pageIndex, 19);
    assert.equal(reloaded.anchors[0].label, 'P20');
    assert.equal(reloaded.anchors[0].source, 'blocks');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('anchors keep pdfLocation and normalize invalid position fields', () => {
  const { dataDir, store } = createStore();

  try {
    const created = store.createNote({
      paperId: 'native-library:paper-1',
      type: 'highlight',
      title: 'Note',
      content: '',
      anchors: [
        {
          id: 'anchor-pdf',
          paperId: 'paper-1',
          label: 'P8',
          excerpt: 'quoted',
          source: 'pdf',
          blockId: '   ',
          pageIndex: -3,
          pdfLocation: { pageNumber: 8, bbox: [1, 2, 3, 4], bboxCoordinateSystem: 'pdf' },
          createdAt: 1,
        },
      ],
    });

    const [storedAnchor] = created.anchors;
    assert.equal(storedAnchor.blockId, undefined);
    assert.equal(storedAnchor.pageIndex, undefined);
    assert.equal(storedAnchor.pdfLocation.pageNumber, 8);
    assert.deepEqual(storedAnchor.pdfLocation.bbox, [1, 2, 3, 4]);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('note folders support create/list/rename and cascade delete moves notes to uncategorized', () => {
  const { dataDir, store } = createStore();

  try {
    const parent = store.createFolder({ name: '论文笔记' });
    const child = store.createFolder({ name: '深度模型', parentId: parent.id });

    let folders = store.listFolders();
    assert.equal(folders.length, 2);
    assert.equal(folders[0].id, parent.id);
    assert.equal(folders[0].sortOrder, 1);
    assert.equal(folders[1].parentId, parent.id);

    const note = store.createNote({
      paperId: 'native-library:paper-1',
      type: 'standalone',
      title: '子文件夹里的笔记',
      content: '正文',
      folderId: child.id,
    });
    assert.equal(note.folderId, child.id);

    const renamed = store.renameFolder({ id: parent.id, name: '读论文' });
    assert.equal(renamed.name, '读论文');

    const { deletedFolderIds } = store.deleteFolder({ id: parent.id });
    assert.deepEqual(new Set(deletedFolderIds), new Set([parent.id, child.id]));

    folders = store.listFolders();
    assert.equal(folders.length, 0);

    // 笔记不被删除，而是归入未分类。
    const reloaded = store.getNote({ id: note.id });
    assert.equal(reloaded.folderId, null);

    assert.throws(() => store.createFolder({ name: '' }), /folder name is required/);
    assert.throws(
      () => store.createFolder({ name: '孤儿', parentId: 'missing-folder' }),
      /Parent folder does not exist/,
    );
    assert.throws(() => store.deleteFolder({ id: 'missing-folder' }), /Folder does not exist/);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('note folders can be created with an explicit id for localStorage migration', () => {
  const { dataDir, store } = createStore();

  try {
    const migrated = store.createFolder({ id: 'note-folder-legacy-1', name: '迁移来的' });
    assert.equal(migrated.id, 'note-folder-legacy-1');

    // 迁移后新建文件夹走自动生成的 id，不与迁移 id 冲突。
    const fresh = store.createFolder({ name: '新建的' });
    assert.notEqual(fresh.id, 'note-folder-legacy-1');
    assert.ok(fresh.id);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('page_kind migrates legacy source types once and remains idempotent', () => {
  const { dataDir, store } = createStore();

  try {
    const highlight = store.createNote({ type: 'highlight', title: '摘录', content: '' });
    const chat = store.createNote({ type: 'ai-chat', title: '问答', content: '' });
    const area = store.createNote({ type: 'area', title: '区域', content: '' });
    const standalone = store.createNote({ type: 'standalone', title: '独立', content: '' });
    store.close();

    const db = new DatabaseSync(path.join(dataDir, 'paperquay-notes.sqlite'));
    db.prepare('UPDATE notes SET page_kind = NULL').run();
    db.close();

    const reopened = createNoteStore({
      dataDir,
      notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    });
    assert.equal(reopened.getNote({ id: highlight.id }).pageKind, 'excerpt');
    assert.equal(reopened.getNote({ id: chat.id }).pageKind, 'qa');
    assert.equal(reopened.getNote({ id: area.id }).pageKind, null);
    assert.equal(reopened.getNote({ id: standalone.id }).pageKind, null);
    reopened.close();

    const reopenedAgain = createNoteStore({
      dataDir,
      notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    });
    assert.equal(reopenedAgain.getNote({ id: highlight.id }).pageKind, 'excerpt');
    assert.equal(reopenedAgain.getNote({ id: chat.id }).pageKind, 'qa');
    assert.equal(reopenedAgain.listNotes({ pageKind: 'excerpt' }).length, 1);
    reopenedAgain.close();
  } finally {
    try { store.close(); } catch {}
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('page_kind validates values and filters listNotes', () => {
  const { dataDir, store } = createStore();

  try {
    const concept = store.createNote({ title: '概念', content: '', pageKind: 'concept' });
    store.createNote({ title: '日志', content: '', pageKind: 'log' });
    store.createNote({ title: '无类型', content: '' });

    assert.equal(store.getNote({ id: concept.id }).pageKind, 'concept');
    assert.deepEqual(store.listNotes({ pageKind: 'concept' }).map((note: any) => note.id), [concept.id]);
    assert.throws(
      () => store.createNote({ title: '非法', content: '', pageKind: 'not-a-kind' }),
      /Unsupported note page kind/,
    );
    assert.throws(
      () => store.updateNote({ id: concept.id, patch: { pageKind: 'not-a-kind' } }),
      /Unsupported note page kind/,
    );
    assert.throws(
      () => store.listNotes({ pageKind: 'not-a-kind' }),
      /Unsupported note page kind/,
    );
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('wiki links remain ID-stable across target renames and re-saves', () => {
  const { dataDir, store } = createStore();

  try {
    const target = store.createNote({ title: '原标题', content: '' });
    const source = store.createNote({
      title: '引用方',
      content: '',
      contentText: '[[原标题]]',
      contentJson: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'wikiLink', attrs: { noteId: target.id, id: target.id, label: '原标题' } }],
        }],
      },
    });

    store.updateNote({ id: target.id, patch: { title: '新标题' } });
    const resaved = store.updateNote({
      id: source.id,
      patch: { content: '[[原标题]]', contentText: '[[原标题]]', contentJson: source.contentJson },
    });

    assert.deepEqual(resaved.linkedNoteIds, [target.id]);
    assert.equal(store.getNote({ id: target.id }).title, '新标题');
    assert.equal(store.listBacklinks({ noteId: target.id })[0].sourceNoteId, source.id);

    store.updateNote({ id: target.id, patch: { title: '循环标题' } });
    store.updateNote({ id: target.id, patch: { title: '新标题' } });
    const afterCycle = store.getNote({ id: source.id });
    assert.deepEqual(afterCycle.linkedNoteIds, [target.id]);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
