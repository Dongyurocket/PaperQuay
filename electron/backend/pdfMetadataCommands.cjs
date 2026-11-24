'use strict';

/**
 * PDF 元数据预览（D4-13）。
 *
 * 渲染层不再把整份 PDF 以 base64 经 IPC 送过来再用 pdf.js 解析——那会在大文件上
 * 产生数倍内存的字符串搬运，且把 PDF 字节暴露在渲染进程。这里在**主进程**读文件、
 * 用 pdf.js 的 legacy 构建解析第 1 页，只回传很小的 JSON（元数据 + 首页文本行 +
 * 页数）。标题/作者/DOI 的选择启发式仍留在渲染层，行为保持不变。
 *
 * 路径校验复用 fileCommands 的 pathPolicy：只允许已授权根目录/附件位置下的
 * 真实 `.pdf`，拒绝 UNC、设备路径、非 PDF、缺失文件与超大文件。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { cleanString } = require('./utils.cjs');
const {
  createPathPolicy,
  hasUnsafePathSyntax,
  isUncPath,
} = require('./pathPolicy.cjs');
const { resolvePdfJsAssetRoot } = require('../pdfJsAssets.cjs');

/** 首页预览只需解析第一页；上限防止误把超大扫描件整份读入内存。 */
const DEFAULT_MAX_PDF_PREVIEW_BYTES = 256 * 1024 * 1024;

let pdfJsModulePromise = null;

function isExistingFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolvePdfJsModulePath() {
  const candidates = [];

  try {
    candidates.push(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  } catch {
    // 开发/测试态通常安装依赖；打包态 pdfjs-dist 不在 asar 内。
  }

  // electron/backend -> electron -> 仓库根目录
  candidates.push(path.join(__dirname, '..', '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));

  // 打包态：若构建把 legacy 构建复制到 resources/pdfjs，则从 extraResources 读取。
  try {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'pdfjs', 'legacy', 'build', 'pdf.mjs'));
      candidates.push(path.join(process.resourcesPath, 'pdfjs', 'build', 'pdf.mjs'));
      candidates.push(path.join(process.resourcesPath, 'pdfjs', 'pdf.mjs'));
    }
  } catch {
    // process.resourcesPath 在纯 Node 测试环境可能不存在。
  }

  return candidates.find(isExistingFile) ?? null;
}

function loadPdfJs() {
  if (!pdfJsModulePromise) {
    const modulePath = resolvePdfJsModulePath();

    if (!modulePath) {
      return Promise.reject(new Error(
        'PDF parsing support is unavailable: pdfjs-dist legacy build was not found.',
      ));
    }

    pdfJsModulePromise = import(pathToFileURL(modulePath).href).catch((error) => {
      pdfJsModulePromise = null;
      throw error;
    });
  }

  return pdfJsModulePromise;
}

function resolveAssetRootAtRuntime() {
  let isPackaged = false;

  try {
    isPackaged = Boolean(require('electron')?.app?.isPackaged);
  } catch {
    // 纯 Node 测试环境没有 electron。
  }

  return resolvePdfJsAssetRoot({
    isPackaged,
    resourcesPath: process.resourcesPath,
    appDir: path.join(__dirname, '..'),
  });
}

function optionalAssetDir(root, name) {
  if (!root) return undefined;
  const directory = path.join(root, name);

  try {
    return fs.statSync(directory).isDirectory() ? `${directory}${path.sep}` : undefined;
  } catch {
    return undefined;
  }
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/[\u00a0\u2000-\u200d\u202f\u205f\u3000]/g, ' ')
    .trim();
}

function estimatedItemRight(item) {
  if (item.width > 0) {
    return item.x + item.width;
  }

  return item.x + item.text.length * Math.max(item.height, 7) * 0.48;
}

function splitVisualRowByColumns(row) {
  const sorted = [...row].sort((left, right) => left.x - right.x);
  const groups = [];

  for (const item of sorted) {
    const current = groups[groups.length - 1];

    if (!current) {
      groups.push([item]);
      continue;
    }

    const previous = current[current.length - 1];
    const averageHeight =
      current.reduce((sum, value) => sum + Math.max(value.height, 0), 0) / Math.max(current.length, 1);
    const gap = item.x - estimatedItemRight(previous);
    const columnGapThreshold = Math.max(28, Math.min(96, averageHeight * 3.2));

    if (gap > columnGapThreshold) {
      groups.push([item]);
    } else {
      current.push(item);
    }
  }

  return groups;
}

function lineFromItems(items) {
  const sorted = [...items].sort((left, right) => left.x - right.x);
  const text = normalizeWhitespace(sorted.map((item) => item.text).join(' '));
  const x = sorted.reduce((min, item) => Math.min(min, item.x), Number.POSITIVE_INFINITY);
  const right = sorted.reduce(
    (max, item) => Math.max(max, estimatedItemRight(item)),
    Number.NEGATIVE_INFINITY,
  );
  const y = sorted.reduce((sum, item) => sum + item.y, 0) / sorted.length;
  const avgHeight = sorted.reduce((sum, item) => sum + item.height, 0) / Math.max(sorted.length, 1);
  const orderIndex = sorted.reduce(
    (min, item) => Math.min(min, item.orderIndex),
    Number.POSITIVE_INFINITY,
  );

  return {
    text,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(right) && Number.isFinite(x) ? Math.max(0, right - x) : 0,
    avgHeight: Number.isFinite(avgHeight) ? avgHeight : 0,
    orderIndex: Number.isFinite(orderIndex) ? orderIndex : 0,
  };
}

function isLowSignalLine(value) {
  const normalized = normalizeWhitespace(value);

  if (!normalized || normalized.length < 4 || normalized.length > 240) {
    return true;
  }

  return [
    /^https?:\/\//i,
    /www\./i,
    /中国知网/i,
    /\bcnki\b/i,
    /^doi[:：]/i,
    /^摘要[:：]?$/i,
    /^abstract[:：]?$/i,
    /^关键词[:：]?$/i,
    /^key words?[:：]?$/i,
    /^中图分类号/i,
    /^收稿日期/i,
    /^基金项目/i,
  ].some((pattern) => pattern.test(normalized));
}

function collectPageLines(textContent) {
  const textItems = (Array.isArray(textContent?.items) ? textContent.items : [])
    .map((item, orderIndex) => ({
      text: typeof item.str === 'string' ? item.str : '',
      x: Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0,
      y: Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0,
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : 0,
      orderIndex,
    }))
    .filter((item) => item.text.trim());

  const sorted = [...textItems].sort((left, right) => {
    if (Math.abs(right.y - left.y) > 2.4) {
      return right.y - left.y;
    }

    return left.x - right.x;
  });

  const visualRows = [];

  for (const item of sorted) {
    const currentRow = visualRows[visualRows.length - 1];

    if (!currentRow) {
      visualRows.push([item]);
      continue;
    }

    const currentY =
      currentRow.reduce((sum, value) => sum + value.y, 0) / Math.max(currentRow.length, 1);

    if (Math.abs(currentY - item.y) <= 2.8) {
      currentRow.push(item);
    } else {
      visualRows.push([item]);
    }
  }

  return visualRows
    .flatMap(splitVisualRowByColumns)
    .map(lineFromItems)
    .filter((line) => !isLowSignalLine(line.text))
    .sort((left, right) => {
      if (Math.abs(right.y - left.y) > 2.4) {
        return right.y - left.y;
      }

      return left.x - right.x;
    });
}

function metadataString(value) {
  return typeof value === 'string' ? value : '';
}

function createPdfMetadataCommands(context = {}) {
  const { appPaths = {}, approvedWritePaths = new Set(), store } = context;
  const pathPolicy = context.pathPolicy ?? createPathPolicy({
    appPaths,
    store,
    approvedReadPaths: context.approvedReadPaths ?? new Set(),
    approvedWritePaths,
  });
  const requestedMaxBytes = Number(context.pdfMetadataPreviewMaxBytes);
  const maxBytes = Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
    ? requestedMaxBytes
    : DEFAULT_MAX_PDF_PREVIEW_BYTES;

  async function readMetadataPreview(filePath) {
    const raw = cleanString(filePath);

    if (!raw) {
      throw new Error('PDF path cannot be empty');
    }

    if (isUncPath(raw) || hasUnsafePathSyntax(raw)) {
      throw new Error(`PDF path is not allowed: ${raw}`);
    }

    if (path.extname(raw).toLowerCase() !== '.pdf') {
      throw new Error(`Only .pdf files can be previewed: ${raw}`);
    }

    pathPolicy.assertReadAllowed(raw);

    const absolutePath = path.resolve(raw);
    let stat;

    try {
      stat = await fsp.stat(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        const notFound = new Error(`PDF file not found: ${raw}`);
        notFound.code = 'PDF_NOT_FOUND';
        throw notFound;
      }

      throw error;
    }

    if (!stat.isFile()) {
      throw new Error(`PDF path is not a file: ${raw}`);
    }

    if (stat.size > maxBytes) {
      throw new Error(
        `PDF file is too large for metadata preview: ${stat.size} bytes exceeds the ${maxBytes}-byte limit`,
      );
    }

    const data = await fsp.readFile(absolutePath);
    const pdfjs = await loadPdfJs();
    const assetRoot = resolveAssetRootAtRuntime();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data),
      // Mirror the renderer's PDF.js compatibility options so text geometry
      // (and therefore the title/author/DOI heuristics) stays the same.
      cMapPacked: true,
      cMapUrl: optionalAssetDir(assetRoot, 'cmaps'),
      standardFontDataUrl: optionalAssetDir(assetRoot, 'standard_fonts'),
      useSystemFonts: true,
      stopAtErrors: false,
      fontExtraProperties: true,
      isEvalSupported: false,
      verbosity: 0,
    });

    let pdfDocument = null;

    try {
      pdfDocument = await loadingTask.promise;
      const metadata = await pdfDocument.getMetadata().catch(() => null);
      const info = metadata?.info ?? {};
      const firstPage = await pdfDocument.getPage(1);
      let lines = [];

      try {
        const textContent = await firstPage.getTextContent();
        lines = collectPageLines(textContent);
      } finally {
        firstPage.cleanup?.();
      }

      return {
        numPages: pdfDocument.numPages,
        info: {
          title: metadataString(info.Title),
          author: metadataString(info.Author),
          subject: metadataString(info.Subject),
          keywords: metadataString(info.Keywords),
          creationDate: metadataString(info.CreationDate),
          modDate: metadataString(info.ModDate),
        },
        firstPageText: normalizeWhitespace(lines.map((line) => line.text).join(' ')),
        lines,
      };
    } finally {
      try {
        if (pdfDocument) {
          await pdfDocument.destroy();
        } else {
          await loadingTask.destroy?.();
        }
      } catch {
        // 释放失败不应掩盖解析结果或原始错误。
      }
    }
  }

  return {
    async pdf_read_metadata_preview({ path: filePath } = {}) {
      return readMetadataPreview(filePath);
    },
  };
}

module.exports = {
  DEFAULT_MAX_PDF_PREVIEW_BYTES,
  createPdfMetadataCommands,
  // 导出纯函数便于单测校验与渲染层一致的行切分行为。
  collectPageLines,
  normalizeWhitespace,
};
