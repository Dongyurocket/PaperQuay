// Electron 验收驱动：CDP 连接真实渲染进程，供 axe 扫描、双主题截图与安装版冒烟复用。
// 只依赖 Node 24 内置 WebSocket / fetch，不引入 Playwright。
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export function electronBinary(projectRoot) {
  if (process.platform === 'win32') {
    return path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  }
  if (process.platform === 'darwin') {
    return path.join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron');
}

// 本机安全软件会锁住 %TEMP% 与用户目录外层的 ACL（Electron 创建 profile 时报
// Error code 5，进程单例锁失败后直接退出）。验收 profile 必须放在仓库内的
// .tmp-*（已 gitignore）；安装包构建/归档仍可放仓库外。可用 PAPERQUAY_AUDIT_ROOT 覆盖。
export function auditRoot() {
  return process.env.PAPERQUAY_AUDIT_ROOT
    || path.resolve(process.cwd(), '.tmp-audit');
}

export async function makeAuditDir(prefix = 'pq-audit-') {
  const root = auditRoot();
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, prefix));
}

export async function makeUserDataDir(prefix = 'pq-audit-') {
  return makeAuditDir(prefix);
}

async function waitForDebugTarget(port, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && /index\.html/.test(target.url));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // 端点尚未就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for CDP target on port ${port}`);
}

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.message} (${pending.method})`));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params);
      }
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

export async function launchPaperQuay(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const binary = options.electronBinaryPath ?? electronBinary(projectRoot);
  const appPath = options.appPath === null ? null : (options.appPath ?? projectRoot);
  const port = options.port ?? 9333;
  const userDataDir = options.userDataDir ?? await makeUserDataDir();
  const env = {
    ...process.env,
    PAPERQUAY_PERF: '1',
    ...(options.env ?? {}),
  };
  delete env.ELECTRON_RUN_AS_NODE;

  // 本机环境限制：不带 --no-sandbox 时 Chromium 在 app ready 前崩溃
  // (0x80000003)；crash reporter/GPU 子进程也会在受限会话里退出。渲染器仍由
  // webPreferences.sandbox 限制 preload 的 Node 访问，验收文档记录该限制。
  const auditArgs = options.auditArgs ?? [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-crash-reporter',
    '--disable-breakpad',
  ];
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...auditArgs,
    ...(options.extraArgs ?? []),
    ...(appPath ? [appPath] : []),
  ];
  if (options.executableArgsFirst) args.unshift(...(options.executableArgsFirst ?? []));

  const startedAt = Date.now();
  const child = spawn(binary, args, {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const target = await waitForDebugTarget(port);
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', () => reject(new Error('CDP websocket failed to open')), { once: true });
      });
      const cdp = new CdpConnection(ws);
      await cdp.send('Runtime.enable');
      await cdp.send('Page.enable');

      const consoleLines = [];
      cdp.on('Runtime.consoleAPICalled', (params) => {
        const text = (params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ');
        consoleLines.push({ type: params.type, text, at: Date.now() });
      });
      const exceptions = [];
      cdp.on('Runtime.exceptionThrown', (params) => {
        exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'unknown exception');
      });

      const controller = {
        child,
        cdp,
        port,
        userDataDir,
        startedAt,
        consoleLines,
        exceptions,
        get stdout() { return stdout.join(''); },
        get stderr() { return stderr.join(''); },
        get exited() { return exited; },
        async evaluate(expression) {
          const result = await cdp.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true,
          });
          if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
          }
          return result.result?.value;
        },
        async reload() {
          const loaded = new Promise((resolve) => {
            const off = cdp.on('Page.loadEventFired', () => {
              off();
              resolve();
            });
          });
          await cdp.send('Page.reload', { ignoreCache: true });
          await loaded;
          await this.waitFor(`document.readyState === 'complete' && Boolean(window.paperquay)`, {
            timeoutMs: 60_000,
          });
        },
        async waitFor(expression, { timeoutMs = 30_000, intervalMs = 100 } = {}) {
          const startedAt = Date.now();
          let lastValue;
          while (Date.now() - startedAt < timeoutMs) {
            try {
              lastValue = await this.evaluate(expression);
              if (lastValue) return lastValue;
            } catch {
              // 页面重载或 DOM 短暂不可用时继续等。
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
          }
          throw new Error(`Timed out waiting for: ${expression}; last=${JSON.stringify(lastValue)}`);
        },
        async screenshot(filePath, { selector = null } = {}) {
          let clip;
          if (selector) {
            clip = await this.evaluate(`(() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return null;
              const rect = el.getBoundingClientRect();
              return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
            })()`);
          }
          const result = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            ...(clip ? { clip } : {}),
          });
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, Buffer.from(result.data, 'base64'));
          return filePath;
        },
        async setTheme(mode) {
          await this.evaluate(`localStorage.setItem('paperquay-theme-mode', ${JSON.stringify(mode)}); location.reload(); true`);
          await this.waitFor(`document.readyState === 'complete' && Boolean(window.paperquay)`, { timeoutMs: 60_000 });
          await this.waitFor(`document.documentElement.classList.contains('dark') === ${mode === 'dark'}`, { timeoutMs: 30_000 });
        },
        async injectAxe() {
          const axeSource = await fs.readFile(path.join(projectRoot, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
          await this.evaluate(`${axeSource}\n;true`);
          await this.waitFor(`Boolean(window.axe)`, { timeoutMs: 30_000 });
        },
        async runAxe(contextSelector = 'body') {
          return this.evaluate(`axe.run(document.querySelector(${JSON.stringify(contextSelector)}) ?? document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
            resultTypes: ['violations', 'incomplete'],
          }).then((result) => {
            const detail = (nodes) => nodes.map((n) => ({
              target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target ?? ''),
              html: String(n.html ?? '').slice(0, 500),
              summary: n.failureSummary ?? '',
            }));
            return {
              violations: result.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                help: v.help,
                nodes: v.nodes.length,
                details: detail(v.nodes),
              })),
              passes: result.passes.length,
              incomplete: result.incomplete.map((v) => ({
                id: v.id,
                impact: v.impact,
                help: v.help,
                nodes: v.nodes.length,
                details: detail(v.nodes),
              })),
            };
          })`);
        },
        async stop() {
          cdp.close();
          if (exited) return exited;
          if (process.platform === 'win32') {
            await new Promise((resolve) => {
              spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', resolve);
            });
          } else {
            child.kill('SIGTERM');
          }
          const startedAt = Date.now();
          while (!exited && Date.now() - startedAt < 15_000) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return exited ?? { code: null, signal: 'timeout' };
        },
      };
      return controller;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  try {
    child.kill();
  } catch {
    // ignore
  }
  throw new Error(`Failed to attach to PaperQuay: ${lastError}\nstdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`);
}
