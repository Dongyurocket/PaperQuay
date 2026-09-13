import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createFileCommands } = require('../electron/backend/fileCommands.cjs');

function createCommands() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-file-commands-test-'));
  const commands = createFileCommands({
    appPaths: {
      configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
      mineruCacheDir: path.join(dataDir, '.mineru-cache'),
      remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    },
    approvedWritePaths: new Set(),
    store: {},
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
