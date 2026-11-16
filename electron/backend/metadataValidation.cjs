const CITATION_KEY_PATTERN = /^[A-Za-z0-9_:\-.]+$/;
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/i;

function canonicalizeBcp47Language(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;

  try {
    return Intl.getCanonicalLocales(normalized)[0] || null;
  } catch {
    return null;
  }
}

function normalizeCitationKey(value) {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new Error(`Invalid citation key: ${value}`);
  }
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  if (!CITATION_KEY_PATTERN.test(normalized)) throw new Error(`Invalid citation key: ${value}`);
  return normalized;
}

function normalizeOrcid(value) {
  const normalized = (typeof value === 'string' ? value.trim() : '')
    .replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '')
    .replace(/^orcid:/i, '')
    .trim();
  if (!normalized) return null;
  if (!ORCID_PATTERN.test(normalized)) throw new Error(`Invalid ORCID: ${value}`);

  const compact = normalized.replace(/-/g, '');
  let total = 0;
  for (const digit of compact.slice(0, -1)) {
    total = (total + Number(digit)) * 2;
  }
  const remainder = total % 11;
  const checkValue = (12 - remainder) % 11;
  const expected = checkValue === 10 ? 'X' : String(checkValue);
  if (normalized.slice(-1).toUpperCase() !== expected) throw new Error(`Invalid ORCID checksum: ${value}`);
  return normalized.slice(0, -1) + expected;
}

module.exports = {
  CITATION_KEY_PATTERN,
  ORCID_PATTERN,
  canonicalizeBcp47Language,
  normalizeCitationKey,
  normalizeOrcid,
};
