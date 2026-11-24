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

test('listNotes and listAllNotes use id as a deterministic tiebreaker', () => {
  const { dataDir, store } = createStore();

  try {
    for (const id of ['note-c', 'note-a', 'note-b']) {
      store.createNote({ id, title: id, content: id });
    }

    // 强制三条笔记的排序键完全相同；没有 id tiebreaker 时 SQLite 会按 rowid 返回。
    const db = new DatabaseSync(path.join(dataDir, 'paperquay-notes.sqlite'));
    try {
      db.prepare('UPDATE notes SET is_pinned = 0, updated_at = 1, created_at = 1').run();
    } finally {
      db.close();
    }

    assert.deepEqual(store.listNotes().map((note: any) => note.id), ['note-a', 'note-b', 'note-c']);
    assert.deepEqual(store.listAllNotes().map((note: any) => note.id), ['note-a', 'note-b', 'note-c']);
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('updateNote validates a changed linkedPaperId like paperId', () => {
  const { dataDir, store } = createStore();

  try {
    const note = store.createNote({ id: 'note-linked', title: 'Linked', content: '' });
    const assertPaperExists = (paperId: string) => paperId === 'paper-1';

    assert.throws(
      () => store.updateNote({
        id: note.id,
        patch: { linkedPaperId: 'missing-paper' },
        assertPaperExists,
      }),
      (error: any) => error?.code === 'PAPER_NOT_FOUND' && /Paper does not exist/.test(error.message),
    );

    const updated = store.updateNote({
      id: note.id,
      patch: { linkedPaperId: 'paper-1' },
      assertPaperExists,
    });
    assert.equal(updated.linkedPaperId, 'paper-1');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('createNote validates linkedPaperId and rolls back when the paper is missing', () => {
  const { dataDir, store } = createStore();

  try {
    const assertPaperExists = (paperId: string) => paperId === 'paper-1';

    // 不存在的 linkedPaperId 与 paperId 同等校验：带 code 拒绝并整体回滚。
    assert.throws(
      () => store.createNote({
        id: 'note-orphan-linked',
        title: '指向不存在文献',
        content: '正文',
        linkedPaperId: 'missing-paper',
        assertPaperExists,
      }),
      (error: any) => error?.code === 'PAPER_NOT_FOUND'
        && /Paper does not exist: missing-paper/.test(error.message),
    );
    assert.equal(store.getNote({ id: 'note-orphan-linked' }), null);
    assert.equal(store.listNotes().length, 0);

    const created = store.createNote({
      id: 'note-valid-linked',
      title: '指向存在的文献',
      content: '正文',
      linkedPaperId: 'paper-1',
      assertPaperExists,
    });
    assert.equal(created.linkedPaperId, 'paper-1');
    assert.equal(store.getNote({ id: 'note-valid-linked' }).linkedPaperId, 'paper-1');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('createNote keeps an empty title instead of persisting a localized sentinel', () => {
  const { dataDir, store } = createStore();

  try {
    const note = store.createNote({ id: 'note-untitled', content: '正文', tags: [] });
    assert.equal(note.title, '');
    assert.equal(store.getNote({ id: 'note-untitled' }).title, '');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('createNote validates linkedPaperId independently when paperId is already valid', () => {
  const { dataDir, store } = createStore();

  try {
    const assertPaperExists = (paperId: string) => paperId === 'paper-1';

    // paperId 合法时，缺省回退不会再拿 linkedPaperId 当 paperId 校验；
    // linkedPaperId 必须被单独校验，否则会落库一条指向不存在文献的关联。
    assert.throws(
      () => store.createNote({
        id: 'note-linked-orphan-with-paper',
        title: '合法文献 + 非法关联',
        content: '正文',
        paperId: 'paper-1',
        linkedPaperId: 'missing-paper',
        assertPaperExists,
      }),
      (error: any) => error?.code === 'PAPER_NOT_FOUND'
        && /^PAPER_NOT_FOUND: /.test(error.message)
        && /Paper does not exist: missing-paper/.test(error.message),
    );
    assert.equal(store.getNote({ id: 'note-linked-orphan-with-paper' }), null);
    assert.equal(store.listNotes().length, 0);

    const created = store.createNote({
      id: 'note-linked-valid-with-paper',
      title: '合法文献 + 合法关联',
      content: '正文',
      paperId: 'paper-1',
      linkedPaperId: 'paper-1',
      assertPaperExists,
    });
    assert.equal(created.paperId, 'paper-1');
    assert.equal(created.linkedPaperId, 'paper-1');
    assert.equal(store.getNote({ id: 'note-linked-valid-with-paper' }).linkedPaperId, 'paper-1');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

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

test('note create/update validate paper and folder targets inside the write transaction', () => {
  const { dataDir, store } = createStore();

  try {
    assert.throws(
      () => store.createNote({ title: '孤儿', content: '', folderId: 'missing-folder' }),
      (error: any) => error.code === 'FOLDER_NOT_FOUND' && /Folder does not exist: missing-folder/.test(error.message),
    );
    assert.throws(
      () => store.createNote({ title: 'MCP 目标', paperId: 'paper-missing', assertPaperExists: () => false }),
      (error: any) => error.code === 'PAPER_NOT_FOUND' && /Paper does not exist: paper-missing/.test(error.message),
    );
    // 校验失败必须整体回滚，不能留下笔记行。
    assert.equal(store.listNotes().length, 0);

    const globalNote = store.createNote({
      title: 'global',
      paperId: 'global-notes',
      assertPaperExists: () => false,
    });
    assert.equal(globalNote.paperId, 'global-notes');

    const paperNote = store.createNote({
      title: 'paper',
      paperId: 'paper-1',
      assertPaperExists: (paperId: string) => paperId === 'paper-1',
    });
    assert.equal(paperNote.paperId, 'paper-1');

    const folder = store.createFolder({ name: 'Folder' });
    const inFolder = store.createNote({ title: 'folder note', content: '', folderId: folder.id });
    assert.equal(inFolder.folderId, folder.id);

    assert.throws(
      () => store.updateNote({ id: paperNote.id, patch: { folderId: 'missing-folder' } }),
      (error: any) => error.code === 'FOLDER_NOT_FOUND',
    );
    assert.equal(store.getNote({ id: paperNote.id }).folderId, null);

    // 历史数据可能已经绑定了不存在的 folder；不改 folder 的更新不应被它阻塞。
    const rawDb = new DatabaseSync(path.join(dataDir, 'paperquay-notes.sqlite'));
    rawDb.prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run('legacy-folder', paperNote.id);
    rawDb.close();
    const updated = store.updateNote({ id: paperNote.id, patch: { title: 'still editable' } });
    assert.equal(updated.title, 'still editable');
  } finally {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
