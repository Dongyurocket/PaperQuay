export const PAPER_DETAILS_SECTIONS_STORAGE_KEY = 'paperquay-literature-details-sections-v1';

export const PAPER_DETAILS_SECTION_KEYS = [
  'information',
  'abstract',
  'overview',
  'keywords',
  'notes',
  'readingTime',
] as const;

export type PaperDetailsSectionKey = (typeof PAPER_DETAILS_SECTION_KEYS)[number];
export type PaperDetailsSectionState = Record<PaperDetailsSectionKey, boolean>;

export const DEFAULT_PAPER_DETAILS_SECTIONS: PaperDetailsSectionState = {
  information: false,
  abstract: true,
  overview: false,
  keywords: false,
  notes: false,
  readingTime: true,
};

export function parsePaperDetailsSections(raw: string | null | undefined): PaperDetailsSectionState {
  if (!raw) return { ...DEFAULT_PAPER_DETAILS_SECTIONS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_PAPER_DETAILS_SECTIONS };
    }
    const value = parsed as Record<string, unknown>;
    return Object.fromEntries(PAPER_DETAILS_SECTION_KEYS.map((key) => [
      key,
      typeof value[key] === 'boolean' ? value[key] : DEFAULT_PAPER_DETAILS_SECTIONS[key],
    ])) as PaperDetailsSectionState;
  } catch {
    return { ...DEFAULT_PAPER_DETAILS_SECTIONS };
  }
}

export function serializePaperDetailsSections(state: PaperDetailsSectionState): string {
  return JSON.stringify(Object.fromEntries(PAPER_DETAILS_SECTION_KEYS.map((key) => [key, state[key]])));
}

export function loadPaperDetailsSections(storage?: Pick<Storage, 'getItem'> | null): PaperDetailsSectionState {
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    return parsePaperDetailsSections(source?.getItem(PAPER_DETAILS_SECTIONS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PAPER_DETAILS_SECTIONS };
  }
}

export function persistPaperDetailsSections(
  state: PaperDetailsSectionState,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    target?.setItem(PAPER_DETAILS_SECTIONS_STORAGE_KEY, serializePaperDetailsSections(state));
  } catch {
    // Storage may be unavailable in private or restricted contexts. Keep the in-memory state.
  }
}
