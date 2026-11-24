import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  PENDING_RESTORE_ERROR_MESSAGE,
  createRendererFailureController,
  createStartupFailureHandler,
  describeStartupFailure,
  loadRendererEntry,
  showPendingRestoreError,
} = require('../electron/appLifecycle.cjs');

function createRecorder() {
  const calls = {
    logs: [],
    errorBoxes: [],
    recoveryDialogs: [],
    cleanup: 0,
    exits: [],
    reloads: 0,
  };
  return {
    calls,
    log: (...args) => calls.logs.push(args),
    showErrorBox: (title, content) => calls.errorBoxes.push({ title, content }),
    showRecoveryDialog: async (details) => {
      calls.recoveryDialogs.push(details);
      return 'quit';
    },
    cleanup: () => {
      calls.cleanup += 1;
    },
    exit: (code) => calls.exits.push(code),
    reload: () => {
      calls.reloads += 1;
    },
  };
}

test('startup failure handler shows a readable error, cleans up and exits exactly once', () => {
  const recorder = createRecorder();
  const handler = createStartupFailureHandler({
    dialog: { showErrorBox: recorder.showErrorBox },
    app: { exit: recorder.exit },
    cleanup: recorder.cleanup,
    log: recorder.log,
  });

  const failure = new Error('Cannot read properties of undefined');
  assert.equal(handler(failure), true);
  assert.equal(handler(new Error('second failure')), false);

  assert.equal(recorder.calls.errorBoxes.length, 1);
  assert.match(recorder.calls.errorBoxes[0].content, /Cannot read properties of undefined/);
  assert.equal(recorder.calls.cleanup, 1);
  assert.deepEqual(recorder.calls.exits, [1]);
  assert.equal(recorder.calls.logs.length, 1);
});

test('startup failure description never renders an empty or object-only message', () => {
  assert.match(describeStartupFailure(new Error('')), /could not start/i);
  assert.match(describeStartupFailure(undefined), /could not start/i);
  assert.match(describeStartupFailure({ code: 'EUNKNOWN' }), /could not start/i);
});

test('startup failure handler still exits when the dialog throws', () => {
  const recorder = createRecorder();
  const handler = createStartupFailureHandler({
    dialog: {
      showErrorBox: () => {
        throw new Error('dialog unavailable');
      },
    },
    app: { exit: recorder.exit },
    cleanup: recorder.cleanup,
    log: recorder.log,
  });

  assert.equal(handler(new Error('fatal')), true);
  assert.equal(recorder.calls.cleanup, 1);
  assert.deepEqual(recorder.calls.exits, [1]);
});

test('loadRendererEntry uses loadURL for dev and loadFile for packaged builds', async () => {
  const calls = [];
  const webContents = {
    loadURL: async (url) => calls.push(['loadURL', url]),
    loadFile: async (file) => calls.push(['loadFile', file]),
  };

  await loadRendererEntry(webContents, {
    isDev: true,
    devServerUrl: 'http://127.0.0.1:1420',
    entryFile: 'C:\\app\\dist\\index.html',
  });
  await loadRendererEntry(webContents, {
    isDev: false,
    devServerUrl: '',
    entryFile: 'C:\\app\\dist\\index.html',
  });

  assert.deepEqual(calls, [
    ['loadURL', 'http://127.0.0.1:1420'],
    ['loadFile', 'C:\\app\\dist\\index.html'],
  ]);
});

test('loadRendererEntry turns synchronous load failures into rejected promises', async () => {
  const webContents = {
    loadURL: () => {
      throw new Error('invalid url');
    },
    loadFile: () => {
      throw new Error('missing file');
    },
  };

  await assert.rejects(
    loadRendererEntry(webContents, { isDev: true, devServerUrl: 'bad', entryFile: '' }),
    /invalid url/,
  );
  await assert.rejects(
    loadRendererEntry(webContents, { isDev: false, devServerUrl: '', entryFile: 'missing' }),
    /missing file/,
  );
});

test('renderer load failure is visible, cleans up and exits once in production and dev', () => {
  for (const isDev of [false, true]) {
    const recorder = createRecorder();
    const controller = createRendererFailureController({
      isDev,
      log: recorder.log,
      showErrorBox: recorder.showErrorBox,
      showRecoveryDialog: recorder.showRecoveryDialog,
      cleanup: recorder.cleanup,
      exit: recorder.exit,
      reload: recorder.reload,
    });

    assert.equal(
      controller.handleDidFailLoad({}, -105, 'NAME_NOT_RESOLVED', 'file:///C:/app/dist/index.html', true),
      true,
    );
    assert.equal(
      controller.handleDidFailLoad({}, -105, 'NAME_NOT_RESOLVED', 'file:///C:/app/dist/index.html', true),
      false,
      'the same window must not report two failure dialogs',
    );
    assert.equal(
      controller.handleLoadRejection(new Error('loadFile rejected')),
      false,
      'a load rejection after did-fail-load must not duplicate the report',
    );

    assert.equal(recorder.calls.errorBoxes.length, 1);
    assert.match(recorder.calls.errorBoxes[0].content, /NAME_NOT_RESOLVED|-105/);
    assert.equal(recorder.calls.cleanup, 1);
    assert.deepEqual(recorder.calls.exits, [1]);
  }
});

test('renderer did-fail-load ignores subframes, aborted loads and duplicate events', () => {
  const recorder = createRecorder();
  const controller = createRendererFailureController({
    log: recorder.log,
    showErrorBox: recorder.showErrorBox,
    showRecoveryDialog: recorder.showRecoveryDialog,
    cleanup: recorder.cleanup,
    exit: recorder.exit,
    reload: recorder.reload,
  });

  assert.equal(controller.handleDidFailLoad({}, -105, 'FAILED', 'https://evil.example', false), false);
  assert.equal(controller.handleDidFailLoad({}, -3, 'ERR_ABORTED', 'file:///C:/app/dist/index.html', true), false);
  assert.equal(recorder.calls.errorBoxes.length, 0);
  assert.equal(recorder.calls.cleanup, 0);
});

test('renderer process crashes offer reload or quit in production', async () => {
  const reloadRecorder = createRecorder();
  const reloadController = createRendererFailureController({
    log: reloadRecorder.log,
    showErrorBox: reloadRecorder.showErrorBox,
    showRecoveryDialog: async (details) => {
      reloadRecorder.calls.recoveryDialogs.push(details);
      return 'reload';
    },
    cleanup: reloadRecorder.cleanup,
    exit: reloadRecorder.exit,
    reload: reloadRecorder.reload,
  });

  await reloadController.handleRenderProcessGone({}, { reason: 'crashed', exitCode: 5 });
  assert.equal(reloadRecorder.calls.recoveryDialogs.length, 1);
  assert.equal(reloadRecorder.calls.reloads, 1);
  assert.equal(reloadRecorder.calls.cleanup, 0);
  assert.deepEqual(reloadRecorder.calls.exits, []);

  const quitRecorder = createRecorder();
  const quitController = createRendererFailureController({
    log: quitRecorder.log,
    showErrorBox: quitRecorder.showErrorBox,
    showRecoveryDialog: async (details) => {
      quitRecorder.calls.recoveryDialogs.push(details);
      return 'quit';
    },
    cleanup: quitRecorder.cleanup,
    exit: quitRecorder.exit,
    reload: quitRecorder.reload,
  });

  await quitController.handleRenderProcessGone({}, { reason: 'crashed', exitCode: 5 });
  assert.equal(quitRecorder.calls.recoveryDialogs.length, 1);
  assert.equal(quitRecorder.calls.cleanup, 1);
  assert.deepEqual(quitRecorder.calls.exits, [1]);

  // A second crash before the user answers must not stack dialogs or exits.
  await quitController.handleRenderProcessGone({}, { reason: 'crashed', exitCode: 5 });
  assert.equal(quitRecorder.calls.recoveryDialogs.length, 1);
  assert.deepEqual(quitRecorder.calls.exits, [1]);
});

test('clean renderer exit (window close) does not raise a crash dialog', async () => {
  const recorder = createRecorder();
  const controller = createRendererFailureController({
    log: recorder.log,
    showErrorBox: recorder.showErrorBox,
    showRecoveryDialog: recorder.showRecoveryDialog,
    cleanup: recorder.cleanup,
    exit: recorder.exit,
    reload: recorder.reload,
  });

  await controller.handleRenderProcessGone({}, { reason: 'clean-exit', exitCode: 0 });
  assert.equal(recorder.calls.recoveryDialogs.length, 0);
  assert.equal(recorder.calls.errorBoxes.length, 0);
  assert.equal(recorder.calls.cleanup, 0);
});

test('invalid pending restore shows a readable error pointing at pending.error.json', () => {
  const boxes = [];
  assert.equal(
    showPendingRestoreError({ showErrorBox: (title, content) => boxes.push({ title, content }) }),
    true,
  );
  assert.equal(boxes.length, 1);
  assert.match(boxes[0].title, /restore could not be completed/i);
  assert.match(boxes[0].content, /pending\.error\.json/);
  assert.match(boxes[0].content, /did not open your library/i);
  assert.match(PENDING_RESTORE_ERROR_MESSAGE, /pending\.error\.json/);

  assert.equal(
    showPendingRestoreError({
      showErrorBox: () => {
        throw new Error('no dialog');
      },
    }),
    false,
  );
});

test('main.cjs wires the lifecycle helpers into the production startup and window paths', () => {
  const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

  assert.match(source, /loadRendererEntry\(mainWindow\.webContents/);
  assert.match(source, /mainWindow\.webContents\.on\('render-process-gone'/);
  assert.match(source, /mainWindow\.webContents\.on\('did-fail-load'/);
  assert.match(source, /handleFatalStartupError\(error\)/);
  assert.match(source, /showPendingRestoreError\(dialog\)/);
});
