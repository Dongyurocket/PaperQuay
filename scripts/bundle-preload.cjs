'use strict';

/**
 * 把 electron/preload.cjs 及其本地依赖（ipcAllowlist、rendererStorageRestore）
 * 打成单文件 electron/preload.bundle.cjs。
 *
 * sandbox:true 的 preload 只能 require('electron') 和少量内置模块，不能再通过
 * 相对路径加载本地模块；dev/build 前置执行本脚本，主进程只引用 bundle。
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const DEFAULT_ENTRY = path.join(projectRoot, 'electron', 'preload.cjs');
const DEFAULT_OUTFILE = path.join(projectRoot, 'electron', 'preload.bundle.cjs');

// Electron 42 的 Node 版本为 24.x；语法目标跟随内置 Node，避免多余降级。
const TARGET = 'node24';

function assertSelfContained(source, outfile) {
  const specifiers = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1],
  );
  const localRequires = specifiers.filter((specifier) => specifier.startsWith('.'));
  if (localRequires.length > 0) {
    throw new Error(
      `Preload bundle still requires local modules (${localRequires.join(', ')}): ${outfile}`,
    );
  }

  // sandbox preload 只允许 electron 与 events/timers/url；其他内置模块或外部包
  // 都会在运行期才失败，这里按白名单在构建期拒绝。
  const allowed = new Set([
    'electron',
    'events',
    'timers',
    'url',
    'node:events',
    'node:timers',
    'node:url',
  ]);
  const disallowed = [...new Set(specifiers.filter((specifier) => !allowed.has(specifier)))];
  if (disallowed.length > 0) {
    throw new Error(
      `Preload bundle requires modules unavailable in sandbox (${disallowed.join(', ')}): ${outfile}`,
    );
  }

  if (!/require\(\s*["']electron["']\s*\)/.test(source)) {
    throw new Error(`Preload bundle must keep the electron require external: ${outfile}`);
  }
}

async function bundlePreload({ entry = DEFAULT_ENTRY, outfile = DEFAULT_OUTFILE } = {}) {
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: TARGET,
    external: ['electron'],
    write: true,
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
  });

  const source = await fs.readFile(outfile, 'utf8');
  assertSelfContained(source, outfile);

  return { entry, outfile, bytes: Buffer.byteLength(source) };
}

if (require.main === module) {
  bundlePreload()
    .then((result) => {
      console.log(`PaperQuay preload bundle: ${result.outfile} (${result.bytes} bytes)`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

module.exports = { bundlePreload, DEFAULT_ENTRY, DEFAULT_OUTFILE, TARGET };
