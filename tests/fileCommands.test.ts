import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createFileCommands } = require('../electron/backend/fileCommands.cjs');

function createCommands(storeLoad = null, approvedWritePaths = new Set()) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-file-commands-test-'));
  const commands = createFileCommands({
    appPaths: {
      dataDir,
      configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
      mineruCacheDir: path.join(dataDir, '.mineru-cache'),
      remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    },
    approvedWritePaths,
    store: {
      load: storeLoad ?? (() => ({
        settings: { storageDir: path.join(dataDir, 'paperquay-data') },
        papers: [],
      })),
    },
  });

  return { commands, dataDir };
}

test('paths_exist resolves to real booleans instead of pending promises', async () => {
  const { commands, dataDir } = createCommands();

  try {
    const existingFile = path.join(dataDir, 'exists.txt');
    const emptyFile = path.join(dataDir, 'empty.txt');
    writeFileSync(existingFile, 'content');
    writeFileSync(emptyFile, '');

    const result = await commands.paths_exist({
      paths: [existingFile, path.join(dataDir, 'missing.txt'), emptyFile, '', 42],
    });

    // 每个元素必须是真正的布尔值：Electron IPC 无法序列化 Promise，
    // 返回未等待的 Promise 数组会让渲染层 invoke 永久悬挂（文献库停在“检测中”）。
    assert.ok(Array.isArray(result));
    assert.deepEqual(result, [true, false, false, false, false]);
    assert.ok(result.every((item) => typeof item === 'boolean'));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('paths_exist rejects non-array payloads', async () => {
  const { commands, dataDir } = createCommands();

  try {
    await assert.rejects(() => commands.paths_exist({ paths: 'not-an-array' }));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('write_text_file writes utf-8 content under the app data directory', async () => {
  const { commands, dataDir } = createCommands();

  try {
    const target = path.join(dataDir, '.mineru-cache', 'document-test', 'translations', 'chinese.json');
    await commands.write_text_file({ path: target, content: '{"translations":{}}' });

    assert.equal(readFileSync(target, 'utf8'), '{"translations":{}}');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('write_text_file recovers from a read-only cache target', async () => {
  const { commands, dataDir } = createCommands();

  try {
    const target = path.join(dataDir, '.mineru-cache', 'document-test', 'translations', 'chinese.json');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'old');
    chmodSync(target, 0o444);

    await commands.write_text_file({ path: target, content: 'new' });

    assert.equal(readFileSync(target, 'utf8'), 'new');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('write_text_file under the app data directory does not depend on the library store', async () => {
  const { commands, dataDir } = createCommands(() => {
    throw new Error('database is locked');
  });

  try {
    const target = path.join(dataDir, '.mineru-cache', 'document-test', 'translations', 'chinese.json');

    await commands.write_text_file({ path: target, content: '{"translations":{}}' });

    assert.equal(readFileSync(target, 'utf8'), '{"translations":{}}');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function createRevealCommands(options: { papers?: unknown[] } = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-reveal-test-'));
  const calls: { showItemInFolder: string[]; openPath: string[] } = { showItemInFolder: [], openPath: [] };
  const commands = createFileCommands({
    appPaths: {
      dataDir,
      configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
      mineruCacheDir: path.join(dataDir, '.mineru-cache'),
      remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    },
    approvedWritePaths: new Set(),
    store: { load: () => ({ settings: { storageDir: path.join(dataDir, 'paperquay-data') }, papers: options.papers ?? [] }) },
    shell: {
      showItemInFolder: (target: string) => { calls.showItemInFolder.push(target); },
      openPath: async (target: string) => { calls.openPath.push(target); return ''; },
    },
  });

  return { commands, dataDir, calls };
}

test('write_text_file under an approved cache path does not depend on the library store', async () => {
  const approvedDir = mkdtempSync(path.join(tmpdir(), 'paperquay-approved-cache-test-'));
  const { commands, dataDir } = createCommands(
    () => {
      throw new Error('database is locked');
    },
    new Set([approvedDir]),
  );

  try {
    const target = path.join(approvedDir, 'document-test', 'translations', 'chinese.json');

    await commands.write_text_file({ path: target, content: '{"translations":{}}' });

    assert.equal(readFileSync(target, 'utf8'), '{"translations":{}}');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(approvedDir, { recursive: true, force: true });
  }
});

test('reveal_path shows files inside library roots in the file manager', async () => {
  const { commands, dataDir, calls } = createRevealCommands();

  try {
    const storageDir = path.join(dataDir, 'paperquay-data');
    mkdirSync(storageDir, { recursive: true });
    const pdfPath = path.join(storageDir, 'paper.pdf');
    writeFileSync(pdfPath, '%PDF');

    assert.deepEqual(await commands.reveal_path({ path: pdfPath }), { ok: true, kind: 'file' });
    assert.deepEqual(calls.showItemInFolder, [path.resolve(pdfPath)]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('reveal_path opens directories such as the MinerU cache folder', async () => {
  const { commands, dataDir, calls } = createRevealCommands();

  try {
    const mineruDir = path.join(dataDir, '.mineru-cache', 'document-abc');
    mkdirSync(mineruDir, { recursive: true });

    assert.deepEqual(await commands.reveal_path({ path: mineruDir }), { ok: true, kind: 'directory' });
    assert.deepEqual(calls.openPath, [path.resolve(mineruDir)]);
    assert.deepEqual(calls.showItemInFolder, []);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('reveal_path reports missing files without touching the shell', async () => {
  const { commands, dataDir, calls } = createRevealCommands();

  try {
    const missing = path.join(dataDir, 'paperquay-data', 'missing.pdf');
    assert.deepEqual(await commands.reveal_path({ path: missing }), { ok: false, reason: 'missing' });
    assert.deepEqual(calls.showItemInFolder, []);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('reveal_path allows the folder of an attachment original path outside library roots', async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-reveal-outside-'));
  const originalPdf = path.join(outsideDir, 'original.pdf');
  writeFileSync(originalPdf, '%PDF');
  writeFileSync(path.join(outsideDir, 'full.md'), '# md');
  const { commands, dataDir, calls } = createRevealCommands({
    papers: [{ id: 'p1', attachments: [{ originalPath: originalPdf, storedPath: path.join(outsideDir, 'stored', 'x.pdf') }] }],
  });

  try {
    assert.deepEqual(await commands.reveal_path({ path: originalPdf }), { ok: true, kind: 'file' });
    // 与原始 PDF 同目录的 MinerU 输出（autoLoadSiblingJson 场景）也可定位。
    assert.deepEqual(await commands.reveal_path({ path: path.join(outsideDir, 'full.md') }), { ok: true, kind: 'file' });
    assert.equal(calls.showItemInFolder.length, 2);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('reveal_path rejects paths outside allowed roots and empty input', async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-reveal-denied-'));
  const outsideFile = path.join(outsideDir, 'secret.txt');
  writeFileSync(outsideFile, 'x');
  const { commands, dataDir, calls } = createRevealCommands();

  try {
    await assert.rejects(() => commands.reveal_path({ path: outsideFile }), /not allowed/);
    // 用 .. 绕出根目录同样被拒绝。
    await assert.rejects(
      () => commands.reveal_path({ path: path.join(dataDir, 'paperquay-data', '..', '..', path.basename(outsideDir), 'secret.txt') }),
      /not allowed/,
    );
    await assert.rejects(() => commands.reveal_path({ path: '' }), /empty/);
    assert.deepEqual(calls.showItemInFolder, []);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});
