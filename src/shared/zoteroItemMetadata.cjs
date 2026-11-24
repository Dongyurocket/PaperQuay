'use strict';

/**
 * Pure Zotero item -> import metadata mapping shared by the renderer Zotero
 * import and the MCP `paperquay_sync_from_zotero` flow.
 *
 * Keep this file dependency-free: it is loaded both by Vite (renderer) and by
 * the Electron/MCP main process.
 */

const CITATION_KEY_PATTERN = /^[A-Za-z0-9_:.-]+$/;
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/i;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function splitAuthors(value) {
  return String(value ?? '')
    .split(/[;,，；]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeItemType(rawType) {
  const type = String(rawType ?? '').trim().toLowerCase();
  if (!type) return 'journalArticle';
  if (type.includes('booksection') || type.includes('chapter')) return 'bookSection';
  if (type.includes('book') || type.includes('monograph')) return 'book';
  if (type.includes('thesis') || type.includes('dissertation')) return 'thesis';
  if (type.includes('report') || type.includes('whitepaper')) return 'report';
  if (type.includes('conference') || type.includes('proceedings') || type.includes('inproceedings')) return 'conferencePaper';
  if (type.includes('preprint') || type.includes('arxiv')) return 'preprint';
  if (type.includes('journal') || type.includes('article')) return 'journalArticle';
  return String(rawType ?? '').trim() || 'journalArticle';
}

function canonicalizeBcp47Language(value) {
  const normalized = cleanString(value);
  if (!normalized) return null;
  try {
    return Intl.getCanonicalLocales(normalized)[0] || null;
  } catch {
    return null;
  }
}

function isValidCitationKey(value) {
  const normalized = cleanString(value);
  return normalized === '' || CITATION_KEY_PATTERN.test(normalized);
}

function normalizeOrcid(value) {
  const normalized = cleanString(value)
    .replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '')
    .replace(/^orcid:/i, '')
    .trim();

  if (!ORCID_PATTERN.test(normalized)) return null;

  const compact = normalized.replace(/-/g, '');
  let total = 0;
  for (const digit of compact.slice(0, -1)) {
    total = (total + Number(digit)) * 2;
  }
  const remainder = total % 11;
  const checkValue = (12 - remainder) % 11;
  const expected = checkValue === 10 ? 'X' : String(checkValue);

  return normalized.slice(-1).toUpperCase() === expected
    ? normalized.slice(0, -1) + expected
    : null;
}

/** Stable identity used to de-duplicate Zotero items across collections. */
function zoteroItemIdentity(item) {
  return cleanString(item?.attachmentKey) || cleanString(item?.localPdfPath) || cleanString(item?.itemKey);
}

/**
 * Mirrors the desktop `metadataFromZoteroItem` mapping. Zotero metadata is
 * intentionally not authoritative for publication/DOI in the desktop import;
 * the MCP sync keeps the same behavior so both paths converge.
 */
function buildZoteroItemMetadata(item) {
  const source = item && typeof item === 'object' ? item : {};
  const year = String(source.year ?? '').trim();
  const detailedAuthors = (Array.isArray(source.authors) ? source.authors : [])
    .map((author) => ({
      name: cleanString(author?.name),
      givenName: cleanString(author?.givenName) || null,
      familyName: cleanString(author?.familyName) || null,
      affiliation: cleanString(author?.affiliation) || null,
      orcid: normalizeOrcid(author?.orcid) ?? null,
    }))
    .filter((author) => author.name);
  const authors = detailedAuthors.length > 0
    ? detailedAuthors.map((author) => author.name)
    : splitAuthors(source.creators).filter((author) => author !== 'Unknown Authors');

  const metadata = {
    title: cleanString(source.title) || cleanString(source.attachmentFilename) || cleanString(source.itemKey),
    authors,
    year: year && year !== '未知年份' && year !== 'Unknown Year' ? year : null,
    publication: null,
    doi: null,
  };

  if (source.itemType && source.itemType !== 'journalArticle') {
    metadata.itemType = normalizeItemType(source.itemType);
  }

  if (detailedAuthors.length > 0) {
    metadata.authorDetails = detailedAuthors;
  }

  const language = canonicalizeBcp47Language(source.language);
  if (language) {
    metadata.language = language;
  }

  const citationLine = String(source.extra ?? '')
    .split(/\r?\n/)
    .find((line) => /^citation\s+key\s*:/i.test(line));
  const citationKey = citationLine?.replace(/^citation\s+key\s*:/i, '').trim() || '';
  if (citationKey && isValidCitationKey(citationKey)) {
    metadata.citationKey = citationKey;
  }

  return metadata;
}

module.exports = {
  buildZoteroItemMetadata,
  zoteroItemIdentity,
  splitAuthors,
  normalizeItemType,
  canonicalizeBcp47Language,
  isValidCitationKey,
  normalizeOrcid,
};
