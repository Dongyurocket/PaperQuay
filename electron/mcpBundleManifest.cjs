'use strict';

/**
 * MCP bundle manifest（D3-13）。
 *
 * `npm run mcp:bundle` 在 packaging/mcp 写入 bundle-manifest.json，记录源入口
 * hash、server/worker 产物 hash、工具数与版本；afterPack 在打包前复核这些值。
 * 这样即使有人跳过 bundleMcp 直接运行 electron-builder，也会因为 stale bundle
 * 被拒绝，而不是把旧工具集打进安装包。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MCP_BUNDLE_MANIFEST_FILE = 'bundle-manifest.json';
const MCP_BUNDLE_SCHEMA_VERSION = 1;
const MCP_BUNDLE_SOURCE_ENTRY = 'bin/paperquay-mcp.cjs';
const MCP_BUNDLE_SERVER_FILE = 'server.cjs';
const MCP_BUNDLE_WORKER_FILE = 'ragWorker.cjs';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readPackageVersion(root) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return String(packageJson.version ?? '');
}

function currentToolCount() {
  return require('./mcp/mcpTools.cjs').TOOLS.length;
}

function resolveBundleDir(root, outDir) {
  return outDir ? path.resolve(outDir) : path.join(path.resolve(root), 'packaging', 'mcp');
}

/** 生成 manifest；调用时 server.cjs 与 ragWorker.cjs 必须已经落盘。 */
/** @param {{ root?: string, outDir?: string }} [options] */
function createMcpBundleManifest({ root, outDir } = {}) {
  const resolvedRoot = path.resolve(root ?? path.join(__dirname, '..'));
  const bundleDir = resolveBundleDir(resolvedRoot, outDir);
  return {
    schemaVersion: MCP_BUNDLE_SCHEMA_VERSION,
    name: 'paperquay-mcp',
    version: readPackageVersion(resolvedRoot),
    entry: MCP_BUNDLE_SOURCE_ENTRY,
    entrySha256: sha256File(path.join(resolvedRoot, MCP_BUNDLE_SOURCE_ENTRY)),
    serverSha256: sha256File(path.join(bundleDir, MCP_BUNDLE_SERVER_FILE)),
    workerSha256: sha256File(path.join(bundleDir, MCP_BUNDLE_WORKER_FILE)),
    toolCount: currentToolCount(),
  };
}

/** @param {{ root?: string, outDir?: string }} [options] */
function writeMcpBundleManifest({ root, outDir } = {}) {
  const bundleDir = resolveBundleDir(root ?? path.join(__dirname, '..'), outDir);
  const manifest = createMcpBundleManifest({ root, outDir });
  fs.writeFileSync(
    path.join(bundleDir, MCP_BUNDLE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/** @param {{ root?: string, outDir?: string }} [options] */
function readMcpBundleManifest({ root, outDir } = {}) {
  const bundleDir = resolveBundleDir(root ?? path.join(__dirname, '..'), outDir);
  return JSON.parse(fs.readFileSync(path.join(bundleDir, MCP_BUNDLE_MANIFEST_FILE), 'utf8'));
}

/**
 * 对比 manifest 与当前源码/产物。返回问题列表；空数组表示 bundle 是最新的。
 * 不抛错，便于测试与 afterPack 统一处理。
 */
/**
 * @param {{ root?: string, outDir?: string }} [options]
 */
function auditMcpBundle({ root, outDir } = {}) {
  const resolvedRoot = path.resolve(root ?? path.join(__dirname, '..'));
  const bundleDir = resolveBundleDir(resolvedRoot, outDir);
  /** @type {string[]} */
  const problems = [];

  for (const file of [MCP_BUNDLE_SERVER_FILE, MCP_BUNDLE_WORKER_FILE, MCP_BUNDLE_MANIFEST_FILE]) {
    if (!fs.existsSync(path.join(bundleDir, file))) {
      problems.push(`missing ${file} in ${path.relative(resolvedRoot, bundleDir) || bundleDir}; run "npm run mcp:bundle"`);
    }
  }
  if (problems.length > 0) return problems;

  /** @type {{ schemaVersion?: number, version?: string, entry?: string, entrySha256?: string, serverSha256?: string, workerSha256?: string, toolCount?: number }} */
  let manifest;
  try {
    manifest = readMcpBundleManifest({ root: resolvedRoot, outDir });
  } catch (error) {
    problems.push(`bundle manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return problems;
  }

  if (manifest.schemaVersion !== MCP_BUNDLE_SCHEMA_VERSION) {
    problems.push(`bundle manifest schema ${String(manifest.schemaVersion)} is not supported`);
  }
  if (manifest.entry !== MCP_BUNDLE_SOURCE_ENTRY) {
    problems.push(`bundle manifest entry is ${String(manifest.entry)}, expected ${MCP_BUNDLE_SOURCE_ENTRY}`);
  }

  const expected = createMcpBundleManifest({ root: resolvedRoot, outDir });
  if (manifest.entrySha256 !== expected.entrySha256) {
    problems.push('MCP source entry changed after bundling (stale bundle); run "npm run mcp:bundle"');
  }
  if (manifest.serverSha256 !== expected.serverSha256) {
    problems.push('server.cjs does not match the manifest (stale or modified bundle); run "npm run mcp:bundle"');
  }
  if (manifest.workerSha256 !== expected.workerSha256) {
    problems.push('ragWorker.cjs does not match the manifest (stale or modified bundle); run "npm run mcp:bundle"');
  }
  if (manifest.version !== expected.version) {
    problems.push(`bundle version ${String(manifest.version)} does not match package.json ${expected.version}`);
  }
  if (manifest.toolCount !== expected.toolCount) {
    problems.push(`bundle exposes ${String(manifest.toolCount)} tools, source exposes ${expected.toolCount}`);
  }

  return problems;
}

module.exports = {
  MCP_BUNDLE_MANIFEST_FILE,
  MCP_BUNDLE_SCHEMA_VERSION,
  MCP_BUNDLE_SOURCE_ENTRY,
  MCP_BUNDLE_SERVER_FILE,
  MCP_BUNDLE_WORKER_FILE,
  createMcpBundleManifest,
  writeMcpBundleManifest,
  readMcpBundleManifest,
  auditMcpBundle,
};
