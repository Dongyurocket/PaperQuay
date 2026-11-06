import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  DATA_START,
  extractBackupPackage,
  inspectBackupPackage,
  validateEntryPath,
  verifyBackupPackage,
  writeBackupPackage,
} = require('../electron/backend/backupContainer.cjs');
const { FRAME_SIZE } = require('../electron/backend/backupCrypto.cjs');

function createTempDir(prefix: string) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function createManifest(extra = {}) {
  return {
    manifestVersion: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    app: { name: 'PaperQuay', version: '0.5.0', platform: 'win32', arch: 'x64' },
    schema: { library: 1, notes: 1, rag: 1 },
    sourceRoots: { dataDir: 'C:/paperquay/data', libraryStorageDir: 'D:/papers' },
    resolvedRoots: { dataDir: 'C:/paperquay/data-real' },
    counts: { papers: 1, notes: 1 },
    preset: 'migration',
    warnings: [],
    ...extra,
  };
}

function descriptor({ kind = 'other', relativePath, packagePath, ...extra }: any) {
  return {
    kind,
    sourceRoot: 'dataDir',
    relativePath,
    packagePath,
    originalName: path.posix.basename(packagePath),
    compression: 'none',
    ...extra,
  };
}

async function writeFixture({ directory, entries, compressionLevel = 'standard', onProgress, manifest = createManifest() }: any) {
  const packagePath = path.join(directory, 'backup.pqbackup');
  const result = await writeBackupPackage({
    outputPath: packagePath,
    password: 'correct horse battery staple',
    manifest,
    entries,
    compressionLevel,
    onProgress,
  });
  return { packagePath, result };
}

test('container round-trips Buffer and streamed files, keeps zero-length offsets contiguous, and exposes progress/mappings', async () => {
  const directory = createTempDir('paperquay-backup-container-');
  const target = path.join(directory, 'restore');
  const largeBytes = Buffer.alloc(FRAME_SIZE + 1, 0x5a);
  const memoryBytes = Buffer.from(JSON.stringify({ secret: 'kept in encrypted manifest payload data only' }));
  const sourcePath = path.join(directory, 'large.bin');
  writeFileSync(sourcePath, largeBytes);
  const writerEvents: any[] = [];
  const events: any[] = [];
  const entryEvents: any[] = [];

  try {
    const { packagePath, result } = await writeFixture({
      directory,
      onProgress: (event: any) => writerEvents.push(event),
      entries: [
        descriptor({ kind: 'database', relativePath: 'library.sqlite', packagePath: 'data/library.sqlite', sourcePath }),
        descriptor({ kind: 'config', relativePath: 'paperquay.config.json', packagePath: 'config/paperquay.config.json', data: memoryBytes }),
        descriptor({ relativePath: 'empty-a.bin', packagePath: 'misc/empty-a.bin', data: Buffer.alloc(0) }),
        descriptor({ relativePath: 'empty-b.bin', packagePath: 'misc/empty-b.bin', data: Buffer.alloc(0) }),
      ],
    });
    assert.equal(result.bytes, statSync(packagePath).size);
    assert.equal(result.manifest.preset, 'migration');
    assert.deepEqual(result.manifest.counts, { papers: 1, notes: 1 });
    assert.ok(result.manifest.entries.every((entry: any) => !('sourcePath' in entry) && !('data' in entry)));
    assert.equal(result.manifest.entries[0].frameCount, 2);
    assert.equal(result.manifest.entries[0].dataOffset, DATA_START);
    assert.equal(result.manifest.entries[2].dataOffset, result.manifest.entries[3].dataOffset);
    assert.equal(result.manifest.entries[2].dataLength, 0);

    const inspected = await inspectBackupPackage({ packagePath, password: 'correct horse battery staple' });
    assert.equal(inspected.manifest.packageId, result.manifest.packageId);
    assert.equal(inspected.packageSize, result.bytes);
    assert.equal(writerEvents[0].phase, 'writing');
    assert.equal(writerEvents.at(-1).completedBytes, largeBytes.length + memoryBytes.length);
    assert.equal(writerEvents.at(-1).completedEntries, 4);
    assert.ok(writerEvents.every((event) => 'currentLabel' in event && 'totalEntries' in event));

    const verified = await verifyBackupPackage({
      packagePath,
      password: 'correct horse battery staple',
      onProgress: (event: any) => events.push(event),
    });
    assert.equal(verified.manifest.entries.length, 4);
    assert.equal(events[0].phase, 'verifying');
    assert.equal(events.at(-1).completedBytes, largeBytes.length + memoryBytes.length);
    assert.ok(events.every((event) => 'currentLabel' in event && 'totalEntries' in event));

    const extracted = await extractBackupPackage({
      packagePath,
      password: 'correct horse battery staple',
      resolveDestination: (entry: any) => ({ root: target, relativePath: `mapped/${entry.packagePath}` }),
      onEntry: (event: any) => entryEvents.push(event),
    });
    assert.equal(extracted.extractedEntries.length, 4);
    assert.ok(entryEvents.every((event) => typeof event.outputPath === 'string'));
    const outputs = extracted.extractedEntries.map((item: any) => item.outputPath);
    assert.deepEqual(readFileSync(outputs[0]), largeBytes);
    assert.deepEqual(readFileSync(outputs[1]), memoryBytes);
    assert.equal(statSync(outputs[2]).size, 0);
    assert.equal(statSync(outputs[3]).size, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deflate-raw compresses text while enforcing bounded decompression', async () => {
  const directory = createTempDir('paperquay-backup-compress-');
  const text = Buffer.from(JSON.stringify(Array.from({ length: 12000 }, (_, index) => ({
    id: index,
    title: `Rotorcraft study ${index.toString(36)}`,
    abstract: `Fluid dynamics result ${((index * 982451653) >>> 0).toString(36)}`,
  }))));
  try {
    const { packagePath, result } = await writeFixture({
      directory,
      entries: [descriptor({
        kind: 'config', relativePath: 'state.json', packagePath: 'config/state.json',
        compression: 'deflate-raw', data: text,
      })],
    });
    assert.equal(result.manifest.entries[0].compression, 'deflate-raw');
    assert.ok(result.manifest.entries[0].dataLength < text.length + 20);
    await verifyBackupPackage({ packagePath, password: 'correct horse battery staple' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe paths and normalized collisions, and bounds highly compressible frames', async () => {
  const directory = createTempDir('paperquay-backup-reject-');
  const base = (relativePath: string, packagePath: string, data: Buffer) => descriptor({
    relativePath, packagePath, data,
  });
  try {
    for (const unsafe of ['../escape', '/absolute', 'C:/drive', '//server/share', 'folder\\file', 'name:stream', 'bad*name', 'CON.txt', 'folder/name.', 'folder/name ']) {
      assert.throws(() => validateEntryPath(unsafe), { code: 'UNSAFE_ENTRY_PATH' });
    }
    await assert.rejects(writeFixture({
      directory,
      entries: [base('../escape', 'misc/a.bin', Buffer.from('x'))],
    }), { code: 'UNSAFE_ENTRY_PATH' });
    await assert.rejects(writeFixture({
      directory,
      entries: [descriptor({
        relativePath: 'empty-root.json', packagePath: 'config/empty-root.json', data: Buffer.from('{}'),
      })],
      manifest: createManifest({ sourceRoots: { dataDir: '' }, resolvedRoots: { dataDir: '' } }),
    }), { code: 'INVALID_PACKAGE' });
    await assert.rejects(writeBackupPackage({
      outputPath: path.join(directory, 'oversized-buffer.pqbackup'),
      password: 'correct horse battery staple',
      manifest: createManifest(),
      entries: [descriptor({
        relativePath: 'oversized.json', packagePath: 'config/oversized.json', data: Buffer.alloc(8 * 1024 * 1024 + 1),
      })],
    }), { code: 'INVALID_ENTRY' });
    await assert.rejects(writeFixture({
      directory,
      entries: [
        base('café.txt', 'misc/café.txt', Buffer.from('a')),
        base('cafe\u0301.txt', 'misc/other.txt', Buffer.from('b')),
      ],
    }), { code: 'UNSAFE_ENTRY_PATH' });

    const lowGainPath = path.join(directory, 'low-gain.json');
    const lowGain = randomBytes(1024 * 1024);
    writeFileSync(lowGainPath, lowGain);
    const lowGainResult = await writeFixture({
      directory,
      entries: [descriptor({
        relativePath: 'low-gain.json', packagePath: 'config/low-gain.json', sourcePath: lowGainPath,
        compression: 'deflate-raw',
      })],
    });
    assert.equal(lowGainResult.result.manifest.entries[0].compression, 'none');

    const mixed = Buffer.alloc(FRAME_SIZE + 128 * 1024);
    const sampleBlock = randomBytes(16 * 1024);
    for (let sampleOffset = 0; sampleOffset < FRAME_SIZE; sampleOffset += sampleBlock.length) {
      sampleBlock.copy(mixed, sampleOffset);
    }
    mixed.fill(0, FRAME_SIZE);
    const mixedPath = path.join(directory, 'mixed.txt');
    writeFileSync(mixedPath, mixed);
    await assert.rejects(writeBackupPackage({
      outputPath: path.join(directory, 'bomb.pqbackup'),
      password: 'correct horse battery staple',
      manifest: createManifest(),
      entries: [descriptor({
        relativePath: 'mixed.txt', packagePath: 'text/mixed.txt', sourcePath: mixedPath,
        compression: 'deflate-raw',
      })],
      compressionLevel: 'fast',
    }), { code: 'COMPRESSION_RATIO_LIMIT' });
    assert.equal(readdirSync(directory).some((name) => name.endsWith('.partial')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects wrong passwords, footer AAD tampering, frame corruption, truncation, and unsupported KDF ids', async () => {
  const directory = createTempDir('paperquay-backup-tamper-');
  const data = Buffer.from('authenticated payload that spans several bytes');
  let packagePath: string;
  try {
    ({ packagePath } = await writeFixture({
      directory,
      entries: [descriptor({ kind: 'config', relativePath: 'config.json', packagePath: 'config/config.json', data })],
    }));
    await assert.rejects(inspectBackupPackage({ packagePath, password: 'wrong password is used' }), {
      code: 'WRONG_PASSWORD_OR_CORRUPT',
    });

    const footerTampered = path.join(directory, 'footer-tampered.pqbackup');
    copyFileSync(packagePath, footerTampered);
    let handle = openSync(footerTampered, 'r+');
    const footerOffset = fstatSync(handle).size - 68;
    const nonceByte = Buffer.alloc(1);
    readSync(handle, nonceByte, 0, 1, footerOffset + 20);
    nonceByte[0] ^= 1;
    writeSync(handle, nonceByte, 0, 1, footerOffset + 20);
    fsyncSync(handle);
    closeSync(handle);
    await assert.rejects(inspectBackupPackage({ footerTampered: true, packagePath: footerTampered, password: 'correct horse battery staple' }), {
      code: 'WRONG_PASSWORD_OR_CORRUPT',
    });

    const frameTampered = path.join(directory, 'frame-tampered.pqbackup');
    copyFileSync(packagePath, frameTampered);
    handle = openSync(frameTampered, 'r+');
    const cipherByte = Buffer.alloc(1);
    readSync(handle, cipherByte, 0, 1, DATA_START + 4);
    cipherByte[0] ^= 1;
    writeSync(handle, cipherByte, 0, 1, DATA_START + 4);
    closeSync(handle);
    await assert.rejects(verifyBackupPackage({ packagePath: frameTampered, password: 'correct horse battery staple' }), {
      code: 'CHECKSUM_MISMATCH',
    });

    const truncated = path.join(directory, 'truncated.pqbackup');
    copyFileSync(packagePath, truncated);
    truncateSync(truncated, statSync(truncated).size - 1);
    await assert.rejects(inspectBackupPackage({ packagePath: truncated, password: 'correct horse battery staple' }), {
      code: 'INVALID_PACKAGE',
    });

    const unsupported = path.join(directory, 'unsupported-kdf.pqbackup');
    copyFileSync(packagePath, unsupported);
    handle = openSync(unsupported, 'r+');
    writeSync(handle, Buffer.from([2]), 0, 1, 12);
    closeSync(handle);
    await assert.rejects(inspectBackupPackage({ packagePath: unsupported, password: 'correct horse battery staple' }), {
      code: 'KDF_PARAMETERS_UNSUPPORTED',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects overwrite by default, checks cancellation at entry boundaries, and cleans partials', async () => {
  const directory = createTempDir('paperquay-backup-cancel-');
  const packagePath = path.join(directory, 'backup.pqbackup');
  const abort = new AbortController();
  abort.abort();
  try {
    await assert.rejects(writeBackupPackage({
      outputPath: packagePath,
      password: 'correct horse battery staple',
      manifest: createManifest(),
      entries: [descriptor({
        kind: 'config', relativePath: 'config.json', packagePath: 'config/config.json', data: Buffer.from('x'),
      })],
      signal: abort.signal,
    }), { code: 'CANCELLED' });
    assert.equal(existsSync(packagePath), false);
    assert.equal(readdirSync(directory).some((name) => name.endsWith('.partial')), false);

    const midWriteAbort = new AbortController();
    const midWritePath = path.join(directory, 'mid-write.pqbackup');
    await assert.rejects(writeBackupPackage({
      outputPath: midWritePath,
      password: 'correct horse battery staple',
      manifest: createManifest(),
      entries: [descriptor({
        kind: 'config', relativePath: 'large.bin', packagePath: 'config/large.bin',
        data: Buffer.alloc(FRAME_SIZE + 1, 0x5a),
      })],
      onProgress: (event: any) => {
        if (event.completedBytes >= FRAME_SIZE) midWriteAbort.abort();
      },
      signal: midWriteAbort.signal,
    }), { code: 'CANCELLED' });
    assert.equal(existsSync(midWritePath), false);
    assert.equal(readdirSync(directory).some((name) => name.endsWith('.partial')), false);

    const { packagePath: completePackagePath, result } = await writeFixture({
      directory,
      entries: [descriptor({
        kind: 'config', relativePath: 'config.json', packagePath: 'config/config.json', data: Buffer.from('x'),
      })],
    });
    const extractionTarget = path.join(directory, 'cancelled-restore');
    const extractionAbort = new AbortController();
    await assert.rejects(extractBackupPackage({
      packagePath: completePackagePath,
      password: 'correct horse battery staple',
      destinationDir: extractionTarget,
      signal: extractionAbort.signal,
      onProgress: (event: any) => {
        if (event.completedBytes > 0) extractionAbort.abort();
      },
    }), { code: 'CANCELLED' });
    assert.deepEqual(readdirSync(extractionTarget), []);

    await assert.rejects(writeBackupPackage({
      outputPath: result.packagePath,
      password: 'correct horse battery staple',
      manifest: createManifest(),
      entries: [],
    }), { code: 'OUTPUT_EXISTS' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
