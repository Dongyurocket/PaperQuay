import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPathPolicy } = require('../electron/backend/pathPolicy.cjs');
const { createMineruCacheCommands } = require('../electron/backend/mineruCacheCommands.cjs');
const { createFileCommands } = require('../electron/backend/fileCommands.cjs');
const { addTranslatedPdfAttachment } = require('../electron/backend/translatedPdfAttachments.cjs');
const { createAppSettingsStore } = require('../electron/backend/appSettings.cjs');
const { RENDERER_ALLOWED_COMMANDS } = require('../electron/ipcAllowlist.cjs');

function createAppPaths(dataDir) {
  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
    libraryPath: path.join(dataDir, 'paperquay-library.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
    screenshotDir: path.join(dataDir, '.screenshots'),
  };
}

function createPolicy({
  appPaths,
  storageDir = '',
  translatedPdfDir = '',
  knownAttachmentDirs = [],
  knownAttachmentPaths = [],
}) {
  const samePath = (left, right) => {
    const canonical = (value) => {
      try {
        const real = realpathSync.native ? realpathSync.native(value) : realpathSync(value);
        return real.toLowerCase();
      } catch {
        return path.resolve(value).toLowerCase();
      }
    };
    return canonical(left) === canonical(right);
  };
  return createPathPolicy({
    appPaths,
    store: {
      loadSettings: () => ({ storageDir, translatedPdfDir }),
      load: () => ({ settings: { storageDir, translatedPdfDir }, papers: [] }),
      isKnownAttachmentLocation: (filePath) => knownAttachmentPaths.some((item) => samePath(item, filePath)),
      isKnownAttachmentDirectory: (directoryPath) => knownAttachmentDirs.some((item) => samePath(item, directoryPath)),
    },
    approvedReadPaths: new Set(),
    approvedWritePaths: new Set(),
  });
}

function createCommands({ appPaths, pathPolicy, readerSettings = {}, librarySettings = {} }) {
  return createMineruCacheCommands({
    appPaths,
    pathPolicy,
    store: { loadSettings: () => librarySettings },
    appSettings: { getPublic: () => ({ settings: readerSettings }) },
  });
}

function writeMineruCache(directory) {
  mkdirSync(path.join(directory, 'images'), { recursive: true });
  writeFileSync(path.join(directory, 'images', 'part_1_aaa.jpg'), 'fake-image');
  writeFileSync(
    path.join(directory, 'content_list_v2.json'),
    JSON.stringify([{ 0: { type: 'image', content: { image_source: { path: 'images/aaa.jpg' } } } }]),
  );
}

test('authorization status distinguishes default, dialog-approved and missing approval', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-status-'));
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-outside-'));
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });

  try {
    const defaultStatus = policy.getAuthorizationStatus(appPaths.mineruCacheDir, {
      mode: 'write',
      defaultPaths: [appPaths.mineruCacheDir],
    });
    assert.equal(defaultStatus.authorized, true);
    assert.equal(defaultStatus.reason, 'default');
    // 默认 MinerU 根由 pathPolicy 内置，不传 defaultPaths 也能识别。
    assert.equal(policy.getAuthorizationStatus(appPaths.mineruCacheDir).reason, 'default');

    const missingStatus = policy.getAuthorizationStatus(outsideDir, {
      mode: 'write',
      defaultPaths: [appPaths.mineruCacheDir],
    });
    assert.equal(missingStatus.authorized, false);
    assert.equal(missingStatus.reason, 'missing-approval');
    assert.equal(missingStatus.path, path.resolve(outsideDir));

    policy.approveWritePath(outsideDir);
    const approvedStatus = policy.getAuthorizationStatus(outsideDir, {
      mode: 'write',
      defaultPaths: [appPaths.mineruCacheDir],
    });
    assert.equal(approvedStatus.authorized, true);
    assert.equal(approvedStatus.reason, 'dialog-approved');
    assert.equal(policy.isApprovedPath(outsideDir, 'write'), true);
    assert.equal(policy.isApprovedPath(outsideDir, 'read'), false);

    const inDataDir = path.join(dataDir, 'custom-cache');
    const configuredStatus = policy.getAuthorizationStatus(inDataDir, {
      mode: 'write',
      trustedRoots: [dataDir],
    });
    assert.equal(configuredStatus.authorized, true);
    assert.equal(configuredStatus.reason, 'configured');

    // UNC 在 realpath 前就拒绝，授权查询不能触发 SMB 探测。
    const uncStatus = policy.getAuthorizationStatus('\\\\server\\share\\cache', {
      mode: 'write',
      defaultPaths: [appPaths.mineruCacheDir],
    });
    assert.equal(uncStatus.authorized, false);
    assert.equal(uncStatus.reason, 'unsafe');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('path_authorization_status reports upgrade configs without approval records', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-command-'));
  const customCacheDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-cache-'));
  const customTranslatedDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-translated-'));
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths, translatedPdfDir: customTranslatedDir });
  const commands = createCommands({
    appPaths,
    pathPolicy: policy,
    readerSettings: { mineruCacheDir: customCacheDir },
    librarySettings: { storageDir: '', translatedPdfDir: customTranslatedDir },
  });

  try {
    assert.equal(typeof commands.path_authorization_status, 'function');
    assert.equal(
      RENDERER_ALLOWED_COMMANDS.has('path_authorization_status'),
      true,
      'the read-only status command must be allowlisted',
    );

    const status = await commands.path_authorization_status();
    assert.deepEqual(Object.keys(status).sort(), ['mineruCacheDir', 'storageDir', 'translatedPdfDir']);

    assert.equal(status.mineruCacheDir.reason, 'missing-approval');
    assert.equal(status.mineruCacheDir.authorized, false);
    assert.equal(status.mineruCacheDir.path, customCacheDir);
    // 未授权路径不做 existsSync：否则渲染层可把只读状态命令当成任意路径探针。
    assert.equal(status.mineruCacheDir.exists, false);

    assert.equal(status.translatedPdfDir.reason, 'missing-approval');
    assert.equal(status.translatedPdfDir.authorized, false);

    // 默认库目录位于 dataDir 内，无需对话框授权。
    assert.equal(status.storageDir.authorized, true);
    assert.equal(status.storageDir.reason, 'default');

    policy.approveWritePath(customCacheDir);
    const afterApproval = await commands.path_authorization_status();
    assert.equal(afterApproval.mineruCacheDir.authorized, true);
    assert.equal(afterApproval.mineruCacheDir.reason, 'dialog-approved');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(customCacheDir, { recursive: true, force: true });
    rmSync(customTranslatedDir, { recursive: true, force: true });
  }
});

test('repair and prepare refuse a configured but unapproved MinerU cache directory', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-repair-'));
  const customRoot = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-repair-root-'));
  const appPaths = createAppPaths(dataDir);
  const cacheDir = path.join(customRoot, 'document-a');
  writeMineruCache(cacheDir);

  const policy = createPolicy({ appPaths });
  const commands = createCommands({
    appPaths,
    pathPolicy: policy,
    readerSettings: { mineruCacheDir: customRoot },
  });

  try {
    // 默认缓存根始终可写，无需授权文件。
    const defaultCacheDir = path.join(appPaths.mineruCacheDir, 'document-default');
    writeMineruCache(defaultCacheDir);
    const defaultReport = await commands.repair_mineru_cache_images({ directory: defaultCacheDir });
    assert.equal(defaultReport.fixed, 1);

    await assert.rejects(
      commands.repair_mineru_cache_images({ directory: cacheDir }),
      /outside the MinerU cache root/,
    );
    await assert.rejects(
      commands.prepare_mineru_reparse({ directory: cacheDir }),
      /outside the MinerU cache root/,
    );
    await assert.rejects(
      commands.finish_mineru_cache_reparse({ directory: cacheDir, success: false }),
      /outside the MinerU cache root/,
    );
    await assert.rejects(
      commands.read_mineru_asset_base64({ cacheDir, assetPath: 'images/aaa.jpg' }),
      /not allowed/,
    );

    policy.approveWritePath(customRoot);
    const report = await commands.repair_mineru_cache_images({ directory: cacheDir });
    assert.equal(report.fixed, 1);

    const prepared = await commands.prepare_mineru_reparse({ directory: cacheDir });
    assert.deepEqual(prepared.removedFiles.sort(), ['content_list_v2.json']);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(customRoot, { recursive: true, force: true });
  }
});

test('renderer cannot gain write access by writing mineruCacheDir to the filesystem root', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-root-'));
  const filesystemRoot = path.parse(dataDir).root;
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  const commands = createCommands({
    appPaths,
    pathPolicy: policy,
    readerSettings: { mineruCacheDir: filesystemRoot },
  });

  try {
    const status = await commands.path_authorization_status();
    assert.equal(status.mineruCacheDir.authorized, false);
    assert.equal(status.mineruCacheDir.reason, 'missing-approval');
    assert.equal(policy.isWriteAllowed(path.join(filesystemRoot, 'paperquay-should-not-write')), false);
    assert.equal(policy.isApprovedPath(filesystemRoot, 'write'), false);

    await assert.rejects(
      commands.prepare_mineru_reparse({ directory: path.join(filesystemRoot, 'paperquay-should-not-write') }),
      /outside the MinerU cache root/,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a legacy config file with a custom mineruCacheDir becomes authorized only after re-selection', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-legacy-'));
  const customCacheDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-legacy-cache-'));
  const appPaths = createAppPaths(dataDir);
  const approvalsFilePath = path.join(dataDir, '.paperquay-approved-roots.json');

  mkdirSync(path.join(dataDir, '.settings'), { recursive: true });
  writeFileSync(
    appPaths.configPath,
    JSON.stringify({ settings: { mineruCacheDir: customCacheDir } }, null, 2),
    'utf8',
  );

  const policy = createPolicy({ appPaths });
  const appSettings = createAppSettingsStore({ appPaths, legacyZoteroDir: () => '' });
  const commands = createMineruCacheCommands({
    appPaths,
    pathPolicy: policy,
    appSettings,
    store: { loadSettings: () => ({ storageDir: '', translatedPdfDir: '' }) },
  });

  try {
    assert.equal(existsSync(approvalsFilePath), false, 'upgrade starts without an approval file');

    const status = await commands.path_authorization_status();
    assert.equal(status.mineruCacheDir.path, customCacheDir);
    assert.equal(status.mineruCacheDir.reason, 'missing-approval');
    assert.equal(status.mineruCacheDir.authorized, false);

    await assert.rejects(
      commands.prepare_mineru_reparse({ directory: customCacheDir }),
      /outside the MinerU cache root/,
    );

    // 目录对话框返回后 approveWritePath 会持久化授权记录。
    policy.approveWritePath(customCacheDir);
    assert.equal(existsSync(approvalsFilePath), true);

    const afterApproval = await commands.path_authorization_status();
    assert.equal(afterApproval.mineruCacheDir.reason, 'dialog-approved');
    assert.equal(afterApproval.mineruCacheDir.authorized, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(customCacheDir, { recursive: true, force: true });
  }
});

test('path_authorization_status tolerates missing settings stores', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-empty-'));
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  const commands = createMineruCacheCommands({ appPaths, pathPolicy: policy });

  try {
    const status = await commands.path_authorization_status();
    assert.equal(status.mineruCacheDir.reason, 'default');
    assert.equal(status.mineruCacheDir.authorized, true);
    assert.equal(status.storageDir.authorized, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('approveReadDirectory authorizes only the selected directory, never its parent', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-dir-'));
  const rootDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-dir-root-'));
  const childDir = path.join(rootDir, 'cache');
  mkdirSync(childDir, { recursive: true });
  const parentFile = path.join(rootDir, 'outside.txt');
  const siblingDir = path.join(rootDir, 'sibling');
  mkdirSync(siblingDir, { recursive: true });
  writeFileSync(parentFile, 'parent', 'utf8');
  writeFileSync(path.join(childDir, 'inside.txt'), 'inside', 'utf8');
  const appPaths = createAppPaths(dataDir);

  try {
    const policy = createPolicy({ appPaths });
    policy.approveReadDirectory(childDir);

    assert.equal(policy.isReadAllowed(path.join(childDir, 'inside.txt')), true);
    // 父目录文件、父目录 .pdf、父目录的其它子目录都不应因目录选择而可读/可写。
    assert.equal(policy.isReadAllowed(parentFile), false);
    assert.equal(policy.isWriteAllowed(path.join(rootDir, 'sibling.pdf')), false);
    assert.equal(policy.isReadAllowed(path.join(siblingDir, 'other.txt')), false);
    assert.equal(policy.isApprovedPath(rootDir, 'read'), false);
    assert.equal(
      policy.readRoots().some((root) => path.resolve(root) === path.resolve(rootDir)),
      false,
      'readRoots must not contain the parent directory',
    );

    // 重启（新 policy 从持久化文件恢复）后仍只授权目录自身。
    const restarted = createPolicy({ appPaths });
    assert.equal(restarted.isReadAllowed(path.join(childDir, 'inside.txt')), true);
    assert.equal(restarted.isReadAllowed(parentFile), false);
    assert.equal(restarted.isReadAllowed(path.join(siblingDir, 'other.txt')), false);
    assert.equal(
      restarted.readRoots().some((root) => path.resolve(root) === path.resolve(rootDir)),
      false,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test('select_directory and prepare_mineru_cache_dir use the directory-only approval entry', () => {
  const fileCommandsSource = readFileSync(
    path.resolve('electron/backend/fileCommands.cjs'),
    'utf8',
  );
  const selectBlock = fileCommandsSource.slice(
    fileCommandsSource.indexOf('async select_directory('),
    fileCommandsSource.indexOf('async prepare_mineru_cache_dir('),
  );
  assert.match(selectBlock, /approveReadDirectory\(selected\)/);
  assert.equal(/approveReadPath\(selected\)/.test(selectBlock), false);

  const prepareBlock = fileCommandsSource.slice(
    fileCommandsSource.indexOf('async prepare_mineru_cache_dir('),
    fileCommandsSource.indexOf('async list_directory_files('),
  );
  assert.match(prepareBlock, /approveReadDirectory\(resolvedTargetDir\)/);
  assert.match(prepareBlock, /migrationSkippedReason/);
});

test('path_authorization_status keeps translatedPdfDir aligned with isReadAllowed/isWriteAllowed', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-translated-'));
  const customTranslatedDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-translated-dir-'));
  writeFileSync(path.join(customTranslatedDir, 'paper.pdf'), 'pdf', 'utf8');
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths, translatedPdfDir: customTranslatedDir });
  const commands = createCommands({
    appPaths,
    pathPolicy: policy,
    librarySettings: { storageDir: '', translatedPdfDir: customTranslatedDir },
  });

  try {
    const target = path.join(customTranslatedDir, 'paper.pdf');
    const status = await commands.path_authorization_status();
    assert.equal(status.translatedPdfDir.reason, 'missing-approval');
    assert.equal(status.translatedPdfDir.authorized, false);
    // 状态与真实策略必须一致：不能一边报缺失授权，一边读写放行。
    assert.equal(policy.isReadAllowed(target), false);
    assert.equal(policy.isWriteAllowed(target), false);

    policy.approveReadDirectory(customTranslatedDir);
    policy.approveWritePath(customTranslatedDir);
    const approved = await commands.path_authorization_status();
    assert.equal(approved.translatedPdfDir.reason, 'dialog-approved');
    assert.equal(approved.translatedPdfDir.authorized, true);
    assert.equal(policy.isReadAllowed(target), true);
    assert.equal(policy.isWriteAllowed(target), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(customTranslatedDir, { recursive: true, force: true });
  }
});

test('path_authorization_status matches attachment-derived access for a populated translated dir', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-populated-'));
  const customTranslatedDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-populated-dir-'));
  const target = path.join(customTranslatedDir, 'paper.pdf');
  writeFileSync(target, 'pdf', 'utf8');
  const appPaths = createAppPaths(dataDir);
  // 生产环境里 libraryStore 用附件锚点判定目录：目录中已有译版 PDF 时可读，
  // 同目录新 .pdf 也可写。状态必须与这两个方法一致，不能仍报 missing-approval。
  const policy = createPolicy({
    appPaths,
    translatedPdfDir: customTranslatedDir,
    knownAttachmentDirs: [customTranslatedDir],
    knownAttachmentPaths: [target],
  });

  try {
    assert.equal(policy.isReadAllowed(target), true);
    assert.equal(policy.isWriteAllowed(path.join(customTranslatedDir, 'next.pdf')), true);

    const status = policy.getAuthorizationStatus(customTranslatedDir, {
      mode: 'write',
      defaultPaths: [path.join(dataDir, 'paperquay-data', 'translated-pdfs')],
      trustedRoots: [dataDir],
    });
    assert.equal(status.authorized, true);
    assert.equal(status.reason, 'known-attachment');
    assert.equal(status.exists, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(customTranslatedDir, { recursive: true, force: true });
  }
});

test('unauthorized status does not return a realpath', async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-real-'));
  const realDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-real-target-'));
  const linkedDir = path.join(path.dirname(realDir), `${path.basename(realDir)}-link`);
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  const commands = createCommands({ appPaths, pathPolicy: policy });

  try {
    try {
      symlinkSync(realDir, linkedDir, 'junction');
    } catch (error) {
      t.skip(`junction unavailable: ${error?.message ?? error}`);
      return;
    }

    const status = await commands.path_authorization_status();
    assert.equal(status.mineruCacheDir.authorized, true);

    const unauthorized = policy.getAuthorizationStatus(linkedDir, {
      mode: 'write',
      defaultPaths: [appPaths.mineruCacheDir],
    });
    assert.equal(unauthorized.authorized, false);
    assert.equal(unauthorized.path, path.resolve(linkedDir));
    assert.notEqual(unauthorized.path, realpathSync.native
      ? realpathSync.native(linkedDir)
      : realpathSync(linkedDir));

    policy.approveWritePath(linkedDir);
    const authorized = policy.getAuthorizationStatus(linkedDir, {
      mode: 'write',
      defaultPaths: [appPaths.mineruCacheDir],
    });
    assert.equal(authorized.authorized, true);
    assert.equal(authorized.path, realpathSync.native
      ? realpathSync.native(linkedDir)
      : realpathSync(linkedDir));
  } finally {
    rmSync(linkedDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(realDir, { recursive: true, force: true });
  }
});

test('write checks resolve the nearest existing ancestor through a junction', async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-link-write-'));
  const approvedDir = path.join(dataDir, 'approved');
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-link-outside-'));
  const linkDir = path.join(approvedDir, 'link');
  mkdirSync(approvedDir, { recursive: true });
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  policy.approveWritePath(approvedDir);

  try {
    try {
      symlinkSync(outsideDir, linkDir, 'junction');
    } catch (error) {
      t.skip(`junction unavailable: ${error?.message ?? error}`);
      return;
    }
    const target = path.join(linkDir, 'newdir', 'pwn.txt');
    assert.equal(policy.isWriteAllowed(target), false, 'nonexistent child under a junction must not be writable');
  } finally {
    rmSync(linkDir, { recursive: true, force: true });
    rmSync(approvedDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('write-mode authorization status does not treat a readable-only ancestor as known attachment', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-status-write-'));
  const parentDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-status-write-parent-'));
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  const childDir = path.join(parentDir, 'child');
  const selectedFile = path.join(parentDir, 'selected.pdf');
  mkdirSync(childDir, { recursive: true });
  writeFileSync(selectedFile, '%PDF-1.7\n');

  try {
    policy.approveReadPath(selectedFile);
    assert.equal(policy.getAuthorizationStatus(childDir, { mode: 'read' }).authorized, true);
    const writeStatus = policy.getAuthorizationStatus(childDir, { mode: 'write' });
    assert.equal(writeStatus.authorized, false, 'readable-only ancestor must not report writable');
    assert.equal(policy.isWriteAllowed(path.join(childDir, 'probe.pdf')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(parentDir, { recursive: true, force: true });
  }
});

test('translated PDF attachment writer rejects an unapproved custom translatedPdfDir', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-translated-'));
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-translated-outside-'));
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  const sourcePath = path.join(dataDir, 'source.pdf');
  writeFileSync(sourcePath, '%PDF-1.7\nsource\n');

  try {
    await assert.rejects(
      addTranslatedPdfAttachment({
        paper: {
          id: 'paper-1',
          title: 'Paper',
          authors: [],
          attachments: [],
          updatedAt: 1,
        },
        sourcePath,
        settings: { storageDir: path.join(dataDir, 'papers'), translatedPdfDir: outsideDir },
        appPaths,
        pathPolicy: policy,
        persist: async () => {},
      }),
      /not authorized/i,
    );
    assert.equal(existsSync(path.join(outsideDir, 'probe.pdf')), false);
    assert.equal(readdirSync(outsideDir).length, 0, 'writer must fail before creating files');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('prepare_mineru_cache_dir skips migration from an unreadable previous directory', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-migrate-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-migrate-src-'));
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  const commands = createFileCommands({
    appPaths,
    approvedWritePaths: new Set(),
    pathPolicy: policy,
    store: {
      load: () => ({ settings: {}, papers: [] }),
      loadSettings: () => ({}),
      isKnownAttachmentLocation: () => false,
      isKnownAttachmentDirectory: () => false,
    },
  });
  const sourceCache = path.join(outsideRoot, 'document-secret');
  writeMineruCache(sourceCache);
  const targetDir = path.join(dataDir, '.mineru-cache-new');

  try {
    const prepared = await commands.prepare_mineru_cache_dir({
      directory: targetDir,
      previousDirectory: outsideRoot,
    });
    assert.equal(prepared.directory, path.resolve(targetDir));
    assert.equal(prepared.migratedCount, 0);
    assert.equal(prepared.migrationSkippedReason, 'previous-not-authorized');
    assert.equal(existsSync(path.join(targetDir, '.paperquay-mineru-cache.json')), true);
    assert.equal(existsSync(path.join(targetDir, 'document-secret')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('prepare_mineru_cache_dir skips migration when the previous directory listing fails with EPERM', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-auth-migrate-os-'));
  const appPaths = createAppPaths(dataDir);
  const policy = createPolicy({ appPaths });
  const previousDir = path.join(dataDir, '.mineru-cache-previous');
  const targetDir = path.join(dataDir, '.mineru-cache-target');
  mkdirSync(previousDir, { recursive: true });
  const commands = createFileCommands({
    appPaths,
    approvedWritePaths: new Set(),
    pathPolicy: policy,
    store: {
      load: () => ({ settings: {}, papers: [] }),
      loadSettings: () => ({}),
      isKnownAttachmentLocation: () => false,
      isKnownAttachmentDirectory: () => false,
    },
    listMineruCacheEntries: async (root) => {
      if (path.resolve(root) === path.resolve(previousDir)) {
        const error = new Error('EPERM: operation not permitted');
        error.code = 'EPERM';
        throw error;
      }
      return [];
    },
  });

  try {
    const prepared = await commands.prepare_mineru_cache_dir({
      directory: targetDir,
      previousDirectory: previousDir,
    });
    assert.equal(prepared.migrationSkippedReason, 'previous-unreadable');
    assert.equal(prepared.migratedCount, 0);
    assert.equal(existsSync(path.join(targetDir, '.paperquay-mineru-cache.json')), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
