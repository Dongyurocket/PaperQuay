import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { RENDERER_ALLOWED_COMMANDS, isRendererCommandAllowed } = require('../electron/ipcAllowlist.cjs');
const { createIpcSenderGuard, isTrustedRendererNavigation, isTrustedRendererUrl } = require('../electron/ipcSecurity.cjs');
const { createPathPolicy } = require('../electron/backend/pathPolicy.cjs');
const { handleLocalPdfRequest } = require('../electron/localPdfProtocol.cjs');

function canonicalPath(filePath) {
  try {
    return realpathSync.native ? realpathSync.native(filePath) : realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
const { createMineruCommands, isAllowedMineruEndpoint, resolveExtractDir } = require('../electron/backend/mineruCommands.cjs');
const { readZipWithAdm } = require('../electron/backend/utils.cjs');

function walkSourceFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkSourceFiles(entryPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      output.push(entryPath);
    }
  }
  return output;
}

function createTempRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function createAppPaths(dataDir) {
  return {
    dataDir,
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    mineruCacheDir: path.join(dataDir, '.mineru-cache'),
    remotePdfDownloadDir: path.join(dataDir, '.downloads', 'pdfs'),
  };
}

test('renderer IPC allowlist covers every command used in src and drops approve_write_path', () => {
  assert.equal(isRendererCommandAllowed('approve_write_path'), false);
  assert.equal(isRendererCommandAllowed('translate_cancel'), true);
  assert.equal(isRendererCommandAllowed('reader_secret_encrypt'), true);
  assert.equal(isRendererCommandAllowed('__proto__'), false);
  assert.equal(isRendererCommandAllowed(42), false);

  const commands = new Set();
  for (const filePath of walkSourceFiles(path.resolve('src'))) {
    const source = readFileSync(filePath, 'utf8');
    // 同时匹配单引号与双引号；translation.ts 历史上使用双引号，单引号扫描
    // 会漏掉整个翻译命令面（B1/C2 的回归就出在这里）。
    for (const match of source.matchAll(/invoke(?:<[^>]*>)?\(\s*['"]([a-z0-9_]+)['"]/g)) {
      commands.add(match[1]);
    }
  }

  assert.ok(commands.size > 100, `expected the full renderer surface, got ${commands.size}`);
  const missing = [...commands].filter((command) => !RENDERER_ALLOWED_COMMANDS.has(command));
  assert.deepEqual(missing, [], `renderer commands missing from the allowlist: ${missing.join(', ')}`);
});

test('IPC sender guard only trusts the application document main frame', () => {
  const prodOptions = { isDev: false, devServerUrl: '', appDir: 'C:\\app\\electron' };
  const entryUrl = 'file:///C:/app/dist/index.html';

  assert.equal(isTrustedRendererUrl(entryUrl, prodOptions), true);
  assert.equal(isTrustedRendererUrl(`${entryUrl}#/reader`, prodOptions), true);
  assert.equal(isTrustedRendererUrl('file:///C:/Users/me/evil.html', prodOptions), false);
  assert.equal(isTrustedRendererUrl('https://evil.example/index.html', prodOptions), false);
  assert.equal(isTrustedRendererUrl('', prodOptions), false);

  const guard = createIpcSenderGuard(prodOptions);
  assert.doesNotThrow(() => guard({ senderFrame: { url: entryUrl, parent: null } }));
  assert.throws(
    () => guard({ senderFrame: { url: 'file:///C:/Users/me/evil.html', parent: null } }),
    /untrusted document/,
  );
  assert.throws(
    () => guard({ senderFrame: { url: entryUrl, parent: { url: entryUrl } } }),
    /untrusted frame/,
  );
  assert.throws(() => guard({}), /untrusted frame/);

  const devOptions = { isDev: true, devServerUrl: 'http://127.0.0.1:1420', appDir: 'C:\\app\\electron' };
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:1420/', devOptions), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:9999/', devOptions), false);
  assert.equal(isTrustedRendererUrl(entryUrl, devOptions), false);
});

test('will-navigate only allows the application document, not arbitrary file:// pages', () => {
  const prodOptions = { isDev: false, devServerUrl: '', appDir: 'C:\\app\\electron' };
  const entryUrl = 'file:///C:/app/dist/index.html';

  assert.equal(isTrustedRendererNavigation(entryUrl, prodOptions), true);
  assert.equal(isTrustedRendererNavigation(`${entryUrl}#/reader`, prodOptions), true);
  assert.equal(isTrustedRendererNavigation(`${entryUrl}?tab=notes`, prodOptions), true);
  assert.equal(isTrustedRendererNavigation('file:///C:/Users/me/evil.html', prodOptions), false);
  assert.equal(isTrustedRendererNavigation('file:///C:/app/dist/other.html', prodOptions), false);
  assert.equal(isTrustedRendererNavigation('file:///C:/app/dist/../evil.html', prodOptions), false);
  assert.equal(isTrustedRendererNavigation('file:///C:/app/dist/%2e%2e/evil.html', prodOptions), false);
  assert.equal(isTrustedRendererNavigation('file://evil.example/C:/app/dist/index.html', prodOptions), false);
  assert.equal(isTrustedRendererNavigation('https://evil.example/index.html', prodOptions), false);
  assert.equal(isTrustedRendererNavigation('', prodOptions), false);

  const devOptions = { isDev: true, devServerUrl: 'http://127.0.0.1:1420', appDir: 'C:\\app\\electron' };
  assert.equal(isTrustedRendererNavigation('http://127.0.0.1:1420/', devOptions), true);
  assert.equal(isTrustedRendererNavigation('http://127.0.0.1:1420/#/reader', devOptions), true);
  assert.equal(isTrustedRendererNavigation('http://127.0.0.1:9999/', devOptions), false);
  assert.equal(isTrustedRendererNavigation(entryUrl, devOptions), false);
});

test('path policy allows only known roots, attachments and dialog approvals', () => {
  const dataDir = createTempRoot('paperquay-path-policy-');
  const outsideDir = createTempRoot('paperquay-path-policy-outside-');
  const attachmentDir = createTempRoot('paperquay-path-attachment-');
  const appPaths = createAppPaths(dataDir);
  const storageDir = path.join(dataDir, 'papers');
  mkdirSync(storageDir, { recursive: true });

  const approvedReadPaths = new Set();
  const approvedWritePaths = new Set();
  const policy = createPathPolicy({
    appPaths,
    store: {
      loadSettings: () => ({ storageDir, translatedPdfDir: '' }),
      load: () => ({ settings: { storageDir }, papers: [] }),
      isKnownAttachmentLocation: (filePath) => canonicalPath(filePath).startsWith(canonicalPath(attachmentDir)),
      isKnownAttachmentDirectory: (directory) => canonicalPath(directory) === canonicalPath(attachmentDir),
    },
    approvedReadPaths,
    approvedWritePaths,
  });

  try {
    const cacheFile = path.join(appPaths.mineruCacheDir, 'document-a', 'content_list_v2.json');
    const storageFile = path.join(storageDir, 'paper.pdf');
    assert.equal(policy.isReadAllowed(cacheFile), true);
    assert.equal(policy.isReadAllowed(storageFile), true);
    assert.equal(policy.isWriteAllowed(storageFile), true);
    assert.equal(policy.isReadAllowed(path.join(attachmentDir, 'content_list.json')), true);
    assert.equal(
      policy.isWriteAllowed(path.join(attachmentDir, 'annotated.pdf')),
      true,
      'annotated PDFs may be written next to a known attachment',
    );
    assert.equal(
      policy.isWriteAllowed(path.join(attachmentDir, 'malware.exe')),
      false,
      'only PDFs may use the attachment-directory exception',
    );

    const outsideFile = path.join(outsideDir, 'secret.txt');
    assert.equal(policy.isReadAllowed(outsideFile), false);
    assert.equal(policy.isWriteAllowed(outsideFile), false);
    assert.throws(() => policy.assertReadAllowed(outsideFile), /not allowed/);
    assert.throws(() => policy.assertWriteAllowed(outsideFile), /not allowed/);

    // 设备路径 / ADS / 空路径一律拒绝。
    assert.equal(policy.isReadAllowed('\\\\?\\C:\\Windows\\win.ini'), false);
    if (process.platform === 'win32') {
      assert.equal(policy.isReadAllowed('C:\\papers\\paper.pdf:stream'), false);
    }
    assert.equal(policy.isReadAllowed(''), false);

    // 对话框返回的路径与所在目录被登记为可读。
    policy.approveReadPath(path.join(outsideDir, 'paper.pdf'));
    assert.equal(policy.isReadAllowed(path.join(outsideDir, 'paper.pdf')), true);
    assert.equal(policy.isReadAllowed(path.join(outsideDir, 'content_list_v2.json')), true);
    assert.equal(
      policy.isWriteAllowed(path.join(outsideDir, 'annotated.pdf')),
      true,
      'the annotated PDF may be written next to a dialog-selected PDF',
    );
    assert.equal(
      policy.isWriteAllowed(path.join(outsideDir, 'annotated.exe')),
      false,
      'the sibling exception only covers PDF files',
    );

    const unapprovedDir = createTempRoot('paperquay-path-policy-unapproved-');
    try {
      assert.equal(policy.isReadAllowed(path.join(unapprovedDir, 'other.txt')), false);
    } finally {
      rmSync(unapprovedDir, { recursive: true, force: true });
    }

    // PDF 协议只接受 .pdf 且拒绝 UNC。
    assert.equal(policy.isPdfPathAllowed(storageFile), true);
    assert.equal(policy.isPdfPathAllowed(path.join(storageDir, 'paper.txt')), false);
    assert.equal(policy.isPdfPathAllowed('\\\\server\\share\\paper.pdf'), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(attachmentDir, { recursive: true, force: true });
  }
});

test('paperquay-pdf protocol rejects unknown paths, UNC, wrong methods and non-PDF files', async () => {
  const root = createTempRoot('paperquay-protocol-');
  const pdfPath = path.join(root, 'paper.pdf');
  writeFileSync(pdfPath, '%PDF-1.7\nbody\n');

  const requestFor = (filePath, method = 'GET') => ({
    url: `paperquay-pdf://local/?path=${encodeURIComponent(filePath)}`,
    method,
    headers: new Headers(),
  });

  try {
    const ok = await handleLocalPdfRequest(requestFor(pdfPath), {
      isPdfPathAllowed: () => true,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'application/pdf');
    await ok.arrayBuffer();

    const denied = await handleLocalPdfRequest(requestFor(pdfPath), {
      isPdfPathAllowed: () => false,
    });
    assert.equal(denied.status, 404);

    const noPolicy = await handleLocalPdfRequest(requestFor(pdfPath));
    assert.equal(noPolicy.status, 404);

    const uncRequest = {
      url: `paperquay-pdf://local/?path=${encodeURIComponent('\\\\server\\share\\paper.pdf')}`,
      method: 'GET',
      headers: new Headers(),
    };
    const unc = await handleLocalPdfRequest(uncRequest, { isPdfPathAllowed: () => true });
    assert.equal(unc.status, 404);

    const post = await handleLocalPdfRequest(requestFor(pdfPath, 'POST'), {
      isPdfPathAllowed: () => true,
    });
    assert.equal(post.status, 405);

    const textRequest = {
      url: `paperquay-pdf://local/?path=${encodeURIComponent(path.join(root, 'paper.txt'))}`,
      method: 'GET',
      headers: new Headers(),
    };
    const text = await handleLocalPdfRequest(textRequest, { isPdfPathAllowed: () => true });
    assert.equal(text.status, 400);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run_mineru_cloud_parse rejects out-of-root PDFs and non-configured endpoints before any network call', async () => {
  const dataDir = createTempRoot('paperquay-mineru-guard-');
  const outsideDir = createTempRoot('paperquay-mineru-guard-outside-');
  const appPaths = createAppPaths(dataDir);
  mkdirSync(appPaths.mineruCacheDir, { recursive: true });
  const insidePdf = path.join(dataDir, 'inside.pdf');
  const outsidePdf = path.join(outsideDir, 'outside.pdf');
  writeFileSync(insidePdf, '%PDF-1.7\n');
  writeFileSync(outsidePdf, '%PDF-1.7\n');

  const policy = createPathPolicy({
    appPaths,
    store: { loadSettings: () => ({}), load: () => ({ settings: {}, papers: [] }) },
    approvedReadPaths: new Set(),
    approvedWritePaths: new Set(),
  });
  const commands = createMineruCommands({ appPaths, pathPolicy: policy });

  try {
    await assert.rejects(
      commands.run_mineru_cloud_parse({
        options: { apiToken: 'token', pdfPath: outsidePdf },
      }),
      /not allowed/,
    );

    await assert.rejects(
      commands.run_mineru_cloud_parse({
        options: {
          apiToken: 'token',
          pdfPath: insidePdf,
          apiBaseUrl: 'https://evil.example/v1',
        },
      }),
      /endpoint is not allowed/,
    );

    await assert.rejects(
      commands.run_mineru_cloud_parse({
        options: { apiToken: 'token', pdfPath: path.join(dataDir, 'not-a-pdf.txt') },
      }),
      /Only PDF files/,
    );

    const requestedInside = path.join(appPaths.mineruCacheDir, 'document-abc');
    assert.equal(
      resolveExtractDir(appPaths, requestedInside, 'fallback'),
      path.resolve(requestedInside),
    );
    assert.equal(
      resolveExtractDir(appPaths, path.join(outsideDir, 'evil'), 'fallback'),
      path.join(appPaths.mineruCacheDir, 'fallback'),
      'out-of-root extractDir falls back to the controlled cache directory',
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('paperquay-pdf protocol rejects .. traversal outside the allowed roots', async () => {
  const dataDir = createTempRoot('paperquay-protocol-traversal-');
  const outsideDir = createTempRoot('paperquay-protocol-traversal-outside-');
  const appPaths = createAppPaths(dataDir);
  writeFileSync(path.join(outsideDir, 'secret.pdf'), '%PDF-1.7\n');

  const policy = createPathPolicy({
    appPaths,
    store: { loadSettings: () => ({}), load: () => ({ settings: {}, papers: [] }) },
    approvedReadPaths: new Set(),
    approvedWritePaths: new Set(),
  });

  // 手工拼接带 .. 的路径，模拟不经过 path.resolve 的原始请求参数。
  const traversalPath = `${dataDir}${path.sep}..${path.sep}${path.basename(outsideDir)}${path.sep}secret.pdf`;
  const response = await handleLocalPdfRequest(
    {
      url: `paperquay-pdf://local/?path=${encodeURIComponent(traversalPath)}`,
      method: 'GET',
      headers: new Headers(),
    },
    { isPdfPathAllowed: policy.isPdfPathAllowed },
  );

  try {
    assert.equal(response.status, 404);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('MinerU zip extraction rejects traversal, alternate data streams, device names and oversized archives', async () => {
  const AdmZip = require('adm-zip');
  const root = createTempRoot('paperquay-zip-guard-');

  const buildZip = (entries) => {
    const zip = new AdmZip();
    entries.forEach(([name, content], index) => {
      zip.addFile(`placeholder-${index}.txt`, Buffer.from(content));
      // adm-zip 在 addFile 时会规范化 ../；直接改写条目名以模拟恶意压缩包。
      zip.getEntries()[zip.getEntries().length - 1].entryName = name;
    });
    return zip.toBuffer();
  };

  try {
    await assert.rejects(
      readZipWithAdm(buildZip([['../evil.txt', 'x']]), path.join(root, 'a')),
      /Illegal MinerU zip entry path/,
    );
    await assert.rejects(
      readZipWithAdm(buildZip([['C:/evil.txt', 'x']]), path.join(root, 'b')),
      /Illegal MinerU zip entry path/,
    );
    await assert.rejects(
      readZipWithAdm(buildZip([['paper.pdf:stream', 'x']]), path.join(root, 'c')),
      /alternate data stream/,
    );
    await assert.rejects(
      readZipWithAdm(buildZip([['CON.txt', 'x']]), path.join(root, 'd')),
      /reserved device name/,
    );

    const manyEntries = Array.from({ length: 5001 }, (_, index) => [`file-${index}.txt`, 'x']);
    await assert.rejects(
      readZipWithAdm(buildZip(manyEntries), path.join(root, 'e')),
      /too many files/,
    );

    const extracted = await readZipWithAdm(
      buildZip([['content_list.json', '[]'], ['images/p1.png', 'png']]),
      path.join(root, 'ok'),
    );
    assert.equal(extracted.contentJsonText, '[]');
    assert.equal(readFileSync(path.join(root, 'ok', 'images', 'p1.png'), 'utf8'), 'png');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MinerU endpoints are limited to the official host, loopback and private networks', () => {
  assert.equal(isAllowedMineruEndpoint(''), true);
  assert.equal(isAllowedMineruEndpoint('http://127.0.0.1:8000'), true);
  assert.equal(isAllowedMineruEndpoint('http://localhost:8000'), true);
  assert.equal(isAllowedMineruEndpoint('http://192.168.1.20:8000'), true);
  assert.equal(isAllowedMineruEndpoint('http://10.1.2.3:9000'), true);
  assert.equal(isAllowedMineruEndpoint('http://172.20.0.5'), true);
  assert.equal(isAllowedMineruEndpoint('https://evil.example/v1'), false);
  assert.equal(isAllowedMineruEndpoint('http://8.8.8.8'), false);
  assert.equal(isAllowedMineruEndpoint('ftp://127.0.0.1'), false);
  assert.equal(isAllowedMineruEndpoint('http://user:pass@127.0.0.1'), false);
});

test('renderer-written config cannot widen the path policy roots', () => {
  const dataDir = createTempRoot('paperquay-config-root-');
  const outsideDir = createTempRoot('paperquay-config-root-outside-');
  const appPaths = createAppPaths(dataDir);
  mkdirSync(path.dirname(appPaths.configPath), { recursive: true });
  writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');
  writeFileSync(
    appPaths.configPath,
    JSON.stringify({ settings: { mineruCacheDir: outsideDir } }),
    'utf8',
  );
  const policy = createPathPolicy({
    appPaths,
    store: { loadSettings: () => ({}), load: () => ({ settings: {}, papers: [] }) },
    approvedReadPaths: new Set(),
    approvedWritePaths: new Set(),
  });

  try {
    assert.equal(
      policy.isReadAllowed(path.join(outsideDir, 'secret.txt')),
      false,
      'config-written cache dirs must not become trust roots',
    );
    assert.equal(policy.isWriteAllowed(path.join(outsideDir, 'evil.txt')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});
