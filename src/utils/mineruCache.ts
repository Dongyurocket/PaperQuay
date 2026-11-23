import type { WorkspaceItem } from '../types/reader';
import {
  buildCachePaths,
  buildLegacyMineruCachePaths as buildSharedLegacyMineruCachePaths,
  buildMineruCachePathCandidates as buildSharedMineruCachePathCandidates,
  buildMineruCachePaths as buildSharedMineruCachePaths,
  buildTitleMineruCachePaths as buildSharedTitleMineruCachePaths,
  getMineruJsonPathCandidates as getSharedMineruJsonPathCandidates,
  getPathSeparator,
  hashString,
  joinPath,
  sanitizePathSegment,
  type MineruCachePaths,
} from '../shared/mineruCachePaths.cjs';

export type { MineruCachePaths } from '../shared/mineruCachePaths.cjs';

export function guessSiblingJsonPath(pdfPath: string): string {
  const separator = pdfPath.includes('\\') ? '\\' : '/';
  const lastSeparatorIndex = Math.max(pdfPath.lastIndexOf('/'), pdfPath.lastIndexOf('\\'));
  const directory = lastSeparatorIndex >= 0 ? pdfPath.slice(0, lastSeparatorIndex) : '.';

  return `${directory}${separator}content_list_v2.json`;
}

export function guessSiblingJsonPaths(pdfPath: string): string[] {
  const separator = pdfPath.includes('\\') ? '\\' : '/';
  const lastSeparatorIndex = Math.max(pdfPath.lastIndexOf('/'), pdfPath.lastIndexOf('\\'));
  const directory = lastSeparatorIndex >= 0 ? pdfPath.slice(0, lastSeparatorIndex) : '.';

  return [
    `${directory}${separator}content_list_v2.json`,
    `${directory}${separator}content_list.json`,
    `${directory}${separator}middle.json`,
  ];
}

export function guessSiblingMarkdownPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const lastSeparatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const directory = lastSeparatorIndex >= 0 ? path.slice(0, lastSeparatorIndex) : '.';

  return `${directory}${separator}full.md`;
}

export function buildMineruCachePaths(rootDir: string, item: WorkspaceItem): MineruCachePaths {
  return buildSharedMineruCachePaths(rootDir, item);
}

export function buildTitleMineruCachePaths(rootDir: string, item: WorkspaceItem): MineruCachePaths {
  return buildSharedTitleMineruCachePaths(rootDir, item);
}

export function buildLegacyMineruCachePaths(rootDir: string, item: WorkspaceItem): MineruCachePaths {
  return buildSharedLegacyMineruCachePaths(rootDir, item);
}

export function getMineruJsonPathCandidates(cachePaths: MineruCachePaths): string[] {
  return getSharedMineruJsonPathCandidates(cachePaths);
}

export function buildMineruCachePathCandidates(rootDir: string, item: WorkspaceItem): MineruCachePaths[] {
  return buildSharedMineruCachePathCandidates(rootDir, item);
}

export function buildMineruTranslationCachePath(
  rootDir: string,
  item: WorkspaceItem,
  targetLanguage: string,
): string {
  const cachePaths = buildMineruCachePaths(rootDir, item);
  const languageSegment = sanitizePathSegment(targetLanguage || 'default');

  return joinPath(cachePaths.translationsDir, `${languageSegment}.json`);
}

export function buildLegacyMineruTranslationCachePath(
  rootDir: string,
  item: WorkspaceItem,
  targetLanguage: string,
): string {
  const cachePaths = buildLegacyMineruCachePaths(rootDir, item);
  const languageSegment = sanitizePathSegment(targetLanguage || 'default');

  return joinPath(cachePaths.translationsDir, `${languageSegment}.json`);
}

export function buildMineruTranslationCachePathCandidates(
  rootDir: string,
  item: WorkspaceItem,
  targetLanguage: string,
): string[] {
  const languageSegment = sanitizePathSegment(targetLanguage || 'default');

  return buildMineruCachePathCandidates(rootDir, item).map((cachePaths) =>
    joinPath(cachePaths.translationsDir, `${languageSegment}.json`)
  );
}

export function buildMineruSummaryCachePath(
  rootDir: string,
  item: WorkspaceItem,
  sourceKey: string,
): string {
  const cachePaths = buildMineruCachePaths(rootDir, item);
  const fileName = `${hashString(sourceKey || 'summary')}.json`;

  return joinPath(cachePaths.summariesDir, fileName);
}

export function buildLegacyMineruSummaryCachePath(
  rootDir: string,
  item: WorkspaceItem,
  sourceKey: string,
): string {
  const cachePaths = buildLegacyMineruCachePaths(rootDir, item);
  const fileName = `${hashString(sourceKey || 'summary')}.json`;

  return joinPath(cachePaths.summariesDir, fileName);
}

export function buildMineruSummaryCachePathCandidates(
  rootDir: string,
  item: WorkspaceItem,
  sourceKey: string,
): string[] {
  const fileName = `${hashString(sourceKey || 'summary')}.json`;

  return buildMineruCachePathCandidates(rootDir, item).map((cachePaths) =>
    joinPath(cachePaths.summariesDir, fileName)
  );
}

export function buildSiblingPath(path: string, fileName: string): string {
  const separator = getPathSeparator(path);
  const lastSeparatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const directory = lastSeparatorIndex >= 0 ? path.slice(0, lastSeparatorIndex) : '';

  return directory ? `${directory}${separator}${fileName}` : fileName;
}

// buildCachePaths 供只需要目录内标准文件布局的调用方使用（与共享实现一致）。
export { buildCachePaths };
