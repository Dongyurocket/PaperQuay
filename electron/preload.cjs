const { clipboard, contextBridge, ipcRenderer, webUtils } = require('electron');
const { remapRendererStorage } = require('../src/shared/rendererStorageRemap.cjs');

function restoreRendererStorage() {
  let payload;
  try {
    payload = ipcRenderer.sendSync('paperquay:renderer-restore-sync');
  } catch {
    return;
  }
  if (!payload?.restoreId || !payload.state || typeof payload.state !== 'object') return;

  const failedKeys = [];
  const warnings = [];
  try {
    const storage = window.localStorage;
    const remapped = remapRendererStorage(payload.state, {
      pathMap: payload.pathMap,
      rootMap: payload.rootMap,
      platform: process.platform,
      hasMineruCache: payload.hasMineruCache === true,
    });
    warnings.push(...remapped.warnings);
    storage.clear();
    for (const [key, value] of Object.entries(remapped.state)) {
      try {
        storage.setItem(key, String(value));
      } catch {
        failedKeys.push(key);
      }
    }
  } catch {
    failedKeys.push('__localStorage_restore__');
  }

  try {
    ipcRenderer.send('paperquay:renderer-restore-ack', {
      restoreId: payload.restoreId,
      failedKeys,
      warnings,
    });
  } catch {}
}

restoreRendererStorage();

function toFilePath(file) {
  if (webUtils && typeof webUtils.getPathForFile === 'function') {
    return webUtils.getPathForFile(file);
  }

  return file.path || '';
}

function createDropSubscription(callback) {
  let dragDepth = 0;

  const emit = (payload) => {
    try {
      callback(payload);
    } catch {
      // Renderer callbacks should not break preload event handlers.
    }
  };

  const hasFileDrag = (event) => {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  };

  const handleDragEnter = (event) => {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
    emit({ type: 'enter', paths: [] });
  };

  const handleDragOver = (event) => {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    emit({ type: 'over', paths: [] });
  };

  const handleDragLeave = (event) => {
    if (!hasFileDrag(event) && dragDepth === 0) {
      return;
    }

    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);

    if (dragDepth === 0) {
      emit({ type: 'leave', paths: [] });
    }
  };

  const handleDrop = (event) => {
    if (!hasFileDrag(event)) {
      return;
    }

    event.preventDefault();
    dragDepth = 0;

    const paths = Array.from(event.dataTransfer?.files ?? [])
      .map(toFilePath)
      .filter(Boolean);

    emit({ type: 'drop', paths });
  };

  window.addEventListener('dragenter', handleDragEnter);
  window.addEventListener('dragover', handleDragOver);
  window.addEventListener('dragleave', handleDragLeave);
  window.addEventListener('drop', handleDrop);

  return () => {
    window.removeEventListener('dragenter', handleDragEnter);
    window.removeEventListener('dragover', handleDragOver);
    window.removeEventListener('dragleave', handleDragLeave);
    window.removeEventListener('drop', handleDrop);
  };
}

contextBridge.exposeInMainWorld('paperquay', {
  platform: process.platform,
  invoke(command, args) {
    return ipcRenderer.invoke('paperquay:invoke', command, args ?? {});
  },
  listen(eventName, callback) {
    const handler = (_event, nextEventName, payload) => {
      if (nextEventName === eventName) {
        callback({ event: eventName, payload });
      }
    };

    ipcRenderer.on('paperquay:event', handler);

    return Promise.resolve(() => {
      ipcRenderer.removeListener('paperquay:event', handler);
    });
  },
  window: {
    minimize() {
      return ipcRenderer.invoke('paperquay:window-control', 'minimize');
    },
    toggleMaximize() {
      return ipcRenderer.invoke('paperquay:window-control', 'toggleMaximize');
    },
    close() {
      return ipcRenderer.invoke('paperquay:window-control', 'close');
    },
  },
  clipboard: {
    readText() {
      return clipboard.readText();
    },
    writeText(value) {
      clipboard.writeText(String(value ?? ''));
    },
  },
  onFileDrop(callback) {
    return createDropSubscription(callback);
  },
});
