import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginTranslationCacheRestore,
  createTranslationCacheIdentity,
  deleteTranslationCache,
  hasTranslationCacheClearedMarker,
  isTranslationCacheRestoreTokenCurrent,
  markTranslationCacheCleared,
  readTranslationCache,
  resetTranslationCacheSessionState,
  writeTranslationCache,
} from '../src/features/reader/readerTranslationCache.ts';
import {
  buildMineruTranslationCachePath,
  buildMineruTranslationCachePathCandidates,
} from '../src/utils/mineruCache.ts';
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
    identity: null,
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
    identity: null,
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
    identity: null,
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
    identity: null,
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

function memoryCacheStore() {
  const files = new Map<string, string>();

  return {
    files,
    deleteText: async (path: string) => files.delete(path),
    readText: async (path: string) => files.get(path) ?? null,
    writeText: async (path: string, content: string) => {
      files.set(path, content);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

const identityA = createTranslationCacheIdentity(
  'https://api.example.test/v1',
  'model-a',
  'English',
)!;

test('deleteTranslationCache removes every candidate file from both cache roots', async () => {
  resetTranslationCacheSessionState();
  const deleted: string[] = [];
  const listedDirectories: string[] = [];

  const result = await deleteTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/primary-cache',
    targetLanguage: 'Chinese',
    identity: identityA,
    resolveFallbackRoot: async () => 'C:/fallback-cache',
    listFiles: async (directory) => {
      listedDirectories.push(directory);

      return [
        `${directory}/chinese.json`,
        `${directory}/chinese-11111111.json`,
        `${directory}/chinese-22222222.json`,
        `${directory}/chinese-not-a-cache.json`,
        `${directory}/english.json`,
      ];
    },
    deleteText: async (path) => {
      deleted.push(path);
      return true;
    },
  });

  assert.deepEqual(result.failed, []);
  assert.equal(new Set(deleted).size, deleted.length);

  for (const root of ['C:/primary-cache', 'C:/fallback-cache']) {
    assert.ok(
      deleted.some((path) => path.startsWith(root) && /chinese-[0-9a-f]{8}\.json$/.test(path)),
      `expected a model-keyed cache under ${root}`,
    );
    assert.ok(
      deleted.some((path) => path.startsWith(root) && path.endsWith('/chinese.json')),
      `expected the legacy language cache under ${root}`,
    );
  }

  // 目录里由历史模型写下的其它哈希文件同样要被清除，其它语言不受影响。
  assert.ok(deleted.some((path) => path.endsWith('/chinese-11111111.json')));
  assert.ok(deleted.some((path) => path.endsWith('/chinese-22222222.json')));
  assert.ok(!deleted.some((path) => path.endsWith('/english.json')));
  assert.ok(!deleted.some((path) => path.endsWith('/chinese-not-a-cache.json')));
  assert.ok(deleted.length >= 24, `expected all layout candidates, got ${deleted.length}`);
  assert.equal(listedDirectories.length, 6);
});

test('deleteTranslationCache still removes identity and legacy candidates without directory listing', async () => {
  resetTranslationCacheSessionState();
  const deleted: string[] = [];

  const result = await deleteTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/primary-cache',
    targetLanguage: 'Chinese',
    identity: identityA,
    resolveFallbackRoot: async () => '',
    listFiles: async () => {
      throw new Error('EACCES: listing denied');
    },
    deleteText: async (path) => {
      deleted.push(path);
      return true;
    },
  });

  assert.deepEqual(result.failed, []);
  assert.ok(deleted.some((path) => /chinese-[0-9a-f]{8}\.json$/.test(path)));
  assert.ok(deleted.some((path) => path.endsWith('/chinese.json')));
});

test('a failed disk deletion keeps the session cleared marker so restore stays suppressed', async () => {
  resetTranslationCacheSessionState();

  const result = await deleteTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/primary-cache',
    targetLanguage: 'Chinese',
    identity: identityA,
    resolveFallbackRoot: async () => '',
    listFiles: async () => [],
    deleteText: async () => {
      throw new Error('EPERM: cache file is locked');
    },
  });

  assert.ok(result.failed.length > 0);
  assert.equal(hasTranslationCacheClearedMarker(item(), 'Chinese'), true);
  assert.equal(beginTranslationCacheRestore(item(), 'Chinese'), null);

  // 清除只作用于当前文稿和当前目标语言，切换后可以正常恢复。
  assert.ok(beginTranslationCacheRestore(item({ workspaceId: 'native-library:other' }), 'Chinese'));
  assert.ok(beginTranslationCacheRestore(item(), 'English'));

  // 新译文成功写入后解除会话标记，后续恢复重新可用。
  await writeTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/primary-cache',
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translations,
    identity: identityA,
    resolveFallbackRoot: async () => '',
    readText: async () => null,
    writeText: async () => undefined,
  });

  assert.equal(hasTranslationCacheClearedMarker(item(), 'Chinese'), false);
  assert.ok(beginTranslationCacheRestore(item(), 'Chinese'));
});

test('clear invalidates an in-flight restore read for the same paper and target language', async () => {
  resetTranslationCacheSessionState();
  const pendingRead = deferred<string | null>();
  const token = beginTranslationCacheRestore(item(), 'Chinese');

  assert.ok(token);

  const readPromise = readTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/primary-cache',
    targetLanguage: 'Chinese',
    identity: null,
    resolveFallbackRoot: async () => '',
    readText: () => pendingRead.promise,
  });

  markTranslationCacheCleared(item(), 'Chinese');
  pendingRead.resolve(JSON.stringify({
    version: 1,
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translatedAt: '2026-11-19T00:00:00.000Z',
    translations,
  }));

  const restored = await readPromise;

  // 读取本身仍然完成，但旧 generation 的结果不会被回填。
  assert.ok(restored);
  assert.equal(isTranslationCacheRestoreTokenCurrent(token), false);

  const otherLanguageToken = beginTranslationCacheRestore(item(), 'English');
  const otherPaperToken = beginTranslationCacheRestore(
    item({ workspaceId: 'native-library:other' }),
    'Chinese',
  );

  assert.ok(otherLanguageToken);
  assert.ok(otherPaperToken);
  markTranslationCacheCleared(item(), 'Chinese');
  assert.equal(isTranslationCacheRestoreTokenCurrent(otherLanguageToken), true);
  assert.equal(isTranslationCacheRestoreTokenCurrent(otherPaperToken), true);
});

test('cache identity includes model and source language while legacy language caches still read', async () => {
  resetTranslationCacheSessionState();
  const modelB = createTranslationCacheIdentity(
    'https://api.example.test/v1',
    'model-b',
    'English',
  )!;
  const sourceB = createTranslationCacheIdentity(
    'https://api.example.test/v1',
    'model-a',
    'French',
  )!;
  const pathA = buildMineruTranslationCachePath('C:/cache', item(), 'Chinese', identityA);
  const pathB = buildMineruTranslationCachePath('C:/cache', item(), 'Chinese', modelB);
  const pathSourceB = buildMineruTranslationCachePath('C:/cache', item(), 'Chinese', sourceB);
  const legacyPath = buildMineruTranslationCachePath('C:/cache', item(), 'Chinese');

  assert.match(pathA, /\/chinese-[0-9a-f]{8}\.json$/);
  assert.match(legacyPath, /\/chinese\.json$/);
  assert.notEqual(pathA, pathB);
  assert.notEqual(pathA, pathSourceB);
  assert.notEqual(pathA, legacyPath);

  const candidates = buildMineruTranslationCachePathCandidates('C:/cache', item(), 'Chinese', identityA);
  assert.ok(candidates.includes(pathA));
  assert.ok(candidates.includes(legacyPath));

  const store = memoryCacheStore();

  await writeTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/cache',
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translations,
    identity: identityA,
    resolveFallbackRoot: async () => '',
    readText: store.readText,
    writeText: store.writeText,
  });

  assert.ok(store.files.has(pathA));

  // 旧版本写下的 <targetLanguage>.json 仍然能被新模型读取。
  store.files.set(legacyPath, JSON.stringify({
    version: 1,
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translatedAt: '2026-11-18T00:00:00.000Z',
    translations: { 'legacy-block': '历史译文' },
  }));

  const legacyRead = await readTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/cache',
    targetLanguage: 'Chinese',
    identity: modelB,
    resolveFallbackRoot: async () => '',
    readText: store.readText,
  });

  assert.ok(legacyRead);
  assert.equal(legacyRead.path, legacyPath);
  assert.deepEqual(legacyRead.translations, { 'legacy-block': '历史译文' });

  // 当前模型读取时把身份缓存与旧缓存合并，块不丢失。
  const mergedRead = await readTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/cache',
    targetLanguage: 'Chinese',
    identity: identityA,
    resolveFallbackRoot: async () => '',
    readText: store.readText,
  });

  assert.ok(mergedRead);
  assert.equal(mergedRead.path, pathA);
  assert.deepEqual(mergedRead.translations, {
    'page-1-block-1': '第一段译文',
    'page-1-block-2': '第二段译文',
    'legacy-block': '历史译文',
  });
});

test('two concurrent writers merge blocks instead of overwriting each other', async () => {
  resetTranslationCacheSessionState();
  const store = memoryCacheStore();
  const yieldToIo = () => new Promise<void>((resolve) => setImmediate(resolve));
  const readText = async (path: string) => {
    // 让出宏任务保证两个写入都进入异步路径；按路径锁负责串行化，不依赖固定延时。
    await yieldToIo();
    return store.readText(path);
  };
  const writeText = async (path: string, content: string) => {
    await yieldToIo();
    await store.writeText(path, content);
  };

  const [firstPath, secondPath] = await Promise.all([
    writeTranslationCache({
      item: item(),
      mineruCacheDir: 'C:/cache',
      sourceLanguage: 'English',
      targetLanguage: 'Chinese',
      translations: { 'page-1-block-1': '第一段译文' },
      identity: identityA,
      resolveFallbackRoot: async () => '',
      readText,
      writeText,
    }),
    writeTranslationCache({
      item: item(),
      mineruCacheDir: 'C:/cache',
      sourceLanguage: 'English',
      targetLanguage: 'Chinese',
      translations: { 'page-1-block-2': '第二段译文' },
      identity: identityA,
      resolveFallbackRoot: async () => '',
      readText,
      writeText,
    }),
  ]);

  assert.equal(firstPath, secondPath);

  const saved = JSON.parse(store.files.get(firstPath ?? '') ?? '{}') as {
    translations: TranslationMap;
  };

  assert.deepEqual(saved.translations, translations);
});

test('a clear issued during an in-flight write keeps the session cleared marker', async () => {
  resetTranslationCacheSessionState();
  const store = memoryCacheStore();
  const writeStarted = deferred<void>();
  const writeGate = deferred<void>();
  const writePromise = writeTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/cache',
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translations,
    identity: identityA,
    resolveFallbackRoot: async () => '',
    readText: store.readText,
    writeText: async (path, content) => {
      writeStarted.resolve();
      await writeGate.promise;
      await store.writeText(path, content);
    },
  });

  await writeStarted.promise;
  markTranslationCacheCleared(item(), 'Chinese');
  writeGate.resolve();
  await writePromise;

  // 这次写入发生在清除之前，成功后也不能解除清除标记。
  assert.equal(hasTranslationCacheClearedMarker(item(), 'Chinese'), true);
  assert.equal(beginTranslationCacheRestore(item(), 'Chinese'), null);
});

test('the current model cache wins over a more complete legacy cache for the same block', async () => {
  resetTranslationCacheSessionState();
  const store = memoryCacheStore();
  const identityPath = buildMineruTranslationCachePath('C:/cache', item(), 'Chinese', identityA);
  const legacyPath = buildMineruTranslationCachePath('C:/cache', item(), 'Chinese');

  store.files.set(identityPath, JSON.stringify({
    version: 1,
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translatedAt: '2026-11-19T00:00:00.000Z',
    translations: { 'page-1-block-1': '当前模型译文' },
  }));
  store.files.set(legacyPath, JSON.stringify({
    version: 1,
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    translatedAt: '2026-11-20T00:00:00.000Z',
    translations: {
      'page-1-block-1': '旧版模型译文',
      'page-1-block-2': '第二段译文',
      'page-1-block-3': '第三段译文',
    },
  }));

  const result = await readTranslationCache({
    item: item(),
    mineruCacheDir: 'C:/cache',
    targetLanguage: 'Chinese',
    identity: identityA,
    resolveFallbackRoot: async () => '',
    readText: store.readText,
  });

  assert.ok(result);
  assert.equal(result.path, identityPath);
  assert.deepEqual(result.translations, {
    'page-1-block-1': '当前模型译文',
    'page-1-block-2': '第二段译文',
    'page-1-block-3': '第三段译文',
  });
});
