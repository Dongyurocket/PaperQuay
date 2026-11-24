import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';

import packaging from '../electron/packagingDependencies.cjs';

const {
  BUILD_ONLY_DEPENDENCIES,
  RUNTIME_DEPENDENCIES,
  RENDERER_ONLY_DEPENDENCIES,
  REMOVED_DEPENDENCIES,
  auditPackagingDependencies,
  packageCoveredByFiles,
  patternCoversPackage,
} = packaging;

const ROOT = path.resolve('.');

test('packaging dependency classification has no drift', () => {
  const { problems, requires, roots, closure } = auditPackagingDependencies(ROOT);

  assert.deepEqual(problems, [], problems.join('\n'));
  // 运行时 require 的第三方包必须都在登记表里（否则安装版可能缺模块）。
  for (const name of requires) {
    const registered = RUNTIME_DEPENDENCIES.includes(name)
      || BUILD_ONLY_DEPENDENCIES.has(name)
      || closure.has(`node_modules/${name}`);
    assert.equal(registered, true, `unregistered main-process require: ${name}`);
  }
  // 闭包由实际 require 展开，必须包含传递依赖，而不只是顶层白名单。
  assert.ok(roots.includes('pdf-lib'));
  assert.ok(roots.includes('electron-updater'));
  const paths = [...closure.values()].map((entry) => entry.path);
  assert.ok(paths.includes('node_modules/pdf-lib'), 'the closure must include pdf-lib');
  assert.ok(
    paths.some((entry) => entry.endsWith('/node_modules/pako')),
    'the closure must include nested pako',
  );
  assert.ok(
    paths.some((entry) => entry.endsWith('/node_modules/tslib')),
    'the closure must include nested tslib',
  );
  assert.ok(paths.includes('node_modules/sax'), 'builder-util-runtime pulls in sax');
});

test('the audit rejects a runtime package missing from build.files and honors negations', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-packaging-audit-'));
  const packageJson = (files) => ({
    name: 'fixture',
    version: '1.0.0',
    dependencies: { foo: '1.0.0' },
    build: { files },
  });
  try {
    mkdirSync(path.join(root, 'electron'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules', 'foo'), { recursive: true });
    writeFileSync(path.join(root, 'electron', 'main.cjs'), "require('foo');\n");
    writeFileSync(
      path.join(root, 'node_modules', 'foo', 'package.json'),
      JSON.stringify({ name: 'foo', version: '1.0.0' }),
    );
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson(['dist/**/*'])));

    let { problems } = auditPackagingDependencies(root);
    assert.ok(
      problems.some((problem) => problem.includes('build.files must include node_modules/foo/**/*')),
      problems.join('\n'),
    );

    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(packageJson(['dist/**/*', 'node_modules/foo/**/*'])),
    );
    ({ problems } = auditPackagingDependencies(root));
    assert.equal(
      problems.some((problem) => problem.includes('node_modules/foo')),
      false,
      problems.join('\n'),
    );

    // 负模式在后：即便有正向覆盖，最终仍会被排除。
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(packageJson(['dist/**/*', 'node_modules/foo/**/*', '!node_modules/foo/**/*'])),
    );
    ({ problems } = auditPackagingDependencies(root));
    assert.ok(
      problems.some((problem) => problem.includes('build.files must include node_modules/foo/**/*')),
      problems.join('\n'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('build.files glob coverage understands nested node_modules and wildcards', () => {
  assert.equal(patternCoversPackage('node_modules/pdf-lib/**/*', 'node_modules/pdf-lib'), true);
  assert.equal(
    patternCoversPackage('node_modules/pdf-lib/**/*', 'node_modules/pdf-lib/node_modules/pako'),
    true,
    '** must cross package-private node_modules',
  );
  assert.equal(
    patternCoversPackage('node_modules/@pdf-lib/**/*', 'node_modules/@pdf-lib/standard-fonts'),
    true,
  );
  assert.equal(
    patternCoversPackage('node_modules/sqlite-vec-*/*', 'node_modules/sqlite-vec-windows-x64'),
    true,
  );
  assert.equal(patternCoversPackage('node_modules/pdf-lib/**/*', 'node_modules/pako'), false);
  assert.equal(patternCoversPackage('!node_modules/pdf-lib/**/*', 'node_modules/pdf-lib'), false);
  assert.equal(patternCoversPackage('dist/**/*', 'node_modules/pdf-lib'), false);
  assert.equal(
    packageCoveredByFiles(
      ['node_modules/pdf-lib/**/*', '!node_modules/pdf-lib/**/*'],
      'node_modules/pdf-lib',
    ),
    false,
    'a later negative pattern must win',
  );
});

test('renderer-only and removed packages stay out of production dependencies', async () => {
  const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const dependencies = Object.keys(packageJson.dependencies ?? {});

  for (const name of RENDERER_ONLY_DEPENDENCIES) {
    assert.equal(dependencies.includes(name), false, `${name} must be a devDependency`);
  }
  for (const name of REMOVED_DEPENDENCIES) {
    assert.equal(name in dependencies, false, `${name} was removed and must not return`);
    assert.equal(name in (packageJson.devDependencies ?? {}), false, `${name} was removed and must not return`);
  }
  for (const name of RUNTIME_DEPENDENCIES) {
    assert.equal(dependencies.includes(name), true, `${name} must stay a runtime dependency`);
  }
});

test('engines and build.files cover the runtime contract', async () => {
  const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(ROOT, 'package.json'), 'utf8'));

  assert.equal(packageJson.engines?.node, '>=22.18');

  const files = packageJson.build?.files ?? [];
  for (const name of RUNTIME_DEPENDENCIES) {
    assert.equal(
      files.some((pattern) => pattern.startsWith(`node_modules/${name}/`)),
      true,
      `build.files must include node_modules/${name}`,
    );
  }
  assert.equal(files.some((pattern) => pattern.includes('temml')), false, 'temml was removed from build.files');
});
