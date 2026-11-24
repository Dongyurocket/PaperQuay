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
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-notes-fts-test-'));
  const databasePath = path.join(dataDir, 'paperquay-notes.sqlite');
  const store = createNoteStore({ dataDir, notesDatabasePath: databasePath });
  return { dataDir, databasePath, store };
}

function cleanup(dataDir: string) {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`cleanup skipped for ${dataDir}: ${(error as any)?.code ?? error}`);
  }
}

test('keyword search falls back to LIKE when FTS returns zero rows', () => {
  const { dataDir, databasePath, store } = createStore();
  try {
    const note = store.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '可检索标题',
      content: '正文包含独特关键词',
    });

    // 模拟旧库/迁移后 FTS 行缺失：FTS 查询为 0 行，但正文仍然存在。
    const db = new DatabaseSync(databasePath);
    db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(note.id);
    db.close();

    const result = store.searchNotes({ query: '独特关键词' });
    assert.equal(result.channel, 'like', 'zero FTS rows must fall back to LIKE');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, note.id);
  } finally {
    store.close();
    cleanup(dataDir);
  }
});

test('opening an old notes database backfills missing FTS rows', () => {
  const { dataDir, databasePath, store } = createStore();
  let reopened: any = null;
  try {
    const note = store.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '迁移后的笔记',
      content: '旧库没有全文索引',
    });
    store.close();

    // 模拟 FTS 表存在但内容为空的旧库。
    const db = new DatabaseSync(databasePath);
    db.prepare('DELETE FROM notes_fts').run();
    db.close();

    reopened = createNoteStore({ dataDir, notesDatabasePath: databasePath });
    const result = reopened.searchNotes({ query: '全文索引' });
    assert.equal(result.channel, 'fts', 'startup migration must rebuild notes_fts');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, note.id);
  } finally {
    reopened?.close();
    if (store) store.close();
    cleanup(dataDir);
  }
});

test('FTS backfill excludes soft-deleted notes and repairs stale extra rows', () => {
  const { dataDir, databasePath, store } = createStore();
  let reopened: any = null;
  try {
    const kept = store.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '保留的笔记',
      content: '保留内容',
    });
    const removed = store.createNote({
      paperId: 'global-notes',
      type: 'standalone',
      title: '删除的笔记',
      content: '删除内容',
    });
    store.deleteNote({ id: removed.id });
    store.close();

    const db = new DatabaseSync(databasePath);
    db.prepare('DELETE FROM notes_fts').run();
    // 软删除笔记的残留 FTS 行不应在重建后复活。
    db.prepare('INSERT INTO notes_fts (note_id, title, content_text, excerpt) VALUES (?, ?, ?, ?)')
      .run(removed.id, '删除的笔记', '删除内容', '');
    db.close();

    reopened = createNoteStore({ dataDir, notesDatabasePath: databasePath });
    const count = reopened.searchNotes({ query: '删除内容' });
    assert.equal(count.rows.length, 0, 'soft-deleted note must stay out of the index');
    const keptResult = reopened.searchNotes({ query: '保留内容' });
    assert.equal(keptResult.rows.length, 1);
    assert.equal(keptResult.rows[0].id, kept.id);
  } finally {
    reopened?.close();
    if (store) store.close();
    cleanup(dataDir);
  }
});
