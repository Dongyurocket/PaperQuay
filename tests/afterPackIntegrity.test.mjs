import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  assertAsarIntegrityResourceEntries,
  assertPackagedElectronFuses,
  assertWindowsAsarIntegrityResource,
  electronExecutablePath,
  resolveElectronFuseConfig,
} = require('../electron/afterPack.cjs');
const { FuseState } = require('@electron/fuses/dist/constants');
const { FuseV1Options } = require('@electron/fuses');

const ENABLED_WIRE = {
  version: '1',
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
  [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
};

function createContext({
  electronPlatformName = 'win32',
  appOutDir = 'C:\\out\\win-unpacked',
  electronFuses = {
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
} = {}) {
  const flipCalls = [];
  return {
    flipCalls,
    appOutDir,
    electronPlatformName,
    packager: {
      appInfo: { productFilename: 'PaperQuay' },
      config: { electronFuses },
      generateFuseConfig(config) {
        return {
          version: '1',
          [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
            config.enableEmbeddedAsarIntegrityValidation,
          [FuseV1Options.OnlyLoadAppFromAsar]: config.onlyLoadAppFromAsar,
        };
      },
      async addElectronFuses(context, fuseConfig) {
        flipCalls.push({ context, fuseConfig });
      },
    },
  };
}

test('afterPack flips the configured fuses before reading the final wire', async () => {
  const context = createContext();
  const reads = [];

  await assertPackagedElectronFuses(context, {
    async readFuseWire(executablePath) {
      reads.push(executablePath);
      return ENABLED_WIRE;
    },
  });

  assert.equal(context.flipCalls.length, 1, 'fuses must be applied inside afterPack');
  assert.equal(
    context.flipCalls[0].fuseConfig[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
    true,
  );
  assert.equal(context.flipCalls[0].fuseConfig[FuseV1Options.OnlyLoadAppFromAsar], true);
  assert.deepEqual(reads, [path.join('C:\\out\\win-unpacked', 'PaperQuay.exe')]);
});

test('afterPack rejects a binary whose ASAR integrity fuses are not enabled', async () => {
  const context = createContext();

  await assert.rejects(
    assertPackagedElectronFuses(context, {
      readFuseWire: async () => ({
        ...ENABLED_WIRE,
        [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.DISABLE,
      }),
    }),
    /ASAR integrity fuses/,
  );
  await assert.rejects(
    assertPackagedElectronFuses(context, {
      readFuseWire: async () => ({
        ...ENABLED_WIRE,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.DISABLE,
      }),
    }),
    /ASAR integrity fuses/,
  );
  await assert.rejects(
    assertPackagedElectronFuses(context, { readFuseWire: async () => null }),
    /ASAR integrity fuses/,
  );
});

test('afterPack refuses to build when the fuse configuration was weakened', async () => {
  const context = createContext({
    electronFuses: { enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: false },
  });
  await assert.rejects(
    assertPackagedElectronFuses(context, { readFuseWire: async () => ENABLED_WIRE }),
    /electronFuses must enable/,
  );

  const missing = createContext({ electronFuses: null });
  await assert.rejects(
    assertPackagedElectronFuses(missing, { readFuseWire: async () => ENABLED_WIRE }),
    /electronFuses must enable/,
  );
});

test('fuse config falls back to the explicit V1 wire when the packager helper is absent', () => {
  const config = resolveElectronFuseConfig({
    config: {
      electronFuses: { enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true },
    },
  });

  assert.equal(config.version, '1');
  assert.equal(config[FuseV1Options.EnableEmbeddedAsarIntegrityValidation], true);
  assert.equal(config[FuseV1Options.OnlyLoadAppFromAsar], true);
});

test('executable path follows the platform layout', () => {
  assert.equal(electronExecutablePath(createContext()), path.join('C:\\out\\win-unpacked', 'PaperQuay.exe'));
  assert.equal(
    electronExecutablePath(createContext({ electronPlatformName: 'darwin', appOutDir: '/out/mac' })),
    path.join('/out/mac', 'PaperQuay.app'),
  );

  const linuxContext = createContext({ electronPlatformName: 'linux', appOutDir: '/out/linux' });
  linuxContext.packager.executableName = 'paperquay';
  assert.equal(electronExecutablePath(linuxContext), path.join('/out/linux', 'paperquay'));
});

test('ELECTRONASAR payload must describe app.asar with an sha256 hash', () => {
  const valid = [{ file: 'resources\\app.asar', alg: 'sha256', value: 'a'.repeat(64) }];
  assert.doesNotThrow(() => assertAsarIntegrityResourceEntries(valid));

  // electron-builder 实际写出大写 SHA256。
  assert.doesNotThrow(() =>
    assertAsarIntegrityResourceEntries([
      { file: 'resources\\app.asar', alg: 'SHA256', value: 'b'.repeat(64) },
    ]),
  );

  for (const entries of [
    null,
    [],
    [{ file: 'resources\\other.asar', alg: 'sha256', value: 'abc' }],
    [{ file: 'resources\\app.asar', alg: 'md5', value: 'abc' }],
    [{ file: 'resources\\app.asar', alg: 'sha256', value: '' }],
    [{ file: 'resources\\app.asar', alg: 'sha256', value: 42 }],
  ]) {
    assert.throws(
      () => assertAsarIntegrityResourceEntries(entries),
      /ELECTRONASAR|app\.asar/,
      `payload should be rejected: ${JSON.stringify(entries)}`,
    );
  }
});

test('Windows ASAR integrity resource is read from the packaged executable', async () => {
  const context = createContext();
  const reads = [];
  await assertWindowsAsarIntegrityResource(context, {
    async readEntries(executablePath) {
      reads.push(executablePath);
      return [{ file: 'resources\\app.asar', alg: 'sha256', value: 'b'.repeat(64) }];
    },
  });
  assert.deepEqual(reads, [path.join('C:\\out\\win-unpacked', 'PaperQuay.exe')]);

  await assert.rejects(
    assertWindowsAsarIntegrityResource(context, { readEntries: async () => null }),
    /ELECTRONASAR/,
  );
});

test('non-Windows platforms skip the PE resource check', async () => {
  const context = createContext({ electronPlatformName: 'linux' });
  let reads = 0;
  await assertWindowsAsarIntegrityResource(context, {
    async readEntries() {
      reads += 1;
      return [];
    },
  });
  assert.equal(reads, 0);
});
