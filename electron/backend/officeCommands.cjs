'use strict';

/**
 * Office 桥 + 加载项源站的生命周期与状态命令（渲染层经 paperquay:invoke 调用）。
 *
 * 桥与源站都只在主进程里跑：渲染层拿不到 http server，Word 加载项也够不到 Electron IPC，
 * 因此这里只暴露「启动/停止/重启/查看状态/定位发现文件/信任证书」这几个动作，不做文献库写入代理
 * （文献写入仍走既有 library_* 命令，桥的写路径只有 POST /documents/cited）。
 *
 * 两者一起启停：桥是 Word 取数据的通道（127.0.0.1:23120+），源站是 Word 取页面 HTML 的地方
 * （https://localhost:3000，证书不可用时回退 http://localhost:3007）。源站由本体托管，
 * 因此 exe 安装器不需要常驻进程。
 */

const fs = require('node:fs');
const { normalizeSettings, createOfficeBridge } = require('./officeBridge.cjs');
const { createOfficeAddinHost } = require('./officeAddinHost.cjs');

function toErrorMessage(error) {
  return String(error?.message ?? error);
}

function createOfficeCommands(context) {
  const { app, appPaths, store } = context;
  let bridge = null;
  let addinHost = null;

  const log = (level, message) => {
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(`[office] ${message}`);
  };

  /** 原始 officeAddin 设置（桥与源站各自 normalize 同一份对象）。 */
  function readRawSettings() {
    try {
      const settings = typeof store?.loadSettings === 'function' ? store.loadSettings() : null;
      const addin = settings?.officeAddin;
      return addin && typeof addin === 'object' ? addin : null;
    } catch (error) {
      log('error', `读取 Office 插件设置失败：${toErrorMessage(error)}`);
      return null;
    }
  }

  function readSettings() {
    return normalizeSettings(readRawSettings());
  }

  function readSourceSettings() {
    return readRawSettings()?.source ?? null;
  }

  function ensureBridge() {
    if (!bridge) {
      bridge = createOfficeBridge({
        appPaths,
        store,
        appVersion: typeof app?.getVersion === 'function' ? app.getVersion() : '0.0.0',
        getSettings: readSettings,
        logger: { log: (message) => log('log', message), warn: (message) => log('warn', message), error: (message) => log('error', message) },
      });
    }
    return bridge;
  }

  function ensureAddinHost() {
    if (!addinHost) {
      addinHost = createOfficeAddinHost({
        appPaths,
        appRoot: typeof app?.getAppPath === 'function' ? app.getAppPath() : undefined,
        getSettings: readSourceSettings,
        logger: { log: (message) => log('log', message), warn: (message) => log('warn', message), error: (message) => log('error', message) },
      });
    }
    return addinHost;
  }

  function buildStatus() {
    const status = ensureBridge().getStatus();
    return { ...status, settings: readSettings(), source: ensureAddinHost().getStatus() };
  }

  function withFailure(status, failure) {
    if (!failure) return status;
    return { ...status, error: status.error ? `${failure}；${status.error}` : failure };
  }

  async function startBridge() {
    const instance = ensureBridge();
    if (instance.getStatus().running) return;
    await instance.start();
  }

  /** 启动加载项源站；失败不抛错，把原因留在 status.source.error 与 status.error 里。 */
  async function startAddinSource() {
    const host = ensureAddinHost();
    if (host.getStatus().running) return host.getStatus();
    return host.start();
  }

  const commands = {
    async office_get_status() {
      return buildStatus();
    },

    async office_start_bridge() {
      let failure = '';
      if (readSettings().enabled) {
        try {
          await startBridge();
        } catch (error) {
          failure = `桥启动失败：${toErrorMessage(error)}`;
          log('error', failure);
        }
      }
      try {
        const source = await startAddinSource();
        if (!source.running && source.error) failure = failure ? `${failure}；${source.error}` : source.error;
      } catch (error) {
        const text = `加载项源站启动失败：${toErrorMessage(error)}`;
        failure = failure ? `${failure}；${text}` : text;
        log('error', text);
      }
      return withFailure(buildStatus(), failure);
    },

    async office_stop_bridge() {
      if (addinHost) await addinHost.stop();
      if (bridge) await bridge.stop();
      return buildStatus();
    },

    async office_restart_bridge() {
      if (addinHost) await addinHost.stop();
      if (bridge) await bridge.stop();
      let failure = '';
      if (readSettings().enabled) {
        try {
          await startBridge();
        } catch (error) {
          failure = `桥重启失败：${toErrorMessage(error)}`;
          log('error', failure);
        }
      }
      try {
        const source = await startAddinSource();
        if (!source.running && source.error) failure = failure ? `${failure}；${source.error}` : source.error;
      } catch (error) {
        const text = `加载项源站重启失败：${toErrorMessage(error)}`;
        failure = failure ? `${failure}；${text}` : text;
        log('error', text);
      }
      return withFailure(buildStatus(), failure);
    },

    async office_list_citations({ paperId } = {}) {
      const id = typeof paperId === 'string' ? paperId.trim() : '';
      if (!id) return { citations: [] };
      if (typeof store?.listPaperCitations !== 'function') return { citations: [] };
      return { citations: store.listPaperCitations(id) };
    },

    async office_reveal_discovery_file() {
      const { shell } = require('electron');
      const discoveryPath = ensureBridge().getStatus().discoveryPath ?? require('node:path').join(appPaths.dataDir, 'paperquay-office-bridge.json');
      const fs = require('node:fs');
      if (fs.existsSync(discoveryPath)) {
        shell.showItemInFolder(discoveryPath);
        return { revealed: true, path: discoveryPath };
      }
      await shell.openPath(appPaths.dataDir);
      return { revealed: false, path: appPaths.dataDir };
    },

    /** 信任源站证书（必要时先生成）：把本地自签证书装进当前用户的受信任根。 */
    async office_trust_addin_certificate() {
      const host = ensureAddinHost();
      try {
        const result = await host.trustCertificate();
        return { ...result, source: host.getStatus() };
      } catch (error) {
        return { ok: false, reason: toErrorMessage(error), source: host.getStatus() };
      }
    },

    /** 定位加载项：优先安装器写入的清单，其次 office-addin 源目录。 */
    async office_reveal_addin_source() {
      const { shell } = require('electron');
      const status = ensureAddinHost().getStatus();
      if (status.manifestPath && fs.existsSync(status.manifestPath)) {
        shell.showItemInFolder(status.manifestPath);
        return { revealed: true, path: status.manifestPath };
      }
      const target = status.root ?? status.installDir;
      if (target && fs.existsSync(target)) {
        await shell.openPath(target);
        return { revealed: true, path: target };
      }
      return { revealed: false, path: target ?? '' };
    },
  };

  return commands;
}

module.exports = { createOfficeCommands };
