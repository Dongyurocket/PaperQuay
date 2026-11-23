import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  decryptSecretValue,
  encryptSecretValue,
  encryptionAvailable,
  resolveReaderConfigSecrets,
  secretsKeyPath,
} = require('../electron/backend/secretStorage.cjs');

function createAppPaths(root) {
  return { dataDir: path.join(root, 'PaperQuay') };
}

test('secrets are AES-GCM encrypted with a key stored outside dataDir and decrypt back', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-secrets-'));
  const appPaths = createAppPaths(root);
  mkdirSync(appPaths.dataDir, { recursive: true });

  try {
    const keyPath = secretsKeyPath(appPaths);
    assert.equal(path.dirname(keyPath), root, 'the key must live outside the renderer-readable dataDir');
    assert.equal(encryptionAvailable(appPaths), false);

    const ciphertext = encryptSecretValue('sk-super-secret', appPaths);
    assert.match(ciphertext, /^enc:v2:/);
    assert.equal(ciphertext.includes('sk-super-secret'), false);
    assert.equal(existsSync(keyPath), true);
    assert.equal(readFileSync(keyPath).length, 32);
    assert.equal(encryptionAvailable(appPaths), true);
    assert.equal(decryptSecretValue(ciphertext, appPaths), 'sk-super-secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveReaderConfigSecrets decrypts secretsEncrypted and keeps legacy plaintext working', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-secrets-config-'));
  const appPaths = createAppPaths(root);
  mkdirSync(appPaths.dataDir, { recursive: true });

  try {
    const encrypted = encryptSecretValue(
      JSON.stringify({ embeddingApiKey: 'embedding-key', translationApiKey: 'translation-key' }),
      appPaths,
    );
    const decrypted = resolveReaderConfigSecrets({ secretsEncrypted: encrypted }, appPaths);
    assert.equal(decrypted.embeddingApiKey, 'embedding-key');
    assert.equal(decrypted.translationApiKey, 'translation-key');

    const legacy = { embeddingApiKey: 'legacy-key' };
    assert.deepEqual(resolveReaderConfigSecrets({ secrets: legacy }, appPaths), legacy);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing key or tampered ciphertext fails loudly instead of returning garbage', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-secrets-tamper-'));
  const appPaths = createAppPaths(root);
  mkdirSync(appPaths.dataDir, { recursive: true });

  try {
    const ciphertext = encryptSecretValue('secret-value', appPaths);
    const tampered = `${ciphertext.slice(0, -4)}AAAA`;
    assert.throws(() => decryptSecretValue(tampered, appPaths), /could not be decrypted/);

    rmSync(secretsKeyPath(appPaths), { force: true });
    assert.throws(() => decryptSecretValue(ciphertext, appPaths), /encryption key is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plain legacy values pass through unchanged', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'paperquay-secrets-plain-'));
  try {
    assert.equal(decryptSecretValue('plain-key', createAppPaths(root)), 'plain-key');
    writeFileSync(path.join(root, 'note.txt'), 'x');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
