import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createNoteVault } = require('../electron/backend/noteVault.cjs');
const { createNoteStore } = require('../electron/backend/noteStore.cjs');
const { createNoteCommands } = require('../electron/backend/noteCommands.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function setup(options: { autoSyncEnabled?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-vault-cancel-'));
  const vaultDir = path.join(dir, 'vault');
  const noteStore = createNoteStore({
    dataDir: dir,
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
  });
  const library = { settings: { notesVaultDir: vaultDir }, papers: [] as any[] };
  const store = {
    load: () => library,
    saveSettings: async (settings: any) => {
      library.settings = { ...settings };
    },
  };
  const vault = createNoteVault({ noteStore, store } as any);
  const appSettings = {
    getPublic: () => ({ settings: { notesVaultAutoSyncEnabled: options.autoSyncEnabled !== false } }),
  };
  const commands = createNoteCommands({ noteStore, noteVault: vault, store, appSettings } as any);
  return { dir, vaultDir, noteStore, vault, store, library, commands };
}

function seedNotes(noteStore: any, count: number) {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const note = noteStore.createNote({ title: `取消测试-${String(index).padStart(3, '0')}`, content: `正文 ${index}` });
    ids.push(note.id);
  }
  return ids;
}

test('shouldCancel 在同步驱动前缀也生效：返回 cancelled，且没有创建目录/写 manifest', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    seedNotes(noteStore, 3);
    const stats = vault.syncNow({ shouldCancel: () => true });
    // 显式手动同步的小 vault 仍保持同步返回（兼容直接读属性的旧调用）。
    assert.equal(typeof (stats as any).then, 'undefined');
    assert.equal(stats.cancelled, true);
    assert.equal(stats.exported, 0);
    assert.equal(existsSync(vaultDir), false);
    assert.equal(existsSync(path.join(vaultDir, '.paperquay-vault.json')), false);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('AbortSignal 取消后台同步：返回 cancelled 且不写 manifest', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    seedNotes(noteStore, 3);
    const controller = new AbortController();
    controller.abort();
    const stats = await vault.syncNow({ background: true, signal: controller.signal });
    assert.equal(stats.cancelled, true);
    assert.equal(existsSync(path.join(vaultDir, '.paperquay-vault.json')), false);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('后台模式从异步驱动起步：调用后同步栈内不执行任何文件 IO', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    seedNotes(noteStore, 2);
    const pending = vault.syncNow({ background: true });
    assert.equal(typeof (pending as any).then, 'function');
    // 第一个 mkdir 也必须由异步驱动执行，不能在调用栈内发生。
    assert.equal(existsSync(vaultDir), false);

    const stats = await pending;
    assert.equal(stats.cancelled, false);
    assert.equal(stats.exported, 2);
    assert.equal(stats.created, 0);
    assert.ok(existsSync(path.join(vaultDir, '.paperquay-vault.json')));
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('取消在飞的自动同步：manifest 保持原样、文件不删除，后续同步可恢复', async () => {
  const { dir, vaultDir, noteStore, vault } = setup();
  try {
    seedNotes(noteStore, 60);
    await vault.syncNow();
    const manifestPath = path.join(vaultDir, '.paperquay-vault.json');
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    const filesBefore = readdirSync(vaultDir).filter((name) => name.endsWith('.md')).sort();
    assert.equal(filesBefore.length, 60);

    writeFileSync(path.join(vaultDir, '用户自己的文件.md'), '不该被删除');

    const pending = vault.syncNow({ background: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(vault.cancelAutoSync(), true);
    const stats = await pending;

    assert.equal(stats.cancelled, true);
    assert.equal(readFileSync(manifestPath, 'utf8'), manifestBefore);
    assert.deepEqual(readdirSync(vaultDir).filter((name) => name.endsWith('.md')).sort(), [
      ...filesBefore,
      '用户自己的文件.md',
    ].sort());

    // 取消后再次同步仍能正常完成，manifest 不因中断而损坏。
    const resumed = await vault.syncNow({ background: true });
    assert.equal(resumed.cancelled, false);
    assert.equal(resumed.removed, 0);
    assert.equal(readFileSync(manifestPath, 'utf8').includes('"version": 2'), true);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});

test('notes_vault_update_settings：自动同步关闭时中止在跑的调度器同步，cancel-only 不改设置', async () => {
  const { dir, noteStore, vault, commands, library } = setup({ autoSyncEnabled: false });
  try {
    seedNotes(noteStore, 60);
    const savedBefore = JSON.stringify(library.settings);

    const pending = vault.syncNow({ background: true });
    await new Promise((resolve) => setImmediate(resolve));

    // 只发取消请求：不写 dir、不刷新 updatedAtMs。
    const settings = await commands.notes_vault_update_settings({ settings: { cancelAutoSync: true } });
    assert.equal(settings.dir, library.settings.notesVaultDir);

    const stats = await pending;
    assert.equal(stats.cancelled, true);
    assert.equal(JSON.stringify(library.settings), savedBefore);

    // 带 dir 的设置更新在自动同步关闭时同样会取消在跑的自动同步。
    const nextPending = vault.syncNow({ background: true });
    await new Promise((resolve) => setImmediate(resolve));
    await commands.notes_vault_update_settings({ settings: { dir: library.settings.notesVaultDir } });
    assert.equal((await nextPending).cancelled, true);
  } finally {
    noteStore.close();
    cleanupDir(dir);
  }
});
