const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_BASENAME_LENGTH = 100;
const WINDOWS_RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function sanitizeSegment(value, fallback) {
  let result = String(value ?? '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/_+/g, '_');
  if (!result || result === '.' || result === '..') result = fallback;
  if (WINDOWS_RESERVED_NAME.test(result)) result = `_${result}`;
  return result;
}

function shortId(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 8);
}

function buildPdfAssetFileName({ author, institution, year, title, role = 'original', language, stableId, fileNamingRule }) {
  const who = Array.from(sanitizeSegment(author || institution, 'Unknown')).slice(0, 28).join('');
  const date = sanitizeSegment(String(year ?? '').match(/\d{4}/)?.[0], 'nodate');
  const kind = Array.from(role === 'translated'
    ? `translated-${sanitizeSegment(language || 'und', 'und')}`
    : sanitizeSegment(role, 'other')).slice(0, 24).join('');
  const suffix = shortId(stableId || `${who}:${date}:${title}:${kind}`);
  const ending = `__${kind}__${suffix}.pdf`;
  const ruleParts = {
    author: who,
    institution: Array.from(sanitizeSegment(institution || author, 'Unknown')).slice(0, 28).join(''),
    year: date,
    title: sanitizeSegment(title, 'Document'),
    role: kind,
    language: sanitizeSegment(language || 'und', 'und'),
  };
  const template = typeof fileNamingRule === 'string' && fileNamingRule.trim()
    ? fileNamingRule.trim()
    : '{author}_{year}_{title}';
  const customPrefix = template.replace(/\{(author|institution|year|title|role|language)\}/g, (_match, key) => ruleParts[key]);
  const unresolved = customPrefix.match(/\{[^}]+\}/);
  if (unresolved) throw new Error(`Unsupported PDF naming placeholder: ${unresolved[0]}`);
  const available = Math.max(1, MAX_BASENAME_LENGTH - ending.length);
  const base = Array.from(sanitizeSegment(customPrefix, 'Document')).slice(0, available).join('');
  return `${base}${ending}`;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = require('node:fs').createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function inspectPdfAssets(library) {
  const entries = [];
  for (const paper of library.papers ?? []) {
    for (const attachment of paper.attachments ?? []) {
      const entry = {
        paperId: paper.id,
        paperTitle: paper.title,
        attachmentId: attachment.id,
        role: attachment.kind === 'translated-pdf' ? 'translated' : attachment.kind,
        path: attachment.storedPath,
        ownership: isManagedPath(attachment.storedPath, library.settings),
        expectedHash: attachment.contentHash ?? null,
        status: 'unknown',
        byteLength: null,
        sha256: null,
      };
      try {
        const stat = await fsp.stat(attachment.storedPath);
        if (!stat.isFile()) throw new Error('Not a regular file');
        entry.byteLength = stat.size;
        entry.sha256 = await hashFile(attachment.storedPath);
        entry.status = entry.expectedHash && entry.expectedHash !== entry.sha256 ? 'hash-mismatch' : 'verified';
      } catch (error) {
        entry.status = error?.code === 'ENOENT' ? 'missing' : 'unreadable';
      }
      entries.push(entry);
    }
  }

  const groups = new Map();
  for (const entry of entries) {
    if (entry.status !== 'verified' || !entry.sha256) continue;
    const key = `${entry.byteLength}:${entry.sha256}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const duplicates = [...groups.values()].filter((group) => group.length > 1);
  return {
    createdAt: Date.now(),
    attachmentCount: entries.length,
    verifiedCount: entries.filter((entry) => entry.status === 'verified').length,
    missingCount: entries.filter((entry) => entry.status === 'missing').length,
    unreadableCount: entries.filter((entry) => entry.status === 'unreadable').length,
    hashMismatchCount: entries.filter((entry) => entry.status === 'hash-mismatch').length,
    uniqueVerifiedAssetCount: groups.size,
    duplicateGroups: duplicates,
    entries,
  };
}

function isManagedPath(filePath, settings = {}) {
  const resolved = path.resolve(String(filePath ?? ''));
  const roots = [settings.storageDir, settings.translatedPdfDir]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => path.resolve(value));
  return roots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  });
}

async function isRealManagedFilePath(filePath, settings = {}) {
  try {
    const realFile = await fsp.realpath(filePath);
    const roots = [settings.storageDir, settings.translatedPdfDir]
      .filter((value) => typeof value === 'string' && value.trim());
    for (const root of roots) {
      let realRoot;
      try {
        realRoot = await fsp.realpath(root);
      } catch {
        continue;
      }
      const relative = path.relative(realRoot, realFile);
      if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
        return true;
      }
    }
  } catch {}
  return false;
}

function planPdfAssetNames(library) {
  return (library.papers ?? []).flatMap((paper) => (paper.attachments ?? []).map((attachment) => {
    const authors = (paper.authors ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const proposedName = buildPdfAssetFileName({
      author: authors[0]?.name,
      institution: paper.institution || paper.publisher,
      year: paper.year,
      title: paper.title,
      role: attachment.kind === 'translated-pdf' ? 'translated' : 'original',
      language: attachment.language,
      stableId: attachment.id,
      fileNamingRule: library.settings?.fileNamingRule,
    });
    return {
      paperId: paper.id,
      attachmentId: attachment.id,
      role: attachment.kind === 'translated-pdf' ? 'translated' : attachment.kind,
      currentPath: attachment.storedPath,
      proposedPath: path.join(path.dirname(attachment.storedPath), proposedName),
      contentHash: attachment.contentHash ?? null,
      action: attachment.storedPath && path.basename(attachment.storedPath) === proposedName ? 'unchanged' : 'rename-preview',
      ownership: isManagedPath(attachment.storedPath, library.settings),
    };
  }));
}

module.exports = {
  buildPdfAssetFileName,
  inspectPdfAssets,
  isManagedPath,
  isRealManagedFilePath,
  planPdfAssetNames,
};
