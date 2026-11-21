import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildRetainPdfJobPayload,
  extractRetainPdfProgress,
  normalizeApiBase,
  normalizeRetainPdfDesktopConfig,
} = require('../electron/backend/retainPdfIntegration.cjs');

test('RetainPDF desktop config maps Paddle and translation settings into a job payload', () => {
  const config = normalizeRetainPdfDesktopConfig({
    ocrProvider: 'paddle',
    paddleToken: 'paddle-token',
    modelApiKey: 'model-key',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com/v1',
    ocrOptions: {
      paddle: {
        paddleModel: 'PaddleOCR-VL-1.6',
        paddleApiUrl: 'https://paddleocr.aistudio-app.com',
      },
    },
    translationOptions: {
      workers: 50,
      batchSize: 6,
      classifyBatchSize: 10,
      compileWorkers: 4,
      temperature: 0.2,
      topP: 0.9,
      maxRetries: 3,
      reasoningEffort: 'high',
      translationMode: 'fast',
      mathMode: 'placeholder',
    },
  });

  assert.equal(config.ready, true);
  assert.deepEqual(config.missing, []);
  assert.equal(config.provider, 'paddle');
  assert.equal(config.ocr.paddle_token, 'paddle-token');
  assert.equal(config.ocr.paddle_model, 'PaddleOCR-VL-1.6');
  assert.equal(config.translation.mode, 'fast');
  assert.equal(config.translation.math_mode, 'placeholder');
  assert.equal(config.translation.workers, 50);
  assert.equal(config.translation.batch_size, 6);
  assert.equal(config.translation.classify_batch_size, 10);
  assert.equal(config.translation.temperature, 0.2);
  assert.equal(config.translation.top_p, 0.9);
  assert.equal(config.translation.max_retries, 3);
  assert.equal(config.translation.reasoning_effort, 'high');
  assert.equal(config.render.compile_workers, 4);

  const payload = buildRetainPdfJobPayload(config, 'upload-1');
  assert.equal(payload.workflow, 'book');
  assert.deepEqual(payload.source, { upload_id: 'upload-1' });
  assert.equal(payload.ocr.provider, 'paddle');
  assert.equal(payload.ocr.page_ranges, '');
  assert.equal(payload.translation.model, 'deepseek-flash');
  assert.equal(payload.translation.api_key, 'model-key');
  assert.equal(payload.runtime.timeout_seconds, 7200);
  assert.equal(payload.render.render_mode, 'auto');
});

test('RetainPDF desktop config maps MinerU options and reports missing credentials', () => {
  const config = normalizeRetainPdfDesktopConfig({
    ocrProvider: 'mineru',
    mineruToken: 'mineru-token',
    modelApiKey: '',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com/v1',
    ocrOptions: {
      mineru: {
        modelVersion: 'vlm',
        language: 'en',
        disableFormula: true,
        disableTable: true,
      },
    },
  });

  assert.equal(config.provider, 'mineru');
  assert.equal(config.ocr.mineru_token, 'mineru-token');
  assert.equal(config.ocr.language, 'en');
  assert.equal(config.ocr.disable_formula, true);
  assert.equal(config.ocr.disable_table, true);
  assert.equal(config.ready, false);
  assert.deepEqual(config.missing, ['模型 API Key']);
  assert.throws(() => buildRetainPdfJobPayload(config, 'upload-1'), /配置不完整/);
});

test('RetainPDF job snapshots expose stage, progress, and failure details', () => {
  assert.deepEqual(
    extractRetainPdfProgress({
      data: {
        job_id: 'job-1',
        status: 'running',
        stage_snapshot: {
          stage: 'translating',
          stage_detail: '正在翻译第 3/12 批',
          progress: { current: 3, total: 12, percent: 25 },
        },
      },
    }),
    {
      jobId: 'job-1',
      status: 'running',
      stage: 'translating',
      stageDetail: '正在翻译第 3/12 批',
      progress: { current: 3, total: 12, percent: 25 },
      error: '',
    },
  );

  const failed = extractRetainPdfProgress({
    data: {
      job_id: 'job-2',
      status: 'failed',
      failure: { summary: '模型余额不足', root_cause: '402' },
    },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '模型余额不足');
});

test('RetainPDF API bases are restricted to loopback origins', () => {
  assert.equal(normalizeApiBase('http://127.0.0.1:41000/'), 'http://127.0.0.1:41000');
  assert.equal(normalizeApiBase('http://localhost:41000/'), 'http://localhost:41000');
  assert.equal(normalizeApiBase('http://[::1]:41000/'), 'http://[::1]:41000');
  assert.equal(normalizeApiBase('https://example.com:41000'), '');
  assert.equal(normalizeApiBase('http://user:pass@127.0.0.1:41000'), '');
  assert.equal(normalizeApiBase('ftp://127.0.0.1:41000'), '');
});
