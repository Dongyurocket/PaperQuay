const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { restoreRendererStorage: applyRestorePayload } = require('../src/shared/rendererStorageRestore.cjs');
const { isRendererCommandAllowed } = require('./ipcAllowlist.cjs');

function restoreRendererStorage() {
  let payload;
  try {
    payload = ipcRenderer.sendSync('paperquay:renderer-restore-sync');
  } catch {
    return;
  }
  if (!payload?.restoreId || !payload.state || typeof payload.state !== 'object') return;

  let result;
  try {
    result = applyRestorePayload(window.localStorage, payload, { platform: process.platform });
  } catch {
    result = { failedKeys: ['__localStorage_restore__'], warnings: [] };
  }
  if (!result) return;

  try {
    ipcRenderer.send('paperquay:renderer-restore-ack', {
      restoreId: payload.restoreId,
      failedKeys: result.failedKeys,
      warnings: result.warnings,
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

    // 真实文件拖放由 preload 直接登记读权限；这个入口不暴露给页面脚本，
    // 合成 drop 事件里的 File 没有本地路径，无法借此读取任意文件。
    if (paths.length > 0) {
      ipcRenderer.send('paperquay:approve-read-paths', paths.slice(0, 100));
    }

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
    // 与主进程同一份白名单：渲染层被注入脚本时，连尝试调用未登记命令
    // 的机会都没有。真正以 main 侧校验为准，这里只是尽早失败。
    if (!isRendererCommandAllowed(command)) {
      return Promise.reject(new Error(`Unsupported Electron command: ${String(command)}`));
    }
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
      // sandbox preload 没有 clipboard 模块；用最小同步 IPC 保持原有同步 API。
      try {
        const text = ipcRenderer.sendSync('paperquay:invoke-sync', 'clipboard_read_text', {});
        return typeof text === 'string' ? text : '';
      } catch {
        return '';
      }
    },
    writeText(value) {
      return ipcRenderer.invoke('paperquay:invoke', 'clipboard_write_text', {
        text: String(value ?? ''),
      });
    },
  },
  onFileDrop(callback) {
    return createDropSubscription(callback);
  },
});
