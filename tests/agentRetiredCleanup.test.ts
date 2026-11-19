import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createRagStore } = require('../electron/backend/ragStore.cjs');
const {
  cleanupRetiredAgentData,
  cleanupMarkerPath,
} = require('../electron/backend/agentRetiredCleanup.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function makeAppPaths(dir: string) {
  return {
    dataDir: dir,
    libraryDatabasePath: path.join(dir, 'paperquay-library.sqlite'),
    ragDatabasePath: path.join(dir, 'paperquay-rag.sqlite'),
    notesDatabasePath: path.join(dir, 'paperquay-notes.sqlite'),
    configPath: path.join(dir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dir, '.downloads', 'pdfs'),
    libraryPath: path.join(dir, 'paperquay-library.json'),
    screenshotDir: path.join(dir, '.screenshots'),
  };
}

test('retired agent cleanup removes memory and run history once, then stays idempotent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-agent-cleanup-'));
  const appPaths = makeAppPaths(dir);
  try {
    mkdirSync(path.join(dir, 'agent-memory', 'nested'), { recursive: true });
    writeFileSync(path.join(dir, 'agent-memory', 'memory.json'), '{}');
    writeFileSync(path.join(dir, 'agent-memory', 'nested', 'trace.json'), '{}');

    const ragStore = createRagStore(appPaths);
    const run = ragStore.createAgentRun({ runId: 'run-retired-1', sessionId: 'session-1', instruction: 'Retired' });
    ragStore.appendAgentRunEvent({ runId: run.runId, kind: 'turn_start', payload: { text: 'hi' } });
    ragStore.close();

    const reopen = createRagStore(appPaths);
    const first = cleanupRetiredAgentData(appPaths, { ragStore: reopen });
    assert.equal(first.alreadyDone, false);
    assert.equal(first.memoryFilesRemoved, 2);
    assert.equal(first.runsRemoved, 1);
    assert.equal(first.eventsRemoved, 1);
    assert.equal(existsSync(path.join(dir, 'agent-memory')), false);
    assert.equal(existsSync(cleanupMarkerPath(appPaths)), true);
    assert.deepEqual(JSON.parse(readFileSync(cleanupMarkerPath(appPaths), 'utf8')).runsRemoved, 1);
    assert.equal(reopen.getAgentRun({ runId: run.runId }), null);

    // New data written after the first cleanup must not be deleted by a repeat run.
    mkdirSync(path.join(dir, 'agent-memory'), { recursive: true });
    writeFileSync(path.join(dir, 'agent-memory', 'later.json'), '{}');
    reopen.createAgentRun({ runId: 'run-later-2', sessionId: 'session-2', instruction: 'Later' });
    const second = cleanupRetiredAgentData(appPaths, { ragStore: reopen });
    assert.equal(second.alreadyDone, true);
    assert.equal(existsSync(path.join(dir, 'agent-memory', 'later.json')), true);
    assert.equal(reopen.getAgentRun({ runId: 'run-later-2' })?.runId, 'run-later-2');
    reopen.close();
  } finally {
    cleanupDir(dir);
  }
});
