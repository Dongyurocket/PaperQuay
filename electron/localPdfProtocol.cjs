const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { app, protocol } = require('electron');
const {
  PDFJS_ASSET_DIRS,
  resolvePdfJsAssetRoot,
} = require('./pdfJsAssets.cjs');
const { hasUnsafePathSyntax, isUncPath } = require('./backend/pathPolicy.cjs');

const LOCAL_PDF_PROTOCOL = 'paperquay-pdf';
const PDFJS_ASSET_PROTOCOL = 'paperquay-pdf-assets';

// 开发态读 node_modules/pdfjs-dist；安装版读 extraResources 复制出的 resources/pdfjs。
// 解析放到请求时执行，避免在纯 Node 测试环境里访问未初始化的 Electron app。
function resolvePdfJsAssetRootAtRuntime() {
  let isPackaged = false;

  try {
    const electron = require('electron');
    isPackaged = Boolean(electron?.app?.isPackaged);
  } catch {}

  return resolvePdfJsAssetRoot({
    isPackaged,
    resourcesPath: process.resourcesPath,
    appDir: __dirname,
  });
}

function registerLocalPdfProtocolScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_PDF_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
    {
      scheme: PDFJS_ASSET_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function createPlainResponse(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

function createPdfStreamResponse(filePath, stat, request) {
  const fileSize = stat.size;
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-type': 'application/pdf',
  });
  const rangeHeader = request.headers.get('range');

  if (!rangeHeader) {
    headers.set('content-length', String(fileSize));
    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers,
    });
  }

  const rangeMatch = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!rangeMatch) {
    headers.set('content-range', `bytes */${fileSize}`);
    return new Response(null, {
      status: 416,
      headers,
    });
  }

  let start = rangeMatch[1] ? Number(rangeMatch[1]) : NaN;
  let end = rangeMatch[2] ? Number(rangeMatch[2]) : NaN;

  if (!Number.isFinite(start) && Number.isFinite(end)) {
    start = Math.max(0, fileSize - end);
    end = fileSize - 1;
  } else {
    start = Number.isFinite(start) ? start : 0;
    end = Number.isFinite(end) ? end : fileSize - 1;
  }

  start = Math.max(0, Math.min(fileSize - 1, Math.trunc(start)));
  end = Math.max(start, Math.min(fileSize - 1, Math.trunc(end)));

  if (fileSize <= 0 || start >= fileSize) {
    headers.set('content-range', `bytes */${fileSize}`);
    return new Response(null, {
      status: 416,
      headers,
    });
  }

  headers.set('content-length', String(end - start + 1));
  headers.set('content-range', `bytes ${start}-${end}/${fileSize}`);

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 206,
      headers,
    });
  }

  return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
    status: 206,
    headers,
  });
}

async function handleLocalPdfRequest(request, options = {}) {
  const method = String(request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return createPlainResponse('Method not allowed.', 405);
  }

  let requestUrl;

  try {
    requestUrl = new URL(request.url);
  } catch {
    return createPlainResponse('Invalid PDF request URL.');
  }

  if (requestUrl.hostname !== 'local') {
    return createPlainResponse('Unknown PDF source.', 404);
  }

  const filePath = requestUrl.searchParams.get('path') || '';

  if (!filePath || path.extname(filePath).toLowerCase() !== '.pdf') {
    return createPlainResponse('Only PDF files can be served by this protocol.');
  }

  // UNC / 设备路径 / NTFS 数据流：协议层直接拒绝，不依赖调用方策略。
  if (isUncPath(filePath) || hasUnsafePathSyntax(filePath)) {
    return createPlainResponse('PDF path is not allowed.', 404);
  }

  // 协议原本只校验扩展名，任意渲染层脚本都能读取磁盘上任何 .pdf（含 UNC
  // 共享）。允许范围与主进程文件策略一致：文库附件、译版、MinerU 缓存、
  // 应用数据与用户通过对话框打开的路径。
  if (typeof options.isPdfPathAllowed !== 'function' || !options.isPdfPathAllowed(filePath)) {
    return createPlainResponse('PDF path is not allowed.', 404);
  }

  let stat;

  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      return createPlainResponse('PDF path is not a file.', 404);
    }
  } catch {
    return createPlainResponse('PDF file does not exist.', 404);
  }

  return createPdfStreamResponse(filePath, stat, request);
}

function createAssetResponse(filePath, stat) {
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-length': String(stat.size),
      'content-type': 'application/octet-stream',
    },
  });
}

async function handlePdfJsAssetRequest(request) {
  let requestUrl;

  try {
    requestUrl = new URL(request.url);
  } catch {
    return createPlainResponse('Invalid PDF.js asset request URL.');
  }

  if (requestUrl.hostname !== 'pdfjs') {
    return createPlainResponse('Unknown PDF.js asset source.', 404);
  }

  const pathParts = decodeURIComponent(requestUrl.pathname)
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  const [assetDir, ...assetNameParts] = pathParts;

  if (!PDFJS_ASSET_DIRS.includes(assetDir) || assetNameParts.length === 0) {
    return createPlainResponse('Unknown PDF.js asset.', 404);
  }

  const pdfjsAssetRoot = resolvePdfJsAssetRootAtRuntime();
  const assetPath = path.resolve(pdfjsAssetRoot, assetDir, ...assetNameParts);
  const allowedRoot = path.resolve(pdfjsAssetRoot, assetDir);

  if (assetPath !== allowedRoot && !assetPath.startsWith(`${allowedRoot}${path.sep}`)) {
    return createPlainResponse('Illegal PDF.js asset path.', 400);
  }

  try {
    const stat = await fsp.stat(assetPath);
    if (!stat.isFile()) {
      return createPlainResponse('PDF.js asset path is not a file.', 404);
    }

    return createAssetResponse(assetPath, stat);
  } catch {
    return createPlainResponse('PDF.js asset does not exist.', 404);
  }
}

function registerLocalPdfProtocol(options = {}) {
  protocol.handle(LOCAL_PDF_PROTOCOL, (request) => handleLocalPdfRequest(request, options));
  protocol.handle(PDFJS_ASSET_PROTOCOL, handlePdfJsAssetRequest);
}

module.exports = {
  LOCAL_PDF_PROTOCOL,
  PDFJS_ASSET_PROTOCOL,
  handleLocalPdfRequest,
  registerLocalPdfProtocol,
  registerLocalPdfProtocolScheme,
};
