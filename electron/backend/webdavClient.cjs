const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { cleanString } = require('./utils.cjs');

const DEFAULT_REQUEST_INTERVAL_MS = 200;
const JIANGUOYUN_REQUEST_INTERVAL_MS = 3100;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 750;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function splitRemotePath(value) {
  return cleanString(value)
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeRemoteRoot(value) {
  const parts = splitRemotePath(value || 'paperquay');

  if (parts.length === 0) throw new Error('WebDAV remote root cannot be empty');
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('WebDAV remote root cannot contain "." or ".."');
  }

  return parts.join('/');
}

function parentRemotePath(remotePath) {
  const parts = splitRemotePath(remotePath);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function tempUploadPath(remotePath, backupId) {
  return `${remotePath}.uploading-${encodeURIComponent(backupId)}`;
}

function toBasicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function truncateBody(text) {
  const value = cleanString(text);
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function parseRetryAfter(value, nowMs = Date.now()) {
  const normalized = cleanString(value);
  if (!normalized) return null;

  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : null;
}

function isStreamBody(value) {
  return Boolean(value && typeof value === 'object' && typeof value.pipe === 'function');
}

class WebdavRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'WebdavRequestError';
    this.method = details.method ?? '';
    this.remotePath = details.remotePath ?? '';
    this.status = details.status ?? null;
    this.responseBody = details.responseBody ?? '';
    this.attempts = details.attempts ?? 1;
    if (details.cause) this.cause = details.cause;
  }
}

class WebdavClient {
  constructor(settings, options = {}) {
    this.endpointUrl = cleanString(settings.endpointUrl).replace(/\/+$/, '');
    this.remoteRoot = normalizeRemoteRoot(settings.remoteRoot);
    this.username = cleanString(settings.username);
    this.password = String(settings.password ?? '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.maximumRetries = positiveNumber(options.maximumRetries, DEFAULT_MAX_RETRIES);
    this.retryBaseDelayMs = positiveNumber(options.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS);
    this.requestTimeoutMs = positiveNumber(options.requestTimeoutMs, 180000);
    this.maximumUploadTimeoutMs = positiveNumber(options.maximumUploadTimeoutMs, 1800000);
    this.minimumUploadBytesPerSecond = positiveNumber(
      options.minimumUploadBytesPerSecond,
      128 * 1024,
    );
    const endpointRequestInterval = /(?:jianguoyun\.com|nutstore\.net)/i.test(this.endpointUrl)
      ? JIANGUOYUN_REQUEST_INTERVAL_MS
      : DEFAULT_REQUEST_INTERVAL_MS;
    this.minimumRequestIntervalMs = positiveNumber(
      options.minimumRequestIntervalMs,
      endpointRequestInterval,
    );
    this.lastRequestStartedAt = 0;
    this.requestSchedule = Promise.resolve();
    this.knownCollections = new Set();
    this.moveSupported = null;

    if (!/^https?:\/\//i.test(this.endpointUrl)) {
      throw new Error('WebDAV endpoint must start with http:// or https://');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('WebDAV requires a Fetch API implementation');
    }
  }

  buildUrl(remotePath) {
    const parts = [...splitRemotePath(this.remoteRoot), ...splitRemotePath(remotePath)]
      .map((segment) => encodeURIComponent(segment));
    return `${this.endpointUrl}/${parts.join('/')}`;
  }

  async waitForRequestSlot() {
    const scheduled = this.requestSchedule.then(async () => {
      const elapsed = this.now() - this.lastRequestStartedAt;
      const waitMs = Math.max(0, this.minimumRequestIntervalMs - elapsed);
      if (waitMs > 0) await this.sleep(waitMs);
      this.lastRequestStartedAt = this.now();
    });

    this.requestSchedule = scheduled.catch(() => undefined);
    await scheduled;
  }

  retryDelay(response, attempt) {
    const retryAfterMs = response
      ? parseRetryAfter(response.headers.get('retry-after'), this.now())
      : null;
    if (retryAfterMs != null) return retryAfterMs;

    const exponentialDelay = this.retryBaseDelayMs * (2 ** attempt);
    const jitter = Math.floor(exponentialDelay * 0.2 * this.random());
    return exponentialDelay + jitter;
  }

  async request(method, remotePath, options = {}) {
    const headers = { ...(options.headers ?? {}) };

    if (this.username || this.password) {
      headers.Authorization = toBasicAuth(this.username, this.password);
    }

    const maximumRetries = positiveNumber(options.maximumRetries, this.maximumRetries);
    let lastError = null;

    for (let attempt = 0; attempt <= maximumRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.retryDelay(lastError?.response ?? null, attempt - 1));
      }

      await this.waitForRequestSlot();
      const body = options.bodyFactory ? options.bodyFactory() : options.body;

      try {
        const requestOptions = {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(options.timeoutMs ?? this.requestTimeoutMs),
        };
        if (isStreamBody(body)) requestOptions.duplex = 'half';

        const response = await this.fetchImpl(this.buildUrl(remotePath), requestOptions);

        if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maximumRetries) {
          lastError = { response };
          if (typeof body?.destroy === 'function') body.destroy();
          await response.arrayBuffer().catch(() => undefined);
          continue;
        }

        return response;
      } catch (error) {
        if (typeof body?.destroy === 'function') body.destroy();
        lastError = { error };
        if (attempt < maximumRetries) continue;

        const detail = error instanceof Error ? error.message : String(error);
        throw new WebdavRequestError(
          `WebDAV ${method} request failed for ${remotePath || '<root>'} after ${attempt + 1} attempt(s): ${detail}`,
          {
            method,
            remotePath,
            attempts: attempt + 1,
            cause: error,
          },
        );
      }
    }

    throw new WebdavRequestError(`WebDAV ${method} request failed for ${remotePath || '<root>'}`, {
      method,
      remotePath,
    });
  }

  async responseError(method, remotePath, response) {
    const responseBody = truncateBody(await response.text().catch(() => ''));
    const suffix = responseBody ? `: ${responseBody}` : '';
    return new WebdavRequestError(
      `WebDAV ${method} failed for ${remotePath || '<root>'}: HTTP ${response.status}${suffix}`,
      {
        method,
        remotePath,
        status: response.status,
        responseBody,
      },
    );
  }

  async ensureCollection(remotePath) {
    const normalizedPath = splitRemotePath(remotePath).join('/');
    if (this.knownCollections.has(normalizedPath)) return;

    const response = await this.request('MKCOL', normalizedPath);

    if (response.ok || response.status === 405 || response.status === 409) {
      this.knownCollections.add(normalizedPath);
      return;
    }

    throw await this.responseError('MKCOL', normalizedPath, response);
  }

  async ensureParentCollections(remotePath) {
    await this.ensureCollection('');

    const parent = parentRemotePath(remotePath);
    let current = '';

    for (const segment of splitRemotePath(parent)) {
      current = current ? `${current}/${segment}` : segment;
      await this.ensureCollection(current);
    }
  }

  async test() {
    await this.ensureCollection('');
    const response = await this.request('PROPFIND', '', { headers: { Depth: '0' } });

    if (response.ok || response.status === 207) return;
    throw await this.responseError('PROPFIND', '', response);
  }

  async head(remotePath) {
    const response = await this.request('HEAD', remotePath);

    if (response.status === 404 || response.status === 405) return null;
    if (!response.ok) throw await this.responseError('HEAD', remotePath, response);

    const length = response.headers.get('content-length');
    return length ? Number(length) : null;
  }

  async putBytes(remotePath, bytes) {
    const body = Buffer.from(bytes);
    await this.ensureParentCollections(remotePath);
    const response = await this.request('PUT', remotePath, {
      body,
      headers: {
        'Content-Length': String(body.length),
        'Content-Type': 'application/octet-stream',
      },
    });

    if (!response.ok) throw await this.responseError('PUT', remotePath, response);
  }

  async putFile(remotePath, filePath, byteSize) {
    const stat = typeof byteSize === 'number' ? null : await fsp.stat(filePath);
    const contentLength = typeof byteSize === 'number' ? byteSize : stat.size;
    const sizeBasedTimeoutMs = Math.ceil(
      (contentLength / Math.max(1, this.minimumUploadBytesPerSecond)) * 1000,
    );
    const timeoutMs = Math.min(
      this.maximumUploadTimeoutMs,
      Math.max(this.requestTimeoutMs, sizeBasedTimeoutMs),
    );
    await this.ensureParentCollections(remotePath);
    const response = await this.request('PUT', remotePath, {
      bodyFactory: () => fs.createReadStream(filePath),
      headers: {
        'Content-Length': String(contentLength),
        'Content-Type': 'application/octet-stream',
      },
      timeoutMs,
    });

    if (!response.ok) throw await this.responseError('PUT', remotePath, response);
  }

  async move(sourcePath, destinationPath) {
    const response = await this.request('MOVE', sourcePath, {
      headers: {
        Destination: this.buildUrl(destinationPath),
        Overwrite: 'T',
      },
    });

    if (!response.ok) throw await this.responseError('MOVE', sourcePath, response);
  }

  async delete(remotePath) {
    const response = await this.request('DELETE', remotePath);
    if (response.ok || response.status === 404) return;
    throw await this.responseError('DELETE', remotePath, response);
  }

  async deleteQuietly(remotePath) {
    await this.delete(remotePath).catch(() => undefined);
  }

  async atomicUpload(remotePath, backupId, upload) {
    if (this.moveSupported === false) {
      await upload(remotePath);
      return;
    }

    const temporaryPath = tempUploadPath(remotePath, backupId);
    await upload(temporaryPath);

    try {
      await this.move(temporaryPath, remotePath);
      this.moveSupported = true;
    } catch (error) {
      const moveUnsupported =
        error instanceof WebdavRequestError &&
        (error.status === 405 || error.status === 501);

      await this.deleteQuietly(temporaryPath);
      if (!moveUnsupported) throw error;

      this.moveSupported = false;
      await upload(remotePath);
    }
  }

  async atomicUploadBytes(remotePath, backupId, bytes) {
    const body = Buffer.from(bytes);
    await this.atomicUpload(remotePath, backupId, (targetPath) => this.putBytes(targetPath, body));
  }

  async atomicUploadFile(remotePath, backupId, filePath, byteSize) {
    await this.atomicUpload(
      remotePath,
      backupId,
      (targetPath) => this.putFile(targetPath, filePath, byteSize),
    );
  }

  async getBytes(remotePath) {
    const response = await this.request('GET', remotePath);

    if (response.status === 404) return null;
    if (!response.ok) throw await this.responseError('GET', remotePath, response);

    return Buffer.from(await response.arrayBuffer());
  }

  async getText(remotePath) {
    const bytes = await this.getBytes(remotePath);
    return bytes ? bytes.toString('utf8') : null;
  }
}

module.exports = {
  WebdavClient,
  WebdavRequestError,
  normalizeRemoteRoot,
  parentRemotePath,
  parseRetryAfter,
  splitRemotePath,
};
