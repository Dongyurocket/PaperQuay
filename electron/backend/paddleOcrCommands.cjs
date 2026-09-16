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

/**
 * 解析 Base URL。
 *
 * 百度 AI Studio 控制台给出的「API_URL」是完整的作业地址
 * （`https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`），用户很容易整段粘进来；
 * 这里容忍这种写法，避免拼成 `.../api/v2/ocr/jobs/api/v2/ocr/jobs` 得到 404。
 */
function resolvePaddleApiBaseUrl(rawBaseUrl) {
  const trimmed = cleanString(rawBaseUrl).replace(/\/+$/, '');
  if (!trimmed) return PADDLE_OCR_DEFAULT_BASE_URL;

  return trimmed
    .replace(/\/api\/v2\/ocr\/jobs$/i, '')
    .replace(/\/api\/v2\/ocr$/i, '')
    .replace(/\/+$/, '') || PADDLE_OCR_DEFAULT_BASE_URL;
}

/**
 * 读取响应并保留原始文本。
 *
 * 注意：异步 Jobs API 的错误信封使用 `code` / `msg`
 * （实测 401 返回 `{"traceId":"…","code":401,"msg":"Unauthorized"}`），
 * 与官方同步服务文档里的 `errorCode` / `errorMsg` 不一致；因此不能只看单一字段名，
 * 也不能在 2xx 时假定 body 一定带某个固定字段。
 */
async function readPaddleResponse(response, label) {
  const text = await response.text().catch(() => '');

  let payload = null;
  try {
    payload = text.trim() ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  return {
    label,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    payload,
    text,
  };
}

function pickPaddleErrorCode(payload) {
  if (!payload || typeof payload !== 'object') return null;

  for (const key of ['code', 'errorCode', 'error_code', 'status']) {
    const value = payload[key];

    if (typeof value === 'number' && value !== 0) return value;

    if (typeof value === 'string' && value.trim() && value.trim() !== '0') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric !== 0) return value;
    }
  }

  return null;
}

function pickPaddleMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';

  for (const key of ['msg', 'errorMsg', 'message', 'error', 'detail']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return '';
}

function pickPaddleTraceId(payload) {
  if (!payload || typeof payload !== 'object') return '';

  for (const key of ['traceId', 'logId', 'requestId']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return '';
}

function buildPaddleFailureHint(status, code) {
  if (status === 401 || status === 403 || code === 401 || code === 403) {
    return 'Token 无效或已过期，请在 https://aistudio.baidu.com/paddleocr/task 重新获取 API Token。';
  }

  if (status === 404 || code === 404) {
    return '接口路径不存在：API Base URL 只需填域名（如 https://paddleocr.aistudio-app.com），不要包含 /api/v2/ocr/jobs。';
  }

  if (status === 429 || code === 429) {
    return '请求过于频繁或额度已用尽，请稍后重试。';
  }

  if (status >= 500) {
    return '服务端错误，请稍后重试。';
  }

  return '请检查 API Token、API Base URL 与网络连通性。';
}

/** 组装可操作的失败信息：HTTP 状态 + 真实 code/msg + traceId + 原始响应片段。 */
function describePaddleFailure({ label, status, statusText, payload, text }) {
  const code = pickPaddleErrorCode(payload);
  const message = pickPaddleMessage(payload);
  const traceId = pickPaddleTraceId(payload);

  const parts = [label];

  if (status) parts.push(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
  if (code != null) parts.push(`code=${code}`);
  if (message) parts.push(message);
  if (traceId) parts.push(`traceId=${traceId}`);

  let detail = parts.join(' · ');

  if (!message && !code) {
    const snippet = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (snippet) detail += ` · 原始响应：${snippet}`;
  }

  return `${detail}。${buildPaddleFailureHint(status, code)}`;
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

  const parsed = await readPaddleResponse(response, 'PaddleOCR-VL 任务提交失败');

  // 成功与否以 jobId 是否存在为准：实测该接口的成功信封并不保证带 errorCode，
  // 旧实现用 `errorCode !== 0` 判定会把成功的提交误判为失败。
  const jobId = cleanString(parsed.payload?.data?.jobId);

  if (!jobId) {
    throw new Error(describePaddleFailure(parsed));
  }

  return jobId;
}

async function pollPaddleOcrJob({ apiBaseUrl, token, jobId, timeoutSecs, pollIntervalSecs }) {
  const timeoutAt = Date.now() + (timeoutSecs ?? 3600) * 1000;
  const intervalMs = Math.max(1, pollIntervalSecs ?? 5) * 1000;

  while (Date.now() < timeoutAt) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    const response = await fetch(`${apiBaseUrl}/api/v2/ocr/jobs/${encodeURIComponent(jobId)}`, {
      headers: buildAuthHeaders(token),
    });

    const parsed = await readPaddleResponse(response, 'PaddleOCR-VL 任务状态查询失败');
    const data = parsed.payload?.data ?? {};
    const state = cleanString(data.state).toLowerCase();

    if (!state) {
      throw new Error(describePaddleFailure(parsed));
    }

    if (state === 'done') {
      const jsonUrl = cleanString(data.resultUrl?.jsonUrl);
      if (!jsonUrl) {
        throw new Error(
          `PaddleOCR-VL 任务已完成但没有返回 resultUrl.jsonUrl（jobId=${jobId}）。` +
            `原始响应：${JSON.stringify(parsed.payload).slice(0, 300)}`,
        );
      }

      return {
        jsonUrl,
        extractedPages: Number(data.extractProgress?.extractedPages) || null,
      };
    }

    if (state === 'failed') {
      const message = cleanString(data.errorMsg) || pickPaddleMessage(parsed.payload) || 'unknown error';

      throw new Error(
        `PaddleOCR-VL 任务执行失败（jobId=${jobId}）：${message}` +
          (pickPaddleTraceId(parsed.payload) ? ` · traceId=${pickPaddleTraceId(parsed.payload)}` : ''),
      );
    }
  }

  throw new Error(`PaddleOCR-VL 任务超时（jobId=${jobId}），可在服务端查看该任务状态后重试。`);
}

async function downloadPaddleOcrLayoutResults(jsonUrl) {
  const response = await fetch(jsonUrl);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `PaddleOCR-VL 结果下载失败 · HTTP ${response.status} · ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}`,
    );
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
    throw new Error(
      `PaddleOCR-VL 结果中没有可用的 layoutParsingResults（响应 ${text.length} 字节）。` +
        `请确认该任务确实已完成并包含 PDF 页结果。`,
    );
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

      const apiBaseUrl = resolvePaddleApiBaseUrl(options.apiBaseUrl);
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
  describePaddleFailure,
  downloadPaddleOcrLayoutResults,
  looksLikeImage,
  persistPaddleOcrDocument,
  pickPaddleErrorCode,
  pickPaddleMessage,
  pollPaddleOcrJob,
  readPaddleResponse,
  resolvePaddleApiBaseUrl,
  submitPaddleOcrJob,
};
