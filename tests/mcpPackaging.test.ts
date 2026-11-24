import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js');
const { Arch } = require('builder-util');
const asar = require('@electron/asar');
const { createPackage } = asar;
const {
  sqliteVecPlatformPackage,
  assertPackagedRuntimeDependencies,
} = require('../electron/afterPack.cjs');
const {
  auditPackagingDependencies,
} = require('../electron/packagingDependencies.cjs');

// sandbox preload 是 afterPack 的必需资源；测试夹具必须包含它。
async function writePreloadEntry(baseDir: string) {
  await mkdir(path.join(baseDir, 'electron'), { recursive: true });
  await writeFile(path.join(baseDir, 'electron', 'preload.bundle.cjs'), '// sandbox preload bundle\n');
}
const {
  PDFJS_ASSET_DIRS,
  PDFJS_LEGACY_REQUIRED_FILES,
  PDFJS_REQUIRED_FILES,
  assertPdfJsAssets,
  assertPdfJsRuntime,
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
      { from: 'node_modules/pdfjs-dist/legacy/build', to: 'pdfjs/legacy/build' },
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
  // D8-11：sqlite-vec 没有 windows-arm64 原生扩展，必须显式拒绝并给出可操作原因。
  assert.throws(
    () => sqliteVecPlatformPackage('win32', Arch.arm64),
    /sqlite-vec 0\.1\.9 publishes only sqlite-vec-windows-x64/,
  );
});

test('Build-Local does not rebuild the frontend and rejects arm64 explicitly', () => {
  const source = readFileSync(path.join(projectRoot, 'scripts', 'Build-Local.ps1'), 'utf8');
  assert.equal(/^\s*npm run build\s*$/m.test(source), false, 'electron:build already runs npm run build');
  assert.match(source, /sqlite-vec 0\.1\.9 publishes only sqlite-vec-windows-x64/);
});

test('afterPack verifies every closure package inside the real app.asar', async () => {
  const { closure, problems } = auditPackagingDependencies(projectRoot);
  assert.deepEqual(problems, [], problems.join('\n'));
  assert.ok(closure.size > 10, 'the runtime closure must contain transitive dependencies');

  const stage = await mkdtemp(path.join(tmpdir(), 'paperquay-asar-closure-'));
  const resources = path.join(stage, 'resources');
  const appStage = path.join(stage, 'app');
  const asarPath = path.join(resources, 'app.asar');
  const context = {
    appOutDir: stage,
    packager: {
      projectDir: projectRoot,
      getResourcesDir: () => resources,
    },
  };

  try {
    // 模拟 electron-builder 的真实布局：包内嵌套依赖被提升到 app 根。
    for (const entry of closure.values()) {
      const packagedPath = entry.path.includes('/node_modules/')
        ? `node_modules/${entry.name}`
        : entry.path;
      const packageDir = path.join(appStage, ...packagedPath.split('/'));
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, 'package.json'), '{}');
    }
    await writePreloadEntry(appStage);
    await mkdir(resources, { recursive: true });
    await createPackage(appStage, asarPath);

    await assertPackagedRuntimeDependencies(context);

    const victim = [...closure.values()].find((entry) => entry.path.includes('/node_modules/'))
      ?? [...closure.values()][0];
    const victimPath = victim.path.includes('/node_modules/')
      ? `node_modules/${victim.name}`
      : victim.path;
    await rm(path.join(appStage, ...victimPath.split('/')), { recursive: true, force: true });
    // @electron/asar 复用同一输出路径时会拿到旧索引；用新路径生成后替换。
    const rebuiltAsar = path.join(stage, 'app-missing.asar');
    await createPackage(appStage, rebuiltAsar);
    await rm(asarPath, { force: true });
    await rename(rebuiltAsar, asarPath);
    const escaped = victim.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await assert.rejects(assertPackagedRuntimeDependencies(context), new RegExp(escaped));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test('afterPack also checks the resources/app layout when asar is disabled', async () => {
  const { closure, problems } = auditPackagingDependencies(projectRoot);
  assert.deepEqual(problems, []);

  const stage = await mkdtemp(path.join(tmpdir(), 'paperquay-app-dir-closure-'));
  const resources = path.join(stage, 'resources');
  const appDir = path.join(resources, 'app');
  const context = {
    appOutDir: stage,
    packager: {
      projectDir: projectRoot,
      getResourcesDir: () => resources,
    },
  };

  try {
    for (const entry of closure.values()) {
      const packagedPath = entry.path.includes('/node_modules/')
        ? `node_modules/${entry.name}`
        : entry.path;
      const packageDir = path.join(appDir, ...packagedPath.split('/'));
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, 'package.json'), '{}');
    }

    await writePreloadEntry(appDir);
    await assertPackagedRuntimeDependencies(context);

    const victim = [...closure.values()].find((entry) => entry.path.includes('/node_modules/'))
      ?? [...closure.values()][0];
    const victimPath = victim.path.includes('/node_modules/')
      ? `node_modules/${victim.name}`
      : victim.path;
    await rm(path.join(appDir, ...victimPath.split('/')), { recursive: true, force: true });
    const escaped = victimPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await assert.rejects(assertPackagedRuntimeDependencies(context), new RegExp(escaped));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});

test('afterPack falls back to resources/app when app.asar is corrupt', async (t) => {
  const { closure, problems } = auditPackagingDependencies(projectRoot);
  assert.deepEqual(problems, []);

  const stage = await mkdtemp(path.join(tmpdir(), 'paperquay-asar-corrupt-'));
  const resources = path.join(stage, 'resources');
  const appDir = path.join(resources, 'app');
  const asarPath = path.join(resources, 'app.asar');
  const context = {
    appOutDir: stage,
    packager: {
      projectDir: projectRoot,
      getResourcesDir: () => resources,
    },
  };

  try {
    for (const entry of closure.values()) {
      const packagedPath = entry.path.includes('/node_modules/')
        ? `node_modules/${entry.name}`
        : entry.path;
      const packageDir = path.join(appDir, ...packagedPath.split('/'));
      await mkdir(packageDir, { recursive: true });
      await writeFile(path.join(packageDir, 'package.json'), '{}');
    }
    await writePreloadEntry(appDir);
    await mkdir(resources, { recursive: true });

    // 损坏的 asar（头部 pickle 无法解析，listPackage 抛 RangeError）不能阻断
    // 打包：afterPack 必须回退到 resources/app 目录继续核对依赖闭包。
    const corruptBytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 37 + 11) % 256));
    await writeFile(asarPath, corruptBytes);
    asar.uncacheAll();

    // 回退必须留下可诊断的 console.warn：包含 asar 读取错误与回退说明，
    // 否则打包日志只会表现为「依赖校验偶然改用 app/」。
    const warn = t.mock.method(console, 'warn', () => {});

    await assertPackagedRuntimeDependencies(context);

    const diagnostics = warn.mock.calls
      .map((call) => call.arguments
        .map((value) => (value instanceof Error ? `${value.name}: ${value.message}` : String(value)))
        .join(' '))
      .filter((text) => text.includes('app.asar'));
    assert.ok(diagnostics.length > 0, 'a corrupt app.asar must emit a fallback diagnostic');
    assert.ok(
      diagnostics.some((text) => text.includes('resources/app')
        && /memory outside buffer bounds|RangeError/.test(text)),
      `the diagnostic must carry the asar read error and the resources/app fallback; got: ${diagnostics.join(' | ')}`,
    );

    const victim = [...closure.values()].find((entry) => entry.path.includes('/node_modules/'))
      ?? [...closure.values()][0];
    const victimPath = victim.path.includes('/node_modules/')
      ? `node_modules/${victim.name}`
      : victim.path;
    await rm(path.join(appDir, ...victimPath.split('/')), { recursive: true, force: true });

    // 回退路径同样要拒绝缺失包，并报出具体包名而不是 asar 解析错误。
    const escaped = victimPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await assert.rejects(
      assertPackagedRuntimeDependencies(context),
      new RegExp(escaped),
      'a missing package under resources/app must still fail the post-pack assertion',
    );
  } finally {
    // @electron/asar 按路径缓存索引；临时目录删除后清掉，避免影响后续用例。
    asar.uncacheAll();
    await rm(stage, { recursive: true, force: true });
  }
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

test('post-pack assertion requires the legacy PDF.js runtime used by main-process metadata preview', async () => {
  const resourcesDir = await mkdtemp(path.join(tmpdir(), 'paperquay-pdfjs-legacy-'));
  const legacyRoot = path.join(resourcesDir, 'pdfjs', 'legacy', 'build');

  try {
    await mkdir(legacyRoot, { recursive: true });
    for (const relativePath of PDFJS_LEGACY_REQUIRED_FILES) {
      await writeFile(path.join(resourcesDir, 'pdfjs', relativePath), 'runtime');
    }
    await assertPdfJsRuntime(resourcesDir);

    await rm(path.join(legacyRoot, 'pdf.worker.mjs'), { force: true });
    await assert.rejects(assertPdfJsRuntime(resourcesDir), /pdf\.worker\.mjs/);
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
