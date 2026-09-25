import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');

// Windows 上杀毒/索引软件可能短暂持有临时目录句柄（与 tests/knowledgeMcpWrite.test.ts 一致）。
function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function setup(isAppRunning: () => boolean | null = () => false) {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-notes-test-'));
  const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning });
  return { dir, service };
}

test('create_note 创建笔记并自动抽取标签与 wiki 双链', () => {
  const { dir, service } = setup();
  try {
    // 先建目标笔记：[[标题]] 双链只在目标笔记已存在时解析成链接。
    const target = service.createNote({ title: 'Attention 机制', content: '目标笔记' });
    const created = service.createNote({
      title: 'KV Cache',
      content: '键值缓存。#llm 参考 [[Attention 机制]]',
      tags: ['#inference', 'llm'],
    });

    assert.ok(created.noteId.startsWith('note_'));
    assert.equal(created.note.title, 'KV Cache');
    assert.equal(created.note.paperId, 'global-notes');
    assert.deepEqual([...created.note.tags].sort(), ['inference', 'llm']);
    assert.deepEqual(created.note.linkedNoteIds, [target.noteId]);
    const stored = service.withWritableNoteStore((store: any) => store.getNote({ id: created.noteId }));
    assert.equal(stored.contentJson.type, 'doc');
    assert.ok(stored.contentJson.content[0].content.some((node: any) => node.type === 'hashTag'));
    assert.ok(stored.contentJson.content[0].content.some((node: any) => node.type === 'wikiLink'));

    // search_notes 只读路径能立刻查到
    const found = service.searchNotes({ query: '键值缓存' });
    assert.equal(found.total, 1);
    assert.equal(found.notes[0].id, created.noteId);
  } finally {
    cleanupDir(dir);
  }
});

test('create_note 拒绝空内容与非法类型', () => {
  const { dir, service } = setup();
  try {
    assert.throws(() => service.createNote({}), /non-empty title or content/);
    assert.throws(() => service.createNote({ title: 'X', type: 'weird' }), /Unsupported note type/);
    assert.throws(() => service.createNote({ title: 'X', pageKind: 'weird' }), /Unsupported note page kind/);
  } finally {
    cleanupDir(dir);
  }
});

test('create_note 的 pageKind 可写入、回读并参与过滤', () => {
  const { dir, service } = setup();
  try {
    const created = service.createNote({ title: '概念页', content: '内容', pageKind: 'concept' });
    assert.equal(created.note.pageKind, 'concept');
    const stored = service.withWritableNoteStore((store: any) => store.getNote({ id: created.noteId }));
    assert.equal(stored.pageKind, 'concept');
    assert.equal(service.searchNotes({ pageKind: 'concept' }).notes[0].id, created.noteId);
    assert.throws(() => service.searchNotes({ pageKind: 'bad-kind' }), /Unsupported note page kind/);
  } finally {
    cleanupDir(dir);
  }
});

test('update_note 局部更新并重建富文本 JSON', () => {
  const { dir, service } = setup();
  try {
    const created = service.createNote({ title: '旧标题', content: '旧正文', tags: ['a'] });
    const updated = service.updateNote({
      noteId: created.noteId,
      title: '新标题',
      content: '新正文 #new',
      tags: ['b'],
    });

    assert.equal(updated.note.title, '新标题');
    assert.equal(updated.note.content, '新正文 #new');
    assert.deepEqual([...updated.note.tags].sort(), ['b', 'new']);
    const stored = service.withWritableNoteStore((store: any) => store.getNote({ id: created.noteId }));
    assert.equal(stored.contentJson.type, 'doc');
    assert.equal(stored.contentJson.content[0].content[1].attrs.tag, 'new');

    // 未提供的字段保持不变——只传 title 不应动正文
    const retitled = service.updateNote({ noteId: created.noteId, title: '再改标题' });
    assert.equal(retitled.note.content, '新正文 #new');

    assert.throws(() => service.updateNote({ noteId: created.noteId }), /at least one of/);
    assert.throws(() => service.updateNote({ noteId: 'note_missing', title: 'X' }), /does not exist/);
  } finally {
    cleanupDir(dir);
  }
});

test('delete_note 软删除并移出 FTS 与搜索', () => {
  const { dir, service } = setup();
  try {
    const created = service.createNote({ title: '待删除', content: '会被删掉' });
    const deleted = service.deleteNote({ noteId: created.noteId });
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.title, '待删除');

    const found = service.searchNotes({ query: '会被删掉' });
    assert.equal(found.total, 0);

    assert.throws(() => service.deleteNote({ noteId: created.noteId }), /does not exist/);
  } finally {
    cleanupDir(dir);
  }
});

test('list_note_tags 聚合标签计数', () => {
  const { dir, service } = setup();
  try {
    service.createNote({ title: 'N1', content: '正文', tags: ['llm', 'agent'] });
    service.createNote({ title: 'N2', content: '正文', tags: ['llm'] });
    const { tags, total } = service.listNoteTags();
    assert.equal(total, 2);
    const llm = tags.find((entry: any) => entry.tag === 'llm');
    assert.equal(llm.count, 2);
  } finally {
    cleanupDir(dir);
  }
});

test('文件夹工具：创建/重命名/移动笔记/级联删除归入未分类', () => {
  const { dir, service } = setup();
  try {
    const parent = service.createNoteFolder({ name: '论文笔记' });
    const child = service.createNoteFolder({ name: '深度模型', parentId: parent.folderId });

    const { folders, total } = service.listNoteFolders();
    assert.equal(total, 2);
    assert.equal(folders.find((f: any) => f.id === child.folderId).parentId, parent.folderId);

    const renamed = service.renameNoteFolder({ folderId: parent.folderId, name: '读论文' });
    assert.equal(renamed.folder.name, '读论文');

    // 笔记创建时进文件夹，之后可移动到未分类
    const note = service.createNote({ title: 'N', content: '正文', folderId: child.folderId });
    assert.equal(note.note.folderId, child.folderId);
    const moved = service.updateNote({ noteId: note.noteId, folderId: '' });
    assert.equal(moved.note.folderId, null);
    const movedBack = service.updateNote({ noteId: note.noteId, folderId: child.folderId });
    assert.equal(movedBack.note.folderId, child.folderId);

    const deleted = service.deleteNoteFolder({ folderId: parent.folderId });
    assert.deepEqual(new Set(deleted.deletedFolderIds), new Set([parent.folderId, child.folderId]));
    assert.equal(service.listNoteFolders().total, 0);
    // 笔记归入未分类而非被删除
    const found = service.searchNotes({ query: '正文' });
    assert.equal(found.total, 1);

    assert.throws(() => service.createNoteFolder({ name: '' }), /non-empty name/);
    assert.throws(
      () => service.createNoteFolder({ name: '孤儿', parentId: 'missing' }),
      /Parent folder does not exist/,
    );
    assert.throws(() => service.deleteNoteFolder({ folderId: 'missing' }), /Folder does not exist/);
  } finally {
    cleanupDir(dir);
  }
});

test('文件夹写工具同样走写护栏', () => {
  const { dir } = setup();
  const guarded = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => true });
  try {
    assert.throws(() => guarded.createNoteFolder({ name: 'X' }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.renameNoteFolder({ folderId: 'f1', name: 'X' }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.deleteNoteFolder({ folderId: 'f1' }), /正在运行，已拒绝写入/);
    const forced = guarded.createNoteFolder({ name: 'X', allowWhileAppRunning: true });
    assert.ok(forced.folderId);
  } finally {
    cleanupDir(dir);
  }
});

test('笔记写工具复用写护栏：运行时拒绝、可覆盖、PAPERQUAY_MCP_WRITE=off 全局只读', () => {
  const { dir } = setup();
  const guarded = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => true });
  try {
    assert.throws(() => guarded.createNote({ title: 'X', content: 'c' }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.updateNote({ noteId: 'note_1', title: 'X' }), /正在运行，已拒绝写入/);
    assert.throws(() => guarded.deleteNote({ noteId: 'note_1' }), /正在运行，已拒绝写入/);

    const forced = guarded.createNote({ title: 'X', content: 'c', allowWhileAppRunning: true });
    assert.ok(forced.noteId.startsWith('note_'));

    process.env.PAPERQUAY_MCP_WRITE = 'off';
    try {
      assert.throws(
        () => guarded.createNote({ title: 'Y', content: 'c', allowWhileAppRunning: true }),
        /PAPERQUAY_MCP_WRITE=off/,
      );
    } finally {
      delete process.env.PAPERQUAY_MCP_WRITE;
    }
  } finally {
    cleanupDir(dir);
  }
});
