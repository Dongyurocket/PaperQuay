import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js');
const { Arch } = require('builder-util');
const { sqliteVecPlatformPackage } = require('../electron/afterPack.cjs');

const projectRoot = path.resolve('.');
const identity = (value: string) => value;

function stat(isDirectory: boolean) {
  return {
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  };
}

function matcher(from: string, patterns: string[]) {
  return new FileMatcher(from, path.join(projectRoot, 'release', 'resources'), identity, patterns);
}

test('installed MCP extraResources copies sqlite-vec outside the filtered node_modules child', () => {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const extraResources = packageJson.build.extraResources;

  assert.deepEqual(
    extraResources.map((entry: { from: string; to: string }) => ({ from: entry.from, to: entry.to })),
    [
      { from: 'packaging/mcp', to: 'paperquay-mcp' },
      { from: 'packaging/mcp/node_modules', to: 'paperquay-mcp/node_modules' },
    ],
  );

  const bundleDir = path.join(projectRoot, 'packaging', 'mcp');
  const bundled = matcher(bundleDir, extraResources[0].filter);
  assert.equal(bundled.createFilter()(path.join(bundleDir, 'server.cjs'), stat(false)), true);
  assert.equal(bundled.createFilter()(path.join(bundleDir, 'sql-wasm.wasm'), stat(false)), true);
  assert.equal(bundled.createFilter()(path.join(bundleDir, 'node_modules'), stat(true)), false);
  assert.equal(
    bundled.createFilter()(path.join(bundleDir, 'node_modules', 'sqlite-vec', 'package.json'), stat(false)),
    false,
  );

  const modulesDir = path.join(bundleDir, 'node_modules');
  const modules = matcher(modulesDir, extraResources[1].filter);
  const accept = modules.createFilter();
  assert.equal(accept(path.join(modulesDir, 'sqlite-vec', 'package.json'), stat(false)), true);
  assert.equal(accept(path.join(modulesDir, 'sqlite-vec-windows-x64', 'vec0.dll'), stat(false)), true);
  assert.equal(accept(path.join(modulesDir, 'sqlite-vec-darwin-arm64', 'vec0.dylib'), stat(false)), true);
  assert.equal(accept(path.join(modulesDir, 'sqlite-vec-linux-x64', 'vec0.so'), stat(false)), true);
});

test('afterPack sqlite-vec assertion uses the current Electron platform package', () => {
  assert.deepEqual(sqliteVecPlatformPackage('win32', Arch.x64), {
    packageName: 'sqlite-vec-windows-x64',
    extensionFile: 'vec0.dll',
  });
  assert.deepEqual(sqliteVecPlatformPackage('darwin', Arch.arm64), {
    packageName: 'sqlite-vec-darwin-arm64',
    extensionFile: 'vec0.dylib',
  });
  assert.deepEqual(sqliteVecPlatformPackage('linux', Arch.x64), {
    packageName: 'sqlite-vec-linux-x64',
    extensionFile: 'vec0.so',
  });
  assert.throws(() => sqliteVecPlatformPackage('win32', Arch.universal), /Unsupported Electron target/);
});
