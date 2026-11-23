export interface MineruCachePaths {
  directory: string;
  manifestPath: string;
  contentJsonPath: string;
  contentListJsonPath: string;
  middleJsonPath: string;
  markdownPath: string;
  translationsDir: string;
  summariesDir: string;
}

export interface MineruCacheItemLike {
  workspaceId?: string;
  itemKey?: string;
  localPdfPath?: string;
  title?: string;
}

export function getPathSeparator(pathValue: string): string;
export function joinPath(basePath: string, ...segments: string[]): string;
export function sanitizePathSegment(value: string): string;
export function hashString(value: string): string;
export function buildCachePaths(rootDir: string, directoryName: string): MineruCachePaths;
export function stableDocumentKey(item: MineruCacheItemLike): string;
export function buildMineruCachePaths(rootDir: string, item: MineruCacheItemLike): MineruCachePaths;
export function buildTitleMineruCachePaths(rootDir: string, item: MineruCacheItemLike): MineruCachePaths;
export function buildLegacyMineruCachePaths(rootDir: string, item: MineruCacheItemLike): MineruCachePaths;
export function getMineruJsonPathCandidates(cachePaths: MineruCachePaths): string[];
export function buildMineruCachePathCandidates(rootDir: string, item: MineruCacheItemLike): MineruCachePaths[];
