'use strict';

/**
 * Shared library domain rules used by the desktop IPC commands and the MCP
 * service. Keeping duplicate detection, PDF naming, metadata patches, and the
 * imported-paper record in one place prevents the two write paths from drifting.
 */

const path = require('node:path');
const { buildPdfAssetFileName } = require('../backend/pdfAssetGovernance.cjs');
const { UPDATABLE_PAPER_FIELDS } = require('../backend/paperMetadataFields.cjs');
const {
  canonicalizeBcp47Language,
  normalizeCitationKey,
} = require('../backend/metadataValidation.cjs');
const { normalizeAuthor, normalizeTag } = require('../backend/libraryStore.cjs');
const { now, safeFileName } = require('../backend/utils.cjs');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Strip DOI resolver prefixes and compare case-insensitively. */
function normalizeDoi(value) {
  return cleanString(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim()
    .toLowerCase();
}

/** Normalize a title for duplicate matching (`&` -> `and`, punctuation -> space). */
function normalizeTitleForDuplicate(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Duplicate detection shared by desktop import and MCP import.
 * Priority: content hash, then normalized DOI, then normalized title.
 *
 * @returns {{ paper: object, reason: 'content-hash' | 'doi' | 'title' } | null}
 */
function findDuplicatePaper({ papers, contentHash, doi, title } = {}) {
  const list = Array.isArray(papers) ? papers : [];
  const hash = cleanString(contentHash);
  const normalizedDoi = normalizeDoi(doi);
  const normalizedTitle = normalizeTitleForDuplicate(title);

  if (hash) {
    for (const paper of list) {
      if ((paper.attachments ?? []).some((attachment) => attachment?.contentHash === hash)) {
        return { paper, reason: 'content-hash' };
      }
    }
  }

  if (normalizedDoi) {
    for (const paper of list) {
      if (normalizeDoi(paper.doi) === normalizedDoi) {
        return { paper, reason: 'doi' };
      }
    }
  }

  if (normalizedTitle) {
    for (const paper of list) {
      if (normalizeTitleForDuplicate(paper.title) === normalizedTitle) {
        return { paper, reason: 'title' };
      }
    }
  }

  return null;
}

/**
 * Reproduce the desktop attachment naming rule:
 * - `autoRenameFiles === false` -> `${paperId}-${fileName}`
 * - otherwise -> `buildPdfAssetFileName` with the configured naming rule.
 */
function buildImportedAttachmentFileName({ settings, paperId, attachmentId, fileName, metadata } = {}) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const originalFileName = safeFileName(cleanString(fileName));
  const effectiveSettings = settings && typeof settings === 'object' ? settings : {};

  if (effectiveSettings.autoRenameFiles === false) {
    return `${paperId}-${originalFileName}`;
  }

  const firstAuthor = Array.isArray(meta.authors) ? meta.authors[0] : '';
  const author = typeof firstAuthor === 'string' ? firstAuthor : firstAuthor?.name || '';

  return buildPdfAssetFileName({
    author,
    institution: meta.institution || meta.publisher,
    year: meta.year,
    title: meta.title || path.basename(originalFileName, path.extname(originalFileName)),
    role: 'original',
    stableId: attachmentId,
    fileNamingRule: effectiveSettings.fileNamingRule,
  });
}

/**
 * Apply an `update_paper` metadata patch to a paper object.
 * `language: ''` and `language: null` both clear the value to null.
 */
function applyPaperMetadataPatch(paper, patch = {}) {
  const source = patch && typeof patch === 'object' ? patch : {};

  for (const key of UPDATABLE_PAPER_FIELDS) {
    if (source[key] === undefined || key === 'authorDetails') continue;
    if (key === 'language') {
      if (source.language === null || source.language === '') {
        paper.language = null;
      } else {
        const normalized = canonicalizeBcp47Language(source.language);
        if (!normalized) throw new Error(`无效的 BCP 47 语言标签：${source.language}`);
        paper.language = normalized;
      }
    } else if (key === 'citationKey') {
      paper.citationKey = normalizeCitationKey(source.citationKey);
    } else {
      paper[key] = source[key];
    }
  }

  if (source.keywords !== undefined) {
    if (!Array.isArray(source.keywords)) throw new Error('keywords must be an array of strings');
    paper.keywords = source.keywords.map(cleanString).filter(Boolean);
  }
  if (source.authorDetails !== undefined) {
    if (!Array.isArray(source.authorDetails)) throw new Error('authorDetails must be an array of author objects');
    paper.authors = source.authorDetails
      .map((author, index) => normalizeAuthor(author, index))
      .filter((author) => author.name);
  } else if (source.authors !== undefined) {
    if (!Array.isArray(source.authors)) throw new Error('authors must be an array of author names');
    paper.authors = source.authors
      .map(cleanString)
      .filter(Boolean)
      .map((name, index) => normalizeAuthor(name, index));
  }
  if (source.tags !== undefined) {
    if (!Array.isArray(source.tags)) throw new Error('tags must be an array of tag names');
    paper.tags = source.tags.map(cleanString).filter(Boolean).map(normalizeTag);
  }
  if (source.isFavorite != null) paper.isFavorite = Boolean(source.isFavorite);

  return paper;
}

function normalizeMetadataAuthors(metadata) {
  const detailed = Array.isArray(metadata.authorDetails) ? metadata.authorDetails : null;
  if (detailed) {
    return detailed
      .map((author, index) => normalizeAuthor(author, index))
      .filter((author) => author.name);
  }
  const authors = Array.isArray(metadata.authors) ? metadata.authors : [];
  return authors
    .map(cleanString)
    .filter(Boolean)
    .map((name, index) => normalizeAuthor(name, index));
}

function normalizeImportedLanguage(value) {
  if (value === null || value === undefined || !cleanString(value)) return null;
  const normalized = canonicalizeBcp47Language(value);
  if (!normalized) throw new Error(`无效的 BCP 47 语言标签：${value}`);
  return normalized;
}

/**
 * Build the persisted paper record for an imported PDF. Callers keep ownership
 * of `source`, `sortOrder`, category assignment, and their public result shape.
 */
function buildImportedPaperRecord({
  paperId,
  attachmentId,
  metadata,
  source,
  sortOrder,
  categoryIds,
  attachment,
  timestamp,
} = {}) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const att = attachment && typeof attachment === 'object' ? attachment : {};
  const createdAt = Number.isFinite(timestamp) ? Number(timestamp) : now();
  const fileName = safeFileName(cleanString(att.fileName));
  const fallbackTitle = path.basename(fileName, path.extname(fileName));

  return {
    id: paperId,
    title: cleanString(meta.title) || fallbackTitle,
    titleZh: cleanString(meta.titleZh) || null,
    year: meta.year ?? null,
    publication: meta.publication ?? null,
    doi: meta.doi ?? null,
    url: meta.url ?? null,
    abstractText: meta.abstractText ?? null,
    itemType: meta.itemType || 'journalArticle',
    publisher: meta.publisher ?? null,
    institution: meta.institution ?? null,
    reportNumber: meta.reportNumber ?? null,
    volume: meta.volume ?? null,
    issue: meta.issue ?? null,
    pages: meta.pages ?? null,
    isbn: meta.isbn ?? null,
    issn: meta.issn ?? null,
    language: normalizeImportedLanguage(meta.language),
    citationKey: normalizeCitationKey(meta.citationKey),
    keywords: Array.isArray(meta.keywords) ? meta.keywords.map(cleanString).filter(Boolean) : [],
    importedAt: createdAt,
    updatedAt: createdAt,
    lastReadAt: null,
    readingProgress: 0,
    isFavorite: false,
    userNote: null,
    aiSummary: null,
    citation: null,
    source,
    sortOrder,
    authors: normalizeMetadataAuthors(meta),
    tags: Array.isArray(meta.tags) ? meta.tags.map(cleanString).filter(Boolean).map(normalizeTag) : [],
    categoryIds: Array.isArray(categoryIds) ? [...categoryIds] : [],
    attachments: [{
      id: attachmentId,
      paperId,
      kind: 'pdf',
      originalPath: att.originalPath,
      storedPath: att.storedPath,
      relativePath: att.relativePath ?? null,
      language: null,
      fileName,
      mimeType: 'application/pdf',
      fileSize: att.fileSize,
      contentHash: att.contentHash,
      createdAt,
      missing: false,
    }],
  };
}

module.exports = {
  UPDATABLE_PAPER_FIELDS,
  normalizeDoi,
  normalizeTitleForDuplicate,
  findDuplicatePaper,
  buildImportedAttachmentFileName,
  applyPaperMetadataPatch,
  buildImportedPaperRecord,
};
