const CITATION_KEY_PATTERN = /^[A-Za-z0-9_:\-.]+$/;
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/i;

/** 返回 BCP 47 的规范化标签；空值表示未设置或无效。 */
export function canonicalizeBcp47Language(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;

  try {
    return Intl.getCanonicalLocales(normalized)[0] ?? null;
  } catch {
    return null;
  }
}

export function isValidBcp47Language(value: string | null | undefined): boolean {
  return canonicalizeBcp47Language(value) !== null;
}

/** 空字符串表示未设置；非空值只能包含 BibTeX 兼容的键字符。 */
export function isValidCitationKey(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? '';
  return normalized === '' || CITATION_KEY_PATTERN.test(normalized);
}

/** 返回不带 URL 前缀的规范 ORCID；空值表示未设置或校验失败。 */
export function normalizeOrcid(value: string | null | undefined): string | null {
  const normalized = (value?.trim() ?? '')
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

export function isValidOrcid(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? '';
  return normalized === '' || normalizeOrcid(normalized) !== null;
}

export { CITATION_KEY_PATTERN, ORCID_PATTERN };
