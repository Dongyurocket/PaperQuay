'use strict';

/**
 * Word 加载项静态资源源站（Office.js 任务窗格页面的托管方）。
 *
 * 为什么需要它：Office 加载项页面无法用 file:// 打开，Word 只会从 https（或 localhost 的 http）
 * 源站取页面。源站由 PaperQuay 主进程托管、随应用启停，因此 exe 安装器不需要常驻任何进程——
 * 安装器只负责证书、清单与侧载注册表，页面始终由应用自己提供。
 *
 * 证书与清单的查找顺序（安装器目录优先，便于安装器换证书后无需改应用）：
 *   1. `%LOCALAPPDATA%\PaperQuay\OfficeAddin\`（exe 安装器写入）
 *   2. `<dataDir>/office-addin/`（开发者首次启动时用 PowerShell 自动生成）
 *   3. `<office-addin>/.certs/`（scripts/office-addin-server.mjs 留下的证书）
 * 都不可用且允许回退时，用 http://localhost:3007 托管（Word 会提示不安全，但功能可用）。
 *
 * 安全约束：只监听 127.0.0.1、只读 office-addin/ 目录、绝不做目录穿越、不写任何文件
 * （唯一例外是按需生成证书，且仅写入上述证书目录）。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOST = '127.0.0.1';
const ADDIN_DIR_NAME = 'office-addin';
const DEFAULT_HTTPS_PORT = 3000;
const DEFAULT_HTTP_PORT = 3007;
const PFX_FILE_NAME = 'paperquay-addin.pfx';
const CER_FILE_NAME = 'paperquay-addin.cer';
const PASSPHRASE_FILE_NAME = 'passphrase.txt';
const MANIFEST_FILE_NAME = 'manifest.xml';
const INSTALL_INFO_FILE_NAME = 'install.json';
const CERTIFICATE_FRIENDLY_NAME = 'PaperQuay Office Add-in';
const INSTALL_DIR_SEGMENTS = ['PaperQuay', 'OfficeAddin'];
const LISTEN_HOST = HOST;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isDirectory(target) {
  try {
    return Boolean(target) && fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target) {
  try {
    return Boolean(target) && fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function toErrorMessage(error) {
  return String(error?.message ?? error);
}

function clampPort(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return fallback;
  return parsed;
}

/** 源站设置（settings.officeAddin.source）。端口 0 表示由系统分配（测试用）。 */
function normalizeSourceSettings(raw) {
  const record = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: record.enabled !== false,
    httpsPort: clampPort(record.httpsPort, DEFAULT_HTTPS_PORT),
    httpPort: clampPort(record.httpPort, DEFAULT_HTTP_PORT),
    allowHttpFallback: record.allowHttpFallback !== false,
  };
}

/** 安装器自有目录：%LOCALAPPDATA%\PaperQuay\OfficeAddin（安装器与本体共用同一约定）。 */
function resolveInstallDir(env = process.env) {
  const base = cleanString(env.LOCALAPPDATA) || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, ...INSTALL_DIR_SEGMENTS);
}

/**
 * 读取安装器写下的 install.json（缺失或损坏时返回 null，不影响源站启动）。
 * 只解析需要的几个字段，避免为一个只读状态引入 JSON 依赖。
 */
function readInstallInfo(installDir) {
  const infoPath = path.join(installDir, INSTALL_INFO_FILE_NAME);
  if (!isFile(infoPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    const record = parsed && typeof parsed === 'object' ? parsed : {};
    return {
      installDir,
      infoPath,
      manifestPath: cleanString(record.manifestPath) || path.join(installDir, MANIFEST_FILE_NAME),
      origin: cleanString(record.origin) || null,
      scheme: cleanString(record.scheme) || null,
      port: clampPort(record.port, DEFAULT_HTTPS_PORT),
      installedAt: cleanString(record.installedAt) || null,
      version: cleanString(record.version) || null,
      certThumbprint: cleanString(record.certThumbprint) || null,
      trusted: record.trusted === true,
    };
  } catch {
    return null;
  }
}

/** 找到 office-addin 静态资源目录：环境变量 → 应用根目录 → 当前工作目录。 */
function resolveAddinRoot(options = {}) {
  const env = options.env ?? process.env;
  const candidates = [];
  const explicit = cleanString(env.PAPERQUAY_OFFICE_ADDIN_DIR);
  if (explicit) candidates.push(explicit);
  if (options.appRoot) candidates.push(path.join(options.appRoot, ADDIN_DIR_NAME));
  if (options.cwd) candidates.push(path.join(options.cwd, ADDIN_DIR_NAME));
  candidates.push(path.join(process.cwd(), ADDIN_DIR_NAME));

  for (const candidate of candidates) {
    if (isDirectory(candidate) && isFile(path.join(candidate, 'taskpane.html'))) return candidate;
  }
  return null;
}

/** 证书查找：安装器目录 → 应用数据目录 → office-addin/.certs。 */
function resolveCertificate(options = {}) {
  const { installDir, dataDir, addinRoot } = options;
  const candidates = [];
  if (installDir) candidates.push({ dir: installDir, source: 'installer' });
  if (dataDir) candidates.push({ dir: path.join(dataDir, ADDIN_DIR_NAME), source: 'data' });
  if (addinRoot) candidates.push({ dir: path.join(addinRoot, '.certs'), source: 'dev' });

  for (const candidate of candidates) {
    const pfxPath = path.join(candidate.dir, PFX_FILE_NAME);
    const passphrasePath = path.join(candidate.dir, PASSPHRASE_FILE_NAME);
    if (!isFile(pfxPath) || !isFile(passphrasePath)) continue;
    const passphrase = cleanString(fs.readFileSync(passphrasePath, 'utf8'));
    if (!passphrase) continue;
    return {
      ok: true,
      source: candidate.source,
      dir: candidate.dir,
      pfxPath,
      cerPath: path.join(candidate.dir, CER_FILE_NAME),
      passphrase,
    };
  }

  return {
    ok: false,
    source: null,
    dir: null,
    pfxPath: null,
    cerPath: null,
    reason: '没有可用的本地证书（缺少 pfx 或 passphrase）',
  };
}

function runPowerShell(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 用 PowerShell 生成自签证书（仅 Windows）。写入目录为安装器目录或 dataDir/office-addin。
 * 返回与 resolveCertificate 同形的结果，便于调用方统一处理。
 */
function ensureCertificate(options = {}) {
  const dir = options.dir;
  if (!dir) return { ok: false, reason: '没有可写入的证书目录' };
  if (process.platform !== 'win32') {
    return { ok: false, reason: '当前系统不是 Windows，无法用 New-SelfSignedCertificate 生成证书' };
  }

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { ok: false, reason: `无法创建证书目录：${toErrorMessage(error)}` };
  }

  const pfxPath = path.join(dir, PFX_FILE_NAME);
  const cerPath = path.join(dir, CER_FILE_NAME);
  const passphrasePath = path.join(dir, PASSPHRASE_FILE_NAME);
  try {
    if (!isFile(passphrasePath)) {
      fs.writeFileSync(passphrasePath, crypto.randomBytes(18).toString('base64url'), { mode: 0o600 });
    }
    const passphrase = cleanString(fs.readFileSync(passphrasePath, 'utf8'));
    if (!passphrase) return { ok: false, reason: '证书口令文件为空' };

    if (!isFile(pfxPath) || !isFile(cerPath)) {
      runPowerShell(
        [
          "$ErrorActionPreference = 'Stop'",
          `$cert = New-SelfSignedCertificate -DnsName 'localhost', '127.0.0.1' -CertStoreLocation 'Cert:\\CurrentUser\\My' -FriendlyName ${quotePowerShell(CERTIFICATE_FRIENDLY_NAME)} -NotAfter (Get-Date).AddYears(3) -KeyExportPolicy Exportable`,
          `$password = ConvertTo-SecureString -String ${quotePowerShell(passphrase)} -Force -AsPlainText`,
          `Export-PfxCertificate -Cert $cert -FilePath ${quotePowerShell(pfxPath)} -Password $password | Out-Null`,
          `Export-Certificate -Cert $cert -FilePath ${quotePowerShell(cerPath)} | Out-Null`,
        ].join('; '),
      );
    }
  } catch (error) {
    return { ok: false, reason: `生成自签证书失败：${toErrorMessage(error)}` };
  }

  return { ok: true, source: 'generated', dir, pfxPath, cerPath, passphrase: cleanString(fs.readFileSync(passphrasePath, 'utf8')) };
}

/** 把证书导入「受信任的根证书颁发机构」（当前用户），Word 不再报证书错误。 */
function trustCertificate(cerPath) {
  if (!isFile(cerPath)) return { ok: false, reason: '找不到证书文件（.cer）' };
  if (process.platform !== 'win32') return { ok: false, reason: '仅 Windows 支持导入受信任根证书' };
  try {
    // $ErrorActionPreference='Stop' + 导入后回查：用户在系统安全提示里点「否」时，
    // Import-Certificate 只产生语句级错误，PowerShell 仍以 0 退出，不能只看退出码。
    runPowerShell(
      [
        "$ErrorActionPreference = 'Stop'",
        `Import-Certificate -FilePath ${quotePowerShell(cerPath)} -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null`,
        `$cer = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 ${quotePowerShell(cerPath)}`,
        `if (-not (Test-Path ('Cert:\\CurrentUser\\Root\\' + $cer.Thumbprint))) { Write-Error '证书未出现在受信任根存储区（可能取消了系统安全提示）'; exit 1 }`,
      ].join('; '),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `导入受信任根证书失败：${toErrorMessage(error)}` };
  }
}

/** 解析请求路径为 office-addin/ 下的真实文件；越界或缺失返回 null。 */
function resolveFile(root, urlPath) {
  const decoded = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  const relative = decoded === '/' ? '/taskpane.html' : decoded;
  const target = path.normalize(path.join(root, relative));
  const normalizedRoot = path.normalize(root);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) return null;
  if (!isFile(target)) return null;
  return target;
}

function createRequestHandler(root) {
  return (request, response) => {
    const method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      response.end('405 Method Not Allowed');
      return;
    }

    let file = null;
    try {
      file = resolveFile(root, request.url);
    } catch {
      file = null;
    }
    if (!file) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('404 Not Found');
      return;
    }

    const body = fs.readFileSync(file);
    const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ETag: etag });
      response.end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    });
    if (method === 'HEAD') {
      response.end();
      return;
    }
    response.end(body);
  };
}

/** 监听端口并等待 listening；失败时关闭已创建的 server 后抛错。 */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      try {
        server.close();
      } catch {
        /* 监听失败时 server 可能尚未启动，忽略关闭错误 */
      }
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, LISTEN_HOST);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * 创建加载项源站。
 *
 * @param {object} options
 * @param {object} [options.appPaths] createAppPaths(app) 的结果（用 dataDir 兜底证书目录）
 * @param {string} [options.appRoot] 应用根目录（app.getAppPath()），用于定位 office-addin/
 * @param {() => object} [options.getSettings] 读取 settings.officeAddin.source
 * @param {{log?:Function,warn?:Function,error?:Function}} [options.logger]
 * @param {'auto'|'disabled'} [options.certificate] disabled 时只用已有证书、不生成（测试用）
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.installDir] 覆盖安装器目录（测试用）
 */
function createOfficeAddinHost(options = {}) {
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => null;
  const logger = options.logger ?? {};
  const certificateMode = options.certificate === 'disabled' ? 'disabled' : 'auto';
  const env = options.env ?? process.env;
  const installDir = options.installDir ?? resolveInstallDir(env);
  const dataDir = options.appPaths?.dataDir ?? null;

  let server = null;
  let running = false;
  let scheme = null;
  let port = null;
  let root = null;
  let error = '';
  let note = '';
  let certificate = { ok: false, source: null, dir: null, pfxPath: null, cerPath: null, reason: '' };

  const log = (level, message) => {
    const sink = level === 'error' ? logger.error : level === 'warn' ? logger.warn : logger.log;
    if (typeof sink === 'function') sink(`[office-addin] ${message}`);
  };

  function readSettings() {
    try {
      return normalizeSourceSettings(getSettings());
    } catch (caught) {
      log('error', `读取源站设置失败：${toErrorMessage(caught)}`);
      return normalizeSourceSettings(null);
    }
  }

  function getStatus() {
    const settings = readSettings();
    const origin = running && scheme && port ? `${scheme}://localhost:${port}` : null;
    return {
      enabled: settings.enabled,
      running,
      scheme,
      port,
      origin,
      url: origin ? `${origin}/taskpane.html` : null,
      root,
      installDir,
      manifestPath: isFile(path.join(installDir, MANIFEST_FILE_NAME)) ? path.join(installDir, MANIFEST_FILE_NAME) : null,
      installed: readInstallInfo(installDir),
      certificate: {
        available: certificate.ok === true,
        source: certificate.source ?? null,
        dir: certificate.dir ?? null,
        pfxPath: certificate.pfxPath ?? null,
        cerPath: certificate.cerPath ?? null,
        reason: certificate.reason ?? '',
      },
      settings,
      ...(note ? { note } : {}),
      ...(error ? { error } : {}),
    };
  }

  function adopt(instance, nextScheme) {
    server = instance;
    running = true;
    scheme = nextScheme;
    const address = instance.address();
    port = address && typeof address === 'object' ? address.port : null;
    log('log', `加载项源站已启动：${scheme}://localhost:${port}（根目录 ${root}）`);
    return getStatus();
  }

  function prepareCertificate() {
    certificate = resolveCertificate({ installDir, dataDir, addinRoot: root });
    if (certificate.ok) return certificate;
    if (certificateMode === 'disabled') return certificate;

    const targetDir = isDirectory(dataDir) ? path.join(dataDir, ADDIN_DIR_NAME) : dataDir;
    const generated = ensureCertificate({ dir: targetDir });
    if (!generated.ok) {
      certificate = { ...certificate, reason: generated.reason };
      return certificate;
    }
    certificate = { ...generated, source: 'data' };
    log('log', `已生成自签证书：${certificate.pfxPath}`);
    return certificate;
  }

  async function start() {
    const existing = getStatus();
    if (existing.running) return existing;

    error = '';
    note = '';
    const settings = readSettings();
    if (!settings.enabled) {
      error = '加载项源站已在设置中关闭。';
      return getStatus();
    }

    root = resolveAddinRoot({ appRoot: options.appRoot, env, cwd: options.cwd });
    if (!root) {
      error = '找不到 office-addin 目录（缺少 taskpane.html）。请确认应用完整安装，或用 PAPERQUAY_OFFICE_ADDIN_DIR 指定目录。';
      log('error', error);
      return getStatus();
    }

    const handler = createRequestHandler(root);
    const prepared = prepareCertificate();

    if (prepared.ok) {
      const serverOptions = { pfx: fs.readFileSync(prepared.pfxPath), passphrase: prepared.passphrase };
      try {
        return adopt(await listen(https.createServer(serverOptions, handler), settings.httpsPort), 'https');
      } catch (caught) {
        const reason = toErrorMessage(caught);
        note = `HTTPS 源站启动失败（${reason}），已回退到 HTTP。`;
        log('warn', note);
      }
    } else if (!settings.allowHttpFallback) {
      error = `${prepared.reason}，且已禁用 HTTP 回退：加载项页面无法托管。`;
      log('error', error);
      return getStatus();
    } else {
      note = `${prepared.reason}，已回退到 HTTP（Word 可能提示内容不安全）。`;
      log('warn', note);
    }

    if (!settings.allowHttpFallback) {
      error = `HTTPS 源站不可用，且已禁用 HTTP 回退：加载项页面无法托管。`;
      log('error', error);
      return getStatus();
    }

    try {
      return adopt(await listen(http.createServer(handler), settings.httpPort), 'http');
    } catch (caught) {
      error = `${error ? `${error} ` : ''}HTTP 源站启动失败（${toErrorMessage(caught)}）。`;
      log('error', error);
      server = null;
      return getStatus();
    }
  }

  async function stop() {
    const instance = server;
    server = null;
    running = false;
    scheme = null;
    port = null;
    note = '';
    if (instance) await closeServer(instance);
    log('log', '加载项源站已停止');
    return getStatus();
  }

  /** 信任证书（必要时先生成），供「一键 HTTPS」按钮使用。 */
  async function trust() {
    root = root ?? resolveAddinRoot({ appRoot: options.appRoot, env, cwd: options.cwd });
    const prepared = certificate.ok ? certificate : prepareCertificate();
    if (!prepared.ok) return { ok: false, reason: prepared.reason };
    const result = trustCertificate(prepared.cerPath);
    if (result.ok) {
      certificate = { ...prepared, ok: true };
      log('log', '证书已导入受信任的根证书颁发机构');
    }
    return { ...result, cerPath: prepared.cerPath, dir: prepared.dir };
  }

  return { start, stop, getStatus, trustCertificate: trust };
}

module.exports = {
  createOfficeAddinHost,
  normalizeSourceSettings,
  resolveAddinRoot,
  resolveCertificate,
  resolveInstallDir,
  readInstallInfo,
  ensureCertificate,
  trustCertificate,
  resolveFile,
  createRequestHandler,
  DEFAULT_HTTPS_PORT,
  DEFAULT_HTTP_PORT,
  PFX_FILE_NAME,
  CER_FILE_NAME,
  PASSPHRASE_FILE_NAME,
  MANIFEST_FILE_NAME,
  INSTALL_INFO_FILE_NAME,
  INSTALL_DIR_SEGMENTS,
  MIME_TYPES,
};
