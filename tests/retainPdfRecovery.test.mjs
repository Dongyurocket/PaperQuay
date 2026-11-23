import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createRetainPdfIntegration,
  isStaleActiveRecord,
} = require('../electron/backend/retainPdfIntegration.cjs');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// 隔离本机可能安装的 RetainPDF：否则 detectRetainPdf 会读取真实的
// %APPDATA%\retain-pdf-desktop 并让测试结果依赖机器状态。
const ISOLATED_ROOT = path.join(os.tmpdir(), 'paperquay-retainpdf-isolated');
process.env.APPDATA = path.join(ISOLATED_ROOT, 'appdata');
process.env.LOCALAPPDATA = path.join(ISOLATED_ROOT, 'localappdata');
process.env.ProgramFiles = path.join(ISOLATED_ROOT, 'programfiles');
process.env['ProgramFiles(x86)'] = path.join(ISOLATED_ROOT, 'programfiles-x86');
process.env.RETAINPDF_USER_DATA_DIR = path.join(ISOLATED_ROOT, 'userdata');
process.env.RETAINPDF_RUNTIME_PORTS_FILE = path.join(ISOLATED_ROOT, 'runtime-ports.json');
process.env.RETAINPDF_EXE = path.join(ISOLATED_ROOT, 'missing-retainpdf.exe');

function jobRecord(overrides) {
  const now = Date.now();
  return {
    paperId: 'paper-1',
    paperTitle: 'Paper',
    jobId: '',
    status: 'starting',
    stage: '',
    stageDetail: '',
    progress: null,
    error: '',
    createdAt: now,
    updatedAt: now,
    attachmentId: '',
    pageCountMismatch: null,
    configPath: '',
    cancelRequested: false,
    attachAttempts: 0,
    ...overrides,
  };
}

test('starting/uploading records go stale quickly; running records use the six-hour timeout', () => {
  const now = Date.now();

  assert.equal(isStaleActiveRecord(jobRecord({ status: 'starting', updatedAt: now - 9 * MINUTE }), now), false);
  assert.equal(isStaleActiveRecord(jobRecord({ status: 'starting', updatedAt: now - 11 * MINUTE }), now), true);
  assert.equal(isStaleActiveRecord(jobRecord({ status: 'uploading', updatedAt: now - 11 * MINUTE }), now), true);
  assert.equal(isStaleActiveRecord(jobRecord({ status: 'running', updatedAt: now - HOUR }), now), false);
  assert.equal(isStaleActiveRecord(jobRecord({ status: 'running', updatedAt: now - 7 * HOUR }), now), true);
  assert.equal(isStaleActiveRecord(jobRecord({ status: 'failed', updatedAt: now - 7 * HOUR }), now), false);
  assert.equal(isStaleActiveRecord(jobRecord({ status: 'starting', updatedAt: 0, createdAt: 0 }), now), true);
});

test('a restart converts orphan starting/uploading records into retryable failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-retainpdf-recovery-'));
  const now = Date.now();

  await fs.writeFile(
    path.join(root, '.retainpdf-jobs.json'),
    JSON.stringify({
      version: 1,
      jobs: [
        jobRecord({ paperId: 'stale-start', status: 'starting', updatedAt: now - 2 * MINUTE }),
        jobRecord({ paperId: 'stale-upload', status: 'uploading', updatedAt: now - 2 * MINUTE }),
        jobRecord({ paperId: 'stale-running', status: 'running', updatedAt: now - 7 * HOUR }),
      ],
    }),
    'utf8',
  );

  const integration = createRetainPdfIntegration({
    appPaths: { dataDir: root },
    store: { getPaper: () => null },
  });

  try {
    const status = await integration.retainpdf_get_status();
    const byId = new Map(status.jobs.map((job) => [job.paperId, job]));

    assert.equal(byId.get('stale-start')?.status, 'failed');
    assert.match(byId.get('stale-start')?.error ?? '', /启动\/上传阶段中断/);
    assert.equal(byId.get('stale-upload')?.status, 'failed');
    assert.equal(byId.get('stale-running')?.status, 'failed');
    assert.match(byId.get('stale-running')?.error ?? '', /超时中断/);
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('a stale active record no longer reports "already running" when translation is restarted', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-retainpdf-retry-'));
  const pdfPath = path.join(root, 'source.pdf');
  await fs.writeFile(pdfPath, '%PDF-1.4\n%%EOF\n');

  await fs.writeFile(
    path.join(root, '.retainpdf-jobs.json'),
    JSON.stringify({
      version: 1,
      jobs: [jobRecord({ paperId: 'paper-1', status: 'starting', updatedAt: Date.now() - 2 * MINUTE })],
    }),
    'utf8',
  );

  const integration = createRetainPdfIntegration({
    appPaths: { dataDir: root },
    store: {
      getPaper: () => ({
        id: 'paper-1',
        title: 'Paper',
        attachments: [{ id: 'att-1', kind: 'pdf', storedPath: pdfPath, missing: false }],
      }),
    },
  });

  try {
    await assert.rejects(
      integration.retainpdf_start_translation({ paperId: 'paper-1' }),
      (error) => !/已有 RetainPDF 翻译任务/.test(String(error?.message ?? '')),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
