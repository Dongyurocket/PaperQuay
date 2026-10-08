import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { desktopRunMarkerState, isDesktopRunMarkerActive, markerPath, removeDesktopRunMarker, writeDesktopRunMarker } =
  require('../electron/backend/desktopRunMarker.cjs');

test('desktop marker protects a live development process and is cleared on close', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-marker-'));
  try {
    assert.equal(isDesktopRunMarkerActive(dir), false);
    writeDesktopRunMarker(dir);
    assert.equal(isDesktopRunMarkerActive(dir), true);
    removeDesktopRunMarker(dir);
    assert.equal(isDesktopRunMarkerActive(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP writes respect the active development marker without an installed app process', () => {
  const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-marker-'));
  try {
    writeDesktopRunMarker(dir);
    const service = new PaperQuayKnowledgeService({ dataDir: dir });
    assert.throws(() => service.assertWritable(false), /正在运行，已拒绝写入/);
    const forced = service.assertWritable(true);
    assert.match(forced.warning ?? '', /运行期间写入/);
  } finally {
    removeDesktopRunMarker(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown marker state is surfaced as unknown and conservatively blocks MCP writes', () => {
  const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-marker-'));
  try {
    writeFileSync(markerPath(dir), 'not json');
    assert.equal(desktopRunMarkerState(dir), null);
    const service = new PaperQuayKnowledgeService({ dataDir: dir });
    assert.throws(() => service.assertWritable(false), /保守拒绝写入/);
    const forced = service.assertWritable(true);
    assert.match(forced.warning ?? '', /无法确认/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
