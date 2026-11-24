import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildRagEmbeddingModelKey } from '../src/services/rag.ts';

const require = createRequire(import.meta.url);
const {
  normalizeEmbeddingBaseUrl,
  buildEmbeddingModelKey,
  resolveEmbeddingConfigFromDocument,
  clampEmbeddingDimensions,
  clampEmbeddingTimeoutSeconds,
  clampEmbeddingBatchSize,
} = require('../src/shared/embeddingConfig.cjs');
const { resolveNoteEmbedding, noteModelKey } = require('../electron/backend/noteEmbedding.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');

function writeConfig(dataDir: string, document: Record<string, unknown>) {
  const configPath = path.join(dataDir, '.settings', 'paperquay.config.json');
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(document));
  return configPath;
}

test('embedding base URL normalization is shared by every caller', () => {
  assert.equal(normalizeEmbeddingBaseUrl('  http://localhost:11434  '), 'http://localhost:11434/v1');
  assert.equal(normalizeEmbeddingBaseUrl('http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.equal(normalizeEmbeddingBaseUrl('http://localhost:11434/v1/embeddings'), 'http://localhost:11434/v1');
  assert.equal(normalizeEmbeddingBaseUrl('http://localhost:11434/v2'), 'http://localhost:11434/v2');
  assert.equal(normalizeEmbeddingBaseUrl('   '), '');
});

test('clamps dimensions, timeout and batch size', () => {
  assert.equal(clampEmbeddingDimensions(1024), 1024);
  assert.equal(clampEmbeddingDimensions(0), null);
  assert.equal(clampEmbeddingDimensions('12'), 12);
  assert.equal(clampEmbeddingDimensions(3.5), null);

  assert.equal(clampEmbeddingTimeoutSeconds(undefined, 60), 60);
  assert.equal(clampEmbeddingTimeoutSeconds(1, 60), 5);
  assert.equal(clampEmbeddingTimeoutSeconds(9999, 60), 600);
  assert.equal(clampEmbeddingTimeoutSeconds(42, 60), 42);

  assert.equal(clampEmbeddingBatchSize(undefined, 24), 24);
  assert.equal(clampEmbeddingBatchSize(0, 24), 24);
  assert.equal(clampEmbeddingBatchSize(999, 24), 100);
  assert.equal(clampEmbeddingBatchSize(32, 24), 32);
});

test('the same document yields the same model key in notes, MCP and renderer', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-embedding-shared-'));
  try {
    const document = {
      version: 1,
      settings: {
        embeddingBaseUrl: 'http://localhost:11434',
        embeddingModel: ' test-embed ',
        embeddingDimensions: 4,
        embeddingRequestTimeoutSeconds: 75,
      },
      secrets: { embeddingApiKey: 'test-key' },
    };
    const configPath = writeConfig(dataDir, document);

    const noteConfig = resolveNoteEmbedding({ dataDir, configPath });
    const service = new PaperQuayKnowledgeService({ dataDir });
    const mcpConfig = service.resolveEmbeddingConfig();
    const sharedConfig = resolveEmbeddingConfigFromDocument(document, {
      requireApiKey: true,
      defaultTimeoutSeconds: 60,
    });

    assert.ok(noteConfig);
    assert.ok(mcpConfig);
    assert.ok(sharedConfig);

    const expectedKey = buildEmbeddingModelKey({
      baseUrl: 'http://localhost:11434',
      model: 'test-embed',
      dimensions: 4,
    });
    assert.equal(noteModelKey(noteConfig), expectedKey);
    assert.equal(buildEmbeddingModelKey(mcpConfig), expectedKey);
    assert.equal(buildEmbeddingModelKey(sharedConfig), expectedKey);
    assert.equal(buildRagEmbeddingModelKey({
      baseUrl: 'http://localhost:11434',
      model: 'test-embed',
      dimensions: 4,
      apiKey: 'test-key',
    }), expectedKey);

    // Timeout comes from settings, not a hard-coded per-caller value.
    assert.equal(noteConfig.timeoutSeconds, 75);
    assert.equal(mcpConfig.timeoutSeconds, 75);
    assert.equal(sharedConfig.timeoutSeconds, 75);
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('missing api key falls back to null only where a key is required', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-embedding-shared-'));
  try {
    const document = {
      settings: {
        embeddingBaseUrl: 'http://localhost:11434/v1',
        embeddingModel: 'test-embed',
        embeddingDimensions: 4,
      },
      secrets: {},
    };
    const configPath = writeConfig(dataDir, document);

    assert.equal(resolveNoteEmbedding({ dataDir, configPath }), null);
    assert.equal(resolveEmbeddingConfigFromDocument(document, { requireApiKey: true }), null);

    const optionalKey = resolveEmbeddingConfigFromDocument(document, {
      requireApiKey: false,
      defaultTimeoutSeconds: 60,
    });
    assert.ok(optionalKey);
    assert.equal(optionalKey.apiKey, '');
    assert.equal(optionalKey.timeoutSeconds, 60);

    const service = new PaperQuayKnowledgeService({ dataDir });
    const mcpConfig = service.resolveEmbeddingConfig();
    assert.ok(mcpConfig);
    assert.equal(mcpConfig.apiKey, '');
    assert.equal(mcpConfig.timeoutSeconds, 60);
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('MCP timeout follows settings but remains clamped', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pq-embedding-shared-'));
  try {
    const document = {
      settings: {
        embeddingBaseUrl: 'http://localhost:11434/v1',
        embeddingModel: 'test-embed',
        embeddingRequestTimeoutSeconds: 5000,
      },
      secrets: { embeddingApiKey: 'test-key' },
    };
    writeConfig(dataDir, document);
    const service = new PaperQuayKnowledgeService({ dataDir });
    assert.equal(service.resolveEmbeddingConfig().timeoutSeconds, 600);

    // The resolved document is read from disk, not from the in-memory fixture.
    const onDisk = JSON.parse(readFileSync(path.join(dataDir, '.settings', 'paperquay.config.json'), 'utf8'));
    assert.equal(onDisk.settings.embeddingRequestTimeoutSeconds, 5000);
  } finally {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
