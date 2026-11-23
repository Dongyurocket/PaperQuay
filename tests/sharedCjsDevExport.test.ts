import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  isSharedCjsModuleId,
  transformSharedCjsForDev,
} from '../vite.sharedCjs.ts';

const require = createRequire(import.meta.url);
const sharedDir = path.resolve('src', 'shared');

const sharedCjsFiles = readdirSync(sharedDir).filter((name) => name.endsWith('.cjs'));

test('every shared CJS module gets explicit ESM exports in dev', () => {
  assert.ok(sharedCjsFiles.length > 0, 'expected at least one src/shared/*.cjs module');

  for (const fileName of sharedCjsFiles) {
    const filePath = path.join(sharedDir, fileName);
    const source = readFileSync(filePath, 'utf8');
    const id = `${filePath.replace(/\\/g, '/')}?import`;

    assert.equal(isSharedCjsModuleId(id), true, `${fileName} should be recognized as a shared CJS module`);

    const transformed = transformSharedCjsForDev(source, id);
    assert.ok(transformed, `${fileName} should be transformed in dev`);
    assert.equal(transformed?.includes('module.exports'), false, `${fileName} must not leak module.exports`);
    assert.match(transformed ?? '', /export \{ /, `${fileName} should emit explicit ESM exports`);

    const expectedNames = Object.keys(require(filePath)).sort();
    const match = /export \{ ([^}]+) \};/.exec(transformed ?? '');
    const actualNames = (match?.[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .sort();
    assert.deepEqual(actualNames, expectedNames, `${fileName} export list must match module.exports`);
  }
});

test('non-shared modules and unsupported export styles are left alone or rejected', () => {
  assert.equal(isSharedCjsModuleId('C:/repo/src/features/reader/readerRag.ts'), false);
  assert.equal(
    transformSharedCjsForDev('module.exports = { a };', 'C:/repo/src/features/a.cjs'),
    null,
  );
  assert.throws(
    () => transformSharedCjsForDev('exports.a = 1;', 'C:/repo/src/shared/a.cjs'),
    /module\.exports/,
  );
  // 别名的 `local: exported` 形式必须生成正确的 as 语法，而不是把冒号两侧都当名字。
  assert.equal(
    transformSharedCjsForDev('function parse() {}\nmodule.exports = { parse: parseMarkdown };\n', 'C:/repo/src/shared/alias.cjs'),
    'function parse() {}\nexport { parse as parseMarkdown };\n',
  );
  assert.throws(
    () => transformSharedCjsForDev('module.exports = { "quoted": 1 };', 'C:/repo/src/shared/quoted.cjs'),
    /Unsupported export entry/,
  );
});

test('Vite dev server serves every shared CJS module as ESM', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: path.resolve('vite.config.ts'),
    server: { middlewareMode: true },
    logLevel: 'silent',
  });

  try {
    for (const fileName of sharedCjsFiles) {
      const result = await server.transformRequest(`/src/shared/${fileName}?import`);
      const code = result?.code ?? '';
      assert.ok(code, `${fileName} should produce transformed code`);
      assert.equal(code.includes('module.exports'), false, `${fileName} must not leak module.exports`);
      assert.match(code, /export \{/, `${fileName} should expose ESM exports in dev`);
    }
  } finally {
    await server.close();
  }
});
