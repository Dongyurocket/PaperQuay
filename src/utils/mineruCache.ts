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

/**
 * 译文缓存的身份信息。缓存文件按「目标语言 + 模型身份 + 源语言」隔离：
 * 切换模型或源语言后不会读到另一套译文，读取时仍会把旧版
 * `<targetLanguage>.json` 作为候选回退。
 */
export interface MineruTranslationCacheIdentity {
  baseUrl: string;
  model: string;
  sourceLanguage: string;
}

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

export function buildMineruTranslationCacheFileName(
  targetLanguage: string,
  identity?: MineruTranslationCacheIdentity | null,
): string {
  const languageSegment = sanitizePathSegment(targetLanguage || 'default');

  if (!identity) {
    return `${languageSegment}.json`;
  }

  // 身份哈希覆盖模型地址、模型名与源语言；目标语言已经在文件名前缀里。
  const identityHash = hashString([
    String(identity.sourceLanguage ?? '').trim(),
    String(identity.baseUrl ?? '').trim(),
    String(identity.model ?? '').trim(),
  ].join('\n'));

  return `${languageSegment}-${identityHash}.json`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断文件名是否属于某个目标语言的译文缓存（旧版 `<language>.json`
 * 或新版 `<language>-<8位身份哈希>.json`）。清除缓存时用它过滤目录列表，
 * 避免误删其它语言或无关文件。
 */
export function isMineruTranslationCacheFileName(
  fileName: string,
  targetLanguage: string,
): boolean {
  const languageSegment = sanitizePathSegment(targetLanguage || 'default');
  const normalized = String(fileName ?? '').trim().toLowerCase();

  if (normalized === `${languageSegment}.json`) {
    return true;
  }

  return new RegExp(`^${escapeRegExp(languageSegment)}-[0-9a-f]{8}\\.json$`).test(normalized);
}

export function buildMineruTranslationCachePath(
  rootDir: string,
  item: WorkspaceItem,
  targetLanguage: string,
  identity?: MineruTranslationCacheIdentity | null,
): string {
  const cachePaths = buildMineruCachePaths(rootDir, item);

  return joinPath(
    cachePaths.translationsDir,
    buildMineruTranslationCacheFileName(targetLanguage, identity),
  );
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

export function buildMineruTranslationCachePathCandidatesForLayout(
  cachePaths: MineruCachePaths,
  targetLanguage: string,
  identity?: MineruTranslationCacheIdentity | null,
): string[] {
  const fileNames = identity
    ? [
        buildMineruTranslationCacheFileName(targetLanguage, identity),
        buildMineruTranslationCacheFileName(targetLanguage),
      ]
    : [buildMineruTranslationCacheFileName(targetLanguage)];

  return [...new Set(fileNames)].map((fileName) =>
    joinPath(cachePaths.translationsDir, fileName)
  );
}

export function buildMineruTranslationCachePathCandidates(
  rootDir: string,
  item: WorkspaceItem,
  targetLanguage: string,
  identity?: MineruTranslationCacheIdentity | null,
): string[] {
  return buildMineruCachePathCandidates(rootDir, item).flatMap((cachePaths) =>
    buildMineruTranslationCachePathCandidatesForLayout(
      cachePaths,
      targetLanguage,
      identity,
    )
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
