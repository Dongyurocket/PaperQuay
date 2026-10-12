const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  cleanString,
  ensureFile,
  fileNameFromPath,
  hashBytes,
  id,
  isPdf,
  now,
  safeFileName,
} = require('./utils.cjs');

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function isSubPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveTranslatedPdfStorageDir(settings, appPaths) {
  const custom = cleanString(settings?.translatedPdfDir);
  if (custom) {
    return path.resolve(custom);
  }

  const base = cleanString(settings?.storageDir) || path.join(appPaths.dataDir, 'paperquay-data');
  return path.join(base, 'translated-pdfs');
}

function storageDirFor(settings, appPaths) {
  return cleanString(settings?.storageDir) || path.join(appPaths.dataDir, 'paperquay-data');
}

function canDeleteOwnedFile(listAttachmentsByStoredPath, attachment, allowedDirs) {
  if (!attachment?.storedPath) {
    return false;
  }

  const dirs = (Array.isArray(allowedDirs) ? allowedDirs : [allowedDirs])
    .map(cleanString)
    .filter(Boolean);
  if (!dirs.some((dir) => isSubPath(dir, attachment.storedPath))) {
    return false;
  }

  const others = typeof listAttachmentsByStoredPath === 'function'
    ? listAttachmentsByStoredPath(attachment.storedPath)
    : [];
  return !(Array.isArray(others) ? others : [])
    .some((other) => other.id !== attachment.id && isSamePath(other.storedPath, attachment.storedPath));
}

async function cleanupReplacedAttachments(replaced, storedPath, allowedDirs, listAttachmentsByStoredPath) {
  for (const attachment of replaced) {
    if (
      attachment?.storedPath &&
      !isSamePath(attachment.storedPath, storedPath) &&
      canDeleteOwnedFile(listAttachmentsByStoredPath, attachment, allowedDirs)
    ) {
      await fsp.rm(attachment.storedPath, { force: true }).catch(() => {});
    }
  }
}

async function readPdfPageCount(filePath) {
  try {
    const { PDFDocument } = require('pdf-lib');
    const bytes = await fsp.readFile(filePath);
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const count = document.getPageCount();
    return Number.isInteger(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}

async function compareTranslatedPdfPageCounts(paper, translatedPath) {
  const original = (paper?.attachments || []).find((attachment) =>
    attachment?.kind === 'pdf' && cleanString(attachment.storedPath) && attachment.missing !== true,
  );
  if (!original?.storedPath) {
    return null;
  }

  const [originalCount, translatedCount] = await Promise.all([
    readPdfPageCount(original.storedPath),
    readPdfPageCount(translatedPath),
  ]);
  if (!originalCount || !translatedCount || originalCount === translatedCount) {
    return null;
  }

  return { original: originalCount, translated: translatedCount };
}

async function addTranslatedPdfAttachment({
  paper,
  sourcePath,
  kind = 'translated-pdf',
  settings,
  appPaths,
  persist,
  listAttachmentsByStoredPath,
}) {
  if (!paper) throw new Error('Paper does not exist');

  const cleanSource = cleanString(sourcePath);
  const attachmentKind = cleanString(kind) || 'translated-pdf';
  if (!cleanSource) throw new Error('Missing source path');
  if (attachmentKind !== 'translated-pdf') throw new Error('Only translated-pdf attachments are supported');
  if (!isPdf(cleanSource)) throw new Error('Only PDF files can be attached');
  await ensureFile(cleanSource);

  const storageDir = storageDirFor(settings, appPaths);
  const targetDir = resolveTranslatedPdfStorageDir(settings, appPaths);
  await fsp.mkdir(targetDir, { recursive: true });

  const bytes = await fsp.readFile(cleanSource);
  const contentHash = hashBytes(bytes);
  const fileName = safeFileName(fileNameFromPath(cleanSource));
  const attachmentId = id('att');
  const storedPath = path.join(targetDir, `${paper.id}-translated-${attachmentId}-${fileName}`);
  const replaced = (paper.attachments || []).filter((attachment) => attachment.kind === attachmentKind);
  const copiedToLibrary = !isSamePath(cleanSource, storedPath);
  const pageCountMismatch = await compareTranslatedPdfPageCounts(paper, cleanSource);
  const previousAttachments = paper.attachments;
  const previousUpdatedAt = paper.updatedAt;

  try {
    if (copiedToLibrary) {
      await fsp.copyFile(cleanSource, storedPath);
    }
    const stat = await fsp.stat(storedPath);
    const attachment = {
      id: attachmentId,
      paperId: paper.id,
      kind: attachmentKind,
      originalPath: cleanSource,
      storedPath,
      relativePath: isSubPath(storageDir, storedPath)
        ? path.relative(storageDir, storedPath).replace(/\\/g, '/')
        : null,
      fileName,
      mimeType: 'application/pdf',
      fileSize: stat.size,
      contentHash,
      createdAt: now(),
      missing: false,
    };

    paper.attachments = (paper.attachments || []).filter((item) => item.kind !== attachmentKind);
    paper.attachments.push(attachment);
    paper.updatedAt = now();
    await persist();
    await cleanupReplacedAttachments(
      replaced,
      storedPath,
      [storageDir, targetDir],
      listAttachmentsByStoredPath,
    );

    return {
      attachment,
      replaced: replaced.length > 0,
      pageCountMismatch,
    };
  } catch (error) {
    paper.attachments = previousAttachments;
    paper.updatedAt = previousUpdatedAt;
    if (copiedToLibrary) {
      await fsp.rm(storedPath, { force: true }).catch(() => {});
    }
    throw error;
  }
}

async function removeTranslatedPdfAttachment({
  paper,
  attachmentId,
  deleteFile = true,
  settings,
  appPaths,
  persist,
  listAttachmentsByStoredPath,
}) {
  if (!paper) throw new Error('Attachment does not exist');

  const attachment = (paper.attachments || []).find((item) => item.id === attachmentId);
  if (!attachment) throw new Error('Attachment does not exist');
  if (attachment.kind !== 'translated-pdf') {
    throw new Error('Only translated-pdf attachments can be removed');
  }

  const previousAttachments = paper.attachments;
  const previousUpdatedAt = paper.updatedAt;
  paper.attachments = paper.attachments.filter((item) => item.id !== attachmentId);
  paper.updatedAt = now();

  try {
    await persist();
  } catch (error) {
    paper.attachments = previousAttachments;
    paper.updatedAt = previousUpdatedAt;
    throw error;
  }

  const storageDir = storageDirFor(settings, appPaths);
  const targetDir = resolveTranslatedPdfStorageDir(settings, appPaths);
  if (
    deleteFile !== false &&
    canDeleteOwnedFile(listAttachmentsByStoredPath, attachment, [storageDir, targetDir])
  ) {
    await fsp.rm(attachment.storedPath, { force: true }).catch(() => {});
  }

  return { attachment };
}

module.exports = {
  addTranslatedPdfAttachment,
  compareTranslatedPdfPageCounts,
  readPdfPageCount,
  removeTranslatedPdfAttachment,
  resolveTranslatedPdfStorageDir,
};
