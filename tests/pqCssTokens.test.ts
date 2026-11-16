import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(process.cwd(), 'src');
const tokenReference = /var\(\s*(--pq-[a-z0-9-]+)/g;
const tokenDefinition = /(--pq-[a-z0-9-]+)\s*:/g;

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

test('every --pq-* reference in src has a definition in index.css', () => {
  const css = fs.readFileSync(path.join(sourceRoot, 'app', 'index.css'), 'utf8');
  const definitions = new Set<string>();
  const references = new Map<string, string[]>();

  for (const match of css.matchAll(tokenDefinition)) {
    definitions.add(match[1]);
  }

  for (const filePath of sourceFiles(sourceRoot)) {
    const content = fs.readFileSync(filePath, 'utf8');

    for (const match of content.matchAll(tokenReference)) {
      const token = match[1];
      const files = references.get(token) ?? [];
      files.push(path.relative(process.cwd(), filePath));
      references.set(token, files);
    }
  }

  const missing = [...references.entries()]
    .filter(([token]) => !definitions.has(token))
    .map(([token, files]) => `${token}: ${[...new Set(files)].join(', ')}`)
    .sort();

  assert.deepEqual(missing, []);
});
