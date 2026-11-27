import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBlockTranslationInput,
  buildTranslationSourceHashes,
  hashTranslationSourceText,
  reconcileTranslations,
  withCurrentSourceHashes,
} from '../src/features/reader/translationSource.ts';
import type { PositionedMineruBlock } from '../src/types/reader.ts';

function textBlock(
  blockId: string,
  text: string,
  extra: Partial<PositionedMineruBlock> = {},
): PositionedMineruBlock {
  return {
    blockId,
    pageIndex: 0,
    blockIndex: 0,
    type: 'text',
    content: text,
    ...extra,
  };
}

test('hashTranslationSourceText is deterministic and distinguishes edited text', () => {
  assert.equal(
    hashTranslationSourceText('Urban air mobility'),
    hashTranslationSourceText('Urban air mobility'),
  );
  assert.equal(
    hashTranslationSourceText('  Urban air mobility  '),
    hashTranslationSourceText('Urban air mobility'),
  );
  assert.notEqual(
    hashTranslationSourceText('Urban air mobility'),
    hashTranslationSourceText('Urban air mobility.'),
  );
  assert.notEqual(
    hashTranslationSourceText('Urban air mobility'),
    hashTranslationSourceText('urban air mobility'),
  );
});

test('buildBlockTranslationInput uses the reparse override as the translation source', () => {
  const block = textBlock('page-1-block-1', 'U<sup>RBAN</sup> air mobility is an emerging industry');
  const override = 'Urban air mobility is an emerging industry';
  const input = buildBlockTranslationInput(block, (blockId) =>
    blockId === 'page-1-block-1' ? override : undefined,
  );

  assert.ok(input);
  assert.equal(input.text, override);
  assert.equal(input.sourceHash, hashTranslationSourceText(override));
  assert.notEqual(input.sourceHash, hashTranslationSourceText('URBAN air mobility is an emerging industry'));
});

test('buildBlockTranslationInput skips merged child blocks', () => {
  const child = textBlock('page-2-block-1', 'child text', {
    contentSourceBlockId: 'page-1-block-1',
  });

  assert.equal(buildBlockTranslationInput(child), null);
});

test('buildTranslationSourceHashes trims ids and text consistently with the request', () => {
  const hashes = buildTranslationSourceHashes([
    { blockId: ' page-1-block-1 ', text: ' Alpha ' },
    { blockId: 'page-1-block-2', text: 'Beta' },
  ]);

  assert.deepEqual(hashes, {
    'page-1-block-1': hashTranslationSourceText('Alpha'),
    'page-1-block-2': hashTranslationSourceText('Beta'),
  });
});

test('legacy translations without a stored hash stay valid on unchanged source text', () => {
  const currentHash = hashTranslationSourceText('Alpha');
  const result = reconcileTranslations({
    translations: { a: '阿尔法' },
    storedHashes: {},
    currentHashes: { a: currentHash },
    customSourceBlockIds: new Set(),
  });

  assert.deepEqual(result.translations, { a: '阿尔法' });
  // 补写当前指纹后，下一次覆盖变化就能被检测出来。
  assert.deepEqual(result.sourceHashes, { a: currentHash });
});

test('legacy translations are stale once the block has an AI reparse override', () => {
  const currentHash = hashTranslationSourceText('Alpha repaired');
  const result = reconcileTranslations({
    translations: { a: '阿尔法' },
    storedHashes: {},
    currentHashes: { a: currentHash },
    customSourceBlockIds: new Set(['a']),
  });

  assert.deepEqual(result.translations, {});
  assert.deepEqual(result.sourceHashes, {});
});

test('stored source hashes must match the current source text', () => {
  const stale = reconcileTranslations({
    translations: { a: '阿尔法' },
    storedHashes: { a: hashTranslationSourceText('Alpha') },
    currentHashes: { a: hashTranslationSourceText('Alpha repaired') },
    customSourceBlockIds: new Set(['a']),
  });
  assert.deepEqual(stale.translations, {});

  const currentHash = hashTranslationSourceText('Alpha repaired');
  const current = reconcileTranslations({
    translations: { a: '阿尔法（修复后）' },
    storedHashes: { a: currentHash },
    currentHashes: { a: currentHash },
    customSourceBlockIds: new Set(['a']),
  });
  assert.deepEqual(current.translations, { a: '阿尔法（修复后）' });
  assert.deepEqual(current.sourceHashes, { a: currentHash });
});

test('reverting a reparse override invalidates the translation generated from the repaired text', () => {
  const overrideHash = hashTranslationSourceText('Alpha repaired');
  const originalHash = hashTranslationSourceText('Alpha');
  const result = reconcileTranslations({
    translations: { a: '阿尔法（修复后）' },
    storedHashes: { a: overrideHash },
    currentHashes: { a: originalHash },
    customSourceBlockIds: new Set(),
  });

  assert.deepEqual(result.translations, {});
});

test('blocks that no longer exist in the document are dropped when the known set is provided', () => {
  const result = reconcileTranslations({
    translations: { a: '阿尔法', gone: '旧块译文' },
    storedHashes: {},
    currentHashes: { a: hashTranslationSourceText('Alpha') },
    knownBlockIds: new Set(['a']),
  });

  assert.deepEqual(Object.keys(result.translations), ['a']);
});

test('withCurrentSourceHashes only keeps hashes for blocks that actually have translations', () => {
  const hashes = withCurrentSourceHashes(
    { a: '阿尔法' },
    { a: 'hash-a', b: 'hash-b' },
  );

  assert.deepEqual(hashes, { a: 'hash-a' });
});

test('reparse → retranslate → reopen keeps only the translation for the repaired text', async () => {
  const { readTranslationCache, writeTranslationCache } = await import(
    '../src/features/reader/readerTranslationCache.ts'
  );
  const files = new Map<string, string>();
  const store = {
    readText: async (path: string) => files.get(path) ?? null,
    writeText: async (path: string, content: string) => {
      files.set(path, content);
    },
  };
  const item = {
    itemKey: 'paper-1',
    title: 'Paper',
    creators: 'Author',
    year: '2026',
    itemType: 'journalArticle',
    source: 'native-library' as const,
    workspaceId: 'native-library:paper-1',
    groupKey: 'native-library:paper-1',
  };
  const common = {
    item,
    mineruCacheDir: 'C:/cache',
    sourceLanguage: 'English',
    targetLanguage: 'Chinese',
    identity: null,
    resolveFallbackRoot: async () => '',
  };
  const originalHash = hashTranslationSourceText('Original OCR text');
  const repairedHash = hashTranslationSourceText('Repaired OCR text');

  await writeTranslationCache({
    ...common,
    translations: { a: '旧译文' },
    sourceHashes: { a: originalHash },
    ...store,
  });

  const afterReparse = reconcileTranslations({
    translations: { a: '旧译文' },
    storedHashes: { a: originalHash },
    currentHashes: { a: repairedHash },
    customSourceBlockIds: new Set(['a']),
    knownBlockIds: new Set(['a']),
  });
  assert.deepEqual(afterReparse.translations, {});

  await writeTranslationCache({
    ...common,
    translations: { a: '新译文' },
    sourceHashes: { a: repairedHash },
    ...store,
  });

  const reopened = await readTranslationCache({
    ...common,
    readText: store.readText,
  });
  assert.ok(reopened);

  const reconciled = reconcileTranslations({
    translations: reopened.translations,
    storedHashes: reopened.sourceHashes,
    currentHashes: { a: repairedHash },
    customSourceBlockIds: new Set(['a']),
    knownBlockIds: new Set(['a']),
  });
  assert.deepEqual(reconciled.translations, { a: '新译文' });
});
