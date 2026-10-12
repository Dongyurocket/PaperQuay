const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'packaging', 'mcp');

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  fs.cpSync(source, target, { recursive: true, dereference: true });
  return true;
}

function copySqliteVec(targetNodeModules) {
  const sourceRoot = path.join(root, 'node_modules');
  const names = fs.readdirSync(sourceRoot).filter((name) => name === 'sqlite-vec' || name.startsWith('sqlite-vec-'));
  fs.mkdirSync(targetNodeModules, { recursive: true });
  for (const name of names) {
    copyIfExists(path.join(sourceRoot, name), path.join(targetNodeModules, name));
  }
  return names;
}

async function bundleMcp() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['bin/paperquay-mcp.cjs'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(outDir, 'server.cjs'),
    external: ['sqlite-vec', 'sqlite-vec-*'],
    legalComments: 'none',
    logLevel: 'warning',
  });

  const wasmSource = path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (!copyIfExists(wasmSource, path.join(outDir, 'sql-wasm.wasm'))) {
    throw new Error(`sql.js wasm was not found at ${wasmSource}`);
  }

  const sqlitePackages = copySqliteVec(path.join(outDir, 'node_modules'));
  if (!sqlitePackages.includes('sqlite-vec')) {
    throw new Error('sqlite-vec was not found in node_modules');
  }

  return {
    outDir,
    entry: path.join(outDir, 'server.cjs'),
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
