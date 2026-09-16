/**
 * PaddleOCR-VL 云端异步 Jobs API 适配层。
 *
 * 协议（官方 AsyncParse 示例 / PaddleOCR 官方 SDK 同口径）：
 *   POST {base}/api/v2/ocr/jobs            multipart: model, optionalPayload, file  → data.jobId
 *   GET  {base}/api/v2/ocr/jobs/{jobId}    → data.state(pending|running|done|failed)
 *                                            data.extractProgress.{totalPages,extractedPages}
 *                                            data.resultUrl.jsonUrl / data.errorMsg
 *   GET  {jsonUrl}                         → JSONL，每行 result.layoutParsingResults[]
 *
 * 鉴权：Authorization: bearer <token>
 *
 * 产物归一化为 MinerU 同构缓存（content_list_v2.json + images/ + full.md），
 * 见 paddleOcrNormalize.cjs。
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  cleanString,
  ensureFile,
  fileNameFromPath,
  now,
  readRequestJson,
} = require('./utils.cjs');
const { getPdfPageCount, planPdfSplits, splitPdfFiles } = require('./pdfSplitter.cjs');
const { mergeMineruParseResults } = require('./mineruMerge.cjs');
const { normalizePaddleOcrDocument } = require('./paddleOcrNormalize.cjs');

const PADDLE_OCR_DEFAULT_BASE_URL = 'https://paddleocr.aistudio-app.com';
const PADDLE_OCR_DEFAULT_MODEL = 'PaddleOCR-VL-1.6';

// 官方同步服务默认只处理前 100 页。异步云任务的上限未在文档中固定，
// 因此按同一口径保守切分，并在结果页数不足时显式报错而不是静默丢页。
const PADDLE_OCR_MAX_PAGES_PER_JOB = 100;

const IMAGE_MAGIC_BYTES = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x42, 0x4d], // BMP
];

function looksLikeImage(buffer) {
  if (!buffer || buffer.length < 4) return false;

  return IMAGE_MAGIC_BYTES.some((magic) => magic.every((byte, index) => buffer[index] === byte));
}

function maskToken(token) {
  if (!token || token.length < 8) return '***';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function listRelativeFiles(dir, baseDir = dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...await listRelativeFiles(fullPath, baseDir));
      } else {
        files.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
      }
    }

    return files;
  } catch {
    return [];
  }
}

function buildOptionalPayload(options = {}) {
  return {
    useDocOrientationClassify: false,
    useDocUnwarping: false,
    // 保持与 MinerU 一致的阅读体验：默认关闭图表识别，chart 块作为截图渲染。
    useChartRecognition: options.useChartRecognition === true,
    restructurePages: false,
  };
}

function buildAuthHeaders(token, extra = {}) {
  return { Authorization: `bearer ${token}`, Accept: 'application/json', ...extra };
}

async function submitPaddleOcrJob({ apiBaseUrl, token, pdfPath, fileName, model, options }) {
  const form = new FormData();
  form.append('model', model);
  form.append('optionalPayload', JSON.stringify(buildOptionalPayload(options)));
  form.append(
    'file',
    new Blob([await fsp.readFile(pdfPath)], { type: 'application/pdf' }),
    fileName,
  );

  const response = await fetch(`${apiBaseUrl}/api/v2/ocr/jobs`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: form,
  });

  const envelope = await readRequestJson(response, 'PaddleOCR-VL submit');

  if (envelope.errorCode !== 0) {
    throw new Error(
      `PaddleOCR-VL 提交失败（errorCode=${envelope.errorCode}）：${envelope.errorMsg || 'unknown error'}`,
    );
  }

  const jobId = cleanString(envelope.data?.jobId);
  if (!jobId) throw new Error('PaddleOCR-VL did not return a jobId');

  return jobId;
}

async function pollPaddleOcrJob({ apiBaseUrl, token, jobId, timeoutSecs, pollIntervalSecs }) {
  const timeoutAt = Date.now() + (timeoutSecs ?? 3600) * 1000;
  const intervalMs = Math.max(1, pollIntervalSecs ?? 5) * 1000;

  while (Date.now() < timeoutAt) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const envelope = await readRequestJson(
      await fetch(`${apiBaseUrl}/api/v2/ocr/jobs/${encodeURIComponent(jobId)}`, {
        headers: buildAuthHeaders(token),
      }),
      'PaddleOCR-VL status',
    );

    if (envelope.errorCode !== 0) {
      throw new Error(
        `PaddleOCR-VL 查询失败（errorCode=${envelope.errorCode}）：${envelope.errorMsg || 'unknown error'}`,
      );
    }

    const data = envelope.data ?? {};
    const state = cleanString(data.state).toLowerCase();

    if (state === 'done') {
      const jsonUrl = cleanString(data.resultUrl?.jsonUrl);
      if (!jsonUrl) throw new Error('PaddleOCR-VL 任务完成但没有返回 resultUrl.jsonUrl');

      return {
        jsonUrl,
        extractedPages: Number(data.extractProgress?.extractedPages) || null,
      };
    }

    if (state === 'failed') {
      throw new Error(`PaddleOCR-VL 任务失败：${cleanString(data.errorMsg) || 'unknown error'}`);
    }
  }

  throw new Error(`PaddleOCR-VL 任务超时（jobId=${jobId}）`);
}

async function downloadPaddleOcrLayoutResults(jsonUrl) {
  const response = await fetch(jsonUrl);
  if (!response.ok) {
    throw new Error(`PaddleOCR-VL 结果下载失败：HTTP ${response.status}`);
  }

  const text = await response.text();
  const layoutResults = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const items = parsed?.result?.layoutParsingResults;
    if (Array.isArray(items)) layoutResults.push(...items);
  }

  if (layoutResults.length === 0) {
    throw new Error('PaddleOCR-VL 结果中没有可用的 layoutParsingResults');
  }

  return layoutResults;
}

/**
 * 云端返回的 markdown.images 可能是 Base64，也可能是预签名 URL（官方两种示例都存在），
 * 必须在 URL 过期前落盘为本地副本。
 */
async function resolvePaddleAssetBuffer(value) {
  const trimmed = cleanString(value);
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const response = await fetch(trimmed);
      if (!response.ok) return null;

      const buffer = Buffer.from(await response.arrayBuffer());

      return looksLikeImage(buffer) ? buffer : null;
    } catch {
      return null;
    }
  }

  const base64 = trimmed.replace(/^data:[^;]+;base64,/, '');

  try {
    const buffer = Buffer.from(base64, 'base64');

    return looksLikeImage(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

/** 把归一化结果落盘成 MinerU 同构缓存产物。 */
async function persistPaddleOcrDocument({ layoutResults, extractDir }) {
  const document = normalizePaddleOcrDocument(layoutResults);

  const imagesDir = path.join(extractDir, 'images');
  await fsp.mkdir(imagesDir, { recursive: true });

  let writtenAssets = 0;
  const missingAssets = [];
  const assetPathByKey = new Map(document.assets.map((asset) => [asset.key, asset.assetPath]));

  for (const asset of document.assets) {
    const buffer = await resolvePaddleAssetBuffer(asset.value);

    if (!buffer) {
      missingAssets.push(asset.key);
      continue;
    }

    await fsp.writeFile(path.join(extractDir, ...asset.assetPath.split('/')), buffer);
    writtenAssets += 1;
  }

  // 资产写盘失败的块必须退回文本/表格表示，不能留下指向不存在文件的引用。
  const missingPaths = new Set(
    missingAssets.map((key) => assetPathByKey.get(key)).filter(Boolean),
  );

  const pages = document.pages.map((page) =>
    page.map((block) => {
      const blockPath = block?.content?.image_source?.path;

      if (!blockPath || !missingPaths.has(blockPath)) return block;

      const fallbackText = [
        block?.content?.image_caption?.[0]?.content,
        block?.content?.chart_caption?.[0]?.content,
        block?.content?.content,
      ].map((value) => cleanString(value)).find(Boolean);

      return {
        ...block,
        type: 'paragraph',
        content: {
          paragraph_content: [
            { type: 'text', content: fallbackText || '[图片资源未能下载]' },
          ],
        },
      };
    }),
  );

  const contentJsonPath = path.join(extractDir, 'content_list_v2.json');
  const contentJsonText = `${JSON.stringify(pages, null, 2)}\n`;
  await fsp.writeFile(contentJsonPath, contentJsonText, 'utf8');

  const markdownPath = path.join(extractDir, 'full.md');
  const markdownText = document.markdownText;
  await fsp.writeFile(markdownPath, markdownText, 'utf8');

  return {
    contentJsonText,
    markdownText,
    contentJsonPath,
    markdownPath,
    assetRootDir: extractDir,
    zipEntries: await listRelativeFiles(extractDir),
    pageCount: document.pageCount,
    assetCount: writtenAssets,
    missingAssetCount: missingAssets.length,
    blockCount: pages.reduce((count, page) => count + page.length, 0),
  };
}

async function runSinglePaddleOcrParse({
  pdfPath,
  fileName,
  dataId,
  token,
  apiBaseUrl,
  model,
  options,
  extractDir,
}) {
  await fsp.mkdir(extractDir, { recursive: true });

  const expectedPageCount = await getPdfPageCount(pdfPath).catch(() => 0);

  const jobId = await submitPaddleOcrJob({
    apiBaseUrl,
    token,
    pdfPath,
    fileName,
    model,
    options,
  });

  const { jsonUrl } = await pollPaddleOcrJob({
    apiBaseUrl,
    token,
    jobId,
    timeoutSecs: options.timeoutSecs,
    pollIntervalSecs: options.pollIntervalSecs,
  });

  const layoutResults = await downloadPaddleOcrLayoutResults(jsonUrl);

  if (expectedPageCount > 0 && layoutResults.length < expectedPageCount) {
    throw new Error(
      `PaddleOCR-VL 只返回了 ${layoutResults.length}/${expectedPageCount} 页结果：云端可能截断了文档。` +
        `请降低单卷页数后重试。`,
    );
  }

  const persisted = await persistPaddleOcrDocument({ layoutResults, extractDir });

  return {
    batchId: jobId,
    dataId,
    fileName,
    state: 'done',
    fullZipUrl: jsonUrl,
    usedToken: maskToken(token),
    ...persisted,
  };
}

function createPaddleOcrCommands(context) {
  const { appPaths } = context;

  return {
    async run_paddleocr_cloud_parse({ options }) {
      const token = cleanString(options.apiToken || options.apiTokens);
      if (!token) throw new Error('PaddleOCR-VL API Token cannot be empty');

      const apiBaseUrl =
        cleanString(options.apiBaseUrl).replace(/\/+$/, '') || PADDLE_OCR_DEFAULT_BASE_URL;
      const model = cleanString(options.model) || PADDLE_OCR_DEFAULT_MODEL;

      const pdfPath = options.pdfPath;
      await ensureFile(pdfPath);

      const fileName = fileNameFromPath(pdfPath);
      const dataId = `paper_reader_paddle_${now()}`;

      let totalPageCount = 0;
      try {
        totalPageCount = await getPdfPageCount(pdfPath);
      } catch (err) {
        console.warn(`[PaddleOCR-VL] Failed to read page count for ${fileName}:`, err);
      }

      if (totalPageCount <= PADDLE_OCR_MAX_PAGES_PER_JOB) {
        const singleExtractDir = options.extractDir || path.join(
          appPaths.mineruCacheDir,
          `${path.basename(fileName, '.pdf')}-paddle-${now()}`,
        );

        return await runSinglePaddleOcrParse({
          pdfPath,
          fileName,
          dataId,
          token,
          apiBaseUrl,
          model,
          options,
          extractDir: singleExtractDir,
        });
      }

      const splitPlans = planPdfSplits(totalPageCount, PADDLE_OCR_MAX_PAGES_PER_JOB);
      const splitWorkDir = path.join(
        appPaths.mineruCacheDir,
        '.split-tmp',
        `paddle-${path.basename(fileName, '.pdf')}-${now()}`,
      );

      let splitPdfResults = [];

      try {
        splitPdfResults = await splitPdfFiles(pdfPath, splitPlans, splitWorkDir);
      } catch (splitErr) {
        console.warn(`[PaddleOCR-VL] Failed to split PDF for ${fileName}:`, splitErr);
        const singleExtractDir = options.extractDir || path.join(
          appPaths.mineruCacheDir,
          `${path.basename(fileName, '.pdf')}-paddle-${now()}`,
        );

        return await runSinglePaddleOcrParse({
          pdfPath,
          fileName,
          dataId,
          token,
          apiBaseUrl,
          model,
          options,
          extractDir: singleExtractDir,
        });
      }

      const partResults = [];

      try {
        for (const part of splitPdfResults) {
          const partExtractDir = path.join(splitWorkDir, `paddle_part_${part.partIndex + 1}`);
          const partParsed = await runSinglePaddleOcrParse({
            pdfPath: part.path,
            fileName: path.basename(part.path),
            dataId: `paper_reader_paddle_part_${part.partIndex + 1}_${now()}`,
            token,
            apiBaseUrl,
            model,
            options,
            extractDir: partExtractDir,
          });

          partResults.push({
            partIndex: part.partIndex,
            startPage: part.startPage,
            endPage: part.endPage,
            pageOffset: part.pageOffset,
            pageCount: part.pageCount,
            extracted: partParsed,
          });
        }
      } finally {
        for (const part of splitPdfResults) {
          await fsp.unlink(part.path).catch(() => {});
        }
      }

      const finalExtractDir = options.extractDir || path.join(
        appPaths.mineruCacheDir,
        `${path.basename(fileName, '.pdf')}-paddle-${now()}`,
      );

      const merged = await mergeMineruParseResults(partResults, finalExtractDir);

      await fsp.rm(splitWorkDir, { recursive: true, force: true }).catch(() => {});

      return {
        batchId: partResults.map((part) => part.extracted.batchId).join(','),
        dataId,
        fileName,
        state: 'done',
        fullZipUrl: partResults[0]?.extracted.fullZipUrl || '',
        usedToken: maskToken(token),
        isSplitMerged: true,
        splitPartCount: partResults.length,
        totalPageCount,
        ...merged,
      };
    },
  };
}

module.exports = {
  PADDLE_OCR_DEFAULT_BASE_URL,
  PADDLE_OCR_DEFAULT_MODEL,
  PADDLE_OCR_MAX_PAGES_PER_JOB,
  buildOptionalPayload,
  createPaddleOcrCommands,
  downloadPaddleOcrLayoutResults,
  looksLikeImage,
  persistPaddleOcrDocument,
  pollPaddleOcrJob,
  submitPaddleOcrJob,
};
