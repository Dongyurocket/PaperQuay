import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const {
  KDF_PROFILE,
  decryptGcm,
  deriveKey,
  encryptGcm,
  frameAad,
  frameNonce,
  normalizePassword,
  unwrapDek,
  validateKdfProfile,
  wrapDek,
} = require('../electron/backend/backupCrypto.cjs');

test('backup password is NFC-normalized without trimming and bounded by Unicode characters', () => {
  assert.equal(normalizePassword('e\u0301'.repeat(8)), 'é'.repeat(8));
  assert.equal(normalizePassword('  abcdef  '), '  abcdef  ');
  assert.throws(() => normalizePassword('short'), { code: 'INVALID_PASSWORD' });
  assert.throws(() => normalizePassword('x'.repeat(257)), { code: 'INVALID_PASSWORD' });
  assert.throws(() => normalizePassword(null), { code: 'INVALID_PASSWORD' });
});

test('preamble KDF id selects the single fixed scrypt profile', () => {
  assert.deepEqual(
    { id: KDF_PROFILE.id, N: KDF_PROFILE.N, r: KDF_PROFILE.r, p: KDF_PROFILE.p, dkLen: KDF_PROFILE.dkLen },
    { id: 1, N: 131072, r: 8, p: 1, dkLen: 32 },
  );
  assert.equal(validateKdfProfile(1), KDF_PROFILE);
  assert.throws(() => validateKdfProfile(2), { code: 'KDF_PARAMETERS_UNSUPPORTED' });
});

test('DEK wrapping authenticates the preamble and reports one wrong-password error', async () => {
  const password = 'correct horse battery staple';
  const salt = randomBytes(32);
  const nonce = randomBytes(12);
  const preamble = randomBytes(104);
  const dek = randomBytes(32);
  const wrappedDek = await wrapDek({ password, salt, nonce, preamble, dek });
  assert.equal(wrappedDek.length, 48);
  assert.deepEqual(await unwrapDek({ password, salt, nonce, preamble, wrappedDek }), dek);
  await assert.rejects(
    unwrapDek({ password: 'incorrect password', salt, nonce, preamble, wrappedDek }),
    { code: 'WRONG_PASSWORD_OR_CORRUPT' },
  );
  await assert.rejects(
    unwrapDek({ password, salt, nonce, preamble: Buffer.from(preamble).fill(1), wrappedDek }),
    { code: 'WRONG_PASSWORD_OR_CORRUPT' },
  );
});

test('frame nonce counter is globally encoded as little-endian u32 without wraparound', () => {
  const prefix = Buffer.from('0102030405060708', 'hex');
  const nonces = [0, 1, 2, 0xffffffff].map((index: number) => frameNonce(prefix, index));
  assert.equal(new Set(nonces.map((nonce: Buffer) => nonce.toString('hex'))).size, nonces.length);
  assert.equal(nonces[0].toString('hex'), '010203040506070800000000');
  assert.equal(nonces[3].readUInt32LE(8), 0xffffffff);
  assert.throws(() => frameNonce(prefix, 0x100000000), { code: 'FRAME_LIMIT_EXCEEDED' });
});

test('frame AAD binds package, entry/frame indexes, lengths, and full entry size', () => {
  const packageUuid = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const aad = frameAad({
    packageUuid,
    entryIndex: 7,
    frameIndex: 3,
    rawLength: 4096,
    storedLen: 1024,
    entryPlainSize: 0x100000001,
  });
  assert.equal(aad.length, 40);
  assert.deepEqual(aad.subarray(0, 16), packageUuid);
  assert.equal(aad.readUInt32LE(16), 7);
  assert.equal(aad.readUInt32LE(20), 3);
  assert.equal(aad.readUInt32LE(24), 4096);
  assert.equal(aad.readUInt32LE(28), 1024);
  assert.equal(aad.readBigUInt64LE(32), 0x100000001n);
  assert.throws(() => frameAad({ packageUuid, entryIndex: -1, frameIndex: 0, rawLength: 1, storedLen: 1, entryPlainSize: 1 }), { code: 'INVALID_AAD' });
});

test('AES-256-GCM rejects modified ciphertext or AAD', () => {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const aad = Buffer.from('frame metadata');
  const plaintext = Buffer.from('sensitive backup frame');
  const ciphertextAndTag = encryptGcm({ key, nonce, aad, plaintext });
  assert.deepEqual(decryptGcm({ key, nonce, aad, ciphertextAndTag }), plaintext);
  const modified = Buffer.from(ciphertextAndTag);
  modified[0] ^= 1;
  assert.throws(() => decryptGcm({ key, nonce, aad, ciphertextAndTag: modified }));
  assert.throws(() => decryptGcm({ key, nonce, aad: Buffer.from('different metadata'), ciphertextAndTag }));
});

test('scrypt derivation is asynchronous and returns a 32-byte key', async () => {
  const key = await deriveKey('a sufficiently long password', randomBytes(32));
  assert.equal(key.length, 32);
  key.fill(0);
});
