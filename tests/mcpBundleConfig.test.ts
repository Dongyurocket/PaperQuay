import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const {
  MCP_BUNDLE_ENTRY,
  MCP_BUNDLE_OUT_DIR,
  MCP_BUNDLE_OPTIONS,
  MCP_BUNDLE_WORKER_ENTRY,
  MCP_BUNDLE_WORKER_OUT_FILE,
  createMcpBundleOptions,
  createMcpWorkerBundleOptions,
  resolveMcpBundlePaths,
} = require('../scripts/bundleMcpConfig.cjs');
const { bundleMcp } = require('../scripts/bundle-mcp.cjs');

const projectRoot = path.resolve('.');

let scratchCounter = 0;

// 与 tests/mcpClientLaunch.test.mjs 相同的临时目录策略：%TEMP% 下 esbuild 落盘
// 可能被安全软件锁住，优先使用仓库内已忽略的 .tmp-test/，失败再退回系统临时目录。
function createScratchRoot() {
  const candidates = [path.resolve('.tmp-test'), tmpdir()];
  for (const base of candidates) {
    const dir = path.join(base, `paperquay-mcp-bundle-${process.pid}-${scratchCounter++}`);
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // 换下一个候选目录。
    }
  }
  throw new Error('No writable scratch directory for the MCP bundle test');
}

function removeScratchRoot(dir: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error: any) {
      if (attempt === 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) return;
    }
  }
}

test('shared MCP bundle config describes the packaging layout and esbuild options', () => {
  assert.equal(MCP_BUNDLE_ENTRY, 'bin/paperquay-mcp.cjs');
  assert.equal(MCP_BUNDLE_OUT_DIR, 'packaging/mcp');
  assert.equal(MCP_BUNDLE_OPTIONS.absWorkingDir, projectRoot);
  assert.deepEqual(MCP_BUNDLE_OPTIONS.entryPoints, [MCP_BUNDLE_ENTRY]);
  assert.equal(MCP_BUNDLE_OPTIONS.bundle, true);
  assert.equal(MCP_BUNDLE_OPTIONS.platform, 'node');
  assert.equal(MCP_BUNDLE_OPTIONS.format, 'cjs');
  assert.equal(MCP_BUNDLE_OPTIONS.target, 'node22');
  assert.equal(MCP_BUNDLE_OPTIONS.legalComments, 'none');
  assert.equal(MCP_BUNDLE_OPTIONS.logLevel, 'warning');
  assert.deepEqual(MCP_BUNDLE_OPTIONS.external, ['sqlite-vec', 'sqlite-vec-*']);
  assert.equal(MCP_BUNDLE_OPTIONS.outfile, path.join(projectRoot, 'packaging', 'mcp', 'server.cjs'));

  assert.deepEqual(resolveMcpBundlePaths(projectRoot), {
    root: projectRoot,
    entry: path.join(projectRoot, 'bin', 'paperquay-mcp.cjs'),
    workerEntry: path.join(projectRoot, 'electron', 'backend', 'ragWorker.cjs'),
    outDir: path.join(projectRoot, 'packaging', 'mcp'),
    outfile: path.join(projectRoot, 'packaging', 'mcp', 'server.cjs'),
    workerOutfile: path.join(projectRoot, 'packaging', 'mcp', 'ragWorker.cjs'),
  });

  assert.equal(MCP_BUNDLE_WORKER_ENTRY, 'electron/backend/ragWorker.cjs');
  assert.equal(MCP_BUNDLE_WORKER_OUT_FILE, 'ragWorker.cjs');
  const workerOptions = createMcpWorkerBundleOptions({ write: false });
  assert.deepEqual(workerOptions.entryPoints, [path.join(projectRoot, 'electron', 'backend', 'ragWorker.cjs')]);
  assert.equal(workerOptions.outfile, path.join(projectRoot, 'packaging', 'mcp', 'ragWorker.cjs'));
  assert.deepEqual(workerOptions.external, ['sqlite-vec', 'sqlite-vec-*']);
});

test('package.json extraResources still consumes the shared bundle directory', () => {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const extraResources = packageJson.build.extraResources;
  const froms = extraResources.map((entry: any) => entry.from);

  const bundleEntry = extraResources.find((entry: any) => entry.from === MCP_BUNDLE_OUT_DIR);
  assert.ok(bundleEntry, `expected ${MCP_BUNDLE_OUT_DIR} in ${froms.join(', ')}`);
  assert.equal(bundleEntry.to, 'paperquay-mcp');

  const modulesEntry = extraResources.find(
    (entry: any) => entry.from === `${MCP_BUNDLE_OUT_DIR}/node_modules`,
  );
  assert.ok(modulesEntry, 'sqlite-vec node_modules must be packaged separately');
  assert.equal(modulesEntry.to, 'paperquay-mcp/node_modules');
});

test('the shared entry bundles with sqlite-vec kept external', async () => {
  const result = await build(createMcpBundleOptions({ write: false }));

  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles && result.outputFiles.length > 0, 'esbuild must produce output');
  const output = result.outputFiles[0];
  assert.ok(output.path.endsWith('server.cjs'), output.path);
  assert.match(output.text, /paperquay-knowledge-mcp/);
  assert.match(output.text, /require\(["']sqlite-vec["']\)/, 'sqlite-vec must stay a runtime require');
  assert.doesNotMatch(output.text, /vec0\.(dll|so|dylib)/, 'sqlite-vec platform binaries must not be inlined');
});

test('the rag worker entry bundles as a self-contained worker script', async () => {
  const result = await build(createMcpWorkerBundleOptions({ write: false }));

  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles && result.outputFiles.length > 0);
  const output = result.outputFiles[0];
  assert.ok(output.path.endsWith('ragWorker.cjs'), output.path);
  assert.match(output.text, /must run inside a worker thread/);
  assert.match(output.text, /require\(["']sqlite-vec["']\)/, 'the worker must keep sqlite-vec external');
});

const sqliteVecInstalled = existsSync(path.join(projectRoot, 'node_modules', 'sqlite-vec'));

test(
  'bundleMcp writes server.cjs, sql-wasm.wasm, and sqlite-vec into a custom outDir',
  { skip: sqliteVecInstalled ? false : 'node_modules/sqlite-vec is not installed' },
  async () => {
    const outDir = createScratchRoot();
    try {
      const result = await bundleMcp({ outDir });

      assert.equal(path.resolve(result.outDir), path.resolve(outDir));
      assert.equal(path.resolve(result.entry), path.resolve(outDir, 'server.cjs'));
      assert.ok(existsSync(path.join(outDir, 'server.cjs')), 'server.cjs must be written');
      assert.ok(existsSync(path.join(outDir, 'ragWorker.cjs')), 'ragWorker.cjs must be written for MCP note indexing');
      assert.ok(existsSync(path.join(outDir, 'bundle-manifest.json')), 'the bundle manifest must be written');
      assert.ok(existsSync(path.join(outDir, 'sql-wasm.wasm')), 'sql-wasm.wasm must be copied');
      assert.ok(
        existsSync(path.join(outDir, 'node_modules', 'sqlite-vec', 'package.json')),
        'sqlite-vec must be copied into the bundle',
      );
      assert.ok(result.sqlitePackages.includes('sqlite-vec'));

      const manifest = JSON.parse(readFileSync(path.join(outDir, 'bundle-manifest.json'), 'utf8'));
      assert.equal(manifest.entry, 'bin/paperquay-mcp.cjs');
      assert.equal(manifest.toolCount, 28);
      assert.equal(manifest.version, JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version);
      assert.match(manifest.entrySha256, /^[0-9a-f]{64}$/);
      assert.match(manifest.workerSha256, /^[0-9a-f]{64}$/);
    } finally {
      removeScratchRoot(outDir);
    }
  },
);
