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
  const harness = createHarness({
    backupImport: {
      inspectBackupPackage: async () => new Promise((resolve) => setImmediate(() => resolve({ ok: true }))),
      stageBackupImport: async (_context: unknown, options: { signal: AbortSignal }) => {
        stageSignal = options.signal;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancel'), { code: 'CANCELLED' })), { once: true }));
      },
    },
  });
  const inspecting = harness.commands.backup_import_inspect({ packagePath: path.join(tmpdir(), 'sample.pqbackup'), password: 'correct horse battery staple' });
  assert.deepEqual(await harness.commands.backup_export_cancel(), { cancelled: false });
  await inspecting;
  const staging = harness.commands.backup_import_stage({ packagePath: path.join(tmpdir(), 'sample.pqbackup'), password: 'correct horse battery staple', targets: {}, currentRendererState: {} }, harness.event);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stageSignal?.aborted, false);
  assert.deepEqual(await harness.commands.backup_export_cancel(), { cancelled: true });
  await assert.rejects(staging, { code: 'CANCELLED', message: '操作已取消，未修改本机数据。' });
});
