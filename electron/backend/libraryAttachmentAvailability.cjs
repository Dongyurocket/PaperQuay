'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * 附件文件存在性缓存。
 *
 * 附件筛选（hasPdf/hasTranslatedPdf/missingFile）需要对每个附件做 stat。
 * 筛选变化、分页、全选三态和批量目标校验都会重复触发同一批查询；不缓存时
 * 每次查询都会对整个文库做一轮 stat（stat storm）。这里用短 TTL 缓存文件
 * 存在性，并在文库写入后显式失效。
 *
 * 语义：missing 状态最多滞后 TTL；外部（资源管理器）移动文件也不会立即
 * 反映，下一次查询或显式失效后恢复。
 */
function createAttachmentAvailabilityCache(options = {}) {
  const ttlValue = Number(options.ttlMs);
  const ttlMs = Number.isFinite(ttlValue) ? Math.max(0, ttlValue) : 5000;
  const negativeValue = Number(options.negativeTtlMs ?? Math.min(ttlMs, 1500));
  const negativeTtlMs = Number.isFinite(negativeValue) ? Math.max(0, negativeValue) : Math.min(ttlMs, 1500);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const stat = typeof options.stat === 'function'
    ? options.stat
    : (filePath) => fsp.stat(filePath);
  const entries = new Map();
  const inflight = new Map();

  const isFresh = (entry, timestamp) => {
    const ttl = entry.ok ? ttlMs : negativeTtlMs;
    return timestamp - entry.at < ttl;
  };

  async function read(filePath) {
    const timestamp = now();
    const cached = entries.get(filePath);
    if (cached && isFresh(cached, timestamp)) {
      return cached.ok;
    }

    const pending = inflight.get(filePath);
    if (pending) {
      return pending;
    }

    const request = (async () => {
      let ok = false;
      try {
        ok = (await stat(filePath)).isFile();
      } catch (error) {
        // ENOENT/ENOTDIR 视为文件缺失；其他瞬时错误（权限、占用）不缓存为
        // 缺失，交给调用方按附件快照兜底。
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
          return null;
        }
      }
      entries.set(filePath, { ok, at: now() });
      return ok;
    })().finally(() => {
      inflight.delete(filePath);
    });

    inflight.set(filePath, request);
    return request;
  }

  return {
    get size() {
      return entries.size;
    },
    read,
    invalidate(paths) {
      if (!paths) {
        entries.clear();
        return;
      }
      for (const filePath of paths) {
        if (filePath) entries.delete(filePath);
      }
    },
  };
}

const defaultAttachmentAvailabilityCache = createAttachmentAvailabilityCache();

/** Resolve the same attachment location used by the library UI. */
function attachmentPath(attachment, storageDir) {
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const relative = clean(attachment.relativePath);
  const root = clean(storageDir);
  return root && relative ? path.join(root, relative) : clean(attachment.storedPath) || clean(attachment.originalPath);
}

/**
 * Attachment flags in the library are a snapshot and can become stale when files
 * are moved outside PaperQuay. Only rescan when an attachment filter is active;
 * pass the resulting ids to SQLite so count, pagination, and select-all agree.
 * Never persist this observation or treat a transient access error as deletion.
 */
async function resolveAttachmentFilters(request = {}, library, options = {}) {
  const fields = ['hasPdf', 'hasTranslatedPdf', 'missingFile'];
  if (!fields.some((field) => typeof request[field] === 'boolean')) {
    return { request, applyToPapers: (papers) => papers };
  }

  const cache = options.cache ?? defaultAttachmentAvailabilityCache;
  const papers = library.papers ?? [];
  const root = library.settings?.storageDir;
  const states = new Map();
  const attachments = papers.flatMap((paper) => paper.attachments ?? []);
  const attachmentsByPath = new Map();
  for (const attachment of attachments) {
    const filePath = attachmentPath(attachment, root);
    if (!filePath) {
      states.set(attachment, false);
      continue;
    }
    const group = attachmentsByPath.get(filePath);
    if (group) group.push(attachment);
    else attachmentsByPath.set(filePath, [attachment]);
  }

  const paths = [...attachmentsByPath.keys()];
  let next = 0;
  async function worker() {
    while (next < paths.length) {
      const filePath = paths[next++];
      const observed = await cache.read(filePath);
      const group = attachmentsByPath.get(filePath) ?? [];
      for (const attachment of group) {
        states.set(
          attachment,
          observed === null ? !attachment.missing : observed,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(32, paths.length) }, worker));

  const requestedIds = Array.isArray(request.paperIds) ? new Set(request.paperIds) : null;
  const paperIds = papers.filter((paper) => {
    if (requestedIds && !requestedIds.has(paper.id)) return false;
    const list = paper.attachments ?? [];
    const actual = {
      hasPdf: list.some((a) => a.kind === 'pdf' && states.get(a)),
      hasTranslatedPdf: list.some((a) => a.kind === 'translated-pdf' && states.get(a)),
      missingFile: list.some((a) => !states.get(a)),
    };
    return fields.every((field) => typeof request[field] !== 'boolean' || actual[field] === request[field]);
  }).map((paper) => paper.id);
  const result = { ...request, paperIds };
  for (const field of fields) delete result[field];
  const availabilityById = new Map(attachments.filter((a) => a.id).map((a) => [a.id, states.get(a)]));
  return {
    request: result,
    applyToPapers(papers) {
      return papers.map((paper) => ({
        ...paper,
        attachments: (paper.attachments ?? []).map((attachment) => availabilityById.has(attachment.id)
          ? { ...attachment, missing: !availabilityById.get(attachment.id) }
          : attachment),
      }));
    },
  };
}

async function resolveAttachmentFilterRequest(request, library, options) {
  return (await resolveAttachmentFilters(request, library, options)).request;
}

function invalidateAttachmentAvailability(paths) {
  defaultAttachmentAvailabilityCache.invalidate(paths);
}

module.exports = {
  attachmentPath,
  createAttachmentAvailabilityCache,
  defaultAttachmentAvailabilityCache,
  invalidateAttachmentAvailability,
  resolveAttachmentFilters,
  resolveAttachmentFilterRequest,
};
