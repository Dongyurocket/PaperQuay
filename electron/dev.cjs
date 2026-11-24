const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { bundlePreload } = require('../scripts/bundle-preload.cjs');

const mirrorEnv = {
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  npm_config_electron_mirror: process.env.npm_config_electron_mirror || 'https://npmmirror.com/mirrors/electron/',
};

Object.assign(process.env, mirrorEnv);

const ELECTRON = require('electron');
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:1420';
const VITE_CLI = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite at ${url}`));
          return;
        }

        setTimeout(attempt, 400);
      });

      request.setTimeout(2000, () => {
        request.destroy();
      });
    };

    attempt();
  });
}

const viteProcess = spawn(process.execPath, [VITE_CLI, '--host', '127.0.0.1', '--port', '1420'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...mirrorEnv,
    VITE_DEV_SERVER_URL: DEV_URL,
  },
});

let electronProcess = null;
let restartingElectron = false;
let restartTimer = null;
const WATCH_START_GRACE_MS = 1200;

function isWatchedElectronFile(fileName) {
  const normalized = String(fileName || '').replace(/\\/g, '/');

  // preload.bundle.cjs 是 esbuild 生成物；若把它纳入监听，重新打包会触发无限重启。
  if (normalized === 'preload.bundle.cjs') return false;

  return normalized.endsWith('.cjs') || normalized === 'package.json';
}

function snapshotWatchedElectronFiles(rootDir) {
  const snapshots = new Map();

  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = path.relative(rootDir, entryPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!isWatchedElectronFile(relativePath)) {
        continue;
      }

      try {
        const stat = fs.statSync(entryPath);
        snapshots.set(relativePath, `${stat.mtimeMs}:${stat.size}`);
      } catch {
        snapshots.set(relativePath, 'missing');
      }
    }
  };

  visit(rootDir);
  return snapshots;
}

async function startElectron() {
  // main.cjs 只引用 preload.bundle.cjs；重启前重建，保证 preload 改动生效。
  try {
    await bundlePreload();
  } catch (error) {
    console.error(`[paperquay] Failed to build the preload bundle: ${error.message}`);
    stopAll(1);
    return;
  }

  electronProcess = spawn(ELECTRON, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...mirrorEnv,
      VITE_DEV_SERVER_URL: DEV_URL,
    },
  });

  electronProcess.on('exit', (code) => {
    electronProcess = null;

    if (restartingElectron) {
      restartingElectron = false;
      void startElectron();
      return;
    }

    stopAll(code ?? 0);
  });
}

function scheduleElectronRestart(reason) {
  if (!electronProcess) return;

  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!electronProcess) return;

    console.log(`[paperquay] Electron main changed (${reason}); restarting main process...`);
    restartingElectron = true;
    electronProcess.kill();
  }, 250);
}

function watchElectronMainFiles() {
  const electronDir = path.join(__dirname);
  const watchedFileSnapshots = snapshotWatchedElectronFiles(electronDir);
  const watcherReadyAt = Date.now() + WATCH_START_GRACE_MS;

  try {
    const watcher = fs.watch(electronDir, { recursive: true }, (eventType, fileName) => {
      const changedFile = String(fileName || '').replace(/\\/g, '/');

      if (!isWatchedElectronFile(changedFile)) {
        return;
      }

      const changedPath = path.join(electronDir, changedFile);
      let nextSnapshot = 'missing';

      try {
        const stat = fs.statSync(changedPath);
        nextSnapshot = `${stat.mtimeMs}:${stat.size}`;
      } catch {
      }

      const previousSnapshot = watchedFileSnapshots.get(changedFile);
      watchedFileSnapshots.set(changedFile, nextSnapshot);

      if (Date.now() < watcherReadyAt || previousSnapshot === nextSnapshot) {
        return;
      }

      scheduleElectronRestart(changedFile || eventType);
    });

    process.on('exit', () => watcher.close());
  } catch (error) {
    console.warn(`[paperquay] Electron main file watcher disabled: ${error.message}`);
  }
}

function stopAll(code = 0) {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  if (!viteProcess.killed) {
    viteProcess.kill();
  }

  process.exit(code);
}

viteProcess.on('exit', (code) => {
  if (!electronProcess) {
    stopAll(code ?? 1);
  }
});

waitForServer(DEV_URL)
  .then(() => {
    watchElectronMainFiles();
    void startElectron();
  })
  .catch((error) => {
    console.error(error);
    stopAll(1);
  });

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
