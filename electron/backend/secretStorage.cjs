const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { cleanString } = require('./utils.cjs');

const AES_SECRET_PREFIX = 'enc:v2:';
const SAFE_STORAGE_SECRET_PREFIX = 'enc:v1:';
const SECRETS_KEY_FILE = 'PaperQuay-secrets.key';

/**
 * API Key 落盘加密。
 *
 * 早期实现用 Electron safeStorage（DPAPI/Keychain），但独立运行的 MCP 进程
 * （`ELECTRON_RUN_AS_NODE=1` 的纯 Node 语义）无法调用 safeStorage，会读不到
 * embedding key，笔记向量索引与混合检索随之失效。这里改为 AES-256-GCM：
 * 密钥保存在 `<userData>/PaperQuay-secrets.key`（dataDir 的父目录），不在
 * 渲染层可读的 dataDir 内，因此 IPC 文件命令读不到它；同一用户下的本地
 * 进程仍可读取，与 DPAPI 的同用户威胁模型一致。
 *
 * 仍然支持读取旧的 `enc:v1:`（safeStorage）密文；新写入一律用 `enc:v2:`。
 */

function getSafeStorage() {
  try {
    const electron = require('electron');
    return electron && electron.safeStorage ? electron.safeStorage : null;
  } catch {
    return null;
  }
}

function isSafeStorageAvailable() {
  const safeStorage = getSafeStorage();
  if (!safeStorage) return false;
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function secretsKeyPath(appPaths) {
  const dataDir = cleanString(appPaths?.dataDir);
  if (!dataDir) return '';
  return path.join(path.dirname(dataDir), SECRETS_KEY_FILE);
}

function loadSecretsKey(appPaths, { create = false } = {}) {
  const keyPath = secretsKeyPath(appPaths);
  if (!keyPath) return null;

  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === 32) return existing;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[paperquay] Failed to read the secrets key file.', error);
      return null;
    }
  }

  if (!create) return null;

  try {
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  } catch (error) {
    console.warn('[paperquay] Failed to create the secrets key file.', error);
    return null;
  }
}

function encryptWithAes(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${AES_SECRET_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptWithAes(value, key) {
  const [ivPart, tagPart, cipherPart] = value.slice(AES_SECRET_PREFIX.length).split(':');
  if (!ivPart || !tagPart || !cipherPart) {
    throw new Error('Encrypted secret payload is malformed.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherPart, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptSecretValue(value, appPaths) {
  if (typeof value !== 'string' || !value) return value;
  if (value.startsWith(AES_SECRET_PREFIX) || value.startsWith(SAFE_STORAGE_SECRET_PREFIX)) {
    return value;
  }

  const key = loadSecretsKey(appPaths, { create: true });
  if (key) {
    try {
      return encryptWithAes(value, key);
    } catch (error) {
      console.warn('[paperquay] Failed to encrypt a secret with AES-GCM.', error);
    }
  }

  if (isSafeStorageAvailable()) {
    try {
      const encrypted = getSafeStorage().encryptString(value);
      return `${SAFE_STORAGE_SECRET_PREFIX}${Buffer.from(encrypted).toString('base64')}`;
    } catch {}
  }

  return value;
}

function decryptSecretValue(value, appPaths) {
  if (typeof value !== 'string') return value;

  if (value.startsWith(AES_SECRET_PREFIX)) {
    const key = loadSecretsKey(appPaths, { create: false });
    if (!key) {
      throw new Error(
        'The settings encryption key is missing; re-enter the API keys in Settings on this machine.',
      );
    }
    try {
      return decryptWithAes(value, key);
    } catch (error) {
      throw new Error(
        `The stored API key could not be decrypted on this machine. Re-enter it in Settings. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (value.startsWith(SAFE_STORAGE_SECRET_PREFIX)) {
    const safeStorage = getSafeStorage();
    if (!safeStorage) {
      throw new Error('Encrypted settings require Electron safeStorage, which is not available here.');
    }
    try {
      return safeStorage.decryptString(
        Buffer.from(value.slice(SAFE_STORAGE_SECRET_PREFIX.length), 'base64'),
      );
    } catch (error) {
      throw new Error(
        `The stored API key could not be decrypted on this machine. Re-enter it in Settings. (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  // 旧版明文配置。
  return value;
}

/**
 * 从 `paperquay.config.json` 解析 secrets：
 * - 旧的明文 `secrets` 直接返回；
 * - `secretsEncrypted` 解密后返回；
 * - 不可用时返回 null（调用方按「未配置」处理）。
 */
function resolveReaderConfigSecrets(rawConfig, appPaths) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;

  if (rawConfig.secrets && typeof rawConfig.secrets === 'object' && !Array.isArray(rawConfig.secrets)) {
    return rawConfig.secrets;
  }

  const encrypted = rawConfig.secretsEncrypted;
  if (typeof encrypted !== 'string' || !encrypted) return null;

  try {
    const decrypted = decryptSecretValue(encrypted, appPaths);
    const parsed = JSON.parse(decrypted);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn('[paperquay] Failed to decrypt the reader config secrets.', error);
    return null;
  }
}

function encryptionAvailable(appPaths) {
  return Boolean(loadSecretsKey(appPaths, { create: false })) || isSafeStorageAvailable();
}

function createConfigSecretCommands(context) {
  const appPaths = context?.appPaths;

  return {
    reader_secret_encryption_available() {
      return { available: encryptionAvailable(appPaths) };
    },
    reader_secret_encrypt({ value }) {
      return { value: encryptSecretValue(String(value ?? ''), appPaths) };
    },
    reader_secret_decrypt({ value }) {
      return { value: decryptSecretValue(String(value ?? ''), appPaths) };
    },
  };
}

module.exports = {
  AES_SECRET_PREFIX,
  SAFE_STORAGE_SECRET_PREFIX,
  SECRETS_KEY_FILE,
  createConfigSecretCommands,
  decryptSecretValue,
  encryptSecretValue,
  encryptionAvailable,
  resolveReaderConfigSecrets,
  secretsKeyPath,
};
