/**
 * 解析结果手动编辑的持久化存储。
 *
 * 编辑不写回 MinerU 的 content_list：那里是解析产物，重新解析会整体重写，
 * 也不适合塞入用户私有内容。编辑按「解析路径」归档到应用数据目录：
 *
 *   <dataDir>/parse-edits/<sha256(规范化解析路径)>.json
 *
 * 文件只保存 blockId → { hash, text?, deleted? }，其中 hash 是原始块内容指纹。
 * 重新解析导致块内容变化时，渲染层按指纹丢弃过期编辑，不会把旧修正贴到
 * 新解析结果的其它段落上。
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/** 与 backend/utils.cleanString 同义；此处内联以避免 checkJs 拉入 utils 的存量类型问题。 */
function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const EDIT_DIR_NAME = 'parse-edits';
const EDIT_FILE_VERSION = 1;
const MAX_EDIT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_BLOCK_EDITS = 20000;
const MAX_EDIT_TEXT_LENGTH = 200000;
const BLOCK_ID_PATTERN = /^page-[1-9]\d*-block-[1-9]\d*$/;
const HASH_PATTERN = /^[0-9a-f]{8,64}$/;

function normalizeParseKey(parsePath) {
  const raw = cleanString(parsePath);
  if (!raw) throw new Error('parsePath is required');
  if (raw.length > 4096) throw new Error('parsePath is too long');
  if (raw.includes('\0')) throw new Error('parsePath contains invalid characters');

  const normalized = path.isAbsolute(raw) ? path.resolve(raw) : raw;
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function resolveParseEditDirectory(appPaths) {
  const dataDir = cleanString(appPaths?.dataDir);
  if (!dataDir) throw new Error('Application data directory is unavailable');
  return path.join(dataDir, EDIT_DIR_NAME);
}

function parseEditFilePath(appPaths, parsePath) {
  const digest = crypto.createHash('sha256').update(normalizeParseKey(parsePath), 'utf8').digest('hex');
  return path.join(resolveParseEditDirectory(appPaths), `${digest}.json`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 校验并收敛编辑表。与渲染层 `sanitizeMineruBlockEdits` 保持同一口径：
 * 非法 blockId、非法 hash、超长文本和未知字段一律丢弃，而不是整体失败。
 */
function sanitizeParseEdits(value) {
  const blocks = {};
  const dropped = [];

  if (!isPlainObject(value)) {
    return { blocks, dropped };
  }

  const entries = Object.entries(value);

  if (entries.length > MAX_BLOCK_EDITS) {
    throw new Error(`Too many block edits (max ${MAX_BLOCK_EDITS})`);
  }

  for (const [blockId, rawEdit] of entries) {
    if (!BLOCK_ID_PATTERN.test(blockId) || !isPlainObject(rawEdit)) {
      dropped.push(blockId);
      continue;
    }

    const hash = typeof rawEdit.hash === 'string' ? rawEdit.hash.trim().toLowerCase() : '';
    if (!HASH_PATTERN.test(hash)) {
      dropped.push(blockId);
      continue;
    }

    const text = typeof rawEdit.text === 'string' ? rawEdit.text : undefined;
    if (text !== undefined && text.length > MAX_EDIT_TEXT_LENGTH) {
      dropped.push(blockId);
      continue;
    }

    const deleted = rawEdit.deleted === true;
    if (!deleted && text === undefined) {
      dropped.push(blockId);
      continue;
    }

    const next = { hash };
    if (text !== undefined) next.text = text;
    if (deleted) next.deleted = true;
    blocks[blockId] = next;
  }

  return { blocks, dropped };
}

function emptyEditFile() {
  return { version: EDIT_FILE_VERSION, updatedAt: '', blocks: {} };
}

async function writeFileAtomically(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await fsp.writeFile(temporaryPath, content, 'utf8');
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readMineruParseEdits(appPaths, parsePath) {
  const filePath = parseEditFilePath(appPaths, parsePath);

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return emptyEditFile();
    }
    throw error;
  }

  if (!stat.isFile()) return emptyEditFile();
  if (stat.size > MAX_EDIT_FILE_BYTES) {
    throw new Error('Parse edit file is too large');
  }

  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    throw new Error('Parse edit file is not valid JSON');
  }

  if (!isPlainObject(parsed) || parsed.version !== EDIT_FILE_VERSION) {
    throw new Error('Parse edit file has an unsupported format');
  }

  const { blocks } = sanitizeParseEdits(parsed.blocks);

  return {
    version: EDIT_FILE_VERSION,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    blocks,
  };
}

async function writeMineruParseEdits(appPaths, parsePath, blocks) {
  if (!isPlainObject(blocks)) {
    throw new Error('blocks must be an object');
  }

  const { blocks: sanitized } = sanitizeParseEdits(blocks);
  const filePath = parseEditFilePath(appPaths, parsePath);
  const count = Object.keys(sanitized).length;

  if (count === 0) {
    await fsp.rm(filePath, { force: true });
    return { saved: true, count: 0, filePath };
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomically(
    filePath,
    `${JSON.stringify({
      version: EDIT_FILE_VERSION,
      updatedAt: new Date().toISOString(),
      blocks: sanitized,
    }, null, 2)}\n`,
  );

  return { saved: true, count, filePath };
}

function createParseEditCommands(context) {
  const { appPaths } = context;

  return {
    /**
     * @param {{ parsePath?: string }} [request]
     */
    async read_parse_edits(request = {}) {
      return readMineruParseEdits(appPaths, request.parsePath);
    },

    /**
     * @param {{ parsePath?: string, blocks?: Record<string, unknown> }} [request]
     */
    async write_parse_edits(request = {}) {
      return writeMineruParseEdits(appPaths, request.parsePath, request.blocks);
    },
  };
}

module.exports = {
  EDIT_FILE_VERSION,
  createParseEditCommands,
  parseEditFilePath,
  readMineruParseEdits,
  sanitizeParseEdits,
  writeMineruParseEdits,
};
