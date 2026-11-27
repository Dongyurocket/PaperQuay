import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseEditFilePath,
  readMineruParseEdits,
  sanitizeParseEdits,
  writeMineruParseEdits,
} = require('../electron/backend/parseEditCommands.cjs');

async function withDataDir(run) {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-parse-edits-'));
  const appPaths = { dataDir };

  try {
    await run(appPaths);
  } finally {
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
}

const hash = 'a'.repeat(16);

test('parse edits round-trip through the app data store', async () => {
  await withDataDir(async (appPaths) => {
    const parsePath = 'C:\\cache\\document-demo';
    const written = await writeMineruParseEdits(appPaths, parsePath, {
      'page-1-block-1': { hash, text: 'Corrected text' },
      'page-2-block-3': { hash, deleted: true },
    });

    assert.equal(written.saved, true);
    assert.equal(written.count, 2);

    const file = await readMineruParseEdits(appPaths, parsePath);
    assert.equal(file.version, 1);
    assert.deepEqual(file.blocks, {
      'page-1-block-1': { hash, text: 'Corrected text' },
      'page-2-block-3': { hash, deleted: true },
    });
    assert.ok(Number.isFinite(Date.parse(file.updatedAt)));
  });
});

test('empty edit table removes the stored file', async () => {
  await withDataDir(async (appPaths) => {
    const parsePath = 'D:\\papers\\demo';
    await writeMineruParseEdits(appPaths, parsePath, {
      'page-1-block-1': { hash, text: 'x' },
    });

    const filePath = parseEditFilePath(appPaths, parsePath);
    await fsp.stat(filePath);

    const cleared = await writeMineruParseEdits(appPaths, parsePath, {});
    assert.equal(cleared.count, 0);
    await assert.rejects(fsp.stat(filePath), /ENOENT/);

    const empty = await readMineruParseEdits(appPaths, parsePath);
    assert.deepEqual(empty.blocks, {});
  });
});

test('different parse paths use independent edit files', async () => {
  await withDataDir(async (appPaths) => {
    await writeMineruParseEdits(appPaths, 'C:\\cache\\a', {
      'page-1-block-1': { hash, text: 'A' },
    });
    await writeMineruParseEdits(appPaths, 'C:\\cache\\b', {
      'page-1-block-1': { hash, text: 'B' },
    });

    assert.notEqual(
      parseEditFilePath(appPaths, 'C:\\cache\\a'),
      parseEditFilePath(appPaths, 'C:\\cache\\b'),
    );
    assert.equal(
      (await readMineruParseEdits(appPaths, 'C:\\cache\\a')).blocks['page-1-block-1'].text,
      'A',
    );
  });
});

test('sanitizeParseEdits drops unknown fields and invalid records', () => {
  const { blocks, dropped } = sanitizeParseEdits({
    'page-1-block-1': { hash, text: 'ok', extra: 'ignored' },
    'page-1-block-2': { hash: 'nope', text: 'bad hash' },
    'page-1-block-3': { hash, text: 42 },
    'bad-id': { hash, text: 'bad id' },
  });

  assert.deepEqual(blocks, { 'page-1-block-1': { hash, text: 'ok' } });
  assert.deepEqual(dropped.sort(), ['bad-id', 'page-1-block-2', 'page-1-block-3']);
});

test('corrupt or unsupported edit files fail instead of silently applying', async () => {
  await withDataDir(async (appPaths) => {
    const parsePath = 'C:\\cache\\broken';
    const filePath = parseEditFilePath(appPaths, parsePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    await fsp.writeFile(filePath, '{ not json', 'utf8');
    await assert.rejects(() => readMineruParseEdits(appPaths, parsePath), /valid JSON/);

    await fsp.writeFile(filePath, JSON.stringify({ version: 99, blocks: {} }), 'utf8');
    await assert.rejects(() => readMineruParseEdits(appPaths, parsePath), /unsupported format/);
  });
});
