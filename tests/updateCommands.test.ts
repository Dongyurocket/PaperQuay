import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  cleanVersion,
  compareVersions,
  getAutoUpdateSupport,
} = require('../electron/backend/updateCommands.cjs') as {
  cleanVersion: (value: unknown) => string;
  compareVersions: (left: unknown, right: unknown) => number;
  getAutoUpdateSupport: (app: { isPackaged: boolean }, platform?: string) => {
    supported: boolean;
    channel?: string;
    reason: string;
  };
};

test('cleanVersion normalizes PaperQuay release tags', () => {
  assert.equal(cleanVersion('app-v0.1.19'), '0.1.19');
  assert.equal(cleanVersion('v1.2.3'), '1.2.3');
});

test('compareVersions orders semantic versions and prereleases', () => {
  assert.equal(compareVersions('0.1.20', '0.1.19'), 1);
  assert.equal(compareVersions('0.1.19', '0.1.19'), 0);
  assert.equal(compareVersions('0.1.19-beta.1', '0.1.19'), -1);
});

test('getAutoUpdateSupport disables automatic install in development', () => {
  assert.deepEqual(getAutoUpdateSupport({ isPackaged: false }), {
    supported: false,
    reason: 'development',
  });
});

test('automatic updates are limited to maintained Windows packages', () => {
  assert.deepEqual(getAutoUpdateSupport({ isPackaged: true }, 'win32'), {
    supported: true, channel: 'nsis', reason: '',
  });
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    assert.deepEqual(getAutoUpdateSupport({ isPackaged: true }, platform), {
      supported: false, reason: 'self-build-only',
    });
  }
});
