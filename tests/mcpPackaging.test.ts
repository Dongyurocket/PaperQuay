import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js');
const { Arch } = require('builder-util');
const { sqliteVecPlatformPackage } = require('../electron/afterPack.cjs');
const {
  PDFJS_ASSET_DIRS,
  PDFJS_REQUIRED_FILES,
  assertPdfJsAssets,
  resolvePdfJsAssetRoot,
} = require('../electron/pdfJsAssets.cjs');

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
      { from: 'node_modules/pdfjs-dist/cmaps', to: 'pdfjs/cmaps' },
      { from: 'node_modules/pdfjs-dist/standard_fonts', to: 'pdfjs/standard_fonts' },
      { from: 'node_modules/pdfjs-dist/image_decoders', to: 'pdfjs/image_decoders' },
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

test('packaged PDF.js asset root resolves to extraResources instead of asar', () => {
  assert.equal(
    resolvePdfJsAssetRoot({
      isPackaged: true,
      resourcesPath: path.join('C:', 'app', 'resources'),
      appDir: path.join('C:', 'app', 'resources', 'app.asar', 'electron'),
    }),
    path.join('C:', 'app', 'resources', 'pdfjs'),
  );
  assert.equal(
    resolvePdfJsAssetRoot({
      isPackaged: false,
      resourcesPath: path.join('C:', 'electron', 'resources'),
      appDir: path.join('C:', 'repo', 'electron'),
    }),
    path.join('C:', 'repo', 'electron', '..', 'node_modules', 'pdfjs-dist'),
  );
});

test('post-pack assertion fails when a PDF.js asset directory or file is missing', async () => {
  const resourcesDir = await mkdtemp(path.join(tmpdir(), 'paperquay-pdfjs-assets-'));

  try {
    for (const dirName of PDFJS_ASSET_DIRS) {
      const dirPath = path.join(resourcesDir, 'pdfjs', dirName);
      await mkdir(dirPath, { recursive: true });
      for (const fileName of PDFJS_REQUIRED_FILES[dirName]) {
        await writeFile(path.join(dirPath, fileName), 'asset');
      }
    }

    const counts = await assertPdfJsAssets(resourcesDir);
    assert.deepEqual(counts, {
      cmaps: PDFJS_REQUIRED_FILES.cmaps.length,
      standard_fonts: PDFJS_REQUIRED_FILES.standard_fonts.length,
      image_decoders: PDFJS_REQUIRED_FILES.image_decoders.length,
    });

    await rm(path.join(resourcesDir, 'pdfjs', 'standard_fonts'), { recursive: true, force: true });
    await assert.rejects(assertPdfJsAssets(resourcesDir), /standard_fonts/);
  } finally {
    await rm(resourcesDir, { recursive: true, force: true });
  }
});

test('post-pack assertion rejects a partial copy that still has the representative files', async () => {
  const resourcesDir = await mkdtemp(path.join(tmpdir(), 'paperquay-pdfjs-partial-'));
  const sourceRoot = path.join(projectRoot, 'node_modules', 'pdfjs-dist');

  try {
    for (const dirName of PDFJS_ASSET_DIRS) {
      const dirPath = path.join(resourcesDir, 'pdfjs', dirName);
      await mkdir(dirPath, { recursive: true });
      // 只复制代表文件：目录非空、代表文件齐全，但远少于源目录。
      for (const fileName of PDFJS_REQUIRED_FILES[dirName]) {
        await writeFile(path.join(dirPath, fileName), 'asset');
      }
    }

    await assert.rejects(
      assertPdfJsAssets(resourcesDir, sourceRoot),
      /incomplete/,
      'a partial copy must fail the file-count assertion',
    );

    // 不提供源目录时退回代表文件校验（跨平台打包机没有 devDependencies 的情况）。
    const counts = await assertPdfJsAssets(resourcesDir);
    assert.equal(counts.cmaps, PDFJS_REQUIRED_FILES.cmaps.length);
  } finally {
    await rm(resourcesDir, { recursive: true, force: true });
  }
});

test('the repository pdfjs-dist provides every required runtime asset', async () => {
  const pdfjsRoot = path.join(projectRoot, 'node_modules', 'pdfjs-dist');
  for (const dirName of PDFJS_ASSET_DIRS) {
    for (const fileName of PDFJS_REQUIRED_FILES[dirName]) {
      await statAccess(path.join(pdfjsRoot, dirName, fileName));
    }
  }
});

async function statAccess(filePath: string) {
  const { access } = await import('node:fs/promises');
  await access(filePath);
}
