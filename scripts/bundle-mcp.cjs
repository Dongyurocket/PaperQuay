const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const {
  MCP_BUNDLE_OUT_FILE,
  MCP_BUNDLE_WORKER_OUT_FILE,
  createMcpBundleOptions,
  createMcpWorkerBundleOptions,
  resolveMcpBundlePaths,
} = require('./bundleMcpConfig.cjs');
const { writeMcpBundleManifest } = require('../electron/mcpBundleManifest.cjs');

const projectRoot = resolveMcpBundlePaths().root;

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.cpSync(source, target, { recursive: true, dereference: true });
  return true;
}

function copySqliteVec(targetNodeModules) {
  const sourceRoot = path.join(projectRoot, 'node_modules');
  const names = fs.readdirSync(sourceRoot).filter((name) => name === 'sqlite-vec' || name.startsWith('sqlite-vec-'));
  fs.mkdirSync(targetNodeModules, { recursive: true });
  for (const name of names) {
    copyIfExists(path.join(sourceRoot, name), path.join(targetNodeModules, name));
  }
  return names;
}

/**
 * Bundle the stdio server into packaging/mcp by default. Tests pass `outDir` to
 * build into a temporary directory with identical options.
 */
async function bundleMcp({ outDir } = {}) {
  const defaultPaths = resolveMcpBundlePaths();
  const targetOutDir = outDir ? path.resolve(outDir) : defaultPaths.outDir;

  fs.rmSync(targetOutDir, { recursive: true, force: true });
  fs.mkdirSync(targetOutDir, { recursive: true });

  await esbuild.build(createMcpBundleOptions({ outDir: targetOutDir }));
  // D3-2：MCP 的 ragWorkerHost 以 __dirname/ragWorker.cjs 启动 worker；
  // 安装版必须把 worker 与 server.cjs 放在同一目录，并让它自带依赖闭包。
  await esbuild.build(createMcpWorkerBundleOptions({ outDir: targetOutDir }));

  const wasmSource = path.join(projectRoot, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (!copyIfExists(wasmSource, path.join(targetOutDir, 'sql-wasm.wasm'))) {
    throw new Error(`sql.js wasm was not found at ${wasmSource}`);
  }

  const sqlitePackages = copySqliteVec(path.join(targetOutDir, 'node_modules'));
  if (!sqlitePackages.includes('sqlite-vec')) {
    throw new Error('sqlite-vec was not found in node_modules');
  }

  // D3-13：记录源入口/产物 hash 与工具数，afterPack 校验 stale bundle。
  const manifest = writeMcpBundleManifest({ root: projectRoot, outDir: targetOutDir });

  return {
    outDir: targetOutDir,
    entry: path.join(targetOutDir, MCP_BUNDLE_OUT_FILE),
    workerEntry: path.join(targetOutDir, MCP_BUNDLE_WORKER_OUT_FILE),
    manifest,
    sqlitePackages,
  };
}

if (require.main === module) {
  bundleMcp()
    .then((result) => {
      console.log(`PaperQuay MCP bundle: ${result.entry}`);
      console.log(`sqlite-vec packages: ${result.sqlitePackages.join(', ')}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

module.exports = { bundleMcp };
