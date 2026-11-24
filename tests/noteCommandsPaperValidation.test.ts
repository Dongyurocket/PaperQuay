import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createNoteCommands } = require('../electron/backend/noteCommands.cjs');

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pq-note-commands-paper-'));
  const noteStore = createNoteStore({
    dataDir: dir,
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
  });
  const papers = new Map<string, any>([
    ['paper-1', { id: 'paper-1', title: 'Known Paper', authors: [], year: '2024' }],
  ]);
  const store = {
    getPaper: (paperId: string) => papers.get(paperId) ?? null,
    load: () => ({ papers: [...papers.values()], settings: {} }),
  };
  const captured: any[] = [];
  const wrappedNoteStore = {
    ...noteStore,
    updateNote(request: any) {
      captured.push(request);
      return noteStore.updateNote(request);
    },
  };
  const commands = createNoteCommands({
    noteStore: wrappedNoteStore,
    store,
    noteVault: {
      getSettings: () => ({ dir: '', updatedAtMs: 0 }),
      updateSettings: async (settings: any) => settings,
      syncNow: () => ({}),
      cancelAutoSync: () => false,
    },
  } as any);
  return { dir, noteStore, store, commands, captured, papers };
}

test('notes_create 校验 paper 存在：不存在的 paper 返回 PAPER_NOT_FOUND，global-notes 跳过', () => {
  const { dir, noteStore, commands } = setup();
  try {
    assert.throws(
      () => commands.notes_create({ request: { paperId: 'missing-paper', title: 'bad' } }),
      (error: any) => error.code === 'PAPER_NOT_FOUND'
        && /Paper does not exist: missing-paper/.test(error.message),
    );
    assert.equal(noteStore.listNotes({}).length, 0);

    const globalNote = commands.notes_create({ request: { paperId: 'global-notes', title: 'global' } });
    assert.equal(globalNote.paperId, 'global-notes');

    const paperNote = commands.notes_create({ request: { paperId: 'paper-1', title: 'paper' } });
    assert.equal(paperNote.paperId, 'paper-1');

    // 不传 paperId 时 noteStore 归一化为 global-notes，同样放行。
    assert.equal(commands.notes_create({ request: { title: 'default' } }).paperId, 'global-notes');
  } finally {
    noteStore.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('阅读器 workspaceId 归一化：native-library: 前缀还原为文库主键，standalone: 放行', () => {
  const { dir, noteStore, commands } = setup();
  try {
    // 阅读器标签页的 workspaceId 是 native-library:<paperId>，笔记沿用它。
    const readerNote = commands.notes_create({
      request: { paperId: 'native-library:paper-1', title: '阅读器笔记' },
    });
    assert.equal(readerNote.paperId, 'native-library:paper-1');

    assert.throws(
      () => commands.notes_create({ request: { paperId: 'native-library:missing-paper', title: 'bad' } }),
      (error: any) => error.code === 'PAPER_NOT_FOUND',
    );

    // 独立 PDF 不属于文库，但阅读器笔记是合法目标。
    const standalone = commands.notes_create({
      request: { paperId: 'standalone:C:/docs/论文.pdf', title: '独立 PDF 笔记' },
    });
    assert.equal(standalone.paperId, 'standalone:C:/docs/论文.pdf');
  } finally {
    noteStore.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('notes_update 为 paperId 变更注入 assertPaperExists（noteStore 事务内执行）', () => {
  const { dir, noteStore, commands, captured } = setup();
  try {
    const note = commands.notes_create({ request: { paperId: 'paper-1', title: '可移动' } });
    captured.length = 0;

    assert.throws(
      () => commands.notes_update({ id: note.id, patch: { paperId: 'missing-paper' } }),
      (error: any) => error.code === 'PAPER_NOT_FOUND'
        && /Paper does not exist: missing-paper/.test(error.message),
    );
    assert.equal(captured.length, 1);
    assert.equal(typeof captured[0].assertPaperExists, 'function');
    assert.equal(captured[0].assertPaperExists('missing-paper'), false);
    assert.equal(captured[0].assertPaperExists('paper-1'), true);
    assert.equal(captured[0].assertPaperExists('native-library:paper-1'), true);
    assert.equal(captured[0].assertPaperExists('global-notes'), true);
    assert.equal(captured[0].assertPaperExists('standalone:C:/tmp/a.pdf'), true);
    // 校验失败整体回滚，笔记仍绑定原 paper。
    assert.equal(noteStore.getNote({ id: note.id }).paperId, 'paper-1');

    captured.length = 0;
    commands.notes_update({ id: note.id, patch: { paperId: 'paper-1', title: '合法改名' } });
    assert.equal(typeof captured[0].assertPaperExists, 'function');

    // 普通字段更新也带同一个校验器，保持与 MCP 写路径一致。
    captured.length = 0;
    commands.notes_update({ id: note.id, patch: { title: '改名' } });
    assert.equal(typeof captured[0].assertPaperExists, 'function');
  } finally {
    noteStore.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('notes_create/notes_update 在 store 缺少 getPaper 时视为 paper 不存在（不误放行）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pq-note-commands-paper-'));
  const noteStore = createNoteStore({
    dataDir: dir,
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
  });
  const captured: any[] = [];
  const wrapped = {
    ...noteStore,
    updateNote(request: any) {
      captured.push(request);
      return noteStore.updateNote(request);
    },
  };
  try {
    const commands = createNoteCommands({ noteStore: wrapped, store: {} } as any);
    assert.throws(
      () => commands.notes_create({ request: { paperId: 'paper-1', title: 'bad' } }),
      (error: any) => error.code === 'PAPER_NOT_FOUND',
    );
    const note = commands.notes_create({ request: { paperId: 'global-notes', title: 'ok' } });
    assert.throws(
      () => commands.notes_update({ id: note.id, patch: { paperId: 'paper-1' } }),
      (error: any) => error.code === 'PAPER_NOT_FOUND',
    );
    assert.equal(captured[0].assertPaperExists('paper-1'), false);
    assert.equal(captured[0].assertPaperExists('global-notes'), true);
  } finally {
    noteStore.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
