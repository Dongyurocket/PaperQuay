// F2/§8 安装版冒烟：NSIS 安装 → 空 user-data-dir 启动 → 逐项验收。
// 运行：node tests/support/installerSmoke.mjs --installer release/PaperQuay-0.4.37-win-x64.exe
// 结果写入 docs/assets/audit-2026-11-24/installer-smoke/。
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { launchPaperQuay, makeAuditDir } from './electronCdp.mjs';
import { writePdfFixtures } from './pdfFixtures.mjs';
import { fillWindowsFileDialog } from './windowsDialog.mjs';

const require = createRequire(import.meta.url);
const { buildMineruCachePaths } = require('../../src/shared/mineruCachePaths.cjs');

const projectRoot = process.cwd();
const installerPath = process.argv.includes('--installer')
  ? path.resolve(process.argv[process.argv.indexOf('--installer') + 1])
  : null;
// 本机已有同 appId 的 PaperQuay 安装时，NSIS 静默安装会先卸载旧版本；
// 为不破坏用户安装，允许直接对安装包 7z 解包后的 payload 做冒烟。
const appDirArg = process.argv.includes('--app-dir')
  ? path.resolve(process.argv[process.argv.indexOf('--app-dir') + 1])
  : null;
const OUT_DIR = path.join(projectRoot, 'docs', 'assets', 'audit-2026-11-24', 'installer-smoke');
const PASSWORD = 'PaperQuay-Smoke-12345';
const results = [];
let app = null;

function record(name, status, detail, error) {
  results.push({ name, status, detail: detail ?? null, error: error ? String(error?.stack || error) : null });
  console.log(`[smoke] ${status.toUpperCase()} ${name}${error ? `: ${error}` : ''}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, 'pass', detail);
    return detail;
  } catch (error) {
    record(name, 'fail', null, error);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

/** 审计资产不能包含个人路径：报告里只保留 <repo>/<temp>/<installer> 占位。 */
function sanitizeValue(value, replacements) {
  if (typeof value === 'string') {
    let text = value;
    for (const [needle, replacement] of replacements) {
      if (needle) text = text.split(needle).join(replacement);
    }
    // 错误堆栈里的 file:///C:/Users/... 是正斜杠形式，单独处理。
    text = text.replace(/C:[\\/]Users[\\/][^\\/\s"']+/gi, '<user>');
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, replacements)]),
    );
  }
  return value;
}

async function install(installer) {
  const workRoot = await makeAuditDir('pq-installer-smoke-');
  const installDir = path.join(workRoot, 'app');
  const install = spawnSync(installer, ['/S', `/D=${installDir}`], { stdio: 'pipe', windowsHide: true });
  assert(install.status === 0, `installer exit ${install.status}: ${install.stderr}`);
  const exe = path.join(installDir, 'PaperQuay.exe');
  await fs.access(exe);
  return { workRoot, installDir, exe };
}

async function invoke(command, args) {
  return app.evaluate(`window.paperquay.invoke(${JSON.stringify(command)}, ${JSON.stringify(args ?? {})})`);
}

async function waitForWorkspace(label) {
  await app.evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!el) throw new Error('missing workspace ' + ${JSON.stringify(label)});
    el.click();
    return true;
  })()`);
}

async function openPaper(paperId) {
  const opened = await app.evaluate(`(() => {
    const row = document.querySelector('[data-paper-row-id="' + ${JSON.stringify(paperId)} + '"]');
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`);
  assert(opened, `paper row not found: ${paperId}`);
  await app.waitFor(`Boolean(document.querySelector('.paperquay-pdf-linked[data-pdf-phase="page-rendered"]'))`, { timeoutMs: 90_000 });
}

async function canvasInkRatio() {
  return app.evaluate(`(() => {
    const canvases = [...document.querySelectorAll('.paperquay-pdf-linked canvas')];
    if (!canvases.length) return null;
    const canvas = canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    const total = data.length / 4;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 200 || data[index + 1] < 200 || data[index + 2] < 200) ink += 1;
    }
    return { width: canvas.width, height: canvas.height, ink, total, ratio: ink / total };
  })()`);
}

function createMcpClient(exe, serverEntry, dataDir) {
  const child = spawn(exe, [serverEntry, '--data-dir', dataDir], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PAPERQUAY_MCP_WRITE: 'off' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  let nextId = 1;
  let stderr = '';
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  return {
    child,
    get stderr() { return stderr; },
    request(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`MCP timeout: ${method}`));
          }
        }, 60_000);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    stop() {
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
    },
  };
}

async function seedMineruCache(dataDir, paper) {
  const cacheRoot = path.join(dataDir, '.mineru-cache');
  const cachePaths = buildMineruCachePaths(cacheRoot, {
    workspaceId: `native-library:${paper.id}`,
    itemKey: paper.id,
    title: paper.title,
  });
  const imagesDir = path.join(cachePaths.directory, 'images');
  await fs.mkdir(imagesDir, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await fs.writeFile(path.join(imagesDir, 'smoke-figure.png'), png);
  await fs.writeFile(cachePaths.contentListJsonPath, JSON.stringify([
    { type: 'text', page_idx: 0, text: 'Smoke content' },
    { type: 'image', page_idx: 0, img_path: 'images/smoke-figure.png', image_caption: ['Figure 1. Smoke figure'] },
  ]), 'utf8');
  return cachePaths.directory;
}

async function main() {
  if (!installerPath && !appDirArg) throw new Error('pass --installer <path-to-nsis-exe> or --app-dir <extracted-payload>');
  await fs.mkdir(OUT_DIR, { recursive: true });
  let workRoot;
  let installDir;
  let exe;
  if (appDirArg) {
    workRoot = await makeAuditDir('pq-installer-payload-');
    installDir = appDirArg;
    exe = path.join(installDir, 'PaperQuay.exe');
    await fs.access(exe);
    record('安装包 payload 解包布局', 'pass', { installDir, installerPath });
  } else {
    ({ workRoot, installDir, exe } = await install(installerPath));
    record('NSIS 静默安装', 'pass', { installDir, installerPath });
  }

  const userDataDir = path.join(workRoot, 'userdata');
  const dataDir = path.join(userDataDir, 'PaperQuay');
  const fixtureDir = path.join(workRoot, 'fixtures');
  const { simplePath, chinesePath } = await writePdfFixtures(fixtureDir);
  await fs.mkdir(dataDir, { recursive: true });
  const simpleInData = path.join(dataDir, 'audit-simple.pdf');
  const chineseInData = path.join(dataDir, 'audit-chinese-cid.pdf');
  await fs.copyFile(simplePath, simpleInData);
  await fs.copyFile(chinesePath, chineseInData);

  // 备份导出目标必须在数据/源目录之外；模拟用户此前通过目录对话框授权过它。
  const backupDir = path.join(workRoot, 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, '.paperquay-approved-roots.json'), JSON.stringify({
    version: 1,
    readRoots: [backupDir],
    writeRoots: [backupDir],
  }), 'utf8');

  app = await launchPaperQuay({
    projectRoot,
    electronBinaryPath: exe,
    appPath: null,
    userDataDir,
    port: 9666,
    // 本机管理员/远程会话下 Chromium OS 沙箱在 app ready 前崩溃
    // (0x80000003)；webPreferences.sandbox 仍限制 preload 的 Node 访问。
    extraArgs: ['--no-sandbox'],
  });

  try {
    await step('启动与 preload 桥', async () => {
      await app.waitFor(`document.readyState === 'complete' && Boolean(window.paperquay)`);
      const ua = await app.evaluate(`navigator.userAgent`);
      assert(/Electron/.test(ua), `unexpected user agent: ${ua}`);
      return { ua, title: await app.evaluate(`document.title`) };
    });

    const simpleImport = await step('导入 PDF', async () => {
      const imported = await invoke('library_import_pdfs', {
        request: { paths: [simpleInData], importMode: 'copy' },
      });
      const entry = imported.find((item) => item.status === 'imported');
      assert(entry?.paper?.id, `import failed: ${JSON.stringify(imported)}`);
      await app.waitFor(`Boolean(document.querySelector('[data-paper-row-id]'))`, { timeoutMs: 60_000 });
      return { paperId: entry.paper.id, title: entry.paper.title };
    });

    await step('打开论文与 PDF 渲染', async () => {
      await openPaper(simpleImport.paperId);
      const ink = await canvasInkRatio();
      assert(ink && ink.ratio > 0.002, `blank PDF canvas: ${JSON.stringify(ink)}`);
      await app.screenshot(path.join(OUT_DIR, 'reader-en.png'));
      return ink;
    });

    const chineseImport = await step('中文 CID PDF 导入与渲染', async () => {
      const imported = await invoke('library_import_pdfs', {
        request: { paths: [chineseInData], importMode: 'copy' },
      });
      const entry = imported.find((item) => item.status === 'imported');
      assert(entry?.paper?.id, `import failed: ${JSON.stringify(imported)}`);
      // 直接走 IPC 导入不会触发 UI 的列表刷新事件；重载渲染层后按数据库重新查询。
      await app.reload();
      await waitForWorkspace('文库');
      await app.waitFor(
        `Boolean(document.querySelector('[data-paper-row-id=${JSON.stringify(entry.paper.id)}]'))`,
        { timeoutMs: 60_000 },
      );
      await openPaper(entry.paper.id);
      const ink = await canvasInkRatio();
      assert(ink && ink.ratio > 0.002, `blank Chinese PDF canvas: ${JSON.stringify(ink)}`);
      await app.screenshot(path.join(OUT_DIR, 'reader-chinese-cid.png'));
      return { paperId: entry.paper.id, title: entry.paper.title, ink };
    });

    await step('笔记创建与读取', async () => {
      await waitForWorkspace('笔记');
      const created = await invoke('notes_create', {
        request: {
          paperId: 'global-notes',
          type: 'standalone',
          pageKind: 'concept',
          title: 'Smoke note',
          content: 'Installed build smoke note.',
          contentText: 'Installed build smoke note.',
        },
      });
      const listed = await invoke('notes_list', { request: { limit: 20, offset: 0 } });
      const notes = Array.isArray(listed) ? listed : listed?.notes ?? [];
      assert(notes.some((item) => item.id === created.id), 'created note not listed');
      await app.screenshot(path.join(OUT_DIR, 'notes.png'));
      return { noteId: created.id };
    });

    await step('Vault 同步', async () => {
      const vaultDir = path.join(workRoot, 'vault');
      await fs.mkdir(vaultDir, { recursive: true });
      await invoke('notes_vault_update_settings', { settings: { dir: vaultDir, autoSync: false } });
      const sync = await invoke('notes_vault_sync_now', { options: { background: false } });
      const files = await fs.readdir(vaultDir, { recursive: true });
      assert(files.some((name) => String(name).endsWith('.md')), `no markdown written: ${JSON.stringify(sync)}`);
      return { vaultDir, files: files.length };
    });

    await step('RetainPDF 状态', async () => {
      const status = await invoke('retainpdf_get_status', {});
      return { installed: status.installed, running: status.running, jobs: status.jobs?.length ?? 0 };
    });

    const exportResult = await step('备份导出', async () => {
      const destinationPath = path.join(backupDir, 'smoke-backup.pqbackup');
      const estimate = await invoke('backup_export_estimate', { options: {} });
      const exported = await invoke('backup_export_start', {
        destinationPath,
        password: PASSWORD,
        options: { verifyAfterExport: true },
        rendererState: {},
      });
      const stat = await fs.stat(destinationPath);
      assert(stat.size > 0, 'backup package is empty');
      return { destinationPath, bytes: stat.size, estimateEntries: estimate?.entries ?? null, exported };
    });

    await step('备份导入检查（拒绝未授权包路径）', async () => {
      let rejected = false;
      let message = '';
      try {
        await invoke('backup_import_inspect', { packagePath: exportResult.destinationPath, password: PASSWORD });
      } catch (error) {
        message = String(error);
        rejected = /UNAUTHORIZED_PACKAGE|selected through|文件对话框选择备份包/i.test(message);
      }
      assert(rejected, `unauthorized package path should be rejected: ${message}`);
      return { rejected, message };
    });

    const importSelection = await step('备份导入（原生对话框授权）', async () => {
      const selectPromise = invoke('backup_select_package', {});
      await fillWindowsFileDialog({ processId: app.child.pid, filePath: exportResult.destinationPath });
      const selected = await selectPromise;
      assert(selected, 'select_package returned null');
      const inspected = await invoke('backup_import_inspect', { packagePath: selected, password: PASSWORD });
      assert(inspected?.manifest || inspected?.summary || inspected?.ok !== false, `inspect failed: ${JSON.stringify(inspected)}`);
      return { selected, inspectedKeys: Object.keys(inspected ?? {}) };
    });

    await step('MCP read_paper_figure（安装版 server）', async () => {
      const cacheDir = await seedMineruCache(dataDir, {
        id: chineseImport.paperId,
        title: chineseImport.title || 'audit-chinese-cid',
      });
      await app.stop();
      app = null;

      const serverEntry = path.join(installDir, 'resources', 'paperquay-mcp', 'server.cjs');
      await fs.access(serverEntry);
      const mcp = createMcpClient(exe, serverEntry, dataDir);
      try {
        await mcp.request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'paperquay-smoke', version: '1.0.0' },
        });
        mcp.notify('notifications/initialized');
        const tools = await mcp.request('tools/list');
        assert(tools.tools?.length === 28, `expected 28 tools, got ${tools.tools?.length}`);
        const figure = await mcp.request('tools/call', {
          name: 'read_paper_figure',
          arguments: { paperId: chineseImport.paperId, blockId: 'page-1-block-2' },
        });
        const payload = figure?.content?.find((item) => item.type === 'text')?.text ?? '';
        assert(/Figure 1|imageAvailable|smoke-figure/i.test(payload) || figure?.content?.some((item) => item.type === 'image'),
          `figure not returned: ${JSON.stringify(figure).slice(0, 500)}`);
        return { tools: tools.tools.length, cacheDir, figureType: figure?.content?.map((item) => item.type) };
      } finally {
        mcp.stop();
      }
    });

    await step('备份导入（恢复到临时目录）', async () => {
      assert(importSelection?.selected, 'backup package was not authorized through the dialog');
      app = await launchPaperQuay({
        projectRoot,
        electronBinaryPath: exe,
        appPath: null,
        userDataDir,
        port: 9667,
        extraArgs: ['--no-sandbox'],
      });
      await app.waitFor(`document.readyState === 'complete' && Boolean(window.paperquay)`);

      const restoreLibrary = path.join(workRoot, 'restore-library');
      const restoreVault = path.join(workRoot, 'restore-vault');
      await fs.mkdir(restoreLibrary, { recursive: true });
      await fs.mkdir(restoreVault, { recursive: true });

      const libraryPromise = invoke('backup_select_library_dir', {});
      await fillWindowsFileDialog({ processId: app.child.pid, filePath: restoreLibrary });
      const selectedLibrary = await libraryPromise;
      assert(selectedLibrary, 'select_library_dir returned null');

      const vaultPromise = invoke('backup_select_vault_dir', {});
      await fillWindowsFileDialog({ processId: app.child.pid, filePath: restoreVault });
      const selectedVault = await vaultPromise;
      assert(selectedVault, 'select_vault_dir returned null');

      const stage = await invoke('backup_import_stage', {
        packagePath: importSelection.selected,
        password: PASSWORD,
        targets: { libraryStorageDir: selectedLibrary, notesVaultDir: selectedVault },
        currentRendererState: {},
      });
      const restoredLibraryFiles = await fs.readdir(restoreLibrary, { recursive: true });
      const restoredVaultFiles = await fs.readdir(restoreVault, { recursive: true });
      assert(restoredLibraryFiles.length > 0 || restoredVaultFiles.length > 0,
        `restore targets are empty: ${JSON.stringify(stage)}`);
      return {
        stage: { restartRequired: Boolean(stage?.restartRequired), keys: Object.keys(stage ?? {}) },
        restoredLibraryFiles: restoredLibraryFiles.length,
        restoredVaultFiles: restoredVaultFiles.length,
      };
    });
  } finally {
    if (app) await app.stop();
    const payloadAsar = path.join(installDir, 'resources', 'app.asar');
    const payloadAsarBytes = await fs.stat(payloadAsar).then((stat) => stat.size).catch(() => null);
    const payloadSha256 = payloadAsarBytes ? await hashFile(payloadAsar).catch(() => null) : null;
    const installerSha256 = installerPath ? await hashFile(installerPath).catch(() => null) : null;
    const replacements = [
      [workRoot, '<temp>'],
      [workRoot.replace(/\\/g, '/'), '<temp>'],
      [installerPath, '<installer>'],
      [installerPath?.replace(/\\/g, '/'), '<installer>'],
      [projectRoot, '<repo>'],
      [projectRoot.replace(/\\/g, '/'), '<repo>'],
      [os.tmpdir(), '<temp>'],
      [os.tmpdir().replace(/\\/g, '/'), '<temp>'],
    ];
    const summary = {
      generatedAt: new Date().toISOString(),
      installer: installerPath ? {
        name: path.basename(installerPath),
        sha256: installerSha256,
        bytes: await fs.stat(installerPath).then((stat) => stat.size).catch(() => null),
      } : null,
      payload: {
        appAsarSha256: payloadSha256,
        appAsarBytes: payloadAsarBytes,
      },
      workRoot: '<temp>',
      password: '***',
      results: sanitizeValue(results, replacements),
      pass: results.filter((item) => item.status === 'pass').length,
      fail: results.filter((item) => item.status === 'fail').length,
      appLogs: sanitizeValue(app ? { stdout: app.stdout, stderr: app.stderr, exceptions: app.exceptions } : null, replacements),
    };
    await fs.writeFile(path.join(OUT_DIR, 'smoke-results.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(OUT_DIR, 'smoke-summary.md'), [
      '# Installer smoke',
      '',
      `- installer: ${summary.installer ? `${summary.installer.name} (sha256 ${summary.installer.sha256 ?? 'unavailable'})` : '<payload>'}`,
      `- payload app.asar: sha256 ${summary.payload.appAsarSha256 ?? 'unavailable'}`,
      `- pass: ${summary.pass}, fail: ${summary.fail}`,
      '',
      ...summary.results.map((item) => `- ${item.status === 'pass' ? 'PASS' : 'FAIL'} ${item.name}${item.error ? ` — ${item.error.split('\n')[0]}` : ''}`),
      '',
    ].join('\n'), 'utf8');
    console.log(`[smoke] results: ${path.join(OUT_DIR, 'smoke-results.json')}`);
    console.log(`[smoke] pass=${summary.pass} fail=${summary.fail}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
