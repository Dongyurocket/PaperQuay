import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';

import type { ReaderConfigDependencies } from '../src/services/readerConfig.ts';
import type { ReaderConfigFile } from '../src/types/reader.ts';

const require = createRequire(import.meta.url);

interface ReaderConfigSecretsModule {
  readReaderConfigFileAt: (
    configPath: string,
    dependencies: ReaderConfigDependencies,
  ) => Promise<Partial<ReaderConfigFile> | null>;
  writeReaderConfigFile: (
    config: Partial<ReaderConfigFile>,
    defaultPaths: { configPath: string },
    dependencies: ReaderConfigDependencies,
  ) => Promise<void>;
  readerConfigBackupPath: (configPath: string) => string;
}

const readerConfig: ReaderConfigSecretsModule = await (async () => {
  const result = await build({
    entryPoints: ['src/services/readerConfig.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const module = { exports: {} as ReaderConfigSecretsModule };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  return module.exports;
})();

const { readReaderConfigFileAt, readerConfigBackupPath, writeReaderConfigFile } = readerConfig;

function createDependencies(): ReaderConfigDependencies & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readTextFileIfExists: async (filePath) => (files.has(filePath) ? files.get(filePath)! : null),
    writeTextFile: async (filePath, content) => {
      files.set(filePath, content);
    },
    encryptSecretPayload: async (payload) => `enc:v1:${Buffer.from(payload, 'utf8').toString('base64')}`,
    decryptSecretPayload: async (value) => {
      assert.ok(value.startsWith('enc:v1:'));
      return Buffer.from(value.slice('enc:v1:'.length), 'base64').toString('utf8');
    },
  };
}

function configWithSecrets(apiKey: string): Partial<ReaderConfigFile> {
  return {
    version: 3,
    settings: {} as ReaderConfigFile['settings'],
    secrets: {
      mineruApiToken: '',
      translationApiKey: apiKey,
      summaryApiKey: '',
      embeddingApiKey: '',
      zoteroApiKey: '',
      zoteroUserId: '',
      qaModelPresets: [],
    },
    zoteroLocalDataDir: '',
    leftSidebarCollapsed: false,
  };
}

test('API keys are written encrypted with Electron safeStorage and read back', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-reader-config-secrets-'));
  const configPath = path.join(directory, 'paperquay.config.json');
  const dependencies = createDependencies();

  try {
    await writeReaderConfigFile(configWithSecrets('sk-super-secret'), { configPath }, dependencies);
    const written = dependencies.files.get(configPath) ?? '';
    assert.equal(written.includes('sk-super-secret'), false, 'plaintext key must not reach disk');
    assert.match(written, /"secretsEncrypted":\s*"enc:v1:/);

    const loaded = await readReaderConfigFileAt(configPath, dependencies);
    assert.equal(loaded?.secrets?.translationApiKey, 'sk-super-secret');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy plaintext secrets are read and migrated on the next write; the backup stays encrypted', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-reader-config-legacy-'));
  const configPath = path.join(directory, 'paperquay.config.json');
  const legacyText = JSON.stringify({
    version: 3,
    settings: {},
    secrets: { translationApiKey: 'legacy-plain-key' },
    zoteroLocalDataDir: '',
    leftSidebarCollapsed: false,
  });
  writeFileSync(configPath, legacyText, 'utf8');
  const dependencies = createDependencies();
  dependencies.files.set(configPath, legacyText);

  try {
    const loaded = await readReaderConfigFileAt(configPath, dependencies);
    assert.equal(loaded?.secrets?.translationApiKey, 'legacy-plain-key');

    await writeReaderConfigFile(configWithSecrets('new-key'), { configPath }, dependencies);
    const backup = dependencies.files.get(readerConfigBackupPath(configPath)) ?? '';
    assert.equal(backup.includes('legacy-plain-key'), false, 'backup must not keep plaintext keys');
    assert.match(backup, /"secretsEncrypted":\s*"enc:v1:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('when encryption is unavailable the config stays usable as plaintext', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-reader-config-plain-'));
  const configPath = path.join(directory, 'paperquay.config.json');
  const written: string[] = [];
  const files = new Map<string, string>();
  const dependencies: ReaderConfigDependencies = {
    readTextFileIfExists: async (filePath) => files.get(filePath) ?? null,
    writeTextFile: async (filePath, content) => {
      written.push(content);
      files.set(filePath, content);
    },
    encryptSecretPayload: async (payload) => payload,
    decryptSecretPayload: async (payload) => payload,
  };

  try {
    await writeReaderConfigFile(configWithSecrets('plain-key'), { configPath }, dependencies);
    assert.match(written[0] ?? '', /"secrets"/);
    assert.equal(written[0].includes('secretsEncrypted'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an undecryptable secret raises a recoverable error instead of silently overwriting the file', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-reader-config-broken-'));
  const configPath = path.join(directory, 'paperquay.config.json');
  const encryptedText = JSON.stringify({
    version: 3,
    settings: {},
    secretsEncrypted: 'enc:v1:not-decryptable',
  });
  writeFileSync(configPath, encryptedText, 'utf8');

  try {
    await assert.rejects(
      readReaderConfigFileAt(configPath, {
        readTextFileIfExists: async () => encryptedText,
        writeTextFile: async () => undefined,
        decryptSecretPayload: async () => {
          throw new Error('DPAPI decrypt failed');
        },
      }),
      /DPAPI decrypt failed/,
    );
    assert.equal(readFileSync(configPath, 'utf8'), encryptedText);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('re-saving identical settings does not rewrite the file or churn the backup', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-reader-config-stable-'));
  const configPath = path.join(directory, 'paperquay.config.json');
  const dependencies = createDependencies();
  let counter = 0;
  // 模拟 DPAPI：相同明文每次加密都会得到不同密文。
  dependencies.encryptSecretPayload = async (payload) =>
    `enc:v1:${Buffer.from(`${counter++}:${payload}`, 'utf8').toString('base64')}`;
  dependencies.decryptSecretPayload = async (value) => {
    const decoded = Buffer.from(value.slice('enc:v1:'.length), 'base64').toString('utf8');
    return decoded.slice(decoded.indexOf(':') + 1);
  };

  try {
    await writeReaderConfigFile(configWithSecrets('stable-key'), { configPath }, dependencies);
    const firstWrite = dependencies.files.get(configPath);
    assert.ok(firstWrite);

    await writeReaderConfigFile(configWithSecrets('stable-key'), { configPath }, dependencies);

    assert.equal(dependencies.files.get(configPath), firstWrite, 'no rewrite when nothing changed');
    assert.equal(dependencies.files.has(readerConfigBackupPath(configPath)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an unchanged legacy plaintext config is migrated to ciphertext on the first save', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-reader-config-migrate-'));
  const configPath = path.join(directory, 'paperquay.config.json');
  const legacyConfig = configWithSecrets('same-key');
  const dependencies = createDependencies();
  dependencies.files.set(configPath, JSON.stringify(legacyConfig));

  try {
    const loaded = await readReaderConfigFileAt(configPath, dependencies);
    assert.equal(loaded?.secrets?.translationApiKey, 'same-key');

    // 配置内容没有变化，但旧文件是明文，必须写一次完成迁移。
    await writeReaderConfigFile(loaded ?? legacyConfig, { configPath }, dependencies);

    const written = dependencies.files.get(configPath) ?? '';
    assert.equal(written.includes('same-key'), false);
    assert.match(written, /"secretsEncrypted":\s*"enc:v1:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
