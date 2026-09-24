export type LibraryImportMode = 'copy' | 'move' | 'keep';

/**
 * 加载项页面源站设置：Word 从 https://localhost:3000 取页面 HTML，证书不可用时回退
 * http://localhost:3007。源站由主进程托管（electron/backend/officeAddinHost.cjs）。
 */
export interface OfficeAddinSourceSettings {
  /** 是否随应用托管加载项页面；关闭后 Word 里的加载项会变成空白/报错。 */
  enabled: boolean;
  /** HTTPS 端口，默认 3000（清单里的 SourceLocation 必须与之一致）。 */
  httpsPort: number;
  /** HTTP 回退端口，默认 3007。 */
  httpPort: number;
  /** 证书不可用时是否回退 HTTP（关闭则源站直接不启动）。 */
  allowHttpFallback: boolean;
}

/** Word 加载项（Office 桥）设置；桥侧由 electron/backend/officeBridge.cjs 归一化。 */
export interface OfficeAddinSettings {
  /** 是否随应用启动本地只读桥。 */
  enabled: boolean;
  /** 桥监听端口，默认 23120（被占用时顺延）。 */
  port: number;
  /** 允许跨域访问桥的加载项来源（Origin 白名单）。 */
  allowedOrigins: string[];
  /** 是否允许写入「本文引用过」（唯一写路径）。 */
  allowWriteBack: boolean;
  /** 加载项页面源站设置（可缺省，缺省时按默认值）。 */
  source?: OfficeAddinSourceSettings;
}

export interface LibrarySettings {
  storageDir: string;
  translatedPdfDir?: string;
  zoteroLocalDataDir: string;
  importMode: LibraryImportMode;
  autoRenameFiles: boolean;
  fileNamingRule: string;
  createCategoryFolders: boolean;
  folderWatchEnabled: boolean;
  backupEnabled: boolean;
  preserveOriginalPath: boolean;
  openAlexEnabled: boolean;
  openAlexApiKey: string;
  openAlexMailto: string;
  officeAddin?: OfficeAddinSettings;
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
  /** 出版地（GB/T 7714 专著/学位论文需要，缺失时条目省略该段）。 */
  publisherPlace?: string | null;
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

export interface ListPapersRequest {
  categoryId?: string | null;
  tagId?: string | null;
  search?: string | null;
  sortBy?: 'manual' | 'title' | 'year' | 'author' | 'importedAt' | 'updatedAt' | 'lastReadAt';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
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
  publisherPlace?: string | null;
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
  publisherPlace?: string | null;
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
