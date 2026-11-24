'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

// 外部元数据请求是后台增强，不应让 UI 或导入流程无限等待。
const DEFAULT_JSON_TIMEOUT_MS = 15_000;
const DEFAULT_JSON_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 64 * 1024;

function codedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function resolveLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function combineSignals(signal, timeoutMs) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.trunc(timeoutMs) : 0;
  const timeoutSignal = timeout > 0 ? AbortSignal.timeout(timeout) : null;
  if (!timeoutSignal) return { signal, timeoutSignal: null };
  if (!signal) return { signal: timeoutSignal, timeoutSignal };
  return { signal: AbortSignal.any([signal, timeoutSignal]), timeoutSignal };
}

function timeoutError(label, timeoutMs, cause) {
  return codedError('HTTP_TIMEOUT', `${label} request timed out after ${timeoutMs} ms`, cause);
}

function cancelledError(label, cause) {
  return codedError('CANCELLED', `${label} request was cancelled`, cause);
}

function tooLargeError(label, maxBytes) {
  return codedError(
    'HTTP_RESPONSE_TOO_LARGE',
    `${label} response exceeds the ${maxBytes} byte limit`,
  );
}

function mapTransferError(error, { label, timeoutMs, signal }) {
  if (error?.code) return error;
  if (error?.name === 'TimeoutError' || (error?.name === 'AbortError' && !signal?.aborted)) {
    return timeoutError(label, timeoutMs, error);
  }
  if (signal?.aborted) return cancelledError(label, error);
  return error;
}

async function fetchWithTimeout(url, { headers, timeoutMs, signal, label = 'HTTP' } = {}) {
  const combined = combineSignals(signal, timeoutMs);
  try {
    return await fetch(url, {
      ...(headers ? { headers } : {}),
      signal: combined.signal,
    });
  } catch (error) {
    if (combined.timeoutSignal?.aborted) throw timeoutError(label, timeoutMs, error);
    if (signal?.aborted) throw cancelledError(label, error);
    throw codedError(
      'HTTP_REQUEST_FAILED',
      `${label} request failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

async function readTextLimited(response, label, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLargeError(label, maxBytes);
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw tooLargeError(label, maxBytes);
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLargeError(label, maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  return Buffer.concat(chunks, total).toString('utf8');
}

/**
 * 元数据 JSON 请求：超时 + 声明长度/流式累计上限。返回解析后的对象。
 */
async function fetchJsonLimited(url, label, {
  headers,
  timeoutMs = DEFAULT_JSON_TIMEOUT_MS,
  maxBytes = DEFAULT_JSON_MAX_BYTES,
  signal,
} = {}) {
  const response = await fetchWithTimeout(url, { headers, timeoutMs, signal, label });

  let text;
  try {
    text = await readTextLimited(response, label, maxBytes);
  } catch (error) {
    throw mapTransferError(error, { label, timeoutMs, signal });
  }

  if (!response.ok) {
    throw codedError('HTTP_STATUS', `${label} HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw codedError(
      'HTTP_INVALID_JSON',
      `${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

/**
 * 流式下载到磁盘：先写同目录 partial 文件，成功后改名；超时、超限或流错误
 * 都会删除半成品，不会留下可被误当成完整 PDF 的文件。
 */
async function downloadUrlToFile(url, targetPath, {
  headers,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  maxBytes = DEFAULT_DOWNLOAD_MAX_BYTES,
  signal,
  label = 'Remote download',
} = {}) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const response = await fetchWithTimeout(url, { headers, timeoutMs, signal, label });

  if (!response.ok) {
    const text = await readTextLimited(response, label, ERROR_BODY_MAX_BYTES).catch(() => '');
    throw codedError(
      'HTTP_STATUS',
      `${label} returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
    );
  }

  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLargeError(label, maxBytes);
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw tooLargeError(label, maxBytes);
    await fsp.writeFile(targetPath, buffer);
    return { bytes: buffer.length };
  }

  const partialPath = `${targetPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.partial`;
  let handle;

  try {
    handle = await fsp.open(partialPath, 'wx', 0o600);
    const reader = response.body.getReader();
    let total = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw tooLargeError(label, maxBytes);
        }
        await handle.write(value);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }

    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(partialPath, targetPath);
    return { bytes: total };
  } catch (error) {
    throw mapTransferError(error, { label, timeoutMs, signal });
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.rm(partialPath, { force: true }).catch(() => {});
  }
}

module.exports = {
  DEFAULT_DOWNLOAD_MAX_BYTES,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_JSON_MAX_BYTES,
  DEFAULT_JSON_TIMEOUT_MS,
  downloadUrlToFile,
  fetchJsonLimited,
  resolveLimit,
};
