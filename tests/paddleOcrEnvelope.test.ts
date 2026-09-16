import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import test from 'node:test';

// @ts-ignore
import {
  PADDLE_OCR_DEFAULT_BASE_URL,
  describePaddleFailure,
  pickPaddleErrorCode,
  pickPaddleMessage,
  resolvePaddleApiBaseUrl,
  submitPaddleOcrJob,
} from '../electron/backend/paddleOcrCommands.cjs';

/**
 * 这些响应体是 2026-09-16 对 https://paddleocr.aistudio-app.com 实测抓到的真实形状。
 *
 * 关键事实：异步 Jobs API 的错误信封用 `code` / `msg`，
 * 而官方同步服务文档写的是 `errorCode` / `errorMsg` —— 依赖后者会把成功的提交判成失败。
 */
const REAL_UNAUTHORIZED_BODY = '{"traceId":"f952a5c8-b38c-4f71-a6bd-23473a224ab1","code":401,"msg":"Unauthorized"}';
const REAL_NOT_FOUND_BODY =
  '{"timestamp":"2026-09-16 23:19:57","status":404,"error":"Not Found","path":"/api/v2/ocr/jobs/api/v2/ocr/jobs"}';

test('resolvePaddleApiBaseUrl tolerates the full job URL pasted from the console', () => {
  assert.equal(resolvePaddleApiBaseUrl(''), PADDLE_OCR_DEFAULT_BASE_URL);
  assert.equal(resolvePaddleApiBaseUrl('   '), PADDLE_OCR_DEFAULT_BASE_URL);
  assert.equal(
    resolvePaddleApiBaseUrl('https://paddleocr.aistudio-app.com'),
    'https://paddleocr.aistudio-app.com',
  );
  assert.equal(
    resolvePaddleApiBaseUrl('https://paddleocr.aistudio-app.com/'),
    'https://paddleocr.aistudio-app.com',
  );
  // 控制台给出的 API_URL 是完整作业地址，整段粘进来也必须能用
  assert.equal(
    resolvePaddleApiBaseUrl('https://paddleocr.aistudio-app.com/api/v2/ocr/jobs'),
    'https://paddleocr.aistudio-app.com',
  );
  assert.equal(
    resolvePaddleApiBaseUrl('https://paddleocr.aistudio-app.com/api/v2/ocr'),
    'https://paddleocr.aistudio-app.com',
  );
});

test('describePaddleFailure surfaces the real code/msg/traceId instead of undefined', () => {
  const message = describePaddleFailure({
    label: 'PaddleOCR-VL 任务提交失败',
    status: 401,
    statusText: 'Unauthorized',
    payload: JSON.parse(REAL_UNAUTHORIZED_BODY),
    text: REAL_UNAUTHORIZED_BODY,
  });

  assert.ok(message.includes('HTTP 401'));
  assert.ok(message.includes('code=401'));
  assert.ok(message.includes('Unauthorized'));
  assert.ok(message.includes('traceId=f952a5c8-b38c-4f71-a6bd-23473a224ab1'));
  assert.ok(message.includes('Token 无效或已过期'));
  // 旧实现的症状就是这串 undefined，不能回归
  assert.equal(message.includes('undefined'), false);
});

test('describePaddleFailure gives a path hint for the Spring 404 body', () => {
  const message = describePaddleFailure({
    label: 'PaddleOCR-VL 任务提交失败',
    status: 404,
    statusText: 'Not Found',
    payload: JSON.parse(REAL_NOT_FOUND_BODY),
    text: REAL_NOT_FOUND_BODY,
  });

  assert.ok(message.includes('HTTP 404'));
  assert.ok(message.includes('不要包含 /api/v2/ocr/jobs'));
});

test('describePaddleFailure falls back to a raw body snippet for unknown envelopes', () => {
  const message = describePaddleFailure({
    label: 'PaddleOCR-VL 任务提交失败',
    status: 200,
    statusText: 'OK',
    payload: { something: 'unexpected' },
    text: '<html>gateway error</html>',
  });

  assert.ok(message.includes('原始响应'));
  assert.ok(message.includes('gateway error'));
});

test('envelope field probing accepts both the async and the documented naming', () => {
  assert.equal(pickPaddleErrorCode({ code: 401 }), 401);
  assert.equal(pickPaddleErrorCode({ errorCode: 401 }), 401);
  assert.equal(pickPaddleErrorCode({ errorCode: '401' }), '401');
  // 成功码不能被当成错误
  assert.equal(pickPaddleErrorCode({ code: 0 }), null);
  assert.equal(pickPaddleErrorCode({ errorCode: 0 }), null);
  assert.equal(pickPaddleErrorCode({ errorCode: '0' }), null);
  assert.equal(pickPaddleErrorCode(null), null);

  assert.equal(pickPaddleMessage({ msg: 'Unauthorized' }), 'Unauthorized');
  assert.equal(pickPaddleMessage({ errorMsg: 'boom' }), 'boom');
  assert.equal(pickPaddleMessage({ message: 'boom' }), 'boom');
  assert.equal(pickPaddleMessage({}), '');
});

test('submitPaddleOcrJob treats a jobId as success even without errorCode', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-paddle-submit-'));
  const pdfPath = path.join(tmpDir, 'sample.pdf');
  await fsp.writeFile(pdfPath, Buffer.from('%PDF-1.4\n%%EOF'));

  const originalFetch = globalThis.fetch;
  const seen: string[] = [];

  try {
    // 真实的成功信封不保证带 errorCode —— 旧实现会在这里抛「errorCode=undefined」
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ traceId: 't-1', code: 0, msg: 'success', data: { jobId: 'job-123' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const jobId = await submitPaddleOcrJob({
      apiBaseUrl: 'https://paddleocr.aistudio-app.com',
      token: 'token',
      pdfPath,
      fileName: 'sample.pdf',
      model: 'PaddleOCR-VL-1.6',
      options: {},
    });

    assert.equal(jobId, 'job-123');
    assert.deepEqual(seen, ['https://paddleocr.aistudio-app.com/api/v2/ocr/jobs']);
  } finally {
    globalThis.fetch = originalFetch;
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

test('submitPaddleOcrJob reports an actionable error for a 401 envelope', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-paddle-401-'));
  const pdfPath = path.join(tmpDir, 'sample.pdf');
  await fsp.writeFile(pdfPath, Buffer.from('%PDF-1.4\n%%EOF'));

  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(REAL_UNAUTHORIZED_BODY, {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(
      () =>
        submitPaddleOcrJob({
          apiBaseUrl: 'https://paddleocr.aistudio-app.com',
          token: 'bad-token',
          pdfPath,
          fileName: 'sample.pdf',
          model: 'PaddleOCR-VL-1.6',
          options: {},
        }),
      (error: Error) => {
        assert.ok(error.message.includes('HTTP 401'));
        assert.ok(error.message.includes('code=401'));
        assert.equal(error.message.includes('undefined'), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});
