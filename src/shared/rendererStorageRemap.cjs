'use strict';

const PAPER_HISTORY_KEY = 'paper-reader-paper-history-v1';
const READER_SETTINGS_KEY = 'paper-reader-settings-v3';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWindows(platform) {
  return typeof platform === 'string' && /^(?:win|windows)/i.test(platform);
}

function normalizeSeparators(value, windows) {
  return windows ? value.replace(/[\\/]/g, '\\') : value;
}

function canonicalPath(value, windows) {
  let normalized = normalizeSeparators(value, windows);
  const separator = windows ? '\\' : '/';

  while (normalized.length > 1 && normalized.endsWith(separator)) {
    if (windows && /^[a-z]:\\$/i.test(normalized)) break;
    normalized = normalized.slice(0, -1);
  }

  return windows ? normalized.toLowerCase() : normalized;
}

function createPathMapper(pathMap, rootMap, platform) {
  const windows = isWindows(platform);
  const exactPaths = new Map();
  const roots = [];

  if (isRecord(pathMap)) {
    for (const [source, target] of Object.entries(pathMap)) {
      if (source && typeof target === 'string' && target.length > 0) {
        exactPaths.set(canonicalPath(source, windows), target);
      }
    }
  }

  if (isRecord(rootMap)) {
    for (const [source, target] of Object.entries(rootMap)) {
      if (source && typeof target === 'string' && target.length > 0) {
        roots.push({
          source: canonicalPath(source, windows),
          target,
        });
      }
    }
  }

  roots.sort((left, right) => right.source.length - left.source.length);

  return (path) => {
    if (typeof path !== 'string' || path.length === 0) return path;

    const canonical = canonicalPath(path, windows);
    if (exactPaths.has(canonical)) return exactPaths.get(canonical);

    const normalized = normalizeSeparators(path, windows);
    const separator = windows ? '\\' : '/';

    for (const root of roots) {
      const matches = canonical === root.source || canonical.startsWith(
        root.source.endsWith(separator) ? root.source : `${root.source}${separator}`,
      );
      if (!matches) continue;
      if (canonical === root.source) return root.target;

      const suffix = normalized.slice(root.source.length).replace(/^[\\/]+/, '');
      if (!suffix) return root.target;

      const mappedSuffix = windows ? suffix.replace(/[\\/]/g, '\\') : suffix;
      const targetHasSeparator = /[\\/]$/.test(root.target);
      return `${root.target}${targetHasSeparator ? '' : separator}${mappedSuffix}`;
    }

    return path;
  };
}

function rewriteLocalSourceKey(sourceKey, remapPath) {
  if (typeof sourceKey !== 'string' || !sourceKey.startsWith('local:')) return sourceKey;
  const path = sourceKey.slice('local:'.length);
  const mappedPath = remapPath(path);
  return mappedPath === path ? sourceKey : `local:${mappedPath}`;
}

function rewritePaperSummarySourceKey(sourceKey, remapPath) {
  if (typeof sourceKey !== 'string') return sourceKey;

  const localPdfSignatureMarker = '::pdf-text::local:';
  const markerIndex = sourceKey.indexOf(localPdfSignatureMarker);
  if (markerIndex < 0) return rewriteLocalSourceKey(sourceKey, remapPath);

  const pathStart = markerIndex + localPdfSignatureMarker.length;
  const path = sourceKey.slice(pathStart);
  const mappedPath = remapPath(path);
  return mappedPath === path ? sourceKey : `${sourceKey.slice(0, pathStart)}${mappedPath}`;
}

function remapPathField(record, field, remapPath) {
  if (!isRecord(record) || typeof record[field] !== 'string') return false;
  const mappedPath = remapPath(record[field]);
  if (mappedPath === record[field]) return false;
  record[field] = mappedPath;
  return true;
}

function remapAttachments(messages, remapPath) {
  if (!Array.isArray(messages)) return false;

  let changed = false;
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.attachments)) continue;
    for (const attachment of message.attachments) {
      changed = remapPathField(attachment, 'filePath', remapPath) || changed;
    }
  }
  return changed;
}

function updatedAt(value) {
  return isRecord(value) && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : Number.NEGATIVE_INFINITY;
}

function remapSourceKeyMap(value, label, remapPath, warnings) {
  if (!isRecord(value)) return { value, changed: false };

  let changed = false;
  const entries = [];
  const indices = new Map();

  for (const [sourceKey, candidate] of Object.entries(value)) {
    const mappedKey = rewriteLocalSourceKey(sourceKey, remapPath);
    let mappedValue = candidate;
    if (isRecord(candidate) && typeof candidate.sourceKey === 'string') {
      const mappedValueSourceKey = rewriteLocalSourceKey(candidate.sourceKey, remapPath);
      if (mappedValueSourceKey !== candidate.sourceKey) {
        mappedValue = { ...candidate, sourceKey: mappedValueSourceKey };
        changed = true;
      }
    }

    if (mappedKey !== sourceKey) changed = true;
    if (!indices.has(mappedKey)) {
      indices.set(mappedKey, entries.length);
      entries.push([mappedKey, mappedValue]);
      continue;
    }

    warnings.push(`${label} contains source keys that map to the same restored key; the most recently updated entry was retained.`);
    changed = true;
    const index = indices.get(mappedKey);
    if (updatedAt(mappedValue) > updatedAt(entries[index][1])) {
      entries[index] = [mappedKey, mappedValue];
    }
  }

  return { value: changed ? Object.fromEntries(entries) : value, changed };
}

function remapPaperHistory(history, remapPath, hasMineruCache, warnings) {
  let changed = false;

  for (const record of Object.values(history)) {
    if (!isRecord(record)) continue;

    const document = record.document;
    changed = remapPathField(document, 'localPdfPath', remapPath) || changed;
    changed = remapPathField(document, 'translatedPdfPath', remapPath) || changed;
    changed = remapPathField(record, 'lastPdfPath', remapPath) || changed;

    if (!hasMineruCache && typeof record.lastMineruPath === 'string') {
      if (record.lastMineruPath !== '') {
        record.lastMineruPath = '';
        changed = true;
      }
    } else {
      changed = remapPathField(record, 'lastMineruPath', remapPath) || changed;
    }

    if (Array.isArray(record.qaSessions)) {
      const messages = record.qaSessions.flatMap((session) =>
        isRecord(session) && Array.isArray(session.messages) ? session.messages : [],
      );
      changed = remapAttachments(messages, remapPath) || changed;
    }
    changed = remapAttachments(record.qaMessages, remapPath) || changed;

    if (typeof record.paperSummarySourceKey === 'string') {
      const mappedKey = rewritePaperSummarySourceKey(record.paperSummarySourceKey, remapPath);
      if (mappedKey !== record.paperSummarySourceKey) {
        record.paperSummarySourceKey = mappedKey;
        changed = true;
      }
    }

    for (const field of ['pdfScrollPositions', 'pdfReadingHeatmaps']) {
      const result = remapSourceKeyMap(record[field], `${PAPER_HISTORY_KEY}.${field}`, remapPath, warnings);
      if (result.changed) {
        record[field] = result.value;
        changed = true;
      }
    }
  }

  return changed;
}

function remapSettings(settings, remapPath) {
  let changed = false;
  changed = remapPathField(settings, 'mineruCacheDir', remapPath) || changed;
  changed = remapPathField(settings, 'remotePdfDownloadDir', remapPath) || changed;
  return changed;
}

function transformJsonState(state, storageKey, transform, warnings) {
  const rawValue = state[storageKey];
  if (typeof rawValue !== 'string') return;

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    warnings.push(`${storageKey} is not valid JSON; the stored value was left unchanged.`);
    return;
  }

  if (!isRecord(parsed)) {
    warnings.push(`${storageKey} is not a JSON object; the stored value was left unchanged.`);
    return;
  }

  if (transform(parsed, warnings)) state[storageKey] = JSON.stringify(parsed);
}

function remapRendererStorage(storageRecord, options = {}) {
  const warnings = [];
  if (!isRecord(storageRecord)) {
    return { state: {}, warnings: ['Storage snapshot must be an object.'] };
  }

  const state = { ...storageRecord };
  const remapPath = createPathMapper(options.pathMap, options.rootMap, options.platform);

  transformJsonState(
    state,
    PAPER_HISTORY_KEY,
    (history, currentWarnings) => remapPaperHistory(
      history,
      remapPath,
      options.hasMineruCache === true,
      currentWarnings,
    ),
    warnings,
  );
  transformJsonState(state, READER_SETTINGS_KEY, (settings) => remapSettings(settings, remapPath), warnings);

  return { state, warnings };
}

module.exports = { remapRendererStorage };
