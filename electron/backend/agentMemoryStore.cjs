const fs = require('node:fs');
const path = require('node:path');

const MEMORY_FILE_KEYS = new Set(['trace', 'topics', 'synthesis']);
const MAX_MEMORY_CONTENT_CHARS = 2_000_000;
const MAX_TRACE_BYTES = 8 * 1024 * 1024;
const SENSITIVE_KEY = /(?:api[_-]?key|authorization|token|password|secret|dataurl|attachment)/i;

function normalizeDate(value) {
  const date = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

function normalizeFileKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';

  if (!MEMORY_FILE_KEYS.has(key)) {
    throw new Error(`Unsupported agent memory file: ${key || '(empty)'}`);
  }

  return key;
}

function redact(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.startsWith('data:') ? '[redacted]' : value.slice(0, 4096);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => redact(item, '', depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, 64)) {
      output[entryKey] = redact(entryValue, entryKey, depth + 1);
    }
    return output;
  }
  return String(value).slice(0, 4096);
}

function fileInfo(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      exists: stat.isFile(),
      size: stat.isFile() ? stat.size : 0,
      modifiedAt: stat.isFile() ? stat.mtimeMs : null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, size: 0, modifiedAt: null };
    }
    throw error;
  }
}

function createAgentMemoryStore(appPaths) {
  const memoryDir = appPaths?.agentMemoryDir || path.join(appPaths?.dataDir || '', 'agent-memory');

  if (!memoryDir) {
    throw new Error('agentMemoryDir is required');
  }

  const traceDir = path.join(memoryDir, 'trace');

  function ensureDirectories() {
    fs.mkdirSync(traceDir, { recursive: true });
  }

  function resolvePath(file, date) {
    const key = normalizeFileKey(file);

    if (key === 'trace') {
      return path.join(traceDir, `${normalizeDate(date)}.jsonl`);
    }

    return path.join(memoryDir, key === 'topics' ? 'L2-topics.md' : 'L3-synthesis.md');
  }

  function readMemory(request = {}) {
    const file = normalizeFileKey(request.file);
    const date = file === 'trace' ? normalizeDate(request.date) : null;
    const filePath = resolvePath(file, date);
    const info = fileInfo(filePath);
    const content = info.exists ? fs.readFileSync(filePath, 'utf8') : '';

    return {
      file,
      date,
      content,
      ...info,
    };
  }

  function writeMemory(request = {}) {
    const file = normalizeFileKey(request.file);
    const date = file === 'trace' ? normalizeDate(request.date) : null;
    const content = typeof request.content === 'string' ? request.content : String(request.content ?? '');
    const maxChars = file === 'trace' ? MAX_TRACE_BYTES : MAX_MEMORY_CONTENT_CHARS;
    const contentSize = file === 'trace' ? Buffer.byteLength(content) : content.length;

    if (contentSize > maxChars) {
      throw new Error(`Agent memory content exceeds the ${maxChars} character limit`);
    }

    const filePath = resolvePath(file, date);
    ensureDirectories();
    fs.writeFileSync(filePath, content, 'utf8');

    return readMemory({ file, date: date ?? undefined });
  }

  function clearMemory(request = {}) {
    return writeMemory({ ...request, content: '' });
  }

  function appendTrace(event) {
    const date = normalizeDate(event?.date || new Date(Number(event?.ts) || Date.now()).toISOString().slice(0, 10));
    const filePath = resolvePath('trace', date);
    ensureDirectories();
    const info = fileInfo(filePath);

    if (info.size >= MAX_TRACE_BYTES) {
      throw new Error('Agent memory trace reached its daily size limit');
    }

    const record = redact({
      ts: Number(event?.ts) || Date.now(),
      runId: typeof event?.runId === 'string' ? event.runId : '',
      kind: typeof event?.kind === 'string' ? event.kind : '',
      payload: event?.payload ?? {},
    });
    const line = `${JSON.stringify(record)}\n`;

    if (info.size + Buffer.byteLength(line) > MAX_TRACE_BYTES) {
      throw new Error('Agent memory trace would exceed its daily size limit');
    }

    fs.appendFileSync(filePath, line, 'utf8');
    return readMemory({ file: 'trace', date });
  }

  function listMemory(request = {}) {
    const date = normalizeDate(request.date);

    return [
      { file: 'trace', date, ...fileInfo(resolvePath('trace', date)) },
      { file: 'topics', date: null, ...fileInfo(resolvePath('topics')) },
      { file: 'synthesis', date: null, ...fileInfo(resolvePath('synthesis')) },
    ];
  }

  return {
    appendTrace,
    clearMemory,
    listMemory,
    readMemory,
    writeMemory,
  };
}

module.exports = { createAgentMemoryStore };
