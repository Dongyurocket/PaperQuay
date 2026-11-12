export type LibraryImportMode = 'copy' | 'move' | 'keep';

export interface LibrarySettings {
  storageDir: string;
  translatedPdfDir?: string;
  zoteroLocalDataDir: string;
  importMode: LibraryImportMode;
  autoRenameFiles: boolean;
  fileNamingRule: string;
  createCategoryFolders: boolean;
  folderWatchEnabled: boolean;
  preserveOriginalPath: boolean;
  openAlexEnabled: boolean;
  openAlexApiKey: string;
  openAlexMailto: string;
}

export interface LiteratureAuthor {
  id: string;
  name: string;
  givenName: string | null;
  familyName: string | null;
  sortOrder: number;
}

export interface LiteratureTag {
  id: string;
  name: string;
  color: string | null;
}

export interface LiteratureCategory {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isSystem: boolean;
  systemKey: 'all' | 'recent' | 'uncategorized' | 'favorites' | string | null;
  createdAt: number;
  updatedAt: number;
  paperCount: number;
}

export interface LiteratureAttachment {
  id: string;
  paperId: string;
  kind: 'pdf' | string;
  originalPath: string | null;
  storedPath: string;
  relativePath: string | null;
  language?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentHash: string | null;
  createdAt: number;
  missing: boolean;
}

export type LiteratureItemType =
  | 'journalArticle'
  | 'book'
  | 'bookSection'
  | 'conferencePaper'
  | 'thesis'
  | 'report'
  | 'preprint'
  | 'misc'
  | string;

export interface LiteraturePaper {
  id: string;
  title: string;
  titleZh: string | null;
  year: string | null;
  publication: string | null;
  doi: string | null;
  url: string | null;
  abstractText: string | null;
  itemType?: LiteratureItemType | null;
  publisher?: string | null;
  institution?: string | null;
  reportNumber?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  isbn?: string | null;
  issn?: string | null;
  keywords: string[];
  importedAt: number;
  updatedAt: number;
  lastReadAt: number | null;
  readingProgress: number;
  isFavorite: boolean;
  userNote: string | null;
  aiSummary: string | null;
  citation: string | null;
  source: 'local' | 'zotero' | string;
  sortOrder: number;
  authors: LiteratureAuthor[];
  tags: LiteratureTag[];
  categoryIds: string[];
  attachments: LiteratureAttachment[];
  /** 为 false 时不参与本地 RAG 索引。缺省视为加入。 */
  ragEnabled: boolean;
}

export interface PaperReference {
  id: string;
  paperId: string;
  seq: number;
  doi: string;
  title: string;
  authors: string;
  year: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  unstructured: string;
  fetchedAt: number;
}

export interface FetchPaperReferencesResult {
  paperId: string;
  fetched: number;
  skipped: boolean;
  references: PaperReference[];
}

export interface FetchAllReferencesResult {
  fetched: number;
  skipped: number;
  failed: number;
}

export interface LibraryReferenceProgress {
  status: 'running' | 'done' | 'error';
  current: number;
  total: number;
  paperId?: string;
  title?: string;
  fetched: number;
  skipped: number;
  failed: number;
  updatedAt?: number;
}

export interface LibrarySnapshot {
  settings: LibrarySettings;
  categories: LiteratureCategory[];
  papers: LiteraturePaper[];
}

export interface PdfAssetInventoryEntry {
  paperId: string;
  paperTitle: string;
  attachmentId: string;
  role: string;
  path: string;
  ownership: boolean;
  expectedHash: string | null;
  status: 'verified' | 'missing' | 'unreadable' | 'hash-mismatch' | string;
  byteLength: number | null;
  sha256: string | null;
}

export interface PdfAssetInventoryReport {
  createdAt: number;
  attachmentCount: number;
  verifiedCount: number;
  missingCount: number;
  unreadableCount: number;
  hashMismatchCount: number;
  uniqueVerifiedAssetCount: number;
  duplicateGroups: PdfAssetInventoryEntry[][];
  entries: PdfAssetInventoryEntry[];
}

export interface PdfAssetNameOperation {
  paperId: string;
  attachmentId: string;
  role: string;
  currentPath: string;
  proposedPath: string;
  contentHash: string | null;
  action: 'unchanged' | 'rename-preview' | string;
  ownership: boolean;
}

export interface PdfAssetNamePlan {
  createdAt: number;
  namingVersion: number;
  operations: PdfAssetNameOperation[];
  renameCount: number;
  externalCount: number;
}

export interface ListPapersRequest {
  categoryId?: string | null;
  tagId?: string | null;
  search?: string | null;
  sortBy?: 'manual' | 'title' | 'year' | 'author' | 'importedAt' | 'updatedAt' | 'lastReadAt';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  /** true 只看已加入，false 只看已排除，null/缺省为全部。 */
  ragEnabled?: boolean | null;
}

/** SQL 分页查询结果（P2-1）：total 为当前筛选的完整匹配数，不受 offset/limit 限制。 */
export interface QueryPapersResult {
  papers: LiteraturePaper[];
  total: number;
  offset: number;
  limit: number;
}

export interface CreateCategoryRequest {
  name: string;
  parentId?: string | null;
}

export interface UpdateCategoryRequest {
  id: string;
  name?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
}

export interface MoveCategoryRequest {
  categoryId: string;
  parentId?: string | null;
  sortOrder?: number | null;
}

export interface ImportPdfMetadata {
  title?: string | null;
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  itemType?: LiteratureItemType | null;
  publisher?: string | null;
  institution?: string | null;
  reportNumber?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  isbn?: string | null;
  issn?: string | null;
  keywords?: string[] | null;
  authors?: string[] | null;
}

export interface ImportPdfRequest {
  paths: string[];
  targetCategoryId?: string | null;
  importMode?: LibraryImportMode | null;
  metadata?: Record<string, ImportPdfMetadata> | null;
}

export interface ImportedPdfResult {
  sourcePath: string;
  paper: LiteraturePaper | null;
  duplicated: boolean;
  existingPaperId: string | null;
  status: 'imported' | 'duplicate' | 'failed' | string;
  message: string;
}

export interface RelocateAttachmentRequest {
  attachmentId: string;
  newPath: string;
}

export interface AddAttachmentRequest {
  paperId: string;
  sourcePath: string;
  kind: 'translated-pdf';
  language?: string | null;
}

export interface TranslatedPdfLanguageChange {
  paperId: string;
  attachmentId: string;
  /** Exact raw value observed in the preview; null and '' remain distinct. */
  expectedLanguage: string | null;
  /** null explicitly clears the language. */
  language: string | null;
}

export interface UpdateTranslatedPdfLanguagesRequest {
  changes: TranslatedPdfLanguageChange[];
}

export interface UpdateTranslatedPdfLanguagesResult {
  changedCount: number;
  papers: LiteraturePaper[];
}

export interface RemoveAttachmentRequest {
  attachmentId: string;
  deleteFile?: boolean;
}

export interface AssignPaperCategoryRequest {
  paperId: string;
  categoryId: string;
}

export interface UpdatePaperRequest {
  paperId: string;
  title?: string | null;
  titleZh?: string | null;
  year?: string | null;
  publication?: string | null;
  doi?: string | null;
  url?: string | null;
  abstractText?: string | null;
  itemType?: LiteratureItemType | null;
  publisher?: string | null;
  institution?: string | null;
  reportNumber?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  isbn?: string | null;
  issn?: string | null;
  keywords?: string[] | null;
  tags?: string[] | null;
  authors?: string[] | null;
  userNote?: string | null;
  aiSummary?: string | null;
  citation?: string | null;
  isFavorite?: boolean | null;
}

export interface DeletePaperRequest {
  paperId: string;
  deleteFiles?: boolean;
}

export type LiteraturePaperTaskKind = 'mineru' | 'translation' | 'overview';

export type LiteraturePaperTaskStatus = 'running' | 'success' | 'error';

export interface LiteraturePaperTaskState {
  kind: LiteraturePaperTaskKind;
  status: LiteraturePaperTaskStatus;
  label: string;
  message: string;
  completed?: number | null;
  total?: number | null;
  updatedAt: number;
}

export interface ReorderPapersRequest {
  paperIds: string[];
}
