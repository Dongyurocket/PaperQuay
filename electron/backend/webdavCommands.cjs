const { cleanString, now } = require('./utils.cjs');
const { webdavView } = require('./libraryStore.cjs');
const { WebdavClient, normalizeRemoteRoot } = require('./webdavClient.cjs');
const {
  latestInfoFromManifest,
  loadLatestManifest,
  runBackup,
  runRestore,
} = require('./webdavBackup.cjs');

const WEBDAV_BACKUP_PROGRESS_EVENT = 'paperquay://webdav-backup-progress';

function emitBackupProgress(sender, payload) {
  if (!sender || typeof sender.send !== 'function') return;
  sender.send('paperquay:event', WEBDAV_BACKUP_PROGRESS_EVENT, payload);
}

function updateSettings(store, settings) {
  const library = store.load();
  library.webdav = {
    ...library.webdav,
    endpointUrl: cleanString(settings.endpointUrl),
    remoteRoot: normalizeRemoteRoot(settings.remoteRoot || library.webdav.remoteRoot),
    username: cleanString(settings.username),
    password: settings.clearPassword
      ? ''
      : settings.password != null
        ? String(settings.password)
        : library.webdav.password,
    includePdfs: settings.includePdfs !== false,
    includeDerived: settings.includeDerived !== false,
    updatedAtMs: now(),
  };

  return { library, webdav: library.webdav };
}

function createClientFromStore(store) {
  const settings = store.load().webdav;
  return new WebdavClient(settings);
}

function createWebdavCommands(context) {
  const { store } = context;

  return {
    webdav_get_backup_settings() {
      return webdavView(store.load().webdav);
    },

    async webdav_update_backup_settings({ settings }) {
      const { library, webdav } = updateSettings(store, settings ?? {});
      await store.save(library);
      return webdavView(webdav);
    },

    async webdav_test_connection() {
      const settings = store.load().webdav;
      if (!cleanString(settings.endpointUrl)) {
        return {
          ok: false,
          endpointUrl: '',
          remoteRoot: settings.remoteRoot,
          message: 'WebDAV endpoint is not configured.',
        };
      }

      try {
        const webdav = new WebdavClient(settings);
        await webdav.test();
        return {
          ok: true,
          endpointUrl: settings.endpointUrl,
          remoteRoot: settings.remoteRoot,
          message: 'WebDAV connection succeeded.',
        };
      } catch (error) {
        return {
          ok: false,
          endpointUrl: settings.endpointUrl,
          remoteRoot: settings.remoteRoot,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async webdav_backup_now(_args, event) {
      return runBackup(context, createClientFromStore(store), {
        onProgress: (payload) => emitBackupProgress(event?.sender, payload),
      });
    },

    async webdav_inspect_latest_backup() {
      const manifest = await loadLatestManifest(createClientFromStore(store));
      return latestInfoFromManifest(manifest);
    },

    async webdav_restore_missing_from_latest() {
      return runRestore(context, createClientFromStore(store));
    },
  };
}

module.exports = { createWebdavCommands };
