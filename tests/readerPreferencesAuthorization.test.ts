import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * B1 静态守卫：仓库没有 DOM 测试依赖，这里锁定设置页已接入
 * path_authorization_status，并在未授权/目录缺失时提供“重新选择目录”。
 */

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('reader preferences exposes re-authorization guidance for storage paths', () => {
  const content = read('src/features/reader/readerPreferencesContent.tsx');
  const desktop = read('src/services/desktop.ts');
  const types = read('src/features/reader/readerPreferencesTypes.ts');

  assert.match(desktop, /path_authorization_status/, 'desktop service must call the read-only status command');
  assert.match(desktop, /getPathAuthorizationStatus/, 'desktop service must export a typed status helper');
  assert.match(content, /getPathAuthorizationStatus/, 'preferences must query authorization status');
  assert.match(content, /重新选择目录/);
  assert.match(content, /Select Directory Again/);
  assert.match(content, /未授权|not authorized/i);
  assert.match(
    types,
    /onSelectLibraryStorageDir: \(\) => void \| Promise<void>/,
    'selection callbacks must be awaitable so the warning can refresh after re-authorization',
  );
  assert.match(types, /onSelectTranslatedPdfStorageDir: \(\) => void \| Promise<void>/);
  assert.match(types, /onSelectMineruCacheDir: \(\) => void \| Promise<void>/);
});
