// 托管 office-addin/ 静态资源的本地服务器（Word 加载项源站）。
//
// 为什么需要它：Word 加载项页面必须从 HTTPS（或 localhost）加载，无法直接 file:// 打开。
// 默认用 PowerShell 生成自签证书 `office-addin/.certs/paperquay-addin.pfx`，用 node:https 启动；
// 换机器/换目录后证书不可用时自动回退到 http://localhost。
//
// 用法：
//   node scripts/office-addin-server.mjs                 # https://localhost:3000
//   node scripts/office-addin-server.mjs --http          # http://localhost:3000
//   node scripts/office-addin-server.mjs --trust         # 把证书装进「受信任的根证书颁发机构」
//   node scripts/office-addin-server.mjs --regenerate    # 重新生成证书
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createRequestHandler: createHostRequestHandler } = require('../electron/backend/officeAddinHost.cjs');
const { createOfficeBridge } = require('../electron/backend/officeBridge.cjs');

const ROOT = path.join(process.cwd(), 'office-addin');
const CERT_DIR = path.join(ROOT, '.certs');
const PFX_PATH = path.join(CERT_DIR, 'paperquay-addin.pfx');
const CER_PATH = path.join(CERT_DIR, 'paperquay-addin.cer');
const PASSPHRASE_PATH = path.join(CERT_DIR, 'passphrase.txt');

function parseArgs(argv) {
  const options = { port: 3000, http: false, trust: false, regenerate: false, quiet: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--http') options.http = true;
    else if (arg === '--trust') options.trust = true;
    else if (arg === '--regenerate') options.regenerate = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--port') options.port = Number.parseInt(argv[index + 1], 10) || options.port;
    else if (arg.startsWith('--port=')) options.port = Number.parseInt(arg.slice(7), 10) || options.port;
  }
  return options;
}

function isWindows() {
  return process.platform === 'win32';
}

function runPowerShell(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function ensureCertificate(options) {
  if (!isWindows()) {
    return { ok: false, reason: '当前系统不是 Windows，无法用 New-SelfSignedCertificate 生成证书。' };
  }
  fs.mkdirSync(CERT_DIR, { recursive: true });

  if (options.regenerate) {
    for (const file of [PFX_PATH, CER_PATH, PASSPHRASE_PATH]) fs.rmSync(file, { force: true });
  }

  if (!fs.existsSync(PASSPHRASE_PATH)) {
    fs.writeFileSync(PASSPHRASE_PATH, randomBytes(18).toString('base64url'), { mode: 0o600 });
  }
  const passphrase = fs.readFileSync(PASSPHRASE_PATH, 'utf8').trim();

  if (!fs.existsSync(PFX_PATH) || !fs.existsSync(CER_PATH)) {
    try {
      runPowerShell(
        [
          "$ErrorActionPreference = 'Stop'",
          `$cert = New-SelfSignedCertificate -DnsName 'localhost', '127.0.0.1' -CertStoreLocation 'Cert:\\CurrentUser\\My' -FriendlyName 'PaperQuay Office Add-in (dev)' -NotAfter (Get-Date).AddYears(3) -KeyExportPolicy Exportable`,
          `$password = ConvertTo-SecureString -String '${passphrase}' -Force -AsPlainText`,
          `Export-PfxCertificate -Cert $cert -FilePath '${PFX_PATH}' -Password $password | Out-Null`,
          `Export-Certificate -Cert $cert -FilePath '${CER_PATH}' | Out-Null`,
        ].join('; '),
      );
    } catch (error) {
      return { ok: false, reason: `生成自签证书失败：${error.message}` };
    }
  }

  if (options.trust) {
    try {
      runPowerShell(
        `Import-Certificate -FilePath '${CER_PATH}' -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null`,
      );
      process.stdout.write('已把证书导入「受信任的根证书颁发机构」（Word 不再提示证书错误）。\n');
    } catch (error) {
      process.stdout.write(`导入受信任根证书失败（可忽略，用手动信任）：${error.message}\n`);
    }
  }

  return { ok: true, passphrase };
}

const MANIFEST_SOURCE = path.join(ROOT, 'manifest.xml');
const MANIFEST_LOCAL = path.join(ROOT, 'manifest.local.xml');

/**
 * 生成与当前 scheme/端口匹配的侧载清单：清单里的 SourceLocation 必须和实际源站一致。
 * 产物 manifest.local.xml 已加入 .gitignore，不改动提交进仓库的 manifest.xml。
 */
function writeLocalManifest(scheme, port) {
  const base = `${scheme}://localhost:${port}`;
  const xml = fs.readFileSync(MANIFEST_SOURCE, 'utf8').replaceAll('https://localhost:3000', base);
  fs.writeFileSync(MANIFEST_LOCAL, xml, 'utf8');
  return { path: MANIFEST_LOCAL, base };
}

/**
 * 开发桥：用内存里的几篇示例文献模拟 PaperQuay 文献库，让独立开发服务也能提供同源 /api/v1
 * （与本体一样经 officeAddinHost 的同源校验转发给 officeBridge.handleInternal）。
 */
function createDevBridge() {
  const papers = [
    { id: 'demo-1', title: '深度学习综述', year: '2021', itemType: 'journalArticle', publication: '计算机学报', volume: '44', issue: '3', pages: '1-25', authors: [{ name: '张三' }, { name: '李四' }] },
    { id: 'demo-2', title: 'Attention Is All You Need', year: '2017', itemType: 'conferencePaper', publication: 'Advances in Neural Information Processing Systems', authors: [{ name: 'Ashish Vaswani', familyName: 'Vaswani', givenName: 'Ashish' }] },
    { id: 'demo-3', title: '统计学习方法', year: '2019', itemType: 'book', publisher: '清华大学出版社', publisherPlace: '北京', authors: [{ name: '李航' }] },
  ];
  const store = {
    queryPapers: ({ search = '', limit = 50 } = {}) => {
      const needle = String(search).toLowerCase();
      const matched = papers.filter((paper) => !needle || JSON.stringify(paper).toLowerCase().includes(needle));
      return { papers: matched.slice(0, limit), total: matched.length, offset: 0, limit };
    },
    getPaper: (id) => papers.find((paper) => paper.id === id) ?? null,
    listCategoriesWithCounts: () => [],
    recordPaperCitations: ({ paperIds }) => ({ updated: paperIds.length }),
  };
  return createOfficeBridge({ appPaths: { dataDir: CERT_DIR }, store, appVersion: 'dev', settings: {}, logger: { log() {}, warn() {}, error() {} } });
}

function createRequestHandler(getPort) {
  // 复用本体源站的请求处理：静态资源 + 同源 /api/v1 校验与转发，开发与生产行为一致。
  const bridge = createDevBridge();
  return createHostRequestHandler(ROOT, { getBridge: () => bridge, getPort });
}

function start(options) {
  if (!fs.existsSync(ROOT)) {
    process.stderr.write(`找不到目录：${ROOT}\n`);
    process.exitCode = 1;
    return;
  }
  const handler = createRequestHandler(() => options.port);
  const certificate = options.http ? { ok: false, reason: '已指定 --http。' } : ensureCertificate(options);

  if (certificate.ok) {
    const manifest = writeLocalManifest('https', options.port);
    const server = createHttpsServer(
      { pfx: fs.readFileSync(PFX_PATH), passphrase: certificate.passphrase },
      handler,
    );
    server.listen(options.port, () => {
      process.stdout.write(`PaperQuay 加载项已托管：https://localhost:${options.port}/taskpane.html\n`);
      process.stdout.write(`侧载清单已生成：${path.relative(process.cwd(), manifest.path)}\n`);
      process.stdout.write('侧载：npm run office-addin:install（或 Word → 插入 → 我的加载项 → 共享文件夹）\n');
      if (!options.trust) {
        process.stdout.write('提示：首次使用可加 --trust 把证书装进受信任根，避免 Word 报证书错误。\n');
      }
    });
    server.on('error', (error) => {
      process.stderr.write(`HTTPS 服务启动失败：${error.message}\n`);
      process.exitCode = 1;
    });
    return;
  }

  const manifest = writeLocalManifest('http', options.port);
  const server = createHttpServer(handler);
  server.listen(options.port, () => {
    process.stdout.write(`PaperQuay 加载项已托管：http://localhost:${options.port}/taskpane.html\n`);
    process.stdout.write(`侧载清单已生成：${path.relative(process.cwd(), manifest.path)}\n`);
    process.stdout.write(`（未使用 HTTPS：${certificate.reason}）\n`);
  });
  server.on('error', (error) => {
    process.stderr.write(`HTTP 服务启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
}

start(parseArgs(process.argv.slice(2)));
