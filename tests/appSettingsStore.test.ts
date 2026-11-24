import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const contract = require('../src/shared/appSettingsContract.cjs');
const { createAppSettingsStore } = require('../electron/backend/appSettings.cjs');

async function loadReaderShared() {
  const bundle = await build({
    bundle: true,
    entryPoints: ['src/features/reader/readerShared.ts'],
    format: 'esm',
    platform: 'node',
    sourcemap: false,
    write: false,
    logLevel: 'silent',
  });
  const code = bundle.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
}

function makePaths() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-app-settings-'));
  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    cleanup: () => rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

function readConfig(paths) {
  return JSON.parse(readFileSync(paths.configPath, 'utf8'));
}

function writeConfig(paths, value) {
  mkdirSync(path.dirname(paths.configPath), { recursive: true });
  writeFileSync(paths.configPath, JSON.stringify(value, null, 2), 'utf8');
}

test('settings contract covers every ReaderSettings and ReaderSecrets key', async () => {
  const { DEFAULT_SETTINGS, DEFAULT_SECRETS } = await loadReaderShared();

  assert.deepEqual(
    [...contract.SETTING_KEYS].sort(),
    Object.keys(DEFAULT_SETTINGS).sort(),
  );
  assert.deepEqual(
    [...contract.SECRET_KEYS].sort(),
    Object.keys(DEFAULT_SECRETS).sort(),
  );
});

test('v1 config migrates to a versioned document with revision', () => {
  const paths = makePaths();
  try {
    writeConfig(paths, {
      version: 1,
      settings: { noteCitationStyle: 'gbt7714', smoothScroll: true },
      secrets: { embeddingApiKey: 'sk-plain' },
      zoteroLocalDataDir: 'C:\\Zotero',
      leftSidebarCollapsed: true,
    });

    const store = createAppSettingsStore({ appPaths: paths, now: () => 123 });
    const doc = store.getPublic();

    assert.equal(doc.version, 2);
    assert.equal(doc.revision, 1);
    assert.equal(doc.settings.noteCitationStyle, 'gbt7714');
    assert.equal(doc.zoteroLocalDataDir, 'C:\\Zotero');
    assert.equal(doc.leftSidebarCollapsed, true);

    const persisted = readConfig(paths);
    assert.equal(persisted.version, 2);
    assert.equal(persisted.revision, 1);
    assert.equal(typeof persisted.secretsEncrypted, 'string');
    assert.equal('secrets' in persisted, false);
  } finally {
    paths.cleanup();
  }
});

test('patches merge by key and never roll back another writer', () => {
  const paths = makePaths();
  try {
    const store = createAppSettingsStore({ appPaths: paths, now: () => 1 });
    const initial = store.getPublic();
    assert.equal(initial.revision, 0);

    const afterNotes = store.patch(
      { noteCitationStyle: 'apa7' },
      { expectedRevision: initial.revision },
    );
    assert.equal(afterNotes.ok, true);
    assert.equal(afterNotes.settings.noteCitationStyle, 'apa7');
    assert.equal(afterNotes.revision, 1);

    // Reader writes an unrelated setting while holding the latest revision.
    const afterReader = store.patch(
      { smoothScroll: false },
      { expectedRevision: afterNotes.revision },
    );
    assert.equal(afterReader.ok, true);
    assert.equal(afterReader.settings.noteCitationStyle, 'apa7');
    assert.equal(afterReader.settings.smoothScroll, false);
    assert.equal(afterReader.revision, 2);
  } finally {
    paths.cleanup();
  }
});

test('a stale revision is rejected and does not overwrite the file', () => {
  const paths = makePaths();
  try {
    const store = createAppSettingsStore({ appPaths: paths, now: () => 1 });
    const first = store.patch({ noteCitationStyle: 'apa7' }, { expectedRevision: 0 });
    const stale = store.patch(
      { noteCitationStyle: 'gbt7714', smoothScroll: false },
      { expectedRevision: 0 },
    );

    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'SETTINGS_CONFLICT');
    assert.equal(stale.current.settings.noteCitationStyle, 'apa7');
    assert.equal(stale.current.revision, first.revision);

    const reloaded = createAppSettingsStore({ appPaths: paths }).getPublic();
    assert.equal(reloaded.settings.noteCitationStyle, 'apa7');
    assert.equal(reloaded.settings.smoothScroll, undefined);
  } finally {
    paths.cleanup();
  }
});

test('legacy localStorage migration fills missing keys and lets the notes style win', () => {
  const paths = makePaths();
  try {
    writeConfig(paths, {
      version: 1,
      settings: { noteCitationStyle: 'gbt7714', smoothScroll: true },
      zoteroLocalDataDir: '',
    });
    const store = createAppSettingsStore({
      appPaths: paths,
      legacyZoteroDir: () => 'D:\\Zotero',
      now: () => 5,
    });

    const migrated = store.migrateLegacy({
      settings: { noteCitationStyle: 'gbt7714', compactReading: true },
      secrets: { embeddingApiKey: 'sk-legacy' },
      noteCitationStyle: 'apa7',
    });

    assert.equal(migrated.ok, true);
    assert.equal(migrated.settings.noteCitationStyle, 'apa7');
    assert.equal(migrated.settings.compactReading, true);
    assert.equal(migrated.settings.smoothScroll, true);
    assert.equal(migrated.zoteroLocalDataDir, 'D:\\Zotero');
    assert.equal(store.getSecrets().embeddingApiKey, 'sk-legacy');

    // Migration is idempotent: a second run keeps the canonical values.
    const again = store.migrateLegacy({
      settings: { noteCitationStyle: 'gbt7714' },
      secrets: {},
      noteCitationStyle: null,
    });
    assert.equal(again.ok, true);
    assert.equal(again.settings.noteCitationStyle, 'apa7');
    assert.equal(again.settings.compactReading, true);
  } finally {
    paths.cleanup();
  }
});

test('unknown settings keys are rejected before touching the file', () => {
  const paths = makePaths();
  try {
    const store = createAppSettingsStore({ appPaths: paths, now: () => 1 });
    assert.throws(
      () => store.patch({ notARealSetting: true }, { expectedRevision: 0 }),
      /SETTINGS_UNKNOWN_KEY/,
    );
    assert.equal(existsSync(paths.configPath), false);
  } finally {
    paths.cleanup();
  }
});

test('secret patches are encrypted at rest and survive a reload', () => {
  const paths = makePaths();
  try {
    const store = createAppSettingsStore({ appPaths: paths, now: () => 1 });
    const result = store.patchSecrets(
      { embeddingApiKey: 'sk-secret-value', translationApiKey: 'sk-translate' },
      { expectedRevision: 0 },
    );
    assert.equal(result.ok, true);

    const raw = readFileSync(paths.configPath, 'utf8');
    assert.equal(raw.includes('sk-secret-value'), false);
    assert.equal(raw.includes('secretsEncrypted'), true);

    const reloaded = createAppSettingsStore({ appPaths: paths });
    assert.equal(reloaded.getSecrets().embeddingApiKey, 'sk-secret-value');
    assert.equal(reloaded.getSecrets().translationApiKey, 'sk-translate');
  } finally {
    paths.cleanup();
  }
});

test('the Zotero directory is patched with the same revision guard', () => {
  const paths = makePaths();
  try {
    const store = createAppSettingsStore({ appPaths: paths, now: () => 1 });
    const first = store.patchZoteroDir('D:\\Zotero', { expectedRevision: 0 });
    assert.equal(first.ok, true);
    assert.equal(first.zoteroLocalDataDir, 'D:\\Zotero');

    const stale = store.patchZoteroDir('E:\\Other', { expectedRevision: 0 });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'SETTINGS_CONFLICT');
    assert.equal(store.getPublic().zoteroLocalDataDir, 'D:\\Zotero');

    const second = store.patchZoteroDir('E:\\Other', { expectedRevision: first.revision });
    assert.equal(second.ok, true);
    assert.equal(second.zoteroLocalDataDir, 'E:\\Other');
  } finally {
    paths.cleanup();
  }
});

test('a corrupt or future settings file fails loudly instead of being replaced', () => {
  const paths = makePaths();
  try {
    writeConfig(paths, { version: 99, settings: {} });
    assert.throws(
      () => createAppSettingsStore({ appPaths: paths }).getPublic(),
      /SETTINGS_VERSION_UNSUPPORTED/,
    );

    writeFileSync(paths.configPath, '{ "settings": ', 'utf8');
    assert.throws(
      () => createAppSettingsStore({ appPaths: paths }).getPublic(),
      /SETTINGS_FILE_CORRUPT/,
    );
  } finally {
    paths.cleanup();
  }
});
