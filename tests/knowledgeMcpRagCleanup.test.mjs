import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const { createRagStore } = require('../electron/backend/ragStore.cjs');
const { DatabaseSync } = require('node:sqlite');

function cleanupDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

test('MCP removes RAG chunks for papers deleted through the MCP delete tool', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-rag-cleanup-'));
  const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => false });

  try {
    // 先创建 RAG 库并写入一篇论文的 chunk。
    createRagStore(service.appPaths).close();
    const db = new DatabaseSync(service.appPaths.ragDatabasePath);
    db.prepare(`
      INSERT INTO rag_chunks (document_key, source_type, chunk_id, chunk_index, text)
      VALUES (?, ?, ?, ?, ?)
    `).run('paper-deleted', 'mineru-markdown', 'chunk-1', 0, 'retrievable evidence');
    db.close();

    service.removeRagIndexes(['paper-deleted']);

    const verify = new DatabaseSync(service.appPaths.ragDatabasePath);
    const remaining = verify.prepare(
      'SELECT COUNT(*) AS count FROM rag_chunks WHERE document_key = ?',
    ).get('paper-deleted').count;
    const other = verify.prepare(
      "SELECT COUNT(*) AS count FROM rag_chunks WHERE document_key = 'paper-kept'",
    ).get().count;
    verify.close();

    assert.equal(Number(remaining), 0);
    assert.equal(Number(other), 0);
  } finally {
    cleanupDir(dir);
  }
});

test('MCP deletion without a RAG database is a no-op', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-rag-missing-'));
  const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => false });

  try {
    assert.doesNotThrow(() => service.removeRagIndexes(['paper-1']));
  } finally {
    cleanupDir(dir);
  }
});
