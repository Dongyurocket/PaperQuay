import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMcpClientConfig, nodeSatisfiesSqlite } = require('../electron/backend/mcpClientConfig.cjs');

test('nodeSatisfiesSqlite accepts 22.5 and newer', () => {
  assert.equal(nodeSatisfiesSqlite('22.4.9'), false);
  assert.equal(nodeSatisfiesSqlite('22.5.0'), true);
  assert.equal(nodeSatisfiesSqlite('v24.15.0'), true);
});

test('installed MCP config launches the bundle with Electron as Node', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-config-'));
  try {
    const resourcesPath = path.join(root, 'resources');
    const entry = path.join(resourcesPath, 'paperquay-mcp', 'server.cjs');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, '// bundle');
    const execPath = path.join(root, 'PaperQuay.exe');

    const config = buildMcpClientConfig({
      isPackaged: true,
      execPath,
      resourcesPath,
      appPath: path.join(resourcesPath, 'app.asar'),
      dataDir: path.join(root, 'PaperQuay'),
      nodeVersion: '24.15.0',
      systemNodeVersion: null,
    });

    assert.equal(config.mode, 'installed');
    assert.equal(config.command, execPath);
    assert.deepEqual(config.env, { ELECTRON_RUN_AS_NODE: '1' });
    assert.equal(config.args[0], entry);
    assert.equal(config.args.at(-2), '--data-dir');
    assert.equal(config.entryExists, true);
    assert.match(config.snippets.proma, /ELECTRON_RUN_AS_NODE/);
    assert.match(config.snippets.codex, /ELECTRON_RUN_AS_NODE/);
    assert.match(config.snippets.claude, /PaperQuay.exe|server\.cjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('development MCP config points at the source entry and system Node', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-dev-config-'));
  try {
    const entry = path.join(root, 'bin', 'paperquay-mcp.cjs');
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, '// source');

    const config = buildMcpClientConfig({
      isPackaged: false,
      execPath: path.join(root, 'electron.exe'),
      resourcesPath: path.join(root, 'resources'),
      appPath: root,
      dataDir: '',
      nodeVersion: '24.15.0',
      systemNodeVersion: '22.4.0',
    });

    assert.equal(config.mode, 'development');
    assert.equal(config.command, 'node');
    assert.deepEqual(config.env, {});
    assert.equal(config.args[0], entry);
    assert.equal(config.systemNodeSatisfiesSqlite, false);
    assert.doesNotMatch(config.snippets.proma, /ELECTRON_RUN_AS_NODE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
