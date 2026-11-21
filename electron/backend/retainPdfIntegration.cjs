const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { addTranslatedPdfAttachment } = require('./translatedPdfAttachments.cjs');
const { cleanString } = require('./utils.cjs');

const RETAINPDF_API_KEY = cleanString(process.env.RETAINPDF_API_KEY) || 'retain-pdf-desktop';
const RETAINPDF_EVENT = 'paperquay://retainpdf-translation';
const RETAINPDF_DEFAULT_API_BASE = 'http://127.0.0.1:41000';
const RETAINPDF_DEFAULT_PADDLE_API_URL = 'https://paddleocr.aistudio-app.com';
const RETAINPDF_POLL_INTERVAL_MS = positiveInteger(process.env.PAPERQUAY_RETAINPDF_POLL_MS, 2500);
const RETAINPDF_HEALTH_TIMEOUT_MS = 1500;
const RETAINPDF_LAUNCH_WAIT_MS = 60000;
const RETAINPDF_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const RETAINPDF_JOB_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const RETAINPDF_MAX_ATTACH_ATTEMPTS = 3;

const ACTIVE_STATUSES = new Set([
  'starting',
  'uploading',
  'submitting',
  'queued',
  'running',
  'downloading',
  'attaching',
]);
const RESUME_STATUSES = new Set([
  'running',
  'queued',
  'submitting',
  'downloading',
  'attaching',
]);

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeApiBase(value) {
  const raw = cleanString(value).replace(/\/+$/, '');
  if (!raw) {
    return '';
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return '';
  }
  if (parsed.username || parsed.password) {
    return '';
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
    return '';
  }

  return `${parsed.protocol}//${parsed.host}`;
}

function retainPdfUserDataDirs() {
  const dirs = [];
  const override = cleanString(process.env.RETAINPDF_USER_DATA_DIR);
  if (override) {
    dirs.push(path.resolve(override));
  }

  const appData = cleanString(process.env.APPDATA);
  if (appData) {
    dirs.push(path.join(appData, 'retain-pdf-desktop'));
    dirs.push(path.join(appData, 'RetainPDF'));
  }

  return [...new Set(dirs)];
}

function retainPdfRuntimePortsFiles() {
  const files = [];
  const override = cleanString(process.env.RETAINPDF_RUNTIME_PORTS_FILE);
  if (override) {
    files.push(path.resolve(override));
  }
  for (const dir of retainPdfUserDataDirs()) {
    files.push(path.join(dir, 'runtime-ports.json'));
  }
  return [...new Set(files)];
}

function retainPdfDesktopConfigFiles() {
  const files = [];
  const override = cleanString(process.env.RETAINPDF_DESKTOP_CONFIG_FILE);
  if (override) {
    files.push(path.resolve(override));
  }
  for (const dir of retainPdfUserDataDirs()) {
    files.push(path.join(dir, 'desktop-config.json'));
  }
  return [...new Set(files)];
}

function findRetainPdfExecutable() {
  const candidates = [];
  const envPath = cleanString(process.env.RETAINPDF_EXE);
  if (envPath) {
    candidates.push(path.resolve(envPath));
  }

  const localAppData = cleanString(process.env.LOCALAPPDATA);
  const programFiles = cleanString(process.env.ProgramFiles);
  const programFilesX86 = cleanString(process.env['ProgramFiles(x86)']);

  if (localAppData) {
    for (const name of ['RetainPDF', 'retain-pdf-desktop']) {
      candidates.push(path.join(localAppData, 'Programs', name, `${name}.exe`));
    }
  }
  for (const root of [programFiles, programFilesX86].filter(Boolean)) {
    candidates.push(path.join(root, 'RetainPDF', 'RetainPDF.exe'));
    candidates.push(path.join(root, 'retain-pdf-desktop', 'retain-pdf-desktop.exe'));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? '';
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function candidateApiBases() {
  const bases = [];
  const envBase = normalizeApiBase(process.env.RETAINPDF_API_BASE);
  if (envBase) {
    bases.push(envBase);
  }

  for (const filePath of retainPdfRuntimePortsFiles()) {
    const payload = await readJsonFile(filePath);
    const fileBase = normalizeApiBase(payload?.api_base);
    if (fileBase) {
      bases.push(fileBase);
    }
    const port = positiveInteger(payload?.api_port, 0);
    if (port > 0 && port < 65536) {
      bases.push(`http://127.0.0.1:${port}`);
    }
  }

  bases.push(RETAINPDF_DEFAULT_API_BASE);
  return [...new Set(bases)];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = RETAINPDF_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('RetainPDF request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url, options = {}, timeoutMs = RETAINPDF_REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      'X-API-Key': RETAINPDF_API_KEY,
      ...(options.headers ?? {}),
    },
  }, timeoutMs);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = cleanString(payload?.message) || text.slice(0, 300) || response.statusText;
    throw new Error(`RetainPDF HTTP ${response.status}: ${message}`);
  }

  const code = payload?.code;
  if (code !== undefined && code !== null && code !== 0 && code !== '0') {
    throw new Error(`RetainPDF API error ${code}: ${cleanString(payload?.message) || 'request failed'}`);
  }

  return payload?.data ?? payload;
}

async function probeRetainPdf(apiBase) {
  try {
    const health = await requestJson(`${apiBase}/health`, {}, RETAINPDF_HEALTH_TIMEOUT_MS);
    return health?.status === 'up';
  } catch {
    return false;
  }
}

async function detectRetainPdf() {
  const executablePath = findRetainPdfExecutable();
  for (const apiBase of await candidateApiBases()) {
    if (await probeRetainPdf(apiBase)) {
      return { running: true, apiBase, executablePath };
    }
  }
  return { running: false, apiBase: '', executablePath };
}

async function waitForRetainPdf(timeoutMs = RETAINPDF_LAUNCH_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detected = await detectRetainPdf();
    if (detected.running) {
      return detected;
    }
    await delay(1000);
  }
  return detectRetainPdf();
}

async function ensureRetainPdfRunning() {
  const detected = await detectRetainPdf();
  if (detected.running) {
    return detected;
  }
  if (!detected.executablePath) {
    throw new Error('未找到本机安装的 RetainPDF，请先安装或设置 RETAINPDF_EXE');
  }

  const child = spawn(detected.executablePath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  const launched = await waitForRetainPdf();
  if (!launched.running) {
    throw new Error('已尝试启动 RetainPDF，但本地服务未在限定时间内就绪，请手动启动后重试');
  }
  return launched;
}

async function readRetainPdfDesktopConfig() {
  for (const filePath of retainPdfDesktopConfigFiles()) {
    const raw = await readJsonFile(filePath);
    if (raw && typeof raw === 'object') {
      return { configPath: filePath, raw };
    }
  }
  throw new Error('未找到 RetainPDF 桌面配置，请先启动 RetainPDF 并完成 OCR 与翻译模型设置');
}

function normalizeRetainPdfDesktopConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const provider = source.ocrProvider === 'mineru' ? 'mineru' : 'paddle';
  const ocrOptions = source.ocrOptions && typeof source.ocrOptions === 'object'
    ? source.ocrOptions
    : {};
  const providerOptions = ocrOptions[provider] && typeof ocrOptions[provider] === 'object'
    ? ocrOptions[provider]
    : {};
  const developer = {
    ...(source.translationOptions && typeof source.translationOptions === 'object'
      ? source.translationOptions
      : {}),
    ...(source.developerConfig && typeof source.developerConfig === 'object'
      ? source.developerConfig
      : {}),
  };

  const token = provider === 'paddle'
    ? cleanString(source.paddleToken)
    : cleanString(source.mineruToken);
  const model = cleanString(developer.model) || cleanString(source.model) || 'deepseek-flash';
  const baseUrl = cleanString(developer.baseUrl) || cleanString(source.baseUrl) || 'https://api.deepseek.com/v1';
  const url = cleanString(developer.url) || cleanString(source.url);
  const apiKey = cleanString(source.modelApiKey);

  const ocr = provider === 'paddle'
    ? {
        provider,
        paddle_token: token,
        model_version: 'vlm',
        language: 'ch',
        paddle_api_url: cleanString(providerOptions.paddleApiUrl) || RETAINPDF_DEFAULT_PADDLE_API_URL,
        paddle_model: cleanString(providerOptions.paddleModel) || 'PaddleOCR-VL-1.6',
      }
    : {
        provider,
        mineru_token: token,
        model_version: cleanString(providerOptions.modelVersion) || 'vlm',
        language: cleanString(providerOptions.language) || 'ch',
        disable_formula: Boolean(providerOptions.disableFormula),
        disable_table: Boolean(providerOptions.disableTable),
      };

  const translation = {
    mode: cleanString(developer.translationMode) || 'sci',
    math_mode: cleanString(developer.mathMode) || 'direct_typst',
    model,
    base_url: baseUrl,
    api_key: apiKey,
    workers: positiveInteger(developer.workers, 100),
    batch_size: positiveInteger(developer.batchSize, 8),
    classify_batch_size: positiveInteger(developer.classifyBatchSize, 12),
    rule_profile_name: 'general_sci',
    custom_rules_text: cleanString(developer.customRulesText),
    glossary_id: cleanString(developer.glossaryId || developer.glossary_id),
    glossary_entries: [],
    skip_title_translation: developer.translateTitles === false,
  };
  if (url) {
    translation.url = url;
  }
  const temperature = finiteNumber(developer.temperature);
  if (temperature !== null) {
    translation.temperature = temperature;
  }
  const topP = finiteNumber(developer.topP);
  if (topP !== null) {
    translation.top_p = topP;
  }
  const timeoutSeconds = finiteNumber(developer.timeoutSeconds);
  if (timeoutSeconds !== null && timeoutSeconds > 0) {
    translation.timeout_seconds = Math.floor(timeoutSeconds);
  }
  const maxRetries = finiteNumber(developer.maxRetries);
  if (maxRetries !== null && maxRetries >= 0) {
    translation.max_retries = Math.floor(maxRetries);
  }
  const reasoningEffort = cleanString(developer.reasoningEffort);
  if (reasoningEffort && reasoningEffort !== 'auto') {
    translation.reasoning_effort = reasoningEffort;
  }

  const render = {
    render_mode: 'auto',
    compile_workers: positiveInteger(developer.compileWorkers, 8),
  };

  const missing = [];
  if (!token) {
    missing.push(provider === 'paddle' ? 'PaddleOCR Token' : 'MinerU Token');
  }
  if (!model) {
    missing.push('翻译模型');
  }
  if (!baseUrl && !url) {
    missing.push('模型接口地址');
  }
  if (!apiKey) {
    missing.push('模型 API Key');
  }

  return {
    provider,
    model,
    baseUrl: url || baseUrl,
    ready: missing.length === 0,
    missing,
    ocr,
    translation,
    render,
  };
}

function publicRetainPdfConfig(config, configPath = '') {
  if (!config) {
    return null;
  }
  let displayBaseUrl = '';
  try {
    const parsed = new URL(config.baseUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    displayBaseUrl = parsed.toString().replace(/\/$/, '');
  } catch {}
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: displayBaseUrl,
    ready: config.ready,
    missing: config.missing,
    configPath,
  };
}

function buildRetainPdfJobPayload(config, uploadId) {
  if (!config?.ready) {
    throw new Error(`RetainPDF 配置不完整：${(config?.missing ?? []).join('、') || '未知配置'}`);
  }
  const source = cleanString(uploadId);
  if (!source) {
    throw new Error('RetainPDF upload_id is required');
  }

  return {
    workflow: 'book',
    source: { upload_id: source },
    ocr: { ...config.ocr, page_ranges: '' },
    translation: { ...config.translation },
    render: { ...config.render },
    runtime: { timeout_seconds: 7200 },
  };
}

function extractRetainPdfProgress(payload) {
  const data = payload?.data ?? payload ?? {};
  const snapshot = data.stage_snapshot ?? data.stageSnapshot ?? {};
  const progressValue = snapshot.progress ?? data.progress ?? null;
  const progress = progressValue && typeof progressValue === 'object'
    ? {
        current: finiteNumber(progressValue.current),
        total: finiteNumber(progressValue.total),
        percent: finiteNumber(progressValue.percent),
      }
    : null;
  const failure = data.failure ?? data.failure_diagnostic ?? {};
  const status = cleanString(data.status).toLowerCase();
  const failureSummary = cleanString(failure.summary ?? failure.root_cause);

  return {
    jobId: cleanString(data.job_id ?? data.jobId),
    status,
    stage: cleanString(snapshot.stage ?? data.stage),
    stageDetail: cleanString(
      snapshot.stage_detail
      ?? snapshot.stageDetail
      ?? data.stage_detail
      ?? data.stageDetail
      ?? data.message,
    ),
    progress,
    error: failureSummary || (isTerminalFailure(status) ? cleanString(data.error ?? data.message) : ''),
  };
}

function isTerminalSuccess(status) {
  return ['succeeded', 'success', 'finished', 'completed'].includes(status);
}

function isTerminalFailure(status) {
  return ['failed', 'error'].includes(status);
}

function isTerminalCanceled(status) {
  return ['canceled', 'cancelled'].includes(status);
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

function findPaperPdfPath(paper) {
  const attachment = (paper?.attachments ?? []).find((item) => (
    item?.kind === 'pdf'
    && cleanString(item.storedPath)
    && item.missing !== true
  ));
  return attachment ? cleanString(attachment.storedPath) : '';
}

function publicJobRecord(record) {
  return {
    paperId: record.paperId,
    paperTitle: record.paperTitle,
    jobId: record.jobId,
    status: record.status,
    stage: record.stage,
    stageDetail: record.stageDetail,
    progress: record.progress,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attachmentId: record.attachmentId,
    pageCountMismatch: record.pageCountMismatch,
  };
}

function broadcastRetainPdfEvent(payload) {
  try {
    const { BrowserWindow } = require('electron');
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('paperquay:event', RETAINPDF_EVENT, payload);
      }
    }
  } catch {
  }
}

async function uploadRetainPdf(apiBase, sourcePath) {
  const fileName = path.basename(sourcePath);
  let blob;
  if (typeof fsp.openAsBlob === 'function') {
    blob = await fsp.openAsBlob(sourcePath, { type: 'application/pdf' });
  } else {
    blob = new Blob([await fsp.readFile(sourcePath)], { type: 'application/pdf' });
  }

  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('developer_mode', 'false');
  return requestJson(`${apiBase}/api/v1/uploads`, {
    method: 'POST',
    body: form,
  }, RETAINPDF_REQUEST_TIMEOUT_MS);
}

async function createRetainPdfJob(apiBase, payload) {
  return requestJson(`${apiBase}/api/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, RETAINPDF_REQUEST_TIMEOUT_MS);
}

async function getRetainPdfJob(apiBase, jobId) {
  return requestJson(`${apiBase}/api/v1/jobs/${encodeURIComponent(jobId)}`, {}, 60000);
}

async function cancelRetainPdfJob(apiBase, jobId) {
  return requestJson(`${apiBase}/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  }, 60000);
}

async function downloadRetainPdf(apiBase, jobId, destinationPath) {
  const response = await fetchWithTimeout(
    `${apiBase}/api/v1/jobs/${encodeURIComponent(jobId)}/pdf`,
    { headers: { 'X-API-Key': RETAINPDF_API_KEY } },
    RETAINPDF_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = cleanString(JSON.parse(text)?.message) || message;
    } catch {}
    throw new Error(`RetainPDF download HTTP ${response.status}: ${message.slice(0, 300)}`);
  }
  if (!response.body) {
    throw new Error('RetainPDF 返回的译版 PDF 为空');
  }

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryPath));
    const stat = await fsp.stat(temporaryPath);
    if (stat.size < 1024) {
      throw new Error('RetainPDF 返回的译版 PDF 不完整');
    }
    await fsp.rm(destinationPath, { force: true });
    await fsp.rename(temporaryPath, destinationPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    await fsp.rm(destinationPath, { force: true }).catch(() => {});
    throw error;
  }
  return destinationPath;
}

function createRetainPdfIntegration({ store, appPaths }) {
  const jobs = new Map();
  const statePath = path.join(appPaths.dataDir, '.retainpdf-jobs.json');
  const downloadDir = path.join(appPaths.dataDir, '.retainpdf-downloads');
  let persistChain = Promise.resolve();

  function persistJobs() {
    const snapshot = {
      version: 1,
      jobs: [...jobs.values()],
    };
    const body = `${JSON.stringify(snapshot, null, 2)}\n`;
    persistChain = persistChain
      .then(async () => {
        await fsp.mkdir(appPaths.dataDir, { recursive: true });
        const temporaryPath = `${statePath}.${process.pid}.tmp`;
        await fsp.writeFile(temporaryPath, body, 'utf8');
        await fsp.rename(temporaryPath, statePath);
      })
      .catch(() => {});
    return persistChain;
  }

  function publish(record, phase = 'progress') {
    broadcastRetainPdfEvent({
      phase,
      job: publicJobRecord(record),
    });
  }

  function touch(record, options = {}) {
    record.updatedAt = Date.now();
    publish(record);
    if (options.persist !== false) {
      void persistJobs();
    }
  }

  function failJob(record, error) {
    record.status = 'failed';
    record.error = error instanceof Error ? error.message : String(error);
    record.stageDetail = record.error;
    record.updatedAt = Date.now();
    publish(record, 'failed');
    void persistJobs();
  }

  function cancelRecord(record) {
    record.status = 'canceled';
    record.stageDetail = '已取消';
    record.cancelRequested = true;
    record.updatedAt = Date.now();
    publish(record, 'canceled');
    void persistJobs();
  }

  async function resolvePaperPdf(paperId) {
    const paper = store.getPaper(paperId);
    if (!paper) {
      throw new Error('文献不存在或已被删除');
    }
    const sourcePath = findPaperPdfPath(paper);
    if (!sourcePath) {
      throw new Error('这篇文献没有可翻译的原始 PDF');
    }
    const stat = await fsp.stat(sourcePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error('原始 PDF 文件不存在，请先重新定位附件');
    }
    return { paper, sourcePath };
  }

  async function attachDownloadedPdf(record) {
    const paper = store.getPaper(record.paperId);
    if (!paper) {
      throw new Error('文献不存在或已被删除，无法附加译版 PDF');
    }

    const attachAttempts = positiveInteger(record.attachAttempts, 0);
    if (attachAttempts >= RETAINPDF_MAX_ATTACH_ATTEMPTS) {
      throw new Error('译版 PDF 自动附加多次失败，请重新发起任务或手动附加');
    }

    record.status = 'attaching';
    record.stageDetail = '正在附加译版 PDF';
    record.attachAttempts = attachAttempts + 1;
    touch(record);

    const settings = store.loadSettings();
    const result = await addTranslatedPdfAttachment({
      paper,
      sourcePath: record.downloadedPath,
      kind: 'translated-pdf',
      language: 'zh-CN',
      settings,
      appPaths,
      persist: async () => {
        store.savePaper(paper);
      },
      listAttachmentsByStoredPath: (storedPath) => store.findAttachmentsByStoredPath(storedPath),
    });

    record.status = 'attached';
    record.stage = 'finished';
    record.stageDetail = '译版 PDF 已附加';
    record.attachmentId = result.attachment?.id ?? '';
    record.pageCountMismatch = result.pageCountMismatch ?? null;
    record.updatedAt = Date.now();
    const updatedPaper = store.getPaper(record.paperId) ?? paper;
    broadcastRetainPdfEvent({
      phase: 'attached',
      job: publicJobRecord(record),
      paper: updatedPaper,
      pageCountMismatch: record.pageCountMismatch,
    });
    void persistJobs();
    await fsp.rm(record.downloadedPath, { force: true }).catch(() => {});

    const records = [...jobs.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    for (const stale of records.slice(30)) {
      if (!isActiveStatus(stale.status)) {
        jobs.delete(stale.paperId);
      }
    }
    void persistJobs();
  }

  async function downloadAndAttach(record, apiBase) {
    if (!record.jobId) {
      throw new Error('RetainPDF 任务缺少 job_id');
    }
    record.status = 'downloading';
    record.stageDetail = '正在下载译版 PDF';
    touch(record);
    const destinationPath = path.join(downloadDir, `retainpdf-${record.jobId}.pdf`);
    await downloadRetainPdf(apiBase, record.jobId, destinationPath);
    record.downloadedPath = destinationPath;
    record.updatedAt = Date.now();
    void persistJobs();
    await attachDownloadedPdf(record);
  }

  async function pollJob(record, apiBase) {
    const deadline = Date.now() + RETAINPDF_JOB_TIMEOUT_MS;
    let lastSignature = '';

    while (!record.cancelRequested && Date.now() < deadline) {
      const detail = await getRetainPdfJob(apiBase, record.jobId);
      const snapshot = extractRetainPdfProgress(detail);
      const signature = JSON.stringify([
        snapshot.status,
        snapshot.stage,
        snapshot.stageDetail,
        snapshot.progress,
      ]);

      record.status = snapshot.status === 'queued' ? 'queued' : 'running';
      record.stage = snapshot.stage;
      record.stageDetail = snapshot.stageDetail;
      record.progress = snapshot.progress;
      record.error = snapshot.error;
      record.updatedAt = Date.now();

      if (signature !== lastSignature) {
        lastSignature = signature;
        publish(record);
        void persistJobs();
      }

      if (isTerminalSuccess(snapshot.status)) {
        await downloadAndAttach(record, apiBase);
        return;
      }
      if (isTerminalFailure(snapshot.status)) {
        throw new Error(snapshot.error || 'RetainPDF 翻译任务失败');
      }
      if (isTerminalCanceled(snapshot.status)) {
        cancelRecord(record);
        return;
      }

      await delay(RETAINPDF_POLL_INTERVAL_MS);
    }

    if (record.cancelRequested) {
      return;
    }
    throw new Error('RetainPDF 翻译任务等待超时');
  }

  async function executeJob(record, apiBase) {
    try {
      if (record.cancelRequested) {
        cancelRecord(record);
        return;
      }

      const { configPath, raw } = await readRetainPdfDesktopConfig();
      const config = normalizeRetainPdfDesktopConfig(raw);
      if (!config.ready) {
        throw new Error(`RetainPDF 配置不完整：${config.missing.join('、')}`);
      }

      const { sourcePath } = await resolvePaperPdf(record.paperId);
      record.status = 'uploading';
      record.stageDetail = '正在上传 PDF 到 RetainPDF';
      record.configPath = configPath;
      touch(record);

      const upload = await uploadRetainPdf(apiBase, sourcePath);
      const uploadId = cleanString(upload?.upload_id);
      if (!uploadId) {
        throw new Error('RetainPDF 上传响应缺少 upload_id');
      }
      if (record.cancelRequested) {
        cancelRecord(record);
        return;
      }

      record.status = 'submitting';
      record.stageDetail = '正在创建 RetainPDF 翻译任务';
      touch(record);
      const job = await createRetainPdfJob(apiBase, buildRetainPdfJobPayload(config, uploadId));
      const jobId = cleanString(job?.job_id);
      if (!jobId) {
        throw new Error('RetainPDF 创建任务响应缺少 job_id');
      }

      record.jobId = jobId;
      record.status = 'running';
      record.stage = cleanString(job?.stage ?? 'queued');
      record.stageDetail = 'RetainPDF 已接收任务';
      touch(record);

      await pollJob(record, apiBase);
    } catch (error) {
      if (record.cancelRequested) {
        cancelRecord(record);
        return;
      }
      failJob(record, error);
    }
  }

  async function resumeRecord(record) {
    try {
      const detected = await ensureRetainPdfRunning();
      if (record.status === 'downloading' || record.status === 'attaching') {
        if (record.downloadedPath && await fsp.stat(record.downloadedPath).then((stat) => stat.isFile()).catch(() => false)) {
          await attachDownloadedPdf(record);
          return;
        }
        if (record.jobId) {
          await downloadAndAttach(record, detected.apiBase);
          return;
        }
      }
      if (record.jobId) {
        await pollJob(record, detected.apiBase);
        return;
      }
      failJob(record, new Error('上次 RetainPDF 任务未完成提交，请重新发起'));
    } catch (error) {
      failJob(record, error);
    }
  }

  const ready = readJsonFile(statePath)
    .then((snapshot) => {
      const storedJobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
      for (const job of storedJobs) {
        if (!job?.paperId) {
          continue;
        }
        jobs.set(job.paperId, {
          ...job,
          stage: cleanString(job.stage),
          stageDetail: cleanString(job.stageDetail),
          error: cleanString(job.error),
        });
      }
      for (const record of jobs.values()) {
        if (RESUME_STATUSES.has(record.status)) {
          void resumeRecord(record);
        }
      }
    })
    .catch(() => {});

  async function startTranslation({ paperId }) {
    await ready;
    const targetPaperId = cleanString(paperId);
    if (!targetPaperId) {
      throw new Error('paperId is required');
    }

    const existing = jobs.get(targetPaperId);
    if (existing && isActiveStatus(existing.status)) {
      throw new Error('该文献已有 RetainPDF 翻译任务在进行');
    }

    const { paper } = await resolvePaperPdf(targetPaperId);
    const detected = await detectRetainPdf();
    if (!detected.running && !detected.executablePath) {
      throw new Error('未找到本机安装的 RetainPDF，请先安装或设置 RETAINPDF_EXE');
    }
    const { configPath, raw } = await readRetainPdfDesktopConfig();
    const config = normalizeRetainPdfDesktopConfig(raw);
    if (!config.ready) {
      throw new Error(`RetainPDF 配置不完整：${config.missing.join('、')}。请先在 RetainPDF 设置中完成配置`);
    }

    const now = Date.now();
    const record = {
      paperId: targetPaperId,
      paperTitle: cleanString(paper.title) || path.basename(findPaperPdfPath(paper) || ''),
      jobId: '',
      status: 'starting',
      stage: '',
      stageDetail: '正在启动 RetainPDF',
      progress: null,
      error: '',
      createdAt: now,
      updatedAt: now,
      attachmentId: '',
      pageCountMismatch: null,
      configPath,
      cancelRequested: false,
      attachAttempts: 0,
    };
    jobs.set(targetPaperId, record);
    publish(record);
    await persistJobs();

    void (async () => {
      try {
        const detected = await ensureRetainPdfRunning();
        await executeJob(record, detected.apiBase);
      } catch (error) {
        if (!record.cancelRequested) {
          failJob(record, error);
        }
      }
    })();

    return publicJobRecord(record);
  }

  async function cancelTranslation({ paperId }) {
    await ready;
    const record = jobs.get(cleanString(paperId));
    if (!record) {
      throw new Error('未找到该文献的 RetainPDF 翻译任务');
    }
    if (!isActiveStatus(record.status)) {
      throw new Error('该 RetainPDF 任务已经结束');
    }

    record.cancelRequested = true;
    if (record.jobId) {
      const detected = await detectRetainPdf();
      if (detected.running) {
        await cancelRetainPdfJob(detected.apiBase, record.jobId).catch(() => {});
      }
    }
    cancelRecord(record);
    return publicJobRecord(record);
  }

  async function getStatus() {
    await ready;
    const detected = await detectRetainPdf();
    let config = null;
    let configPath = '';
    try {
      const loaded = await readRetainPdfDesktopConfig();
      configPath = loaded.configPath;
      config = normalizeRetainPdfDesktopConfig(loaded.raw);
    } catch {
      config = null;
    }

    return {
      installed: Boolean(detected.executablePath),
      running: detected.running,
      apiBase: detected.apiBase,
      executablePath: detected.executablePath,
      config: publicRetainPdfConfig(config, configPath),
      jobs: [...jobs.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(publicJobRecord),
    };
  }

  async function getTranslation({ paperId }) {
    await ready;
    const record = jobs.get(cleanString(paperId));
    return record ? publicJobRecord(record) : null;
  }

  return {
    retainpdf_get_status: getStatus,
    retainpdf_start_translation: startTranslation,
    retainpdf_cancel_translation: cancelTranslation,
    retainpdf_get_translation: getTranslation,
  };
}

module.exports = {
  RETAINPDF_EVENT,
  buildRetainPdfJobPayload,
  createRetainPdfIntegration,
  detectRetainPdf,
  extractRetainPdfProgress,
  findRetainPdfExecutable,
  normalizeApiBase,
  normalizeRetainPdfDesktopConfig,
};
