import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const storesRoot = path.join(srcRoot, 'stores');

// src/stores modules that are intentionally not imported by another renderer
// source file. Every entry needs a written justification, because a store that
// nothing imports is either dead code or a test-only fixture that should live
// under tests/ instead.
const ZERO_REFERENCE_ALLOWLIST = new Map([]);

function walk(directory) {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

const rendererSources = walk(srcRoot).filter((file) => /\.(?:ts|tsx)$/.test(file));

function readSource(file) {
  return readFileSync(file, 'utf8');
}

// Collect real module specifiers (static import/export-from, dynamic import,
// require, side-effect import) instead of matching bare substrings, so comments
// and prose that mention a path do not count as a reference.
function collectModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

function normalizeSpecifier(specifier) {
  return specifier.replace(/\\/g, '/');
}

function referencesStoreModule(importerFile, specifier, storeFile) {
  const importerDirectory = path.dirname(importerFile);
  const normalized = normalizeSpecifier(specifier);
  const storeWithoutExtension = storeFile.slice(0, -'.ts'.length);

  if (normalized.startsWith('.')) {
    const resolved = path.resolve(importerDirectory, specifier);
    return resolved === storeFile || resolved === storeWithoutExtension;
  }

  const storeModulePath = normalizeSpecifier(path.relative(srcRoot, storeWithoutExtension));
  return (
    normalized === storeModulePath ||
    normalized === `${storeModulePath}.ts` ||
    normalized.endsWith(`/${storeModulePath}`) ||
    normalized.endsWith(`/${storeModulePath}.ts`)
  );
}

test('renderer sources no longer reference the dead reader bridge store', () => {
  const offenders = rendererSources
    .filter((file) => readSource(file).includes('useReaderBridgeStore'))
    .map((file) => path.relative(root, file));

  assert.deepEqual(offenders, [], 'useReaderBridgeStore must have no renderer references');
  assert.equal(
    existsSync(path.join(storesRoot, 'useReaderBridgeStore.ts')),
    false,
    'src/stores/useReaderBridgeStore.ts must stay deleted; Reader.tsx owns the bridge state',
  );
});

test('the deleted reader bridge store test stays deleted', () => {
  assert.equal(
    existsSync(path.join(root, 'tests', 'readerBridgeStore.test.ts')),
    false,
    'tests/readerBridgeStore.test.ts must not come back for a deleted module',
  );
});

test('every src/stores module is imported by at least one other renderer source file', () => {
  const storeFiles = walk(storesRoot).filter((file) => file.endsWith('.ts'));
  assert.ok(storeFiles.length > 0, 'src/stores must contain store modules');

  const specifiersByFile = new Map(
    rendererSources.map((file) => [file, collectModuleSpecifiers(readSource(file))]),
  );

  const zeroReferenceModules = [];
  for (const storeFile of storeFiles) {
    const storeName = path.basename(storeFile, '.ts');
    const imported = rendererSources.some((importer) => {
      if (importer === storeFile) {
        return false;
      }
      return [...specifiersByFile.get(importer)].some((specifier) =>
        referencesStoreModule(importer, specifier, storeFile),
      );
    });

    if (!imported && !ZERO_REFERENCE_ALLOWLIST.has(storeName)) {
      zeroReferenceModules.push(path.relative(root, storeFile));
    }

    if (imported && ZERO_REFERENCE_ALLOWLIST.has(storeName)) {
      assert.fail(
        `src/stores/${storeName}.ts is listed in ZERO_REFERENCE_ALLOWLIST but is imported by renderer code; drop the stale allowlist entry`,
      );
    }
  }

  assert.deepEqual(
    zeroReferenceModules,
    [],
    'dead store modules must be deleted or justified in ZERO_REFERENCE_ALLOWLIST with evidence',
  );
});
