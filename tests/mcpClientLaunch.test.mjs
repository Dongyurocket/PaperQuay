import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { buildMcpClientConfig } = require('../electron/backend/mcpClientConfig.cjs');
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');

async function exerciseClient(config, noteId) {
  const child = spawn(config.command, config.args, {
    env: { ...process.env, ...config.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  let nextId = 0;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const lines = output.split('\n');
    output = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timeout);
        pending.delete(message.id);
        request.resolve(message);
      }
    }
  });
  const failPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };
  child.on('error', failPending);
  child.on('exit', (code) => failPending(new Error(`MCP exited ${code}: ${errors}`)));
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP timeout: ${errors}`));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const callTool = async (name, args) => {
    const response = await call('tools/call', { name, arguments: args });
    assert.equal(response.result?.isError, false, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  try {
    const initialized = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'paperquay-test', version: '1' } });
    assert.equal(initialized.result?.protocolVersion, '2024-11-05');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const response = await call('tools/list', {});
    assert.ok(response.result?.tools, JSON.stringify(response));
    const found = await callTool('search_notes', { query: 'isolated content', pageKind: 'synthesis' });
    assert.ok(found.notes.some((note) => note.id === noteId));
    const first = await callTool('get_note', { noteId, limit: 8 });
    const second = await callTool('get_note', { noteId, offset: first.note.nextOffset });
    assert.equal(first.note.pageKind, 'synthesis');
    assert.equal(first.note.contentText + second.note.contentText, 'isolated content');
    assert.equal(second.note.nextOffset, null);
    return response.result.tools;
  } finally {
    child.stdin.end();
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  }
}

test('generated development and packaged MCP configurations launch the same tool contracts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperquay-mcp-launch-'));
  const resources = path.join(root, 'resources');
  const bundleDir = path.join(resources, 'paperquay-mcp');
  fs.mkdirSync(bundleDir, { recursive: true });
  try {
    await build({
      entryPoints: ['bin/paperquay-mcp.cjs'], bundle: true, platform: 'node', format: 'cjs',
      target: 'node22', outfile: path.join(bundleDir, 'server.cjs'),
      external: ['sqlite-vec', 'sqlite-vec-*'], legalComments: 'none', logLevel: 'silent',
    });
    fs.copyFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'), path.join(bundleDir, 'sql-wasm.wasm'));
    const modules = path.resolve('node_modules');
    for (const name of fs.readdirSync(modules).filter((item) => item === 'sqlite-vec' || item.startsWith('sqlite-vec-'))) {
      fs.cpSync(path.join(modules, name), path.join(bundleDir, 'node_modules', name), { recursive: true });
    }
    const common = { resourcesPath: resources, dataDir: path.join(root, 'isolated-data'), systemNodeVersion: process.versions.node };
    const fixture = new PaperQuayKnowledgeService({ dataDir: common.dataDir, isAppRunning: () => false });
    const created = fixture.createNote({ title: 'MCP integration', content: 'isolated content', pageKind: 'synthesis' });
    const development = buildMcpClientConfig({ ...common, appPath: process.cwd() });
    const installed = buildMcpClientConfig({ ...common, isPackaged: true, execPath: require('electron') });
    for (const config of [development, installed]) {
      assert.equal(config.entryExists, true);
      for (const client of ['proma', 'claude']) {
        const snippet = JSON.parse(config.snippets[client]);
        const entry = client === 'proma' ? snippet.servers.paperquay : snippet.mcpServers.paperquay;
        assert.equal(entry.command, config.command);
        assert.deepEqual(entry.args, config.args);
        assert.deepEqual(entry.env ?? {}, config.env);
      }
      assert.ok(config.snippets.codex.includes(JSON.stringify(config.command)));
      for (const argument of config.args) assert.ok(config.snippets.codex.includes(JSON.stringify(argument)));
    }
    const sourceTools = await exerciseClient(development, created.noteId);
    const bundledTools = await exerciseClient(installed, created.noteId);
    assert.deepEqual(bundledTools, sourceTools);
    assert.ok(sourceTools.some((tool) => tool.name === 'get_note'));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EBUSY') throw error;
    }
  }
});
