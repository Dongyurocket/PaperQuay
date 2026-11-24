import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

test('desktop minimum width keeps the 980px responsive fallback reachable', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /minWidth:\s*960/);
  assert.equal(/minWidth:\s*1040/.test(main), false);

  const css = read('src/app/index.css');
  assert.match(css, /@media \(max-width: 980px\)/);

  const designDoc = read('docs/ui-design-system.md');
  assert.match(designDoc, /960px/);
  assert.match(designDoc, /@media \(max-width: 980px\)/);
});
