import type {
  ImportPdfMetadata,
  LibrarySettings,
  LiteratureCategory,
  LiteraturePaper,
  LiteraturePaperTaskState,
  UpdatePaperRequest,
} from '../../types/library';
import type { MetadataLookupResult } from '../../types/metadata';
import type { WorkspaceItem, ZoteroLibraryItem } from '../../types/reader';
import {
  buildMineruCachePathCandidates,
  getMineruJsonPathCandidates,
  guessSiblingJsonPaths,
  guessSiblingMarkdownPath,
} from '../../utils/mineruCache.ts';
import { paperPdfPath, resolvePaperPdfAttachment } from '../../utils/libraryPaper.ts';
import { canAutoReplaceTitle, titleFromPdfPath } from './importMetadata.ts';
import type { ImportDraftItem } from './importTypes';
import type { LiteraturePaperListStatus } from './components/LiteraturePaperList';

export interface LiteratureLibraryDemoState {
  settings: LibrarySettings;
  categories: LiteratureCategory[];
  papers: LiteraturePaper[];
  statusMessage: string;
  paperStatuses?: Record<string, LiteraturePaperListStatus>;
}

export interface FloatingMenuPosition {
  x: number;
  y: number;
}

export type PathExists = (path: string) => Promise<boolean>;

export const DETAILS_PANEL_WIDTH_STORAGE_KEY = 'paperquay-literature-details-width-v1';
export const DETAILS_PANEL_DEFAULT_WIDTH = 420;
const DETAILS_PANEL_MIN_WIDTH = 320;
const DETAILS_PANEL_MAX_WIDTH = 760;
export const CATEGORY_SIDEBAR_WIDTH_STORAGE_KEY = 'paperquay-literature-category-sidebar-width-v1';
export const CATEGORY_SIDEBAR_DEFAULT_WIDTH = 248;
const CATEGORY_SIDEBAR_MIN_WIDTH = 200;
const CATEGORY_SIDEBAR_MAX_WIDTH = 420;

export function filterDemoPapers(
  demoLibrary: LiteratureLibraryDemoState,
  categoryId: string | null,
  searchQuery: string,
): LiteraturePaper[] {
  const category = demoLibrary.categories.find((item) => item.id === categoryId);
  const query = searchQuery.trim().toLocaleLowerCase();

  return demoLibrary.papers.filter((paper) => {
    if (category?.systemKey === 'favorites' && !paper.isFavorite) {
      return false;
    }

    if (category?.systemKey === 'uncategorized' && paper.categoryIds.length > 0) {
      return false;
    }

    if (category && !category.isSystem && !paper.categoryIds.includes(category.id)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      paper.title,
      paper.publication ?? '',
      paper.abstractText ?? '',
      paper.authors.map((author) => author.name).join(' '),
      paper.keywords.join(' '),
      paper.tags.map((tag) => tag.name).join(' '),
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

export function resolveSelectedPaperId(
  currentPaperId: string | null,
  papers: LiteraturePaper[],
): string | null {
  return currentPaperId && papers.some((paper) => paper.id === currentPaperId)
    ? currentPaperId
    : papers[0]?.id ?? null;
}

export function clampFloatingMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): FloatingMenuPosition {
  if (typeof window === 'undefined') return { x, y };

  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

export function clampDetailsPanelWidth(width: number): number {
  return Math.max(DETAILS_PANEL_MIN_WIDTH, Math.min(DETAILS_PANEL_MAX_WIDTH, Math.round(width)));
}

export function loadDetailsPanelWidth(): number {
  try {
    const rawValue = Number(localStorage.getItem(DETAILS_PANEL_WIDTH_STORAGE_KEY));

    return Number.isFinite(rawValue)
      ? clampDetailsPanelWidth(rawValue)
      : DETAILS_PANEL_DEFAULT_WIDTH;
  } catch {
    return DETAILS_PANEL_DEFAULT_WIDTH;
  }
}

export function clampCategorySidebarWidth(width: number): number {
  return Math.max(
    CATEGORY_SIDEBAR_MIN_WIDTH,
    Math.min(CATEGORY_SIDEBAR_MAX_WIDTH, Math.round(width)),
  );
}

export function loadCategorySidebarWidth(): number {
  try {
    const rawValue = Number(localStorage.getItem(CATEGORY_SIDEBAR_WIDTH_STORAGE_KEY));

    return Number.isFinite(rawValue)
      ? clampCategorySidebarWidth(rawValue)
      : CATEGORY_SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return CATEGORY_SIDEBAR_DEFAULT_WIDTH;
  }
}

export function splitAuthors(value: string): string[] {
  return value
    .split(/[;,，；]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function metadataFromDraft(draft: ImportDraftItem): ImportPdfMetadata {
  return {
    title: draft.title.trim() || titleFromPdfPath(draft.path),
    authors: splitAuthors(draft.authors),
    year: draft.year.trim() || null,
    publication: draft.publication.trim() || null,
    doi: draft.doi.trim() || null,
    url: draft.url.trim() || null,
    abstractText: draft.abstractText.trim() || null,
  };
}

export function metadataFromZoteroItem(item: ZoteroLibraryItem): ImportPdfMetadata {
  const year = item.year.trim();

  return {
    title: item.title.trim() || item.attachmentFilename || item.itemKey,
    authors: splitAuthors(item.creators).filter((author) => author !== 'Unknown Authors'),
    year: year && year !== '未知年份' && year !== 'Unknown Year' ? year : null,
    publication: null,
    doi: null,
  };
}

export function categorySignature(name: string, parentId: string | null): string {
  return `${parentId ?? 'root'}::${name.trim().toLocaleLowerCase()}`;
}

export function resolveDefaultImportCategoryId(
  categories: LiteratureCategory[],
  selectedCategoryId: string | null,
): string {
  const targetCategory = categories.find((category) => category.id === selectedCategoryId);

  return targetCategory && !targetCategory.isSystem ? targetCategory.id : '';
}

export function normalizeImportPdfPaths(paths: string[]): string[] {
  const seenPaths = new Set<string>();
  const pdfPaths: string[] = [];

  for (const path of paths) {
    const trimmedPath = path.trim();

    if (!trimmedPath.toLowerCase().endsWith('.pdf') || seenPaths.has(trimmedPath)) {
      continue;
    }

    seenPaths.add(trimmedPath);
    pdfPaths.push(trimmedPath);
  }

  return pdfPaths;
}

export function buildImportDraftsFromPdfPaths(options: {
  paths: string[];
  existingDrafts: ImportDraftItem[];
  categories: LiteratureCategory[];
  selectedCategoryId: string | null;
}): {
  pdfPaths: string[];
  drafts: ImportDraftItem[];
} {
  const pdfPaths = normalizeImportPdfPaths(options.paths);
  const defaultCategoryId = resolveDefaultImportCategoryId(
    options.categories,
    options.selectedCategoryId,
  );
  const existingPaths = new Set(options.existingDrafts.map((draft) => draft.path));
  const drafts = pdfPaths
    .filter((path) => !existingPaths.has(path))
    .map((path): ImportDraftItem => ({
      path,
      title: titleFromPdfPath(path),
      authors: '',
      year: '',
      publication: '',
      doi: '',
      url: '',
      abstractText: '',
      categoryId: defaultCategoryId,
    }));

  return {
    pdfPaths,
    drafts,
  };
}

export function defaultPaperListStatus(paper: LiteraturePaper): LiteraturePaperListStatus {
  return {
    mineruParsed: false,
    overviewGenerated: Boolean(paper.aiSummary?.trim()),
    checkingMineru: false,
  };
}

export function buildInitialPaperStatuses(
  papers: LiteraturePaper[],
): Record<string, LiteraturePaperListStatus> {
  return Object.fromEntries(
    papers.map((paper) => [paper.id, defaultPaperListStatus(paper)]),
  );
}

export function markPaperStatusesCheckingMineru(
  current: Record<string, LiteraturePaperListStatus>,
  papers: LiteraturePaper[],
  checkingPaperIds: Set<string>,
): Record<string, LiteraturePaperListStatus> {
  const nextStatuses: Record<string, LiteraturePaperListStatus> = { ...current };
  let changed = false;

  for (const paper of papers) {
    const previous = current[paper.id];
    const nextStatus: LiteraturePaperListStatus = {
      mineruParsed: previous?.mineruParsed ?? false,
      overviewGenerated: Boolean(paper.aiSummary?.trim()),
      checkingMineru: checkingPaperIds.has(paper.id),
    };

    if (
      !previous ||
      previous.mineruParsed !== nextStatus.mineruParsed ||
      previous.overviewGenerated !== nextStatus.overviewGenerated ||
      previous.checkingMineru !== nextStatus.checkingMineru
    ) {
      nextStatuses[paper.id] = nextStatus;
      changed = true;
    }
  }

  return changed ? nextStatuses : current;
}

function getExistingPaperStatus(
  current: Record<string, LiteraturePaperListStatus>,
  paperId: string,
): LiteraturePaperListStatus {
  return current[paperId] ?? {
    mineruParsed: false,
    overviewGenerated: false,
    checkingMineru: false,
  };
}

export function applyPaperSummaryStatusUpdate(
  current: Record<string, LiteraturePaperListStatus>,
  paperId: string,
  aiSummary: string | null,
): Record<string, LiteraturePaperListStatus> {
  return {
    ...current,
    [paperId]: {
      ...getExistingPaperStatus(current, paperId),
      overviewGenerated: Boolean(aiSummary?.trim()),
    },
  };
}

export function applyPaperMineruStatusUpdate(
  current: Record<string, LiteraturePaperListStatus>,
  paperId: string,
  mineruParsed: boolean,
): Record<string, LiteraturePaperListStatus> {
  return {
    ...current,
    [paperId]: {
      ...getExistingPaperStatus(current, paperId),
      mineruParsed,
      checkingMineru: false,
    },
  };
}

export function reorderPaperList(
  papers: LiteraturePaper[],
  draggedPaperId: string,
  targetPaperId: string,
  placement: 'before' | 'after',
): LiteraturePaper[] {
  if (draggedPaperId === targetPaperId) {
    return papers;
  }

  const draggedPaper = papers.find((paper) => paper.id === draggedPaperId);

  if (!draggedPaper) {
    return papers;
  }

  const withoutDragged = papers.filter((paper) => paper.id !== draggedPaperId);
  const targetIndex = withoutDragged.findIndex((paper) => paper.id === targetPaperId);

  if (targetIndex < 0) {
    return papers;
  }

  const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
  const nextPapers = [...withoutDragged];
  nextPapers.splice(insertIndex, 0, draggedPaper);

  return nextPapers;
}

export function metadataUpdateForPaper(
  paper: LiteraturePaper,
  metadata: MetadataLookupResult,
): UpdatePaperRequest | null {
  const request: UpdatePaperRequest = {
    paperId: paper.id,
  };
  let changed = false;
  const pdfPath = paperPdfPath(paper);
  const assignString = <Key extends keyof UpdatePaperRequest>(
    key: Key,
    currentValue: string | null,
    nextValue: string | null | undefined,
  ) => {
    const normalized = nextValue?.trim();

    if (!normalized || normalized === currentValue?.trim()) {
      return;
    }

    if (
      key === 'title' &&
      currentValue?.trim() &&
      (!pdfPath || !canAutoReplaceTitle(currentValue, pdfPath))
    ) {
      return;
    }

    (request[key] as string | null | undefined) = normalized;
    changed = true;
  };

  assignString('title', paper.title, metadata.title);
  assignString('year', paper.year, metadata.year);
  assignString('publication', paper.publication, metadata.publication);
  assignString('doi', paper.doi, metadata.doi);
  assignString('url', paper.url, metadata.url);
  assignString('abstractText', paper.abstractText, metadata.abstractText);

  if (metadata.authors.length > 0) {
    const currentAuthors = paper.authors.map((author) => author.name.trim()).filter(Boolean);
    const nextAuthors = metadata.authors.map((author) => author.trim()).filter(Boolean);

    if (
      nextAuthors.length > 0 &&
      nextAuthors.join('\n').toLocaleLowerCase() !== currentAuthors.join('\n').toLocaleLowerCase()
    ) {
      request.authors = nextAuthors;
      changed = true;
    }
  }

  return changed ? request : null;
}

export function createNativeWorkspaceItemForPaper(
  paper: LiteraturePaper,
  storageDir?: string | null,
): WorkspaceItem | null {
  const resolvedAttachment = resolvePaperPdfAttachment(paper, { storageDir });

  if (!resolvedAttachment) {
    return null;
  }

  const { attachment, path } = resolvedAttachment;
  const workspaceId = `native-library:${paper.id}`;

  return {
    itemKey: paper.id,
    title: paper.title,
    creators: paper.authors.length > 0
      ? paper.authors.map((author) => author.name).join(', ')
      : 'Unknown Authors',
    year: paper.year ?? '',
    itemType: 'pdf',
    attachmentFilename: attachment.fileName,
    localPdfPath: path,
    source: 'native-library',
    workspaceId,
    groupKey: workspaceId,
  };
}

export function mineruOutputPathCandidatesForPaper(
  paper: LiteraturePaper,
  mineruCacheDir: string,
  autoLoadSiblingJson: boolean,
  storageDir?: string | null,
): string[] {
  const candidates = new Set<string>();
  const workspaceItem = createNativeWorkspaceItemForPaper(paper, storageDir);
  const cacheRoot = mineruCacheDir.trim();

  if (workspaceItem && cacheRoot) {
    for (const cachePaths of buildMineruCachePathCandidates(cacheRoot, workspaceItem)) {
      for (const candidatePath of getMineruJsonPathCandidates(cachePaths)) {
        candidates.add(candidatePath);
      }
      candidates.add(cachePaths.markdownPath);
    }
  }

  const pdfPath = paperPdfPath(paper, { storageDir });

  if (pdfPath && autoLoadSiblingJson) {
    for (const candidatePath of guessSiblingJsonPaths(pdfPath)) {
      candidates.add(candidatePath);
    }
    candidates.add(guessSiblingMarkdownPath(pdfPath));
  }

  return [...candidates];
}

export async function hasMineruOutputForPaper(
  paper: LiteraturePaper,
  mineruCacheDir: string,
  autoLoadSiblingJson: boolean,
  pathExists: PathExists,
  storageDir?: string | null,
): Promise<boolean> {
  for (const candidate of mineruOutputPathCandidatesForPaper(
    paper,
    mineruCacheDir,
    autoLoadSiblingJson,
    storageDir,
  )) {
    if (await pathExists(candidate)) {
      return true;
    }
  }

  return false;
}
