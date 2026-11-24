import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildRenderableBlocks,
  flattenMineruPages,
  parseMineruPages,
  resolveMineruAssetPath,
} from '../src/services/mineru.ts';

const require = createRequire(import.meta.url);
const { sanitizeMineruAssetReference } = require('../src/shared/mineruCachePaths.cjs');
const { resolveMineruAssetPath: resolveBackendAsset } = require('../electron/backend/mineruAssetPaths.cjs');
const { createMineruCacheCommands } = require('../electron/backend/mineruCacheCommands.cjs');

const MINERU_JSON_PATH = 'C:/cache/document-demo/content_list_v2.json';

function imageBlock(assetPath: string) {
  return flattenMineruPages(parseMineruPages([[
    {
      type: 'image',
      content: {
        image_source: { path: assetPath },
        image_caption: [{ content: 'Figure' }],
      },
      bbox: [10, 10, 100, 100],
    },
  ]]))[0];
}

function createTempRoot(prefix: string) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`cleanup skipped for ${dir}: ${(error as any)?.code ?? error}`);
  }
}

function normalizeSlashes(value: string | undefined) {
  return (value ?? '').replace(/\\/g, '/');
}

test('MinerU asset references reject absolute, drive, UNC, ADS, URL and traversal forms at the string layer', () => {
  for (const unsafe of [
    '',
    '   ',
    '/etc/passwd',
    '\\windows\\win.ini',
    'C:\\Windows\\win.ini',
    'C:images\\figure.png',
    '\\\\server\\share\\figure.png',
    '//server/share/figure.png',
    '\\\\?\\C:\\figure.png',
    'images\\figure.png:stream',
    'https://evil.example/figure.png',
    'file:///C:/figure.png',
    '../outside.png',
    'images/../../outside.png',
    'images/./figure.png',
    'images/',
    'images/\0figure.png',
  ]) {
    assert.equal(sanitizeMineruAssetReference(unsafe), null, `must reject ${JSON.stringify(unsafe)}`);
  }

  assert.equal(sanitizeMineruAssetReference('images/figure.png'), 'images/figure.png');
  assert.equal(sanitizeMineruAssetReference('images\\figure.png'), 'images/figure.png');
  assert.equal(sanitizeMineruAssetReference('figure.png'), 'figure.png');
});

test('renderer asset resolution joins only sanitized references to the cache directory', () => {
  assert.equal(
    normalizeSlashes(resolveMineruAssetPath(MINERU_JSON_PATH, 'images/figure.png')),
    'C:/cache/document-demo/images/figure.png',
  );
  for (const unsafe of [
    'C:\\Windows\\win.ini',
    '\\\\server\\share\\figure.png',
    '../outside.png',
    'images/figure.png:stream',
    'https://evil.example/figure.png',
    '/etc/passwd',
  ]) {
    assert.equal(resolveMineruAssetPath(MINERU_JSON_PATH, unsafe), undefined, `must reject ${unsafe}`);
  }
  assert.equal(resolveMineruAssetPath('cloud:token', 'images/figure.png'), undefined);
});

test('buildRenderableBlocks drops unsafe asset references instead of forwarding them to the loader', () => {
  const [valid] = buildRenderableBlocks([imageBlock('images/figure.png')], MINERU_JSON_PATH);
  assert.equal(normalizeSlashes(valid.assetPath), 'C:/cache/document-demo/images/figure.png');
  assert.equal(normalizeSlashes(valid.assetCacheDir), 'C:/cache/document-demo');
  assert.equal(valid.assetReference, 'images/figure.png');

  for (const unsafe of [
    'C:\\Windows\\win.ini',
    '\\\\server\\share\\figure.png',
    '../outside.png',
    'images/figure.png:stream',
  ]) {
    const [renderable] = buildRenderableBlocks([imageBlock(unsafe)], MINERU_JSON_PATH);
    assert.equal(renderable.assetPath, undefined, `must not forward ${unsafe}`);
    assert.equal(renderable.assetCacheDir, undefined);
    assert.equal(renderable.assetReference, undefined);
  }
});

test('backend resolver requires the real asset path to stay inside the cache directory', () => {
  const root = createTempRoot('paperquay-asset-');
  const cacheDir = path.join(root, 'document-demo');
  const outsideDir = path.join(root, 'outside');
  mkdirSync(path.join(cacheDir, 'images'), { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  const insideFile = path.join(cacheDir, 'images', 'figure.png');
  const outsideFile = path.join(outsideDir, 'secret.png');
  writeFileSync(insideFile, 'png');
  writeFileSync(outsideFile, 'secret');

  try {
    assert.deepEqual(resolveBackendAsset(cacheDir, 'images/figure.png'), {
      path: realpathSync.native ? realpathSync.native(insideFile) : realpathSync(insideFile),
      reason: '',
    });
    assert.equal(resolveBackendAsset(cacheDir, '../outside/secret.png').path, null);
    assert.equal(resolveBackendAsset(cacheDir, 'images/figure.png:stream').path, null);
    assert.equal(resolveBackendAsset(cacheDir, outsideFile).path, null);
    assert.equal(resolveBackendAsset(cacheDir, 'images/missing.png').reason, 'missing');
    assert.equal(resolveBackendAsset(path.join(root, 'missing-cache'), 'images/figure.png').reason, 'invalid');
  } finally {
    cleanup(root);
  }
});

test('backend resolver rejects UNC and ADS before touching the filesystem', () => {
  let realpathCalls = 0;
  const fakeFs = {
    realpathSync: {
      native(target: string) {
        realpathCalls += 1;
        return target;
      },
    },
  };

  for (const unsafe of [
    '\\\\server\\share\\figure.png',
    '\\\\?\\C:\\figure.png',
    'C:\\figure.png',
    '/etc/passwd',
    'images\\figure.png:stream',
    '../outside.png',
  ]) {
    const result = resolveBackendAsset('C:\\cache\\document-demo', unsafe, { fsImpl: fakeFs });
    assert.equal(result.path, null, `must reject ${unsafe}`);
    assert.equal(result.reason, 'invalid');
  }
  assert.equal(realpathCalls, 0, 'string-level rejection must happen before any SMB/realpath probe');
});

test('backend resolver blocks symlink escapes by comparing realpaths', () => {
  const root = createTempRoot('paperquay-asset-link-');
  const cacheDir = path.join(root, 'document-demo');
  const outsideFile = path.join(root, 'outside.png');
  mkdirSync(path.join(cacheDir, 'images'), { recursive: true });
  writeFileSync(outsideFile, 'secret');

  const fakeFs = {
    realpathSync: {
      native(target: string) {
        if (path.resolve(target) === path.resolve(cacheDir)) return path.resolve(cacheDir);
        return path.resolve(outsideFile);
      },
    },
  };

  try {
    assert.equal(
      resolveBackendAsset(cacheDir, 'images/escape.png', { fsImpl: fakeFs }).path,
      null,
      'an asset whose realpath leaves the cache directory must be rejected',
    );
  } finally {
    cleanup(root);
  }
});

test('read_mineru_asset_base64 reads only files inside a content-list cache directory', async () => {
  const root = createTempRoot('paperquay-asset-command-');
  const cacheDir = path.join(root, 'document-demo');
  const outsideDir = path.join(root, 'outside');
  mkdirSync(path.join(cacheDir, 'images'), { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(path.join(cacheDir, 'content_list_v2.json'), '[]');
  writeFileSync(path.join(cacheDir, 'images', 'figure.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(path.join(outsideDir, 'secret.png'), 'secret');

  // GitHub Windows runners expose tmpdir() as an 8.3 short path (RUNNER~1) while
  // resolveMineruAssetPath returns realpaths, so canonicalize both sides before comparing.
  const canonical = (p: string) => {
    try {
      return (realpathSync.native ?? realpathSync)(p);
    } catch {
      return path.resolve(p);
    }
  };
  const canonicalRoot = canonical(root);
  const commands = createMineruCacheCommands({
    appPaths: { mineruCacheDir: root, configPath: path.join(root, 'config.json') },
    pathPolicy: { isReadAllowed: (target: string) => canonical(target).startsWith(canonicalRoot) },
  });

  try {
    const base64 = await commands.read_mineru_asset_base64({
      cacheDir,
      assetPath: 'images/figure.png',
    });
    assert.equal(base64, Buffer.from('89504e470d0a1a0a', 'hex').toString('base64'));

    await assert.rejects(
      commands.read_mineru_asset_base64({ cacheDir, assetPath: '../outside/secret.png' }),
      /Invalid MinerU asset path/,
    );
    await assert.rejects(
      commands.read_mineru_asset_base64({ cacheDir, assetPath: path.join(outsideDir, 'secret.png') }),
      /Invalid MinerU asset path/,
    );
    await assert.rejects(
      commands.read_mineru_asset_base64({ cacheDir, assetPath: '\\\\server\\share\\figure.png' }),
      /Invalid MinerU asset path/,
    );
    await assert.rejects(
      commands.read_mineru_asset_base64({ cacheDir: outsideDir, assetPath: 'secret.png' }),
      /not a MinerU cache directory/,
    );
    await assert.rejects(
      commands.read_mineru_asset_base64({ cacheDir: '\\\\server\\share\\document', assetPath: 'figure.png' }),
      /not allowed/,
    );
  } finally {
    cleanup(root);
  }
});
