import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readTranslationCache,
  writeTranslationCache,
} from '../src/features/reader/readerTranslationCache.ts';
import type { TranslationMap, WorkspaceItem } from '../src/types/reader.ts';

function item(overrides: Partial<WorkspaceItem> = {}): WorkspaceItem {
  return {
    itemKey: overrides.itemKey ?? 'paper-1',
    title: overrides.title ?? 'Paper Title',
    creators: overrides.creators ?? 'Author',
    year: overrides.year ?? '2026',
    itemType: overrides.itemType ?? 'journalArticle',
    source: overrides.source ?? 'native-library',
    workspaceId: overrides.workspaceId ?? 'native-library:paper-1',
    groupKey: overrides.groupKey ?? 'native-library:paper-1',
    ...overrides,
  };
}

const translations: TranslationMap = {
  'page-1-block-1': '第一段译文',
  'page-1-block-2': '第二段译文',
};

test('writeTranslationCache falls back to the default cache root when the configured root fails', async () => {
  const writes: Array<{ path: string; content: string }> = [];
  const result = await writeTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/custom-cache-fallback',
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translations,
    resolveFallbackRoot: async () => 'C:/default-cache-fallback',
    readText: async () => null,
    writeText: async (path, content) => {
      writes.push({ path, content });

      if (path.startsWith('C:/custom-cache-fallback/')) {
        throw new Error('EPERM: custom cache is not writable');
      }
    },
  });

  assert.match(result ?? '', /^C:\/default-cache-fallback\//);
  assert.equal(writes.length, 2);
  assert.match(writes[0].path, /^C:\/custom-cache-fallback\//);
  assert.match(writes[1].path, /^C:\/default-cache-fallback\//);

  const saved = JSON.parse(writes[1].content) as { translations: TranslationMap };
  assert.deepEqual(saved.translations, translations);
});

test('readTranslationCache reads the fallback cache when the configured root is missing', async () => {
  const reads: string[] = [];
  const result = await readTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/custom-cache',
    targetLanguage: 'Chinese',
    resolveFallbackRoot: async () => 'C:/default-cache',
    readText: async (path) => {
      reads.push(path);

      if (path.includes('/default-cache/')) {
        return JSON.stringify({
          version: 1,
          sourceLanguage: 'English',
          targetLanguage: 'Chinese',
          translatedAt: '2026-11-19T00:00:00.000Z',
          translations,
        });
      }

      return null;
    },
  });

  assert.ok(result);
  assert.equal(result.targetLanguage, 'Chinese');
  assert.deepEqual(result.translations, translations);
  assert.ok(reads.some((path) => path.includes('/custom-cache/')));
  assert.ok(reads.some((path) => path.includes('/default-cache/')));
});

test('readTranslationCache prefers the more complete cache when both roots exist', async () => {
  const result = await readTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/custom-cache',
    targetLanguage: 'Chinese',
    resolveFallbackRoot: async () => 'C:/default-cache',
    readText: async (path) => {
      if (path.includes('/custom-cache/')) {
        return JSON.stringify({
          version: 1,
          sourceLanguage: 'English',
          targetLanguage: 'Chinese',
          translatedAt: '2026-11-19T00:00:00.000Z',
          translations: { 'page-1-block-1': '第一段译文' },
        });
      }

      return JSON.stringify({
        version: 1,
        sourceLanguage: 'English',
        targetLanguage: 'Chinese',
        translatedAt: '2026-11-18T00:00:00.000Z',
        translations,
      });
    },
  });

  assert.ok(result);
  assert.equal(Object.keys(result.translations).length, 2);
  assert.match(result.path, /^C:\/default-cache\//);
});

test('writeTranslationCache treats a complete existing cache as saved when the rewrite fails', async () => {
  const writes: string[] = [];
  const result = await writeTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/custom-cache-complete',
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translations,
    resolveFallbackRoot: async () => 'C:/default-cache-complete',
    readText: async () => JSON.stringify({
      version: 1,
      sourceLanguage: 'English',
      targetLanguage: 'Chinese',
      translatedAt: '2026-11-18T00:00:00.000Z',
      translations,
    }),
    writeText: async (path) => {
      writes.push(path);
      throw new Error('EPERM: cache file is read-only');
    },
  });

  assert.match(result ?? '', /^C:\/custom-cache-complete\//);
  assert.equal(writes.length, 1);
});

test('writeTranslationCache reports both roots when neither can be written', async () => {
  await assert.rejects(
    () => writeTranslationCache({
      item: item(),
      mineruCacheDir: 'C:/custom-cache-fail',
      sourceLanguage: 'English',
      targetLanguage: 'Chinese',
      translations,
      resolveFallbackRoot: async () => 'C:/default-cache-fail',
      readText: async () => null,
      writeText: async (path) => {
        throw new Error(path.includes('custom-cache') ? 'custom denied' : 'default denied');
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /custom denied/);
      assert.match(error.message, /default denied/);
      return true;
    },
  );
});
