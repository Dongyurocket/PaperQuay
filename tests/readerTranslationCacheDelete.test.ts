import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createFileCommands } = require('../electron/backend/fileCommands.cjs');

function createCommands() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-delete-text-test-'));
  const commands = createFileCommands({
    appPaths: {
      dataDir,
      configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
      mineruCacheDir: path.join(dataDir, '.mineru-cache'),
      remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    },
    approvedWritePaths: new Set(),
    store: {
      load: () => ({
        settings: { storageDir: path.join(dataDir, 'paperquay-data') },
        papers: [],
      }),
    },
  });

  return { commands, dataDir };
}

test('delete_text_file deletes a translation cache json under the app data directory', async () => {
  const { commands, dataDir } = createCommands();

  try {
    const target = path.join(dataDir, '.mineru-cache', 'document-test', 'translations', 'chinese-abcd1234.json');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '{"translations":{}}');

    assert.equal(await commands.delete_text_file({ path: target }), true);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('delete_text_file treats a missing cache file as already deleted', async () => {
  const { commands, dataDir } = createCommands();

  try {
    const target = path.join(dataDir, '.mineru-cache', 'document-test', 'translations', 'chinese.json');

    assert.equal(await commands.delete_text_file({ path: target }), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('delete_text_file rejects non-json files even inside a writable root', async () => {
  const { commands, dataDir } = createCommands();

  try {
    const target = path.join(dataDir, '.mineru-cache', 'document-test', 'full.md');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '# markdown');

    await assert.rejects(() => commands.delete_text_file({ path: target }), /Only \.json files/);
    assert.equal(existsSync(target), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('delete_text_file rejects paths outside the approved write roots', async () => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-delete-text-outside-'));
  const { commands, dataDir } = createCommands();

  try {
    const outside = path.join(outsideDir, 'chinese.json');
    writeFileSync(outside, '{}');

    await assert.rejects(() => commands.delete_text_file({ path: outside }), /not allowed/);

    // 用 .. 绕出允许目录同样被拒绝。
    await assert.rejects(
      () => commands.delete_text_file({
        path: path.join(dataDir, '.mineru-cache', '..', '..', path.basename(outsideDir), 'chinese.json'),
      }),
      /not allowed/,
    );
    assert.equal(existsSync(outside), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('delete_text_file rejects empty, device and alternate-data-stream paths', async () => {
  const { commands, dataDir } = createCommands();

  try {
    await assert.rejects(() => commands.delete_text_file({ path: '' }), /not allowed/);
    await assert.rejects(() => commands.delete_text_file({}), /not allowed/);

    if (process.platform === 'win32') {
      const adsPath = `${path.join(dataDir, '.mineru-cache', 'chinese.json')}:evil`;
      await assert.rejects(() => commands.delete_text_file({ path: adsPath }), /not allowed/);
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('delete_text_file rejects directories even when their name ends in .json', async () => {
  const { commands, dataDir } = createCommands();

  try {
    const directory = path.join(dataDir, '.mineru-cache', 'translations.json');
    mkdirSync(directory, { recursive: true });

    await assert.rejects(() => commands.delete_text_file({ path: directory }), /regular files/);
    assert.equal(existsSync(directory), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
