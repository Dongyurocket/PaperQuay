'use strict';

const crypto = require('node:crypto');

const FRAME_SIZE = 4 * 1024 * 1024;
const MAX_STORED_FRAME_SIZE = FRAME_SIZE + 64 * 1024;
const MAX_U32 = 0xffffffff;
const KDF_PROFILE = Object.freeze({
  id: 1,
  name: 'scrypt-131072-8-1',
  N: 131072,
  r: 8,
  p: 1,
  dkLen: 32,
  maxmem: 256 * 1024 * 1024,
});

function codedError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function normalizePassword(password) {
  if (typeof password !== 'string') {
    throw codedError('INVALID_PASSWORD', 'Password must be a string');
  }
  const normalized = password.normalize('NFC');
  const length = Array.from(normalized).length;
  if (length < 8 || length > 256) {
    throw codedError('INVALID_PASSWORD', 'Password must contain 8 to 256 Unicode characters');
  }
  return normalized;
}

function validateKdfProfile(kdfId) {
  if (kdfId !== KDF_PROFILE.id) {
    throw codedError('KDF_PARAMETERS_UNSUPPORTED', 'Unsupported backup KDF profile');
  }
  return KDF_PROFILE;
}

async function deriveKey(password, salt) {
  const normalized = normalizePassword(password);
  if (!Buffer.isBuffer(salt) || salt.length !== 32) {
    throw codedError('INVALID_KDF_INPUT', 'scrypt salt must be exactly 32 bytes');
  }
  const profile = validateKdfProfile(KDF_PROFILE.id);
  const passwordBytes = Buffer.from(normalized, 'utf8');
  try {
    return await new Promise((resolve, reject) => {
      crypto.scrypt(passwordBytes, salt, profile.dkLen, {
        N: profile.N,
        r: profile.r,
        p: profile.p,
        maxmem: profile.maxmem,
      }, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    passwordBytes.fill(0);
  }
}

function assertKeyMaterial({ key, nonce, aad, plaintext }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw codedError('INVALID_CRYPTO_INPUT', 'AES-256-GCM key must be 32 bytes');
  }
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12) {
    throw codedError('INVALID_CRYPTO_INPUT', 'AES-GCM nonce must be 12 bytes');
  }
  if (!Buffer.isBuffer(aad)) {
    throw codedError('INVALID_CRYPTO_INPUT', 'AES-GCM AAD must be a Buffer');
  }
  if (!Buffer.isBuffer(plaintext)) {
    throw codedError('INVALID_CRYPTO_INPUT', 'AES-GCM plaintext must be a Buffer');
  }
}

function encryptGcm({ key, nonce, aad, plaintext }) {
  assertKeyMaterial({ key, nonce, aad, plaintext });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function decryptGcm({ key, nonce, aad, ciphertextAndTag }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw codedError('INVALID_CRYPTO_INPUT', 'AES-256-GCM key must be 32 bytes');
  }
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12 || !Buffer.isBuffer(aad)) {
    throw codedError('INVALID_CRYPTO_INPUT', 'Invalid AES-GCM nonce or AAD');
  }
  if (!Buffer.isBuffer(ciphertextAndTag) || ciphertextAndTag.length < 16) {
    throw codedError('AUTHENTICATION_FAILED', 'AES-GCM ciphertext is missing its tag');
  }
  const ciphertext = ciphertextAndTag.subarray(0, -16);
  const tag = ciphertextAndTag.subarray(-16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function wrapDek({ password, salt, nonce, preamble, dek }) {
  if (!Buffer.isBuffer(dek) || dek.length !== 32 || !Buffer.isBuffer(preamble)) {
    throw codedError('INVALID_CRYPTO_INPUT', 'Invalid DEK or preamble');
  }
  const kek = await deriveKey(password, salt);
  try {
    return encryptGcm({ key: kek, nonce, aad: preamble, plaintext: dek });
  } finally {
    kek.fill(0);
  }
}

async function unwrapDek({ password, salt, nonce, preamble, wrappedDek }) {
  if (!Buffer.isBuffer(preamble) || !Buffer.isBuffer(wrappedDek) || wrappedDek.length !== 48) {
    throw codedError('WRONG_PASSWORD_OR_CORRUPT', 'Password is incorrect or backup package is damaged');
  }
  const kek = await deriveKey(password, salt);
  try {
    const dek = decryptGcm({ key: kek, nonce, aad: preamble, ciphertextAndTag: wrappedDek });
    if (dek.length !== 32) {
      dek.fill(0);
      throw codedError('WRONG_PASSWORD_OR_CORRUPT', 'Password is incorrect or backup package is damaged');
    }
    return dek;
  } catch (error) {
    if (error.code === 'INVALID_PASSWORD' || error.code === 'INVALID_KDF_INPUT') throw error;
    throw codedError('WRONG_PASSWORD_OR_CORRUPT', 'Password is incorrect or backup package is damaged', error);
  } finally {
    kek.fill(0);
  }
}

function frameNonce(baseNonce, globalFrameIndex) {
  if (!Buffer.isBuffer(baseNonce) || baseNonce.length !== 8) {
    throw codedError('INVALID_NONCE', 'Frame nonce prefix must be 8 bytes');
  }
  if (!Number.isInteger(globalFrameIndex) || globalFrameIndex < 0 || globalFrameIndex > MAX_U32) {
    throw codedError('FRAME_LIMIT_EXCEEDED', 'Global frame counter exhausted');
  }
  const nonce = Buffer.allocUnsafe(12);
  baseNonce.copy(nonce, 0);
  nonce.writeUInt32LE(globalFrameIndex, 8);
  return nonce;
}

function frameAad({ packageUuid, entryIndex, frameIndex, rawLength, storedLen, entryPlainSize }) {
  if (!Buffer.isBuffer(packageUuid) || packageUuid.length !== 16) {
    throw codedError('INVALID_AAD', 'Package UUID must be 16 bytes');
  }
  for (const [name, value] of Object.entries({ entryIndex, frameIndex, rawLength, storedLen })) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
      throw codedError('INVALID_AAD', `${name} must be an unsigned 32-bit integer`);
    }
  }
  if (!Number.isSafeInteger(entryPlainSize) || entryPlainSize < 0) {
    throw codedError('INVALID_AAD', 'Entry size must be a non-negative safe integer');
  }
  const aad = Buffer.allocUnsafe(40);
  packageUuid.copy(aad, 0);
  aad.writeUInt32LE(entryIndex, 16);
  aad.writeUInt32LE(frameIndex, 20);
  aad.writeUInt32LE(rawLength, 24);
  aad.writeUInt32LE(storedLen, 28);
  aad.writeBigUInt64LE(BigInt(entryPlainSize), 32);
  return aad;
}

module.exports = {
  FRAME_SIZE,
  KDF_PROFILE,
  MAX_STORED_FRAME_SIZE,
  decryptGcm,
  deriveKey,
  encryptGcm,
  frameAad,
  frameNonce,
  normalizePassword,
  unwrapDek,
  validateKdfProfile,
  wrapDek,
};
