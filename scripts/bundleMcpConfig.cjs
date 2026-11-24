'use strict';

const path = require('node:path');

// Single source of truth for the MCP bundle layout. scripts/bundle-mcp.cjs and
// tests/mcpBundleConfig.test.ts both consume these values so packaging paths and
// esbuild options cannot drift apart.
const repoRoot = path.resolve(__dirname, '..');

const MCP_BUNDLE_ENTRY = 'bin/paperquay-mcp.cjs';
const MCP_BUNDLE_OUT_DIR = 'packaging/mcp';
const MCP_BUNDLE_OUT_FILE = 'server.cjs';
// D3-2：MCP 写笔记后由 ragWorkerHost 在 bundle 目录内 spawn worker。
// worker 必须与 server.cjs 一起打进 packaging/mcp，否则安装版笔记向量索引会静默失败。
const MCP_BUNDLE_WORKER_ENTRY = 'electron/backend/ragWorker.cjs';
const MCP_BUNDLE_WORKER_OUT_FILE = 'ragWorker.cjs';

const MCP_BUNDLE_OPTIONS = Object.freeze({
  absWorkingDir: repoRoot,
  entryPoints: [MCP_BUNDLE_ENTRY],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(repoRoot, MCP_BUNDLE_OUT_DIR, MCP_BUNDLE_OUT_FILE),
  external: ['sqlite-vec', 'sqlite-vec-*'],
  legalComments: 'none',
  logLevel: 'warning',
});

/** ragWorker 与主 bundle 使用同一套 external/target，只是入口与输出文件名不同。 */
const MCP_WORKER_BUNDLE_OPTIONS = Object.freeze({
  ...MCP_BUNDLE_OPTIONS,
  entryPoints: [MCP_BUNDLE_WORKER_ENTRY],
  outfile: path.join(repoRoot, MCP_BUNDLE_OUT_DIR, MCP_BUNDLE_WORKER_OUT_FILE),
});

function resolveMcpBundlePaths(root = repoRoot) {
  const absoluteRoot = path.resolve(root);
  const outDir = path.join(absoluteRoot, MCP_BUNDLE_OUT_DIR);
  return {
    root: absoluteRoot,
    entry: path.join(absoluteRoot, MCP_BUNDLE_ENTRY),
    workerEntry: path.join(absoluteRoot, MCP_BUNDLE_WORKER_ENTRY),
    outDir,
    outfile: path.join(outDir, MCP_BUNDLE_OUT_FILE),
    workerOutfile: path.join(outDir, MCP_BUNDLE_WORKER_OUT_FILE),
  };
}

/**
 * Clone the shared options with the resolved root/outfile. Pass `write: false`
 * to dry-run the bundle (tests) or `outDir` to target a temporary directory.
 */
function createMcpBundleOptions({ root = repoRoot, outDir, outfile, write } = {}) {
  const paths = resolveMcpBundlePaths(root);
  const targetOutfile = outfile
    || (outDir ? path.join(path.resolve(outDir), MCP_BUNDLE_OUT_FILE) : paths.outfile);
  const options = {
    ...MCP_BUNDLE_OPTIONS,
    absWorkingDir: paths.root,
    entryPoints: [paths.entry],
    outfile: targetOutfile,
  };
  if (write !== undefined) options.write = write;
  return options;
}

function createMcpWorkerBundleOptions({ root = repoRoot, outDir, outfile, write } = {}) {
  const paths = resolveMcpBundlePaths(root);
  const targetOutfile = outfile
    || (outDir ? path.join(path.resolve(outDir), MCP_BUNDLE_WORKER_OUT_FILE) : paths.workerOutfile);
  const options = {
    ...MCP_WORKER_BUNDLE_OPTIONS,
    absWorkingDir: paths.root,
    entryPoints: [paths.workerEntry],
    outfile: targetOutfile,
  };
  if (write !== undefined) options.write = write;
  return options;
}

module.exports = {
  MCP_BUNDLE_ENTRY,
  MCP_BUNDLE_OUT_DIR,
  MCP_BUNDLE_OUT_FILE,
  MCP_BUNDLE_WORKER_ENTRY,
  MCP_BUNDLE_WORKER_OUT_FILE,
  MCP_BUNDLE_OPTIONS,
  MCP_WORKER_BUNDLE_OPTIONS,
  resolveMcpBundlePaths,
  createMcpBundleOptions,
  createMcpWorkerBundleOptions,
};
