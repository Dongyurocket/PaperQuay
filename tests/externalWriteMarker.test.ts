import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const markerModulePath = require.resolve('../electron/backend/externalWriteMarker.cjs');
const {
  LEGACY_MARKER_FILE,
  MARKER_FILE,
  externalWriteMarkerPath,
  readExternalWriteMarker,
  recordExternalWrite,
} = require('../electron/backend/externalWriteMarker.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function runChildWrite(dir: string, scope: string, count: number): Promise<void> {
  const script = `
    const { recordExternalWrite } = require(process.argv[1]);
    const [dir, scope, count] = process.argv.slice(2);
    for (let index = 0; index < Number(count); index += 1) {
      recordExternalWrite(dir, scope, { source: 'child-' + process.pid });
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, markerModulePath, dir, scope, String(count)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child writer exited with ${code}: ${stderr}`));
    });
  });
}

test('missing marker reports empty state without creating files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-external-marker-'));
  try {
    const result = readExternalWriteMarker(dir);
    assert.equal(result.status, 'missing');
    assert.equal(result.state.library.revision, 0);
    assert.equal(result.state.notes.revision, 0);
    assert.equal(existsSync(externalWriteMarkerPath(dir)), false);
  } finally {
    cleanupDir(dir);
  }
});

test('legacy JSON revisions are migrated before the first new write', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-external-marker-'));
  try {
    writeFileSync(path.join(dir, LEGACY_MARKER_FILE), JSON.stringify({
      version: 1,
      library: { revision: 5, updatedAt: 100, source: 'legacy' },
      notes: { revision: 7, updatedAt: 200, source: 'legacy' },
    }));

    const state = recordExternalWrite(dir, 'notes', { source: 'mcp', at: 300 });
    assert.equal(state.notes.revision, 8);
    assert.equal(state.notes.updatedAt, 300);
    assert.equal(state.notes.source, 'mcp');
    assert.equal(state.library.revision, 5);
    assert.equal(state.library.updatedAt, 100);

    const reloaded = readExternalWriteMarker(dir);
    assert.equal(reloaded.status, 'known');
    assert.equal(reloaded.state.notes.revision, 8);
    assert.equal(reloaded.state.library.revision, 5);
    assert.equal(path.basename(reloaded.filePath), MARKER_FILE);
  } finally {
    cleanupDir(dir);
  }
});

test('an empty marker database left by a crash still falls back to the legacy baseline', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-external-marker-'));
  try {
    // 模拟事务提交前崩溃：SQLite 文件已创建，但 external_writes 表还没有行。
    const empty = new DatabaseSync(externalWriteMarkerPath(dir));
    empty.exec('CREATE TABLE external_writes (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at INTEGER, source TEXT)');
    empty.close();
    writeFileSync(path.join(dir, LEGACY_MARKER_FILE), JSON.stringify({
      library: { revision: 2, updatedAt: 10, source: 'legacy' },
      notes: { revision: 4, updatedAt: 20, source: 'legacy' },
    }));

    assert.equal(readExternalWriteMarker(dir).state.notes.revision, 4);
    const state = recordExternalWrite(dir, 'notes', { source: 'mcp', at: 30 });
    assert.equal(state.library.revision, 2);
    assert.equal(state.notes.revision, 5);
  } finally {
    cleanupDir(dir);
  }
});

test('two concurrent writer processes never lose a revision increment', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-external-marker-'));
  const writesPerProcess = 40;
  try {
    await Promise.all([
      runChildWrite(dir, 'notes', writesPerProcess),
      runChildWrite(dir, 'notes', writesPerProcess),
    ]);

    const state = readExternalWriteMarker(dir).state;
    assert.equal(state.notes.revision, writesPerProcess * 2);
    assert.equal(state.library.revision, 0);

    // 读者连续看到的值必须严格递增、无回退。
    let previous = state.notes.revision;
    for (let index = 0; index < 5; index += 1) {
      recordExternalWrite(dir, 'notes', { source: 'reader-check' });
      const next = readExternalWriteMarker(dir).state.notes.revision;
      assert.equal(next, previous + 1);
      previous = next;
    }
  } finally {
    cleanupDir(dir);
  }
});
