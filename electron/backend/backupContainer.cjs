'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const {
  FRAME_SIZE,
  MAX_STORED_FRAME_SIZE,
  decryptGcm,
  encryptGcm,
  frameAad,
  frameNonce,
  normalizePassword,
  unwrapDek,
  validateKdfProfile,
  wrapDek,
} = require('./backupCrypto.cjs');

const PREAMBLE_SIZE = 104;
const FOOTER_SIZE = 68;
const WRAPPED_DEK_SIZE = 48;
const DATA_START = PREAMBLE_SIZE + WRAPPED_DEK_SIZE;
const FOOTER_MAGIC = Buffer.from('PQFT0001', 'ascii');
const PREAMBLE_MAGIC = Buffer.from('PQBACKUP', 'ascii');
const FORMAT_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 200000;
const MAX_FRAME_COUNT = 0x100000000;
const MAX_U32 = 0xffffffff;
const ALLOWED_ENTRY_KINDS = new Set([
  'database',
  'config',
  'agent-memory',
  'knowledge-graph',
  'library-pdf',
  'translated-pdf',
  'mineru',
  'notes-vault',
  'renderer-local-storage',
  'other',
]);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function codedError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function caseFold(value) {
  return value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
}

function validateEntryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) {
    throw codedError('UNSAFE_ENTRY_PATH', 'Entry path must contain 1 to 240 characters');
  }
  if (/[\\:*?"<>|]/u.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw codedError('UNSAFE_ENTRY_PATH', 'Entry path contains a forbidden character');
  }
  if (value.startsWith('/') || path.posix.isAbsolute(value) || /^[a-z]:/iu.test(value)) {
    throw codedError('UNSAFE_ENTRY_PATH', 'Entry path must be relative');
  }
  const normalized = value.normalize('NFC');
  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw codedError('UNSAFE_ENTRY_PATH', 'Entry path contains an empty or traversal segment');
  }
  for (const part of parts) {
    if (/[. ]$/u.test(part)) {
      throw codedError('UNSAFE_ENTRY_PATH', 'Entry path segment ends in a dot or space');
    }
    const windowsBase = part.split('.')[0].replace(/[. ]+$/u, '').toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsBase)) {
      throw codedError('UNSAFE_ENTRY_PATH', 'Entry path uses a reserved Windows name');
    }
  }
  return normalized;
}

function uuidToBuffer(uuid) {
  if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(uuid)) {
    throw codedError('INVALID_PACKAGE', 'Package ID must be a lowercase UUIDv4');
  }
  return Buffer.from(uuid.replace(/-/gu, ''), 'hex');
}

function bufferToUuid(bytes) {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createPreamble({ flags, salt, baseNonce, wrappedDekNonce, packageUuid }) {
  const preamble = Buffer.alloc(PREAMBLE_SIZE);
  PREAMBLE_MAGIC.copy(preamble, 0);
  preamble.writeUInt16LE(FORMAT_VERSION, 8);
  preamble.writeUInt16LE(flags, 10);
  preamble.writeUInt8(1, 12);
  preamble.writeUInt8(1, 13);
  preamble.writeUInt32LE(FRAME_SIZE, 14);
  salt.copy(preamble, 18);
  baseNonce.copy(preamble, 50);
  preamble.writeUInt16LE(32, 58);
  wrappedDekNonce.copy(preamble, 60);
  packageUuid.copy(preamble, 88);
  return preamble;
}

function parsePreamble(preamble) {
  if (preamble.length !== PREAMBLE_SIZE || !preamble.subarray(0, 8).equals(PREAMBLE_MAGIC)) {
    throw codedError('INVALID_PACKAGE', 'Invalid backup package preamble');
  }
  if (preamble.readUInt16LE(8) !== FORMAT_VERSION) {
    throw codedError('UNSUPPORTED_VERSION', 'Unsupported backup package format version');
  }
  const flags = preamble.readUInt16LE(10);
  if ((flags & ~0x0007) !== 0) throw codedError('INVALID_PACKAGE', 'Unknown package flags');
  const kdfId = preamble.readUInt8(12);
  validateKdfProfile(kdfId);
  if (preamble.readUInt8(13) !== 1 || preamble.readUInt32LE(14) !== FRAME_SIZE) {
    throw codedError('INVALID_PACKAGE', 'Unsupported cipher or frame size');
  }
  if (preamble.readUInt16LE(58) !== 32 || !preamble.subarray(72, 88).equals(Buffer.alloc(16))) {
    throw codedError('INVALID_PACKAGE', 'Invalid wrapped key length or reserved fields');
  }
  const packageUuidBytes = Buffer.from(preamble.subarray(88, 104));
  const uuid = bufferToUuid(packageUuidBytes);
  uuidToBuffer(uuid);
  return {
    flags,
    salt: Buffer.from(preamble.subarray(18, 50)),
    baseNonce: Buffer.from(preamble.subarray(50, 58)),
    wrappedDekNonce: Buffer.from(preamble.subarray(60, 72)),
    packageUuidBytes,
    packageId: uuid,
  };
}

function createFooter({ manifestOffset, manifestLength, manifestNonce, dataSha256 }) {
  if (!isSafeInteger(manifestOffset) || manifestOffset > Number.MAX_SAFE_INTEGER) {
    throw codedError('INVALID_PACKAGE', 'Invalid manifest offset');
  }
  if (!Number.isInteger(manifestLength) || manifestLength < 1 || manifestLength > MAX_MANIFEST_BYTES) {
    throw codedError('INVALID_PACKAGE', 'Invalid manifest length');
  }
  const footer = Buffer.alloc(FOOTER_SIZE);
  FOOTER_MAGIC.copy(footer, 0);
  footer.writeBigUInt64LE(BigInt(manifestOffset), 8);
  footer.writeUInt32LE(manifestLength, 16);
  manifestNonce.copy(footer, 20);
  dataSha256.copy(footer, 32);
  return footer;
}

function parseFooter(footer, packageSize) {
  if (footer.length !== FOOTER_SIZE || !footer.subarray(0, 8).equals(FOOTER_MAGIC)) {
    throw codedError('INVALID_PACKAGE', 'Invalid backup package footer');
  }
  if (!footer.subarray(64, 68).equals(Buffer.alloc(4))) {
    throw codedError('INVALID_PACKAGE', 'Unknown footer extension');
  }
  const manifestOffsetBig = footer.readBigUInt64LE(8);
  if (manifestOffsetBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw codedError('INVALID_PACKAGE', 'Manifest offset is not safely addressable');
  }
  const manifestOffset = Number(manifestOffsetBig);
  const manifestLength = footer.readUInt32LE(16);
  const expectedSize = BigInt(manifestOffset) + BigInt(manifestLength) + 16n + BigInt(FOOTER_SIZE);
  if (manifestOffset < DATA_START || manifestLength < 1 || manifestLength > MAX_MANIFEST_BYTES || expectedSize !== BigInt(packageSize)) {
    throw codedError('INVALID_PACKAGE', 'Manifest bounds do not match package size');
  }
  return {
    manifestOffset,
    manifestLength,
    manifestNonce: Buffer.from(footer.subarray(20, 32)),
    dataSha256: Buffer.from(footer.subarray(32, 64)),
  };
}

function entryContains(entries, predicate) {
  return entries.some((entry) => predicate(entry));
}

function expectedFlags(entries) {
  let flags = 0;
  if (entryContains(entries, (entry) => entry.kind === 'database' &&
      [entry.packagePath, entry.relativePath].some((value) => typeof value === 'string' &&
        path.posix.basename(value).toLowerCase() === 'paperquay-rag.sqlite'))) flags |= 1;
  if (entryContains(entries, (entry) => entry.kind === 'mineru')) flags |= 2;
  if (entryContains(entries, (entry) => entry.kind === 'notes-vault')) flags |= 4;
  return flags;
}

function validateManifest(manifest, { packageId, manifestOffset }) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.manifestVersion !== 1) {
    throw codedError('INVALID_PACKAGE', 'Invalid backup manifest');
  }
  if (manifest.packageId !== packageId) throw codedError('INVALID_PACKAGE', 'Manifest package ID does not match preamble');
  if (manifest.preset !== undefined && !['migration', 'daily', 'custom'].includes(manifest.preset)) {
    throw codedError('INVALID_PACKAGE', 'Invalid backup preset');
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length > MAX_ENTRIES) {
    throw codedError('INVALID_PACKAGE', 'Manifest entry count exceeds the limit');
  }
  for (const rootsValue of [manifest.sourceRoots, manifest.resolvedRoots]) {
    if (rootsValue !== undefined && (!rootsValue || typeof rootsValue !== 'object' || Array.isArray(rootsValue))) {
      throw codedError('INVALID_PACKAGE', 'Manifest roots must be objects');
    }
  }
  const roots = new Set([
    ...Object.keys(manifest.sourceRoots || {}),
    ...Object.keys(manifest.resolvedRoots || {}),
  ]);
  const packagePaths = new Set();
  const rootedPaths = new Set();
  let expectedOffset = DATA_START;
  let totalFrames = 0;
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.index !== index) {
      throw codedError('INVALID_PACKAGE', `Invalid manifest entry ${index}`);
    }
    if (!ALLOWED_ENTRY_KINDS.has(entry.kind)) throw codedError('INVALID_PACKAGE', `Unknown entry kind at ${index}`);
    if (typeof entry.sourceRoot !== 'string' || (entry.sourceRoot !== 'external' && !roots.has(entry.sourceRoot))) {
      throw codedError('INVALID_PACKAGE', `Invalid source root at entry ${index}`);
    }
    if (entry.sourceRoot !== 'external') {
      const rootValues = [manifest.sourceRoots?.[entry.sourceRoot], manifest.resolvedRoots?.[entry.sourceRoot]];
      if (!rootValues.some((value) => typeof value === 'string' && value.length > 0)) {
        throw codedError('INVALID_PACKAGE', `Source root is empty at entry ${index}`);
      }
    }
    const relativePath = validateEntryPath(entry.relativePath);
    const packagePath = validateEntryPath(entry.packagePath);
    const packageKey = caseFold(packagePath);
    const rootedKey = `${caseFold(entry.sourceRoot)}\u0000${caseFold(relativePath)}`;
    if (packagePaths.has(packageKey) || rootedPaths.has(rootedKey)) {
      throw codedError('UNSAFE_ENTRY_PATH', `Duplicate entry path at ${index}`);
    }
    packagePaths.add(packageKey);
    rootedPaths.add(rootedKey);
    if (!['none', 'deflate-raw'].includes(entry.compression)) {
      throw codedError('INVALID_PACKAGE', `Unsupported compression at entry ${index}`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 ||
        !Number.isSafeInteger(entry.dataOffset) || entry.dataOffset < DATA_START ||
        !Number.isSafeInteger(entry.dataLength) || entry.dataLength < 0 ||
        !Number.isSafeInteger(entry.frameCount) || entry.frameCount < 0 ||
        !/^[0-9a-f]{64}$/u.test(entry.sha256 || '')) {
      throw codedError('INVALID_PACKAGE', `Invalid entry size, offsets, or digest at ${index}`);
    }
    const frameCount = Math.ceil(entry.size / FRAME_SIZE);
    if (entry.frameCount !== frameCount || entry.dataOffset !== expectedOffset) {
      throw codedError('INVALID_PACKAGE', `Entry frame count or offset is inconsistent at ${index}`);
    }
    const minLength = frameCount * 20;
    const maxLength = frameCount * (MAX_STORED_FRAME_SIZE + 20);
    if (entry.dataLength < minLength || entry.dataLength > maxLength || (frameCount === 0 && entry.dataLength !== 0)) {
      throw codedError('INVALID_PACKAGE', `Entry data length is inconsistent at ${index}`);
    }
    expectedOffset += entry.dataLength;
    if (!Number.isSafeInteger(expectedOffset) || expectedOffset > manifestOffset) {
      throw codedError('INVALID_PACKAGE', `Entry offset exceeds data region at ${index}`);
    }
    totalFrames += frameCount;
    if (totalFrames > MAX_FRAME_COUNT) throw codedError('FRAME_LIMIT_EXCEEDED', 'Package has too many frames');
  }
  if (expectedOffset !== manifestOffset) throw codedError('INVALID_PACKAGE', 'Entry data region contains a gap or trailing bytes');
  return manifest;
}

function assertFlagsMatch(flags, manifest) {
  if (expectedFlags(manifest.entries) !== flags) {
    throw codedError('INVALID_PACKAGE', 'Package flags do not match manifest entries');
  }
}

async function writeFully(handle, bytes, position = null) {
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, position === null ? null : position + written);
    if (result.bytesWritten <= 0) throw codedError('WRITE_FAILED', 'Could not write backup package');
    written += result.bytesWritten;
  }
}

async function readExactly(handle, position, length) {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw codedError('INVALID_PACKAGE', 'Invalid read bounds');
  }
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw codedError('INVALID_PACKAGE', 'Unexpected end of backup package');
    offset += bytesRead;
  }
  return buffer;
}

async function* fileFrames(sourcePath, expectedSize) {
  const stream = fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 });
  let frame = Buffer.allocUnsafe(FRAME_SIZE);
  let used = 0;
  let total = 0;
  for await (const chunk of stream) {
    let sourceOffset = 0;
    total += chunk.length;
    if (total > expectedSize) throw codedError('SOURCE_CHANGED', 'Source file grew while being backed up');
    while (sourceOffset < chunk.length) {
      const copied = Math.min(FRAME_SIZE - used, chunk.length - sourceOffset);
      chunk.copy(frame, used, sourceOffset, sourceOffset + copied);
      used += copied;
      sourceOffset += copied;
      if (used === FRAME_SIZE) {
        yield frame;
        frame = Buffer.allocUnsafe(FRAME_SIZE);
        used = 0;
      }
    }
  }
  if (used > 0) yield frame.subarray(0, used);
  if (total !== expectedSize) throw codedError('SOURCE_CHANGED', 'Source file changed while being backed up');
}

function* bufferFrames(data) {
  for (let offset = 0; offset < data.length; offset += FRAME_SIZE) {
    yield data.subarray(offset, Math.min(offset + FRAME_SIZE, data.length));
  }
}

function makeManifestEntry(descriptor, index, size, offset) {
  const entry = { ...descriptor };
  for (const key of ['sourcePath', 'data', 'compressionLevel', 'stream', 'streamFactory', 'fileHandle']) delete entry[key];
  for (const key of ['index', 'size', 'sha256', 'dataOffset', 'dataLength', 'frameCount']) delete entry[key];
  entry.index = index;
  entry.size = size;
  entry.sha256 = '';
  entry.compression = entry.compression || 'none';
  entry.dataOffset = offset;
  entry.dataLength = 0;
  entry.frameCount = 0;
  return entry;
}

async function getDescriptorSize(descriptor, index) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw codedError('INVALID_ENTRY', `Entry ${index} descriptor is invalid`);
  }
  const hasData = descriptor.data !== undefined;
  if (hasData && (descriptor.sourcePath !== undefined || !Buffer.isBuffer(descriptor.data) || descriptor.data.length > 8 * 1024 * 1024)) {
    throw codedError('INVALID_ENTRY', `Entry ${index} Buffer data must be exclusive and no larger than 8 MiB`);
  }
  if (hasData) return descriptor.data.length;
  if (typeof descriptor.sourcePath !== 'string') throw codedError('INVALID_ENTRY', `Entry ${index} requires data or sourcePath`);
  const stat = await fsp.lstat(path.resolve(descriptor.sourcePath));
  if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size)) {
    throw codedError('INVALID_ENTRY', `Entry ${index} is not a regular file`);
  }
  return stat.size;
}

async function sampleSource(descriptor, size) {
  const sampleLength = Math.min(size, 1024 * 1024);
  if (descriptor.data !== undefined) return descriptor.data.subarray(0, sampleLength);
  const handle = await fsp.open(path.resolve(descriptor.sourcePath), 'r');
  try {
    const sample = Buffer.alloc(sampleLength);
    let offset = 0;
    while (offset < sampleLength) {
      const { bytesRead } = await handle.read(sample, offset, sampleLength - offset, offset);
      if (bytesRead === 0) return sample.subarray(0, offset);
      offset += bytesRead;
    }
    return sample;
  } finally {
    await handle.close();
  }
}

async function writeBackupPackage({
  outputPath,
  password,
  manifest,
  entries,
  flags,
  compressionLevel = 'standard',
  overwrite = false,
  signal,
  onProgress,
}) {
  normalizePassword(password);
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw codedError('INVALID_OUTPUT_PATH', 'Package output path must be absolute');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(entries) || entries.length > MAX_ENTRIES) {
    throw codedError('INVALID_MANIFEST', 'Manifest and a bounded entry list are required');
  }
  const compressionLevels = { fast: 1, standard: 6, none: 0 };
  if (!Object.hasOwn(compressionLevels, compressionLevel)) {
    throw codedError('INVALID_COMPRESSION_LEVEL', 'Compression level must be fast, standard, or none');
  }
  const compressionLevelValue = compressionLevels[compressionLevel];
  const destination = path.resolve(outputPath);
  const parent = path.dirname(destination);
  const parentStat = await fsp.stat(parent).catch((error) => {
    throw codedError('INVALID_OUTPUT_PATH', 'Package output directory does not exist', error);
  });
  if (!parentStat.isDirectory()) throw codedError('INVALID_OUTPUT_PATH', 'Package output parent is not a directory');
  if (!overwrite) {
    try {
      await fsp.lstat(destination);
      throw codedError('OUTPUT_EXISTS', 'Backup package destination already exists');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const descriptors = entries;
  const sourceSizes = [];
  let totalBytes = 0;
  for (let index = 0; index < descriptors.length; index += 1) {
    const size = await getDescriptorSize(descriptors[index], index);
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes)) throw codedError('INVALID_ENTRY', 'Total entry size exceeds safe integer range');
    sourceSizes.push(size);
  }
  const packageId = manifest.packageId || crypto.randomUUID();
  const packageUuidBytes = uuidToBuffer(packageId);
  const preset = manifest.preset || 'migration';
  if (!['migration', 'daily', 'custom'].includes(preset)) {
    throw codedError('INVALID_MANIFEST', 'Preset must be migration, daily, or custom');
  }
  const finalManifest = {
    ...manifest,
    manifestVersion: 1,
    packageId,
    createdAt: manifest.createdAt || new Date().toISOString(),
    preset,
    entries: [],
  };
  const inferredFlags = expectedFlags(descriptors.map((entry) => ({
    ...entry,
    packagePath: entry.packagePath,
    relativePath: entry.relativePath,
  })));
  const packageFlags = flags === undefined ? inferredFlags : flags;
  if (!Number.isInteger(packageFlags) || packageFlags < 0 || packageFlags > 7 || packageFlags !== inferredFlags) {
    throw codedError('INVALID_PACKAGE', 'Package flags do not match entry descriptors');
  }

  const salt = crypto.randomBytes(32);
  const baseNonce = crypto.randomBytes(8);
  const wrappedDekNonce = crypto.randomBytes(12);
  const dek = crypto.randomBytes(32);
  const preamble = createPreamble({
    flags: packageFlags,
    salt,
    baseNonce,
    wrappedDekNonce,
    packageUuid: packageUuidBytes,
  });
  const partialPath = `${destination}.partial`;
  let wrappedDek;
  let partialHandle;
  let published = false;
  try {
    wrappedDek = await wrapDek({
      password,
      salt,
      nonce: wrappedDekNonce,
      preamble,
      dek,
    });
    partialHandle = await fsp.open(partialPath, 'wx', 0o600);
    await writeFully(partialHandle, preamble);
    await writeFully(partialHandle, wrappedDek);
    const dataHash = crypto.createHash('sha256');
    dataHash.update(wrappedDek);
    let offset = DATA_START;
    let globalFrameIndex = 0;
    let completedBytes = 0;
    let completedEntries = 0;
    if (onProgress) await onProgress({
      phase: 'writing', completedBytes, totalBytes, completedEntries,
      totalEntries: descriptors.length, currentLabel: '',
    });

    for (let index = 0; index < descriptors.length; index += 1) {
      if (signal?.aborted) throw codedError('CANCELLED', 'Backup package writing was cancelled');
      const descriptor = descriptors[index];
      if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
        throw codedError('INVALID_ENTRY', `Entry ${index} descriptor is invalid`);
      }
      const hasData = descriptor.data !== undefined;
      if (hasData && (descriptor.sourcePath !== undefined || !Buffer.isBuffer(descriptor.data) || descriptor.data.length > 8 * 1024 * 1024)) {
        throw codedError('INVALID_ENTRY', `Entry ${index} Buffer data must be exclusive and no larger than 8 MiB`);
      }
      if (!hasData && typeof descriptor.sourcePath !== 'string') {
        throw codedError('INVALID_ENTRY', `Entry ${index} requires data or sourcePath`);
      }
      const sourcePath = hasData ? null : path.resolve(descriptor.sourcePath);
      const before = hasData ? null : await fsp.lstat(sourcePath);
      if (before && (!before.isFile() || before.isSymbolicLink() || !Number.isSafeInteger(before.size))) {
        throw codedError('INVALID_ENTRY', `Entry ${index} is not a regular file`);
      }
      const sourceSize = sourceSizes[index];
      if ((hasData ? descriptor.data.length : before.size) !== sourceSize) {
        throw codedError('SOURCE_CHANGED', `Entry ${index} changed after size preflight`);
      }
      const entry = makeManifestEntry(descriptor, index, sourceSize, offset);
      entry.relativePath = validateEntryPath(entry.relativePath);
      entry.packagePath = validateEntryPath(entry.packagePath);
      if (!ALLOWED_ENTRY_KINDS.has(entry.kind) || typeof entry.sourceRoot !== 'string') {
        throw codedError('INVALID_ENTRY', `Entry ${index} is missing a supported kind or source root`);
      }
      entry.compression = compressionLevel === 'none' ? 'none' : (entry.compression || 'none');
      if (!['none', 'deflate-raw'].includes(entry.compression)) {
        throw codedError('INVALID_ENTRY', `Entry ${index} has unsupported compression`);
      }
      if (entry.compression === 'deflate-raw') {
        const sample = await sampleSource(descriptor, sourceSize);
        if (sample.length > 0) {
          const compressedSample = deflateRawSync(sample, { level: compressionLevelValue });
          const ratio = sample.length / compressedSample.length;
          const savings = (sample.length - compressedSample.length) / sample.length;
          if (savings < 0.05 || ratio > 200) entry.compression = 'none';
        }
      }
      if (before) entry.mtimeMs = before.mtimeMs;
      const entryHash = crypto.createHash('sha256');
      let rawBytes = 0;
      let storedBytes = 0;
      let frameIndex = 0;
      const currentLabel = entry.originalName || entry.packagePath || `Entry ${index + 1}`;
      const frames = hasData
        ? bufferFrames(descriptor.data)
        : fileFrames(sourcePath, sourceSize);
      for await (const frame of frames) {
        if (signal?.aborted) throw codedError('CANCELLED', 'Backup package writing was cancelled');
        if (globalFrameIndex > MAX_U32) throw codedError('FRAME_LIMIT_EXCEEDED', 'Global frame counter exhausted');
        entryHash.update(frame);
        const stored = entry.compression === 'deflate-raw'
          ? deflateRawSync(frame, { level: compressionLevelValue })
          : frame;
        if (stored.length === 0 || stored.length > MAX_STORED_FRAME_SIZE) {
          throw codedError('FRAME_LIMIT_EXCEEDED', `Entry ${index} frame exceeds stored length limit`);
        }
        if (entry.compression === 'deflate-raw' && frame.length > stored.length * 200) {
          throw codedError('COMPRESSION_RATIO_LIMIT', `Entry ${index} compresses beyond the 200:1 safety limit`);
        }
        const storedLenBytes = Buffer.allocUnsafe(4);
        storedLenBytes.writeUInt32LE(stored.length, 0);
        const aad = frameAad({
          packageUuid: packageUuidBytes,
          entryIndex: index,
          frameIndex,
          rawLength: frame.length,
          storedLen: stored.length,
          entryPlainSize: sourceSize,
        });
        const encrypted = encryptGcm({
          key: dek,
          nonce: frameNonce(baseNonce, globalFrameIndex),
          aad,
          plaintext: stored,
        });
        await writeFully(partialHandle, storedLenBytes);
        await writeFully(partialHandle, encrypted);
        dataHash.update(storedLenBytes);
        dataHash.update(encrypted);
        const recordLength = 4 + encrypted.length;
        offset += recordLength;
        rawBytes += frame.length;
        storedBytes += recordLength;
        frameIndex += 1;
        globalFrameIndex += 1;
        completedBytes += frame.length;
        if (onProgress) await onProgress({
          phase: 'writing', completedBytes, totalBytes, completedEntries,
          totalEntries: descriptors.length, currentLabel,
        });
      }
      if (before) {
        const after = await fsp.stat(sourcePath);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
          throw codedError('SOURCE_CHANGED', `Entry ${index} changed while being backed up`);
        }
      }
      if (rawBytes !== sourceSize) throw codedError('SOURCE_CHANGED', `Entry ${index} byte count changed while being backed up`);
      entry.sha256 = entryHash.digest('hex');
      entry.dataLength = storedBytes;
      entry.frameCount = frameIndex;
      finalManifest.entries.push(entry);
      completedEntries += 1;
      if (onProgress) await onProgress({
        phase: 'writing', completedBytes, totalBytes, completedEntries,
        totalEntries: descriptors.length, currentLabel,
      });
    }

    if (signal?.aborted) throw codedError('CANCELLED', 'Backup package writing was cancelled');
    validateManifest(finalManifest, { packageId, manifestOffset: offset });
    assertFlagsMatch(packageFlags, finalManifest);
    const manifestBytes = Buffer.from(JSON.stringify(finalManifest), 'utf8');
    if (manifestBytes.length < 1 || manifestBytes.length > MAX_MANIFEST_BYTES) {
      throw codedError('MANIFEST_TOO_LARGE', 'Backup manifest exceeds 64 MiB');
    }
    const dataSha256 = dataHash.digest();
    let manifestNonce;
    do {
      manifestNonce = crypto.randomBytes(12);
    } while (manifestNonce.subarray(0, 8).equals(baseNonce) && globalFrameIndex > 0 &&
      manifestNonce.readUInt32LE(8) < globalFrameIndex);
    const footer = createFooter({
      manifestOffset: offset,
      manifestLength: manifestBytes.length,
      manifestNonce,
      dataSha256,
    });
    const manifestAad = Buffer.concat([preamble, wrappedDek, footer]);
    const encryptedManifest = encryptGcm({
      key: dek,
      nonce: manifestNonce,
      aad: manifestAad,
      plaintext: manifestBytes,
    });
    await writeFully(partialHandle, encryptedManifest);
    await writeFully(partialHandle, footer);
    await partialHandle.sync();
    await partialHandle.close();
    partialHandle = undefined;

    if (!overwrite) {
      try {
        await fsp.lstat(destination);
        throw codedError('OUTPUT_EXISTS', 'Backup package destination already exists');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await fsp.rename(partialPath, destination);
    published = true;
    const bytes = offset + encryptedManifest.length + FOOTER_SIZE;
    return {
      packagePath: destination,
      bytes,
      packageSize: bytes,
      flags: packageFlags,
      manifest: finalManifest,
    };
  } finally {
    dek.fill(0);
    if (partialHandle) await partialHandle.close().catch(() => {});
    if (!published) await fsp.unlink(partialPath).catch(() => {});
  }
}

async function openPackage({ packagePath, password }) {
  normalizePassword(password);
  if (typeof packagePath !== 'string' || !path.isAbsolute(packagePath)) {
    throw codedError('INVALID_PACKAGE', 'Package path must be absolute');
  }
  const handle = await fsp.open(packagePath, 'r').catch((error) => {
    throw codedError('INVALID_PACKAGE', 'Could not open backup package', error);
  });
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < DATA_START + 16 + FOOTER_SIZE + 1) {
      throw codedError('INVALID_PACKAGE', 'Backup package is too short');
    }
    const preamble = await readExactly(handle, 0, PREAMBLE_SIZE);
    const header = parsePreamble(preamble);
    const wrappedDek = await readExactly(handle, PREAMBLE_SIZE, WRAPPED_DEK_SIZE);
    const footerBytes = await readExactly(handle, stat.size - FOOTER_SIZE, FOOTER_SIZE);
    const footer = parseFooter(footerBytes, stat.size);
    const dek = await unwrapDek({
      password,
      salt: header.salt,
      nonce: header.wrappedDekNonce,
      preamble,
      wrappedDek,
    });
    let manifestBytes;
    try {
      manifestBytes = decryptGcm({
        key: dek,
        nonce: footer.manifestNonce,
        aad: Buffer.concat([preamble, wrappedDek, footerBytes]),
        ciphertextAndTag: await readExactly(handle, footer.manifestOffset, footer.manifestLength + 16),
      });
    } catch (error) {
      dek.fill(0);
      throw codedError('WRONG_PASSWORD_OR_CORRUPT', 'Password is incorrect or backup package is damaged', error);
    }
    let manifest;
    try {
      manifest = JSON.parse(UTF8_DECODER.decode(manifestBytes));
    } catch (error) {
      dek.fill(0);
      throw codedError('INVALID_PACKAGE', 'Backup manifest is not valid UTF-8 JSON', error);
    }
    try {
      validateManifest(manifest, { packageId: header.packageId, manifestOffset: footer.manifestOffset });
      assertFlagsMatch(header.flags, manifest);
      const totalFrames = manifest.entries.reduce((total, entry) => total + entry.frameCount, 0);
      if (footer.manifestNonce.subarray(0, 8).equals(header.baseNonce) && totalFrames > 0 &&
          footer.manifestNonce.readUInt32LE(8) < totalFrames) {
        throw codedError('INVALID_PACKAGE', 'Manifest nonce collides with a data frame nonce');
      }
    } catch (error) {
      dek.fill(0);
      throw error;
    }
    manifestBytes.fill(0);
    return {
      handle,
      packageSize: stat.size,
      preamble,
      header,
      wrappedDek,
      footerBytes,
      footer,
      dek,
      manifest,
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function inspectBackupPackage(options) {
  const opened = await openPackage(options);
  try {
    return {
      manifest: opened.manifest,
      flags: opened.header.flags,
      packageSize: opened.packageSize,
      dataSha256: opened.footer.dataSha256.toString('hex'),
    };
  } finally {
    opened.dek.fill(0);
    await opened.handle.close();
  }
}

function validateStoredFrameLength(storedLen, rawLength, compression, entryIndex) {
  if (storedLen < 1 || storedLen > MAX_STORED_FRAME_SIZE) {
    throw codedError('INVALID_PACKAGE', `Invalid stored frame length in entry ${entryIndex}`);
  }
  if (compression === 'none' && storedLen !== rawLength) {
    throw codedError('INVALID_PACKAGE', `Uncompressed frame length mismatch in entry ${entryIndex}`);
  }
  if (compression === 'deflate-raw' && rawLength > storedLen * 200) {
    throw codedError('COMPRESSION_RATIO_LIMIT', `Entry ${entryIndex} exceeds the 200:1 decompression ratio limit`);
  }
}

function decodeFrame(stored, { compression, rawLength, entryIndex }) {
  if (compression === 'none') return stored;
  try {
    const raw = inflateRawSync(stored, { maxOutputLength: rawLength });
    if (raw.length !== rawLength) throw new Error('Unexpected decompressed length');
    return raw;
  } catch (error) {
    throw codedError('INVALID_PACKAGE', `Could not safely decompress entry ${entryIndex}`, error);
  }
}

async function ensureSafeParent(destinationRoot, relativePath) {
  const root = path.resolve(destinationRoot);
  await fsp.mkdir(root, { recursive: true });
  const rootStat = await fsp.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw codedError('UNSAFE_DESTINATION', 'Destination root must be a real directory');
  }
  const realRoot = await fsp.realpath(root);
  const parts = relativePath.split('/');
  let parent = realRoot;
  for (const part of parts.slice(0, -1)) {
    const next = path.join(parent, part);
    try {
      await fsp.mkdir(next);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = await fsp.lstat(next);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw codedError('UNSAFE_DESTINATION', 'Destination contains a non-directory or link');
    }
    const realNext = await fsp.realpath(next);
    if (realNext !== realRoot && !realNext.startsWith(`${realRoot}${path.sep}`)) {
      throw codedError('UNSAFE_DESTINATION', 'Destination path escapes its root');
    }
    parent = realNext;
  }
  const outputPath = path.join(parent, parts[parts.length - 1]);
  const normalizedRoot = path.resolve(realRoot);
  if (outputPath !== normalizedRoot && !outputPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw codedError('UNSAFE_DESTINATION', 'Destination path escapes its root');
  }
  return outputPath;
}

async function processEntries(opened, { destinationDir, resolveDestination, onEntry, onProgress, signal, phase = 'verifying' } = {}) {
  const dataHash = crypto.createHash('sha256');
  dataHash.update(opened.wrappedDek);
  const createdFiles = [];
  const extractedEntries = [];
  const totalBytes = opened.manifest.entries.reduce((total, entry) => total + entry.size, 0);
  let completedBytes = 0;
  let completedEntries = 0;
  let globalFrameIndex = 0;
  if (onProgress) await onProgress({
    phase, completedBytes, totalBytes, completedEntries,
    totalEntries: opened.manifest.entries.length, currentLabel: '',
  });
  try {
    for (const entry of opened.manifest.entries) {
      if (signal?.aborted) throw codedError('CANCELLED', 'Backup package verification was cancelled');
      let outputPath = null;
      if (destinationDir || resolveDestination) {
        const mapping = resolveDestination ? await resolveDestination(entry) : entry.relativePath;
        if (typeof mapping === 'string') {
          if (!destinationDir || path.isAbsolute(mapping)) {
            throw codedError('UNSAFE_DESTINATION', 'A relative extraction mapping requires destinationDir');
          }
          outputPath = await ensureSafeParent(destinationDir, validateEntryPath(mapping));
        } else if (mapping && typeof mapping === 'object' && typeof mapping.root === 'string' && path.isAbsolute(mapping.root)) {
          outputPath = await ensureSafeParent(mapping.root, validateEntryPath(mapping.relativePath));
        } else {
          throw codedError('UNSAFE_DESTINATION', `No safe destination mapping for entry ${entry.index}`);
        }
      }
      const currentLabel = entry.originalName || entry.packagePath || `Entry ${entry.index + 1}`;
      let temporaryPath;
      let outputHandle;
      if (outputPath) {
        temporaryPath = `${outputPath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.partial`;
        outputHandle = await fsp.open(temporaryPath, 'wx', 0o600);
      }
      const entryHash = crypto.createHash('sha256');
      let rawTotal = 0;
      let position = entry.dataOffset;
      const end = entry.dataOffset + entry.dataLength;
      try {
        for (let frameIndex = 0; frameIndex < entry.frameCount; frameIndex += 1) {
          if (signal?.aborted) throw codedError('CANCELLED', 'Backup package verification was cancelled');
          if (globalFrameIndex > MAX_U32) throw codedError('FRAME_LIMIT_EXCEEDED', 'Global frame counter exhausted');
          const rawLength = Math.min(FRAME_SIZE, entry.size - frameIndex * FRAME_SIZE);
          const lengthBytes = await readExactly(opened.handle, position, 4);
          const storedLen = lengthBytes.readUInt32LE(0);
          validateStoredFrameLength(storedLen, rawLength, entry.compression, entry.index);
          const encrypted = await readExactly(opened.handle, position + 4, storedLen + 16);
          dataHash.update(lengthBytes);
          dataHash.update(encrypted);
          let stored;
          try {
            stored = decryptGcm({
              key: opened.dek,
              nonce: frameNonce(opened.header.baseNonce, globalFrameIndex),
              aad: frameAad({
                packageUuid: opened.header.packageUuidBytes,
                entryIndex: entry.index,
                frameIndex,
                rawLength,
                storedLen,
                entryPlainSize: entry.size,
              }),
              ciphertextAndTag: encrypted,
            });
          } catch (error) {
            throw codedError('CHECKSUM_MISMATCH', `Authentication failed for entry ${entry.index}, frame ${frameIndex}`, error);
          }
          if (stored.length !== storedLen) throw codedError('INVALID_PACKAGE', 'Decrypted stored frame length mismatch');
          const raw = decodeFrame(stored, {
            compression: entry.compression,
            rawLength,
            entryIndex: entry.index,
          });
          if (raw.length !== rawLength || rawLength > FRAME_SIZE || rawTotal + rawLength > entry.size) {
            throw codedError('INVALID_PACKAGE', `Decompressed size exceeds entry ${entry.index}`);
          }
          entryHash.update(raw);
          if (outputHandle) await writeFully(outputHandle, raw);
          rawTotal += rawLength;
          completedBytes += rawLength;
          position += 4 + storedLen + 16;
          globalFrameIndex += 1;
          if (onProgress) await onProgress({
            phase, completedBytes, totalBytes, completedEntries,
            totalEntries: opened.manifest.entries.length, currentLabel,
          });
        }
        if (position !== end || rawTotal !== entry.size) {
          throw codedError('INVALID_PACKAGE', `Entry ${entry.index} frame boundaries do not match manifest`);
        }
        const digest = entryHash.digest();
        const expectedDigest = Buffer.from(entry.sha256, 'hex');
        if (!crypto.timingSafeEqual(digest, expectedDigest)) {
          throw codedError('CHECKSUM_MISMATCH', `Plaintext SHA-256 mismatch for entry ${entry.index}`);
        }
        if (outputHandle) {
          await outputHandle.sync();
          await outputHandle.close();
          outputHandle = undefined;
          await fsp.link(temporaryPath, outputPath);
          await fsp.unlink(temporaryPath);
          temporaryPath = undefined;
          createdFiles.push(outputPath);
        }
        completedEntries += 1;
        if (outputPath) extractedEntries.push({ entry, outputPath });
        if (onEntry) await onEntry({
          entry, outputPath, completedBytes, totalBytes, completedEntries,
          totalEntries: opened.manifest.entries.length, currentLabel,
        });
        if (onProgress) await onProgress({
          phase, completedBytes, totalBytes, completedEntries,
          totalEntries: opened.manifest.entries.length, currentLabel,
        });
      } finally {
        if (outputHandle) await outputHandle.close().catch(() => {});
        if (temporaryPath) await fsp.unlink(temporaryPath).catch(() => {});
      }
    }
    if (signal?.aborted) throw codedError('CANCELLED', 'Backup package verification was cancelled');
    const actualDataSha = dataHash.digest();
    if (!crypto.timingSafeEqual(actualDataSha, opened.footer.dataSha256)) {
      throw codedError('CHECKSUM_MISMATCH', 'Backup package data-region SHA-256 mismatch');
    }
    if (onProgress) await onProgress({
      phase, completedBytes: totalBytes, totalBytes, completedEntries,
      totalEntries: opened.manifest.entries.length, currentLabel: '',
    });
    return { createdFiles, extractedEntries };
  } catch (error) {
    for (const filePath of createdFiles.reverse()) await fsp.unlink(filePath).catch(() => {});
    throw error;
  }
}

async function verifyBackupPackage({ packagePath, password, signal, onProgress }) {
  const opened = await openPackage({ packagePath, password });
  try {
    await processEntries(opened, { signal, onProgress, phase: 'verifying' });
    return {
      manifest: opened.manifest,
      flags: opened.header.flags,
      packageSize: opened.packageSize,
      dataSha256: opened.footer.dataSha256.toString('hex'),
    };
  } finally {
    opened.dek.fill(0);
    await opened.handle.close();
  }
}

async function extractBackupPackage({
  packagePath,
  password,
  destinationDir,
  resolveDestination,
  onEntry,
  onProgress,
  signal,
}) {
  if (typeof destinationDir !== 'string' && typeof resolveDestination !== 'function') {
    throw codedError('UNSAFE_DESTINATION', 'Extraction requires destinationDir or resolveDestination');
  }
  if (destinationDir && !path.isAbsolute(destinationDir)) {
    throw codedError('UNSAFE_DESTINATION', 'Extraction destination must be absolute');
  }
  const opened = await openPackage({ packagePath, password });
  try {
    const result = await processEntries(opened, {
      destinationDir, resolveDestination, onEntry, onProgress, signal, phase: 'writing',
    });
    return {
      manifest: opened.manifest,
      flags: opened.header.flags,
      packageSize: opened.packageSize,
      extractedFiles: result.createdFiles,
      extractedEntries: result.extractedEntries,
    };
  } finally {
    opened.dek.fill(0);
    await opened.handle.close();
  }
}

module.exports = {
  DATA_START,
  FOOTER_SIZE,
  MAX_ENTRIES,
  MAX_MANIFEST_BYTES,
  PREAMBLE_SIZE,
  extractBackupPackage,
  inspectBackupPackage,
  validateEntryPath,
  verifyBackupPackage,
  writeBackupPackage,
};
