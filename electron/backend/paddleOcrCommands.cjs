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
const fs = require('node:fs');
const crypto = require('node:crypto');
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
const { fetchPaddleResource, mapConcurrent, createPaddleTaskRegistry } = require('./paddleOcrRuntime.cjs');
const { deriveDocumentOutline } = require('./documentOutline.cjs');

const PADDLE_OCR_DEFAULT_BASE_URL = 'https://paddleocr.aistudio-app.com';
const PADDLE_OCR_DEFAULT_MODEL = 'PaddleOCR-VL-1.6';

// 官方同步服务默认只处理前 100 页。异步云任务的上限未在文档中固定，
// 因此按同一口径保守切分，并在结果页数不足时显式报错而不是静默丢页。
const PADDLE_OCR_MAX_PAGES_PER_JOB = 100;

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function generationStagingDirectory(cacheRoot, generation) {
  if (!generation || !cleanString(cacheRoot)) return null;
  const sourceKey = crypto.createHash('sha256').update(generation.sourceId).digest('hex').slice(0, 24);
  return path.join(path.resolve(cacheRoot), '.document-generations', sourceKey, generation.generationId);
}

async function stageCompatibilityCacheReplacement(cacheRoot, generationId, journal, journalPath) {
  const directory = path.resolve(cacheRoot);
  const names = ['content_list_v2.json', 'content_list.json', 'middle.json', 'full.md', 'images', 'translations', 'summaries'];
  const backups = [];
  await fsp.mkdir(directory, { recursive: true });
  try {
    for (const name of names) {
      const target = path.join(directory, name);
      const backup = `${target}.generation-backup-${generationId}`;
      const stat = await fsp.lstat(target).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
      if (!stat) continue;
      if (await fsp.lstat(backup).then(() => true, () => false)) {
        throw new Error('A previous cache publication needs recovery before this generation can replace it.');
      }
      journal.moved.push({ target: path.relative(directory, target), backup: path.relative(directory, backup) });
      journal.backups.push(path.relative(directory, backup));
      await writePublicationJournal(journalPath, journal);
      await fsp.rename(target, backup);
      backups.push({ target, backup });
    }
  } catch (error) {
    for (const item of backups.reverse()) await fsp.rename(item.backup, item.target).catch(() => undefined);
    throw error;
  }
  return { directory, backups, writtenPaths: [] };
}

function publicationJournalDirectory(cacheRoot) {
  return path.join(path.resolve(cacheRoot), '.paperquay-publication-journals');
}

async function writePublicationJournal(journalPath, journal) {
  await fsp.mkdir(path.dirname(journalPath), { recursive: true });
  const temporary = `${journalPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx' });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fsp.rename(temporary, journalPath);
        break;
      } catch (error) {
        const transientWindowsLock = process.platform === 'win32' &&
          ['EPERM', 'EACCES', 'EBUSY'].includes(error?.code);
        if (!transientWindowsLock || attempt >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function safeJournalPath(cacheRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) return null;
  const root = path.resolve(cacheRoot);
  const target = path.resolve(root, relativePath);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function recoverCompatibilityCachePublications(cacheRoot, knowledgeStore) {
  const directory = publicationJournalDirectory(cacheRoot);
  const names = await fsp.readdir(directory).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error));
  const recovered = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const journalPath = path.join(directory, name);
    const journal = JSON.parse(await fsp.readFile(journalPath, 'utf8'));
    if (path.resolve(journal.cacheRoot || '') !== path.resolve(cacheRoot) || !/^[a-f0-9-]{16,}$/i.test(journal.generationId || '') || !journal.sourceId) {
      throw new Error(`Invalid compatibility-cache recovery journal: ${name}`);
    }
    const generation = knowledgeStore?.listGenerations(journal.sourceId)
      .find((item) => item.generationId === journal.generationId);
    const committed = generation?.currentGeneration === journal.generationId;
    if (committed) {
      for (const backup of journal.backups || []) {
        const backupPath = safeJournalPath(cacheRoot, backup);
        if (!backupPath) throw new Error(`Unsafe cache backup path in recovery journal: ${name}`);
        await fsp.rm(backupPath, { recursive: true, force: true });
      }
    } else {
      for (const written of [...(journal.written || [])].reverse()) {
        const writtenPath = safeJournalPath(cacheRoot, written);
        if (!writtenPath) throw new Error(`Unsafe cache output path in recovery journal: ${name}`);
        await fsp.rm(writtenPath, { recursive: true, force: true });
      }
      for (const entry of [...(journal.moved || [])].reverse()) {
        const targetPath = safeJournalPath(cacheRoot, entry.target);
        const backupPath = safeJournalPath(cacheRoot, entry.backup);
        if (!targetPath || !backupPath) throw new Error(`Unsafe cache restore path in recovery journal: ${name}`);
        const backupExists = await fsp.lstat(backupPath).then(() => true, (error) => error?.code === 'ENOENT' ? false : Promise.reject(error));
        if (backupExists) {
          await fsp.rm(targetPath, { recursive: true, force: true });
          await fsp.rename(backupPath, targetPath);
        }
      }
    }
    await fsp.rm(journalPath, { force: true });
    recovered.push({ generationId: journal.generationId, committed });
  }
  return recovered;
}

async function restoreCompatibilityCacheReplacement(preparation) {
  if (!preparation) return;
  for (const target of preparation.writtenPaths.slice().reverse()) {
    await fsp.rm(target, { recursive: true, force: true }).catch(() => undefined);
  }
  for (const item of preparation.backups.slice().reverse()) {
    await fsp.rm(item.target, { recursive: true, force: true }).catch(() => undefined);
    await fsp.rename(item.backup, item.target);
  }
}

async function finishCompatibilityCacheReplacement(preparation) {
  if (!preparation) return;
  for (const item of preparation.backups) await fsp.rm(item.backup, { recursive: true, force: true });
}

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

  options.onProgress?.({ stage: 'submitting', completed: 5, total: 100 });
  const parsed = await fetchPaddleResource(`${apiBaseUrl}/api/v2/ocr/jobs`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: form,
  }, (response) => readPaddleResponse(response, 'PaddleOCR-VL 任务提交失败'), options);

  // 成功与否以 jobId 是否存在为准：实测该接口的成功信封并不保证带 errorCode，
  // 旧实现用 `errorCode !== 0` 判定会把成功的提交误判为失败。
  const jobId = cleanString(parsed.payload?.data?.jobId);

  if (!jobId) {
    throw new Error(describePaddleFailure(parsed));
  }

  await options.onJobSubmitted?.(jobId);
  return jobId;
}

async function pollPaddleOcrJob({ apiBaseUrl, token, jobId, timeoutSecs, pollIntervalSecs, ...runtime }) {
  const timeoutAt = Math.min(runtime.deadline ?? Infinity, Date.now() + (timeoutSecs ?? 3600) * 1000);
  const intervalMs = Math.max(1, pollIntervalSecs ?? 5) * 1000;

  while (Date.now() < timeoutAt) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, timeoutAt - Date.now()))));

    const parsed = await fetchPaddleResource(`${apiBaseUrl}/api/v2/ocr/jobs/${encodeURIComponent(jobId)}`, {
      headers: buildAuthHeaders(token),
    }, (response) => readPaddleResponse(response, 'PaddleOCR-VL 任务状态查询失败'), { ...runtime, deadline: timeoutAt });
    const data = parsed.payload?.data ?? {};
    const state = cleanString(data.state).toLowerCase();
    runtime.onProgress?.({ stage: 'recognizing', completed: Number(data.extractProgress?.extractedPages) || 0,
      total: Number(data.extractProgress?.totalPages) || null });

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

async function downloadPaddleOcrLayoutResults(jsonUrl, runtime = {}) {
  runtime.onProgress?.({ stage: 'downloading', completed: 0, total: null });
  const text = await fetchPaddleResource(jsonUrl, {}, async (response) => {
    const body = await response.text();
    if (!response.ok) throw new Error(`PaddleOCR-VL 结果下载失败 · HTTP ${response.status}`);
    return body;
  }, runtime);
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
async function resolvePaddleAssetBuffer(value, runtime = {}) {
  const trimmed = cleanString(value);
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const buffer = await fetchPaddleResource(trimmed, {}, async (response) => {
        if (!response.ok) return null;
        return Buffer.from(await response.arrayBuffer());
      }, { ...runtime, requestTimeoutMs: runtime.assetTimeoutMs ?? 30000 });

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
async function persistPaddleOcrDocument({ layoutResults, extractDir, runtime = {} }) {
  const document = normalizePaddleOcrDocument(layoutResults);

  const imagesDir = path.join(extractDir, 'images');
  await fsp.mkdir(imagesDir, { recursive: true });

  let writtenAssets = 0;
  const missingAssets = [];
  const assetPathByKey = new Map(document.assets.map((asset) => [asset.key, asset.assetPath]));

  let settledAssets = 0;
  runtime.onProgress?.({ stage: 'assets', completed: 0, total: document.assets.length });
  await mapConcurrent(document.assets, 4, async (asset) => {
    const buffer = await resolvePaddleAssetBuffer(asset.value, runtime);
    if (!buffer) {
      missingAssets.push(asset.key);
    } else {
      await fsp.writeFile(path.join(extractDir, ...asset.assetPath.split('/')), buffer);
      writtenAssets += 1;
    }
    runtime.onProgress?.({ stage: 'assets', completed: ++settledAssets, total: document.assets.length });
  });
  if (Date.now() >= (runtime.deadline ?? Infinity)) throw new Error('PaddleOCR-VL 任务总时限已到');
  runtime.onProgress?.({ stage: 'saving', completed: 0, total: null });

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
  existingJobId = '',
}) {
  await fsp.mkdir(extractDir, { recursive: true });

  const expectedPageCount = await getPdfPageCount(pdfPath).catch(() => 0);

  const jobId = cleanString(existingJobId) || await submitPaddleOcrJob({
    apiBaseUrl, token, pdfPath, fileName, model, options,
  });

  const { jsonUrl } = await pollPaddleOcrJob({
    apiBaseUrl,
    token,
    jobId,
    timeoutSecs: options.timeoutSecs,
    pollIntervalSecs: options.pollIntervalSecs,
    deadline: options.deadline,
    requestTimeoutMs: options.requestTimeoutMs,
    onProgress: options.onProgress,
  });

  const layoutResults = await downloadPaddleOcrLayoutResults(jsonUrl, options);

  if (expectedPageCount > 0 && layoutResults.length < expectedPageCount) {
    throw new Error(
      `PaddleOCR-VL 只返回了 ${layoutResults.length}/${expectedPageCount} 页结果：云端可能截断了文档。` +
        `请降低单卷页数后重试。`,
    );
  }

  const persisted = await persistPaddleOcrDocument({ layoutResults, extractDir, runtime: options });
  if (persisted.blockCount <= 0) throw new Error('PaddleOCR-VL 未返回可用结构块');

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
  const registry = createPaddleTaskRegistry();

  return {
    async list_paddleocr_parse_tasks() { return registry.list(); },
    async run_paddleocr_cloud_parse({ options }, event) {
      return registry.run(options, event, async (options) => {
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

      const knowledgeStore = context.knowledgeStore;
      if (knowledgeStore && options.extractDir) {
        await recoverCompatibilityCachePublications(options.extractDir, knowledgeStore);
      }
      const sourceVersion = knowledgeStore && totalPageCount > 0 ? await hashFile(pdfPath) : '';
      const sourceId = cleanString(options.documentKey) || (sourceVersion
        ? `local-pdf:${crypto.createHash('sha256').update(path.resolve(pdfPath)).digest('hex')}`
        : '');
      const generationForPlans = (plans) => {
        if (!knowledgeStore || !sourceId || !sourceVersion) return null;
        const partitions = plans.map((plan, index) => ({
          index,
          startPage: plan.startPage,
          endPage: plan.endPage,
          inputHash: crypto.createHash('sha256')
            .update(`${sourceVersion}:${model}:${plan.startPage}:${plan.endPage}`)
            .digest('hex'),
        }));
        const resumable = knowledgeStore.findBuildingGeneration?.(sourceId, sourceVersion, partitions);
        if (resumable) return resumable;
        return knowledgeStore.beginGeneration({
          sourceId,
          sourceKind: 'pdf',
          sourceVersion,
          partitions,
        });
      };
      const runTrackedPartition = async (generation, index, parse) => {
        if (!generation) return parse();
        const partition = knowledgeStore.listGenerationPartitions(generation.generationId)
          .find((item) => item.partitionIndex === index);
        if (!partition) throw new Error('Parse partition is missing from its persisted generation.');
        const expectedPages = partition.endPage - partition.startPage + 1;
        const readVerifiedStage = async () => {
          const staged = partition.stagedManifest;
          const root = path.resolve(partition.stagedPath || '');
          if (!staged || staged.version !== 1 || staged.pageCount !== expectedPages || !Array.isArray(staged.entries) || !root) return null;
          const expected = new Set(staged.entries.map((entry) => entry.path));
          if (!expected.size || expected.size !== staged.entries.length || (await listRelativeFiles(root)).length !== expected.size) return null;
          for (const entry of staged.entries) {
            if (!entry || !cleanString(entry.path) || path.isAbsolute(entry.path)) return null;
            const target = path.resolve(root, ...entry.path.split('/'));
            if (!target.startsWith(`${root}${path.sep}`)) return null;
            const stat = await fsp.lstat(target).catch(() => null);
            if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || await hashFile(target) !== entry.sha256) return null;
          }
          const contentJsonPath = path.join(root, 'content_list_v2.json');
          const markdownPath = path.join(root, 'full.md');
          const [contentJsonText, markdownText] = await Promise.all([
            fsp.readFile(contentJsonPath, 'utf8').catch(() => null),
            fsp.readFile(markdownPath, 'utf8').catch(() => null),
          ]);
          if (contentJsonText == null || markdownText == null) return null;
          let blocks;
          try { blocks = JSON.parse(contentJsonText); } catch { return null; }
          if (!Array.isArray(blocks) || blocks.length !== expectedPages) return null;
          return { batchId: partition.remoteJobId || `recovered-${index}`, contentJsonText, markdownText,
            contentJsonPath, markdownPath, assetRootDir: root, pageCount: expectedPages,
            blockCount: staged.blockCount, zipEntries: [...expected] };
        };
        const reused = await readVerifiedStage();
        if (reused) {
          if (partition.status !== 'complete' && !knowledgeStore.setPartitionStatus(generation.generationId, index, 'complete')) {
            throw new Error('Recovered partition artifacts no longer match the active source version.');
          }
          return reused;
        }
        if (!knowledgeStore.setPartitionStatus(generation.generationId, index, 'running')) {
          throw new Error('Parse partition is no longer eligible for this source version.');
        }
        if (partition.stagedPath) {
          const generationRoot = path.resolve(generationStagingDirectory(appPaths.mineruCacheDir, generation));
          const previousStage = path.resolve(partition.stagedPath);
          if (previousStage === generationRoot || previousStage.startsWith(`${generationRoot}${path.sep}`)) {
            knowledgeStore.clearPartitionArtifacts(generation.generationId, index);
            await fsp.rm(previousStage, { recursive: true, force: true });
          }
        }
        try {
          const onJobSubmitted = (remoteJobId) => {
            if (!knowledgeStore.setPartitionRemoteJobId(generation.generationId, index, remoteJobId)) {
              throw new Error('Remote job identity could not be persisted for this source partition.');
            }
          };
          const result = await parse(onJobSubmitted, partition.remoteJobId || '');
          const stageRoot = path.resolve(result.assetRootDir || '');
          const files = await listRelativeFiles(stageRoot);
          const manifest = [];
          for (const relativePath of files) {
            const target = path.resolve(stageRoot, ...relativePath.split('/'));
            if (!target.startsWith(`${stageRoot}${path.sep}`)) throw new Error('Partition artifact escaped its staging directory.');
            const stat = await fsp.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Partition staging contains a non-regular file.');
            manifest.push({ path: relativePath, size: stat.size, sha256: await hashFile(target) });
          }
          if (!knowledgeStore.setPartitionArtifacts(generation.generationId, index, {
            stagedPath: stageRoot, manifest, pageCount: result.pageCount, blockCount: result.blockCount || 0,
          })) throw new Error('Partition artifacts could not be persisted for this source generation.');
          if (!knowledgeStore.setPartitionStatus(generation.generationId, index, 'complete')) {
            throw new Error('Parse partition lost its source version before commit.');
          }
          return result;
        } catch (error) {
          knowledgeStore.setPartitionStatus(generation.generationId, index, 'error');
          throw error;
        }
      };
      const publishGeneration = async (generation, artifactRoot) => {
        if (generation && await hashFile(pdfPath) !== sourceVersion) {
          throw new Error('The source PDF changed while parsing; the staged generation was not published.');
        }
        let manifest = [];
        let pageMappings;
        if (generation) {
          const root = path.resolve(artifactRoot || '');
          const files = await listRelativeFiles(root);
          if (!root || files.length === 0) throw new Error('Parsed artifact staging is empty; previous published generation was preserved.');
          manifest = [];
          for (const relativePath of files) {
            const target = path.resolve(root, ...relativePath.split('/'));
            if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error('Parsed artifact path escaped its staging directory.');
            const stat = await fsp.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Parsed artifact staging contains a non-regular file.');
            manifest.push({ path: relativePath, size: stat.size, sha256: await hashFile(target) });
          }
          if (!knowledgeStore.setGenerationArtifacts(generation.generationId, { artifactPath: root, manifest })) {
            throw new Error('Parsed artifacts could not be registered to the current source generation.');
          }
          for (const entry of manifest) {
            const target = path.resolve(root, ...entry.path.split('/'));
            const stat = await fsp.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || await hashFile(target) !== entry.sha256) {
              throw new Error('Parsed artifact staging changed during validation; previous published generation was preserved.');
            }
          }
          const contentEntry = manifest.find((entry) => /^(?:content_list_v2|content_list)\.json$/i.test(entry.path));
          let parsedContentList = [];
          if (contentEntry) {
            try {
              const contentPath = path.resolve(root, ...contentEntry.path.split('/'));
              parsedContentList = JSON.parse(await fsp.readFile(contentPath, 'utf8'));
            } catch {
              // The generation remains page-addressable even if an optional outline source cannot be read.
              parsedContentList = [];
            }
          }
          const outline = deriveDocumentOutline(parsedContentList, { generationId: generation.generationId, sourceVersion, pageCount: totalPageCount });
          if (!knowledgeStore.upsertDocumentUnits(generation.generationId, outline.units)) {
            throw new Error('Document structure could not be registered to the staged generation.');
          }
          pageMappings = outline.pages;
        }
        let cachePreparation = null;
        let journalPath = null;
        let journal = null;
        try {
          const cacheRoot = path.resolve(options.extractDir || '');
          const generationRoot = path.resolve(artifactRoot || '');
          if (generation && options.extractDir && cacheRoot !== generationRoot) {
            journalPath = path.join(publicationJournalDirectory(cacheRoot), `${generation.generationId}.json`);
            journal = { version: 1, cacheRoot, sourceId: generation.sourceId, generationId: generation.generationId,
              moved: [], backups: [], written: [] };
            await writePublicationJournal(journalPath, journal);
            cachePreparation = await stageCompatibilityCacheReplacement(cacheRoot, generation.generationId, journal, journalPath);
            for (const entry of manifest) {
              const source = path.resolve(generationRoot, ...entry.path.split('/'));
              const destination = path.resolve(cacheRoot, ...entry.path.split('/'));
              if (!source.startsWith(`${generationRoot}${path.sep}`) || !destination.startsWith(`${cacheRoot}${path.sep}`)) {
                throw new Error('Parsed output path escaped its managed directory.');
              }
              await fsp.mkdir(path.dirname(destination), { recursive: true });
              cachePreparation.writtenPaths.push(destination);
              journal.written.push(path.relative(cacheRoot, destination));
              await writePublicationJournal(journalPath, journal);
              await fsp.copyFile(source, destination);
              const copied = await fsp.stat(destination);
              if (!copied.isFile() || copied.size !== entry.size || await hashFile(destination) !== entry.sha256) {
                throw new Error('Compatibility cache copy failed integrity validation; previous cache files were restored.');
              }
            }
          }
          if (generation && !knowledgeStore.publishGeneration(generation.generationId, {
            sourceVersion, expectedPageCount: totalPageCount, pageMappings,
          })) {
            throw new Error('Parsed output failed page coverage or source version validation; previous published generation was preserved.');
          }
          if (cachePreparation) await finishCompatibilityCacheReplacement(cachePreparation);
          if (journalPath) await fsp.rm(journalPath, { force: true });
        } catch (error) {
          if (journalPath) await recoverCompatibilityCachePublications(path.dirname(path.dirname(journalPath)), knowledgeStore).catch(() => undefined);
          else if (cachePreparation) await restoreCompatibilityCacheReplacement(cachePreparation).catch(() => undefined);
          throw error;
        }
      };
      if (totalPageCount <= PADDLE_OCR_MAX_PAGES_PER_JOB) {
        const singleExtractDir = options.extractDir || path.join(
          appPaths.mineruCacheDir,
          `${path.basename(fileName, '.pdf')}-paddle-${now()}`,
        );

        const generation = totalPageCount > 0 ? generationForPlans([{ startPage: 1, endPage: totalPageCount }]) : null;
        const outputDir = generationStagingDirectory(appPaths.mineruCacheDir, generation) || singleExtractDir;
        try {
          const result = await runTrackedPartition(generation, 0, (onJobSubmitted, existingJobId) => runSinglePaddleOcrParse({
            pdfPath, fileName, dataId, token, apiBaseUrl, model,
            options: { ...options, onJobSubmitted }, extractDir: outputDir, existingJobId,
          }));
          await publishGeneration(generation, result.assetRootDir);
          return result;
        } catch (error) { throw error; }
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

        const generation = generationForPlans([{ startPage: 1, endPage: totalPageCount }]);
        const outputDir = generationStagingDirectory(appPaths.mineruCacheDir, generation) || singleExtractDir;
        try {
          const result = await runTrackedPartition(generation, 0, (onJobSubmitted, existingJobId) => runSinglePaddleOcrParse({
            pdfPath, fileName, dataId, token, apiBaseUrl, model,
            options: { ...options, onJobSubmitted }, extractDir: outputDir, existingJobId,
          }));
          await publishGeneration(generation, result.assetRootDir);
          return result;
        } catch (error) { throw error; }
      }

      const generation = generationForPlans(splitPdfResults);

      const partResults = [];

      try {
        for (const part of splitPdfResults) {
          const partExtractDir = path.join(generationStagingDirectory(appPaths.mineruCacheDir, generation),
            'partitions', `part_${String(part.partIndex + 1).padStart(4, '0')}`);
          const partParsed = await runTrackedPartition(generation, part.partIndex, (onJobSubmitted, existingJobId) => runSinglePaddleOcrParse({
            pdfPath: part.path,
            fileName: path.basename(part.path),
            dataId: `paper_reader_paddle_part_${part.partIndex + 1}_${now()}`,
            token,
            apiBaseUrl,
            model,
            options: { ...options, onJobSubmitted }, existingJobId,
            extractDir: partExtractDir,
          }));

          partResults.push({
            partIndex: part.partIndex,
            startPage: part.startPage,
            endPage: part.endPage,
            pageOffset: part.pageOffset,
            pageCount: part.pageCount,
            extracted: partParsed,
          });
        }
      } catch (error) {
        throw error;
      } finally {
        for (const part of splitPdfResults) {
          await fsp.unlink(part.path).catch(() => {});
        }
      }

      const finalExtractDir = generationStagingDirectory(appPaths.mineruCacheDir, generation) || options.extractDir || path.join(
        appPaths.mineruCacheDir,
        `${path.basename(fileName, '.pdf')}-paddle-${now()}`,
      );

      try {
        options.onProgress?.({ stage: 'merging', completed: 0, total: null });
        if (Date.now() >= (options.deadline ?? Infinity)) throw new Error('PaddleOCR-VL 任务总时限已到');
        const merged = await mergeMineruParseResults(partResults, finalExtractDir);
        if (Date.now() >= (options.deadline ?? Infinity)) throw new Error('PaddleOCR-VL 任务总时限已到');
        await publishGeneration(generation, merged.assetRootDir);
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
          blockCount: partResults.reduce((sum, part) => sum + (part.extracted.blockCount || 0), 0),
        };
      } catch (error) {
        throw error;
      } finally {
        await fsp.rm(splitWorkDir, { recursive: true, force: true }).catch(() => {});
      }
      });
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
  recoverCompatibilityCachePublications,
  submitPaddleOcrJob,
};
