import type {
  LiteratureAuthorInput,
  LiteratureCategory,
  LiteraturePaper,
  UpdatePaperRequest,
} from '../../../types/library.ts';
import { canonicalizeBcp47Language, isValidBcp47Language, isValidCitationKey, isValidOrcid, normalizeOrcid } from '../metadataValidation.ts';

export interface PaperDetailsDraft {
  title: string;
  titleZh: string;
  itemType: string;
  publisher: string;
  institution: string;
  reportNumber: string;
  volume: string;
  issue: string;
  pages: string;
  isbn: string;
  issn: string;
  authors: LiteratureAuthorInput[];
  year: string;
  publication: string;
  doi: string;
  url: string;
  abstractText: string;
  keywords: string[];
  tags: string[];
  categories: string[];
  language: string;
  citationKey: string;
  userNote: string;
  citation: string;
}

export type PaperDraftField = keyof PaperDetailsDraft | 'orcid';
export type PaperDraftErrors = Partial<Record<PaperDraftField, string>>;

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function splitAuthorString(value: string): string[] {
  const groups = value
    .split(/[\r\n;；、，]+/)
    .map((author) => author.trim())
    .filter(Boolean);

  return groups.flatMap((group) => {
    const commaParts = group.split(/\s*,\s*/).map((author) => author.trim()).filter(Boolean);
    // Keep the common "Family, Given" form intact; treat longer comma-separated
    // lists as multiple names. Semicolons/newlines remain unambiguous separators.
    return commaParts.length > 2 ? commaParts : [group];
  });
}

export function hasDuplicateCitationKey(
  citationKey: string,
  papers: LiteraturePaper[],
  currentPaperId: string,
): boolean {
  const normalized = citationKey.trim().toLocaleLowerCase();
  return Boolean(normalized && papers.some((paper) =>
    paper.id !== currentPaperId && paper.citationKey?.trim().toLocaleLowerCase() === normalized,
  ));
}

export function createPaperDetailsDraft(paper: LiteraturePaper): PaperDetailsDraft {
  return {
    title: paper.title,
    titleZh: paper.titleZh ?? '',
    itemType: paper.itemType ?? 'journalArticle',
    publisher: paper.publisher ?? '',
    institution: paper.institution ?? '',
    reportNumber: paper.reportNumber ?? '',
    volume: paper.volume ?? '',
    issue: paper.issue ?? '',
    pages: paper.pages ?? '',
    isbn: paper.isbn ?? '',
    issn: paper.issn ?? '',
    authors: paper.authors.map((author) => ({
      id: author.id,
      name: author.name,
      givenName: author.givenName,
      familyName: author.familyName,
      affiliation: author.affiliation ?? null,
      orcid: author.orcid ?? null,
    })),
    year: paper.year ?? '',
    publication: paper.publication ?? '',
    doi: paper.doi ?? '',
    url: paper.url ?? '',
    abstractText: paper.abstractText ?? '',
    keywords: [...paper.keywords],
    tags: paper.tags.map((tag) => tag.name),
    categories: [...paper.categoryIds],
    language: paper.language ?? '',
    citationKey: paper.citationKey ?? '',
    userNote: paper.userNote ?? '',
    citation: paper.citation ?? '',
  };
}

export function normalizeDoi(value: string): string | null {
  const normalized = value.trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
  if (!normalized) return null;
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : null;
}

function isValidIssn(value: string): boolean {
  const match = value.trim().toUpperCase().match(/^(\d{4})-(\d{3}[\dX])$/);
  if (!match) return false;
  const digits = `${match[1]}${match[2]}`;
  const sum = Array.from(digits.slice(0, 7)).reduce(
    (total, digit, index) => total + Number(digit) * (8 - index),
    0,
  );
  const check = (11 - (sum % 11)) % 11;
  return digits[7] === (check === 10 ? 'X' : String(check));
}

export function validatePaperDraft(
  draft: PaperDetailsDraft,
  currentYear = new Date().getFullYear(),
): PaperDraftErrors {
  const errors: PaperDraftErrors = {};
  const year = draft.year.trim();
  if (year && (!/^\d{4}$/.test(year) || Number(year) > currentYear + 1 || Number(year) < 1000)) {
    errors.year = 'invalid-year';
  }
  if (draft.doi.trim() && !normalizeDoi(draft.doi)) errors.doi = 'invalid-doi';
  if (draft.issn.trim() && !isValidIssn(draft.issn)) errors.issn = 'invalid-issn';
  if (draft.url.trim()) {
    try {
      const parsed = new URL(draft.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol');
    } catch {
      errors.url = 'invalid-url';
    }
  }
  if (draft.language.trim() && !isValidBcp47Language(draft.language)) {
    errors.language = 'invalid-language';
  }
  if (!isValidCitationKey(draft.citationKey)) {
    errors.citationKey = 'invalid-citation-key';
  }
  if (draft.authors.some((author) => !isValidOrcid(author.orcid))) {
    errors.orcid = 'invalid-orcid';
  }
  return errors;
}

export function buildPaperDraftUpdateRequest(
  paper: LiteraturePaper,
  draft: PaperDetailsDraft,
): UpdatePaperRequest {
  const authors: LiteratureAuthorInput[] = draft.authors
    .map((author) => ({
      ...(author.id ? { id: author.id } : {}),
      name: author.name.trim(),
      givenName: nullable(author.givenName ?? ''),
      familyName: nullable(author.familyName ?? ''),
      affiliation: nullable(author.affiliation ?? ''),
      orcid: author.orcid?.trim() ? normalizeOrcid(author.orcid) : null,
    }))
    .filter((author) => author.name);

  return {
    paperId: paper.id,
    title: draft.title.trim() || paper.title,
    titleZh: nullable(draft.titleZh),
    itemType: draft.itemType || 'journalArticle',
    publisher: nullable(draft.publisher),
    institution: nullable(draft.institution),
    reportNumber: nullable(draft.reportNumber),
    volume: nullable(draft.volume),
    issue: nullable(draft.issue),
    pages: nullable(draft.pages),
    isbn: nullable(draft.isbn),
    issn: nullable(draft.issn),
    authorDetails: authors,
    year: nullable(draft.year),
    publication: nullable(draft.publication),
    doi: draft.doi.trim() ? normalizeDoi(draft.doi) : null,
    url: nullable(draft.url),
    abstractText: nullable(draft.abstractText),
    keywords: draft.keywords.map((value) => value.trim()).filter(Boolean),
    tags: draft.tags.map((value) => value.trim()).filter(Boolean),
    language: canonicalizeBcp47Language(draft.language),
    citationKey: draft.citationKey.trim() || null,
    userNote: nullable(draft.userNote),
    citation: nullable(draft.citation),
  };
}

export function normalizeCategorySelection(
  selectedIds: string[],
  categories: LiteratureCategory[],
): string[] {
  const available = new Set(categories.filter((category) => !category.isSystem).map((category) => category.id));
  return [...new Set(selectedIds)].filter((id) => available.has(id)).sort();
}

export function paperDraftChanged(paper: LiteraturePaper, draft: PaperDetailsDraft): boolean {
  const request = buildPaperDraftUpdateRequest(paper, draft);
  const fields = Object.keys(request).filter((key) => key !== 'paperId') as Array<keyof UpdatePaperRequest>;
  const comparable = (value: unknown) => JSON.stringify(value);
  for (const field of fields) {
    if (field === 'authorDetails') {
      if (comparable(request.authorDetails) !== comparable(paper.authors.map((author) => ({
        id: author.id,
        name: author.name,
        givenName: author.givenName,
        familyName: author.familyName,
        affiliation: author.affiliation ?? null,
        orcid: author.orcid ?? null,
      })))) return true;
    } else if (field === 'tags') {
      if (comparable(request.tags) !== comparable(paper.tags.map((tag) => tag.name))) return true;
    } else if (field === 'keywords') {
      if (comparable(request.keywords) !== comparable(paper.keywords)) return true;
    } else if (request[field] !== paper[field as keyof LiteraturePaper]) {
      return true;
    }
  }
  return comparable([...draft.categories].sort()) !== comparable([...paper.categoryIds].sort());
}
