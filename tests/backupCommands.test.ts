import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createBackupCommands, publicError } = require('../electron/backend/backupCommands.cjs');

function createHarness(overrides: Record<string, unknown> = {}) {
  const events: Array<{ event: string; payload: unknown }> = [];
  const appPaths = { dataDir: path.join(tmpdir(), 'paperquay-command-test', 'PaperQuay') };
  const context: Record<string, any> = {
    appPaths,
    app: { getPath: () => tmpdir() },
    store: { load: () => ({ settings: { storageDir: path.join(tmpdir(), 'papers') } }) },
    electron: {
      BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
      dialog: {
        showSaveDialog: async () => ({ canceled: false, filePath: path.join(tmpdir(), 'sample.pqbackup') }),
        showOpenDialog: async (_window: unknown, options: { properties: string[] }) => ({ canceled: false, filePaths: [options.properties.includes('openFile') ? path.join(tmpdir(), 'sample.pqbackup') : path.join(tmpdir(), 'chosen')] }),
      },
      shell: { showItemInFolder: () => undefined },
    },
    backupImport: {
      inspectBackupPackage: async () => ({ ok: true }),
      stageBackupImport: async () => ({ ok: true, restartRequired: false }),
      prepareRollback: async () => ({ ok: true, restartRequired: false }),
      getBackupStatus: () => ({ history: [], oldDataDirs: [], oldDataDirDetails: [] }),
      deleteOldData: async () => ({ ok: true, freedBytes: 0 }),
      ...((overrides.backupImport as object) || {}),
    },
    backupEstimate: async () => ({ entries: 1, totalBytes: 2, breakdown: { databases: { entries: 1, totalBytes: 2 } }, warnings: [] }),
    backupExport: async () => ({ ok: true, packagePath: path.join(tmpdir(), 'sample.pqbackup'), bytes: 2, entries: 1, durationMs: 1, warnings: [] }),
    ...overrides,
  };
  const commands = createBackupCommands(context);
  const event = { sender: { send: (_channel: string, eventName: string, payload: unknown) => events.push({ event: eventName, payload }) } };
  return { commands, context, event, events };
}

function abortableRunner({ signal, onProgress }: { signal: AbortSignal; onProgress: (event: Record<string, unknown>) => void }) {
  onProgress({ phase: 'writing', completedBytes: 1, totalBytes: 2, completedEntries: 0, totalEntries: 1, currentLabel: 'config' });
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })), { once: true });
  });
}

test('backup commands expose expected selectors, estimate breakdown, status and safe error text', async () => {
  const opened: string[] = [];
  const harness = createHarness({
    electron: {
      BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
      dialog: {
        showSaveDialog: async (_window: unknown, options: { defaultPath: string }) => ({ canceled: false, filePath: options.defaultPath }),
        showOpenDialog: async (_window: unknown, options: { properties: string[] }) => ({ canceled: false, filePaths: [options.properties.includes('openFile') ? path.join(tmpdir(), 'sample.pqbackup') : path.join(tmpdir(), 'chosen')] }),
      },
      shell: { showItemInFolder: (target: string) => opened.push(target) },
    },
    backupImport: {
      getBackupStatus: () => ({ history: [{ direction: 'export', packagePath: path.join(tmpdir(), 'sample.pqbackup') }], oldDataDirs: [], oldDataDirDetails: [] }),
    },
  });
  assert.match((await harness.commands.backup_select_destination({}, harness.event)) as string, /PaperQuay-Backup-.*\.pqbackup$/);
  assert.equal(await harness.commands.backup_select_package({}, harness.event), path.join(tmpdir(), 'sample.pqbackup'));
  assert.equal(await harness.commands.backup_select_library_dir({}, harness.event), path.join(tmpdir(), 'chosen'));
  assert.equal(await harness.commands.backup_select_vault_dir({}, harness.event), path.join(tmpdir(), 'chosen'));
  const estimate = await harness.commands.backup_export_estimate({ options: { preset: 'daily' }, rendererState: {} });
  assert.equal(estimate.breakdown.databases.totalBytes, 2);
  assert.equal((await harness.commands.backup_get_status()).history[0].direction, 'export');
  assert.deepEqual(await harness.commands.backup_open_path({ path: path.join(tmpdir(), 'sample.pqbackup') }), { ok: false });
  assert.deepEqual(publicError(Object.assign(new Error('password leaked'), { code: 'WRONG_PASSWORD_OR_CORRUPT' })).message, '密码错误或备份包已损坏。');
  assert.deepEqual(opened, []);
});

test('export task is mutually exclusive and cancellation aborts it through the public error mapper', async () => {
  const harness = createHarness({ backupExport: async (_context: unknown, options: { signal: AbortSignal; onProgress: (event: Record<string, unknown>) => void }) => abortableRunner(options) });
  const exporting = harness.commands.backup_export_start({ destinationPath: path.join(tmpdir(), 'sample.pqbackup'), password: 'correct horse battery staple' }, harness.event);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    harness.commands.backup_export_start({ destinationPath: path.join(tmpdir(), 'second.pqbackup'), password: 'correct horse battery staple' }, harness.event),
    { code: 'BACKUP_BUSY' },
  );
  assert.deepEqual(await harness.commands.backup_export_cancel(), { cancelled: true });
  await assert.rejects(exporting, { code: 'CANCELLED', message: '操作已取消，未修改本机数据。' });
  assert.ok(harness.events.some((item) => item.event === 'paperquay://backup-progress'));
});

test('import stage shares the cancellation command but inspection is not cancellable', async () => {
  let stageSignal: AbortSignal | null = null;
  const chosen = path.join(tmpdir(), 'chosen');
  const harness = createHarness({
    backupImport: {
      inspectBackupPackage: async () => new Promise((resolve) => setImmediate(() => resolve({ ok: true }))),
      stageBackupImport: async (_context: unknown, options: { signal: AbortSignal }) => {
        stageSignal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancel'), { code: 'CANCELLED' })), { once: true }));
      },
    },
  });
  assert.equal(await harness.commands.backup_select_library_dir({}, harness.event), chosen);
  await harness.commands.backup_select_package({}, harness.event);
  const inspecting = harness.commands.backup_import_inspect({ packagePath: path.join(tmpdir(), 'sample.pqbackup'), password: 'correct horse battery staple' });
  assert.deepEqual(await harness.commands.backup_export_cancel(), { cancelled: false });
  await inspecting;
  const staging = harness.commands.backup_import_stage({ packagePath: path.join(tmpdir(), 'sample.pqbackup'), password: 'correct horse battery staple', targets: { libraryStorageDir: chosen }, currentRendererState: {} }, harness.event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stageSignal?.aborted, false);
  assert.deepEqual(await harness.commands.backup_export_cancel(), { cancelled: true });
  await assert.rejects(staging, { code: 'CANCELLED', message: '操作已取消，未修改本机数据。' });
});

test('restore stage accepts only directories returned by the main-process selection dialog', async () => {
  const testRoot = path.join(process.cwd(), '.tmp-test');
  const chosen = path.join(testRoot, 'approved-library');
  const unapproved = path.join(testRoot, 'unapproved-library');
  const staged: Array<Record<string, any>> = [];
  const harness = createHarness({
    electron: {
      BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
      dialog: {
        showSaveDialog: async () => ({ canceled: true }),
        showOpenDialog: async (_window: unknown, options: { properties: string[] }) => ({
          canceled: false,
          filePaths: [options.properties.includes('openFile') ? path.join(testRoot, 'sample.pqbackup') : chosen],
        }),
      },
      shell: { showItemInFolder: () => undefined },
    },
    backupImport: {
      stageBackupImport: async (_context: unknown, options: Record<string, any>) => {
        staged.push(options);
        return { ok: true, restartRequired: false };
      },
    },
  });

  await harness.commands.backup_select_package({}, harness.event);

  await assert.rejects(
    harness.commands.backup_import_stage({ packagePath: path.join(testRoot, 'sample.pqbackup'), password: 'pw', targets: { libraryStorageDir: unapproved }, currentRendererState: {} }, harness.event),
    { code: 'UNSAFE_DESTINATION' },
  );
  assert.equal(staged.length, 0, 'the importer must not see an unauthorized target');

  assert.equal(await harness.commands.backup_select_library_dir({}, harness.event), chosen);
  await harness.commands.backup_import_stage({ packagePath: path.join(testRoot, 'sample.pqbackup'), password: 'pw', targets: { libraryStorageDir: chosen, notesVaultDir: null }, currentRendererState: {} }, harness.event);
  assert.equal(staged.length, 1);
  assert.deepEqual(staged[0].authorizedTargets, [chosen]);
  assert.equal(staged[0].targets.libraryStorageDir, chosen);
});

test('restore stage rejects UNC and device targets', async () => {
  const testRoot = path.join(process.cwd(), '.tmp-test');
  const harness = createHarness({
    electron: {
      BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
      dialog: {
        showSaveDialog: async () => ({ canceled: true }),
        showOpenDialog: async (_window: unknown, options: { properties: string[] }) => ({
          canceled: false,
          filePaths: [options.properties.includes('openFile') ? path.join(testRoot, 'sample.pqbackup') : path.join(testRoot, 'approved')],
        }),
      },
      shell: { showItemInFolder: () => undefined },
    },
  });
  await harness.commands.backup_select_package({}, harness.event);
  const targetCode = process.platform === 'win32' ? 'UNSAFE_DESTINATION' : 'TARGET_NOT_WRITABLE';
  await assert.rejects(
    harness.commands.backup_import_stage({ packagePath: path.join(testRoot, 'sample.pqbackup'), password: 'pw', targets: { libraryStorageDir: '\\\\server\\share\\library' }, currentRendererState: {} }, harness.event),
    { code: targetCode },
  );
  if (process.platform === 'win32') {
    await assert.rejects(
      harness.commands.backup_import_stage({ packagePath: path.join(testRoot, 'sample.pqbackup'), password: 'pw', targets: { libraryStorageDir: '\\\\?\\C:\\library' }, currentRendererState: {} }, harness.event),
      { code: 'UNSAFE_DESTINATION' },
    );
  }
});

test('backup inspection only accepts package paths returned by the selection dialog', async () => {
  const testRoot = path.join(process.cwd(), '.tmp-test');
  const chosen = path.join(testRoot, 'chosen.pqbackup');
  const inspected: string[] = [];
  const harness = createHarness({
    electron: {
      BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
      dialog: {
        showSaveDialog: async () => ({ canceled: true }),
        showOpenDialog: async () => ({ canceled: false, filePaths: [chosen] }),
      },
      shell: { showItemInFolder: () => undefined },
    },
    backupImport: {
      inspectBackupPackage: async ({ packagePath }: { packagePath: string }) => {
        inspected.push(packagePath);
        return { ok: true };
      },
    },
  });

  // 渲染层伪造的绝对路径：未经过对话框登记，容器读取前就必须拒绝。
  await assert.rejects(
    harness.commands.backup_import_inspect({ packagePath: path.join(testRoot, 'forged.pqbackup'), password: 'pw' }),
    { code: 'UNAUTHORIZED_PACKAGE' },
  );
  assert.equal(inspected.length, 0);

  assert.equal(await harness.commands.backup_select_package({}, harness.event), chosen);
  assert.deepEqual(
    await harness.commands.backup_import_inspect({ packagePath: chosen, password: 'pw' }),
    { ok: true },
  );
  assert.deepEqual(inspected, [chosen]);
});

test('backup inspection rejects UNC, device and ADS package paths before the importer runs', async () => {
  let inspected = 0;
  const harness = createHarness({
    backupImport: {
      inspectBackupPackage: async () => {
        inspected += 1;
        return { ok: true };
      },
    },
  });

  for (const packagePath of [
    '\\\\server\\share\\sample.pqbackup',
    '\\\\?\\C:\\sample.pqbackup',
    'C:\\sample.pqbackup:stream',
  ]) {
    await assert.rejects(
      harness.commands.backup_import_inspect({ packagePath, password: 'pw' }),
      { code: 'UNAUTHORIZED_PACKAGE' },
    );
  }
  assert.equal(inspected, 0, 'the package container must not be opened before path validation');
});

test('import stage only accepts package paths returned by the selection dialog', async () => {
  const testRoot = path.join(process.cwd(), '.tmp-test');
  const chosenPackage = path.join(testRoot, 'chosen.pqbackup');
  const approvedDir = path.join(testRoot, 'approved-library');
  const staged: Array<Record<string, any>> = [];
  const harness = createHarness({
    electron: {
      BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
      dialog: {
        showSaveDialog: async () => ({ canceled: true }),
        showOpenDialog: async (_window: unknown, options: { properties: string[] }) => ({
          canceled: false,
          filePaths: [options.properties.includes('openFile') ? chosenPackage : approvedDir],
        }),
      },
      shell: { showItemInFolder: () => undefined },
    },
    backupImport: {
      stageBackupImport: async (_context: unknown, options: Record<string, any>) => {
        staged.push(options);
        return { ok: true, restartRequired: false };
      },
    },
  });

  for (const packagePath of [
    path.join(testRoot, 'forged.pqbackup'),
    '\\\\server\\share\\sample.pqbackup',
    '\\\\?\\C:\\sample.pqbackup',
    'C:\\sample.pqbackup:stream',
  ]) {
    await assert.rejects(
      harness.commands.backup_import_stage({ packagePath, password: 'pw', targets: {}, currentRendererState: {} }, harness.event),
      { code: 'UNAUTHORIZED_PACKAGE' },
    );
  }
  assert.equal(staged.length, 0, 'the importer must not see an unregistered package');

  assert.equal(await harness.commands.backup_select_package({}, harness.event), chosenPackage);
  await assert.rejects(
    harness.commands.backup_import_stage({ packagePath: chosenPackage, password: 'pw', targets: {}, currentRendererState: {} }, harness.event),
    { code: 'TARGET_NOT_WRITABLE' },
  );
  assert.equal(staged.length, 0);

  assert.equal(await harness.commands.backup_select_library_dir({}, harness.event), approvedDir);
  await harness.commands.backup_import_stage({ packagePath: chosenPackage, password: 'pw', targets: { libraryStorageDir: approvedDir }, currentRendererState: {} }, harness.event);
  assert.equal(staged.length, 1);
  assert.equal(staged[0].packagePath, chosenPackage);
  assert.deepEqual(staged[0].authorizedTargets, [approvedDir]);
});

test('a UNC path returned by the dialog is not registered as an authorized package', async () => {
  const uncPackage = '\\\\server\\share\\sample.pqbackup';
  const harness = createHarness({
    electron: {
      BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
      dialog: {
        showSaveDialog: async () => ({ canceled: true }),
        showOpenDialog: async () => ({ canceled: false, filePaths: [uncPackage] }),
      },
      shell: { showItemInFolder: () => undefined },
    },
  });

  assert.equal(await harness.commands.backup_select_package({}, harness.event), uncPackage);
  await assert.rejects(
    harness.commands.backup_import_inspect({ packagePath: uncPackage, password: 'pw' }),
    { code: 'UNAUTHORIZED_PACKAGE' },
  );
});
