import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const mainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const { bundlePreload } = require('../scripts/bundle-preload.cjs');

// esbuild 子进程在部分环境不能写系统临时目录，测试产物放到仓库内 node_modules/.cache。
function createBuildDir(prefix) {
  const cacheRoot = path.join(process.cwd(), 'node_modules', '.cache');
  mkdirSync(cacheRoot, { recursive: true });
  return mkdtempSync(path.join(cacheRoot, prefix));
}

async function buildBundle(outfile) {
  await bundlePreload({ outfile });
  return readFileSync(outfile, 'utf8');
}

test('main window uses a sandboxed, self-contained preload bundle', () => {
  assert.match(
    mainSource,
    /preload:\s*path\.join\(__dirname,\s*'preload\.bundle\.cjs'\)/,
    'preload must point at the self-contained bundle',
  );
  assert.match(mainSource, /sandbox:\s*true/, 'renderer must run with sandbox:true');
  assert.doesNotMatch(mainSource, /sandbox:\s*false/, 'sandbox:false must not remain in main.cjs');
});

test('sandboxed preload does not import restricted electron clipboard APIs', () => {
  // sandbox preload 只能 require 有限的 electron 导出；clipboard 必须走主进程 IPC。
  assert.doesNotMatch(preloadSource, /clipboard\s*,\s*contextBridge/);
  assert.doesNotMatch(preloadSource, /\bclipboard\.(?:readText|writeText)\(/);
  assert.match(preloadSource, /require\('electron'\)/);
});

test('preload bundle keeps electron external and has no local relative requires', async () => {
  const dir = createBuildDir('pq-preload-structure-');
  try {
    const source = await buildBundle(path.join(dir, 'preload.bundle.cjs'));
    assert.ok(source.length > 1000, 'bundle should include the inlined shared modules');
    assert.match(source, /require\(['"]electron['"]\)/, 'electron must stay an external require');
    const localRequires = [...source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(localRequires, [], `bundle still requires local modules: ${localRequires.join(', ')}`);
    assert.ok(source.includes('library_init'), 'allowlist must be inlined into the bundle');
    assert.ok(source.includes('clipboard_write_text'), 'clipboard command must be inlined');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
