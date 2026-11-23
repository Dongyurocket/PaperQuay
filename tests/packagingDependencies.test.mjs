import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import packaging from '../electron/packagingDependencies.cjs';

const {
  RUNTIME_DEPENDENCIES,
  RENDERER_ONLY_DEPENDENCIES,
  REMOVED_DEPENDENCIES,
  auditPackagingDependencies,
} = packaging;

const ROOT = path.resolve('.');

test('packaging dependency classification has no drift', () => {
  const { problems, requires } = auditPackagingDependencies(ROOT);

  assert.deepEqual(problems, [], problems.join('\n'));
  // 运行时 require 的第三方包必须都在登记表里（否则安装版可能缺模块）。
  for (const name of requires) {
    const registered = RUNTIME_DEPENDENCIES.includes(name)
      || ['electron', 'builder-util', 'builder-util-runtime', 'esbuild'].includes(name);
    assert.equal(registered, true, `unregistered main-process require: ${name}`);
  }
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
