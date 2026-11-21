import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.PAPERQUAY_RETAINPDF_POLL_MS = '20';

const require = createRequire(import.meta.url);
const { createRetainPdfIntegration } = require('../electron/backend/retainPdfIntegration.cjs');

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response, payload) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

test('RetainPDF translation flow uploads, polls, downloads, and attaches the translated PDF', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paperquay-retainpdf-flow-'));
  const sourcePath = path.join(root, 'source.pdf');
  const configPath = path.join(root, 'desktop-config.json');
  const pdfBytes = Buffer.from(`%PDF-1.4\n${'x'.repeat(4096)}\n%%EOF\n`, 'utf8');
  await fs.writeFile(sourcePath, pdfBytes);
  await fs.writeFile(configPath, JSON.stringify({
    ocrProvider: 'paddle',
    paddleToken: 'paddle-token',
    modelApiKey: 'model-key',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com/v1',
    ocrOptions: { paddle: { paddleModel: 'PaddleOCR-VL-1.6' } },
  }));

  let jobDetailCalls = 0;
  let createdJobPayload = null;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/health') {
      sendJson(response, { code: 0, message: 'ok', data: { status: 'up' } });
      return;
    }
    if (request.headers['x-api-key'] !== 'retain-pdf-desktop') {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ code: 401, message: 'missing or invalid X-API-Key' }));
      return;
    }
    if (url.pathname === '/api/v1/uploads' && request.method === 'POST') {
      await readRequestBody(request);
      sendJson(response, { code: 0, message: 'ok', data: { upload_id: 'upload-1' } });
      return;
    }
    if (url.pathname === '/api/v1/jobs' && request.method === 'POST') {
      createdJobPayload = JSON.parse(await readRequestBody(request));
      sendJson(response, { code: 0, message: 'ok', data: { job_id: 'job-1', status: 'queued' } });
      return;
    }
    if (url.pathname === '/api/v1/jobs/job-1' && request.method === 'GET') {
      jobDetailCalls += 1;
      sendJson(response, {
        code: 0,
        message: 'ok',
        data: jobDetailCalls < 2
          ? {
              job_id: 'job-1',
              status: 'running',
              stage_snapshot: {
                stage: 'translating',
                stage_detail: '正在翻译',
                progress: { current: 1, total: 1, percent: 50 },
              },
            }
          : {
              job_id: 'job-1',
              status: 'succeeded',
              stage_snapshot: {
                stage: 'finished',
                stage_detail: '完成',
                progress: { current: 1, total: 1, percent: 100 },
              },
            },
      });
      return;
    }
    if (url.pathname === '/api/v1/jobs/job-1/pdf' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/pdf' });
      response.end(pdfBytes);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ code: 404, message: 'not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  process.env.RETAINPDF_API_BASE = `http://127.0.0.1:${address.port}`;
  process.env.RETAINPDF_DESKTOP_CONFIG_FILE = configPath;

  const paper = {
    id: 'p1',
    title: 'Test Paper',
    authors: [{ name: 'Author' }],
    year: '2026',
    attachments: [{
      id: 'a1',
      kind: 'pdf',
      storedPath: sourcePath,
      fileName: 'source.pdf',
      mimeType: 'application/pdf',
      missing: false,
    }],
    updatedAt: 1,
  };
  const settings = {
    storageDir: path.join(root, 'storage'),
    translatedPdfDir: path.join(root, 'translated'),
    fileNamingRule: '{author}_{year}_{title}',
  };
  const store = {
    getPaper: (paperId) => (paperId === paper.id ? paper : null),
    loadSettings: () => settings,
    savePaper: () => {},
    findAttachmentsByStoredPath: () => [],
  };

  try {
    const commands = createRetainPdfIntegration({
      store,
      appPaths: { dataDir: root },
    });
    const started = await commands.retainpdf_start_translation({ paperId: 'p1' });
    assert.equal(started.paperId, 'p1');

    const deadline = Date.now() + 5000;
    let job = null;
    while (Date.now() < deadline) {
      job = await commands.retainpdf_get_translation({ paperId: 'p1' });
      if (job?.status === 'attached' || job?.status === 'failed') {
        break;
      }
      await delay(25);
    }

    assert.equal(job?.status, 'attached');
    assert.equal(createdJobPayload.workflow, 'book');
    assert.equal(createdJobPayload.ocr.paddle_token, 'paddle-token');
    assert.equal(createdJobPayload.translation.api_key, 'model-key');
    assert.equal(createdJobPayload.source.upload_id, 'upload-1');

    const attachment = paper.attachments.find((item) => item.kind === 'translated-pdf');
    assert.ok(attachment);
    assert.equal(attachment.language, 'zh-CN');
    assert.equal(await fs.readFile(attachment.storedPath, 'utf8'), pdfBytes.toString('utf8'));
    assert.equal(job.jobId, 'job-1');
    assert.equal(job.attachmentId, attachment.id);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.RETAINPDF_API_BASE;
    delete process.env.RETAINPDF_DESKTOP_CONFIG_FILE;
  }
});
