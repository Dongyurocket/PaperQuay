import type { TranslationMap, WorkspaceItem } from '../../types/reader';
import {
  buildMineruTranslationCachePath,
  buildMineruTranslationCachePathCandidates,
} from '../../utils/mineruCache.ts';
import type { TranslationCacheEnvelope } from './readerShared.ts';
import { normalizeTranslationMap } from './readerTranslation.ts';

const translationCacheWriteChains = new Map<string, Promise<unknown>>();
const translationCacheFallbackRoots = new Map<string, string>();

async function defaultReadText(path: string): Promise<string | null> {
  const { readLocalTextFileIfExists } = await import('../../services/desktop.ts');
  return readLocalTextFileIfExists(path);
}

async function defaultWriteText(path: string, content: string): Promise<void> {
  const { writeLocalTextFile } = await import('../../services/desktop.ts');
  await writeLocalTextFile(path, content);
}

let defaultTranslationCacheRootPromise: Promise<string> | null = null;

async function resolveDefaultTranslationCacheRoot(): Promise<string> {
  if (!defaultTranslationCacheRootPromise) {
    defaultTranslationCacheRootPromise = import('../../services/desktop.ts')
      .then(({ getAppDefaultPaths }) => getAppDefaultPaths())
      .then((paths) => paths.mineruCacheDir?.trim() ?? '')
      .catch(() => '');
  }

  return defaultTranslationCacheRootPromise;
}

function normalizeCacheRoot(value: string): string {
  return value.trim().replace(/[\\/]+$/, '');
}

async function resolveFallbackTranslationCacheRoot(
  primaryRoot: string,
  resolver: () => Promise<string>,
): Promise<string> {
  const fallbackRoot = normalizeCacheRoot(await resolver());

  if (!fallbackRoot || fallbackRoot === normalizeCacheRoot(primaryRoot)) {
    return '';
  }

  return fallbackRoot;
}

function translationCacheErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasAllTranslations(
  cachedTranslations: TranslationMap,
  expectedTranslations: TranslationMap,
): boolean {
  for (const [blockId, translatedText] of Object.entries(expectedTranslations)) {
    if ((cachedTranslations[blockId] ?? '').trim() !== translatedText.trim()) {
      return false;
    }
  }

  return true;
}

async function enqueueTranslationCacheWrite<T>(
  cachePath: string,
  write: () => Promise<T>,
): Promise<T> {
  const previousWrite = translationCacheWriteChains.get(cachePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(write);

  translationCacheWriteChains.set(cachePath, nextWrite);

  try {
    return await nextWrite;
  } finally {
    if (translationCacheWriteChains.get(cachePath) === nextWrite) {
      translationCacheWriteChains.delete(cachePath);
    }
  }
}

export interface TranslationCacheReadResult {
  path: string;
  sourceLanguage: string;
  targetLanguage: string;
  translatedAt: string;
  translations: TranslationMap;
}

function translationCacheCompleteness(result: TranslationCacheReadResult): number {
  return Object.keys(result.translations).length;
}

function translationCacheTime(result: TranslationCacheReadResult): number {
  const value = Date.parse(result.translatedAt);
  return Number.isFinite(value) ? value : 0;
}

function isBetterTranslationCache(
  candidate: TranslationCacheReadResult,
  current: TranslationCacheReadResult,
): boolean {
  const candidateCount = translationCacheCompleteness(candidate);
  const currentCount = translationCacheCompleteness(current);

  if (candidateCount !== currentCount) {
    return candidateCount > currentCount;
  }

  return translationCacheTime(candidate) > translationCacheTime(current);
}

export async function readTranslationCache({
  item,
  mineruCacheDir,
  targetLanguage,
  readText = defaultReadText,
  resolveFallbackRoot = resolveDefaultTranslationCacheRoot,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  targetLanguage: string;
  readText?: (path: string) => Promise<string | null>;
  resolveFallbackRoot?: () => Promise<string>;
}): Promise<TranslationCacheReadResult | null> {
  const primaryRoot = normalizeCacheRoot(mineruCacheDir);

  if (!primaryRoot) {
    return null;
  }

  let lastReadError: unknown = null;

  const readCandidates = async (candidatePaths: string[]) => {
    for (const candidatePath of candidatePaths) {
      try {
        const raw = await readText(candidatePath);
        if (!raw) {
          continue;
        }

        const parsed = JSON.parse(raw) as Partial<TranslationCacheEnvelope>;
        const translations = normalizeTranslationMap(parsed?.translations);

        if (Object.keys(translations).length === 0) {
          continue;
        }

        return {
          path: candidatePath,
          sourceLanguage: parsed?.sourceLanguage ?? '',
          targetLanguage: parsed?.targetLanguage ?? targetLanguage,
          translatedAt: parsed?.translatedAt ?? '',
          translations,
        };
      } catch (error) {
        lastReadError = error;
        continue;
      }
    }

    return null;
  };

  const primaryResult = await readCandidates(
    buildMineruTranslationCachePathCandidates(primaryRoot, item, targetLanguage),
  );
  const fallbackRoot = await resolveFallbackTranslationCacheRoot(
    primaryRoot,
    resolveFallbackRoot,
  );
  const fallbackResult = fallbackRoot
    ? await readCandidates(
        buildMineruTranslationCachePathCandidates(fallbackRoot, item, targetLanguage),
      )
    : null;

  if (primaryResult && fallbackResult) {
    return isBetterTranslationCache(fallbackResult, primaryResult)
      ? fallbackResult
      : primaryResult;
  }

  if (primaryResult || fallbackResult) {
    return primaryResult ?? fallbackResult;
  }

  if (lastReadError) {
    const message = lastReadError instanceof Error
      ? lastReadError.message
      : String(lastReadError);
    throw new Error(`Failed to read translation cache: ${message}`);
  }

  return null;
}

export async function writeTranslationCache({
  item,
  mineruCacheDir,
  sourceLanguage,
  targetLanguage,
  translations,
  writeText = defaultWriteText,
  readText = defaultReadText,
  resolveFallbackRoot = resolveDefaultTranslationCacheRoot,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  translations: TranslationMap;
  writeText?: (path: string, content: string) => Promise<void>;
  readText?: (path: string) => Promise<string | null>;
  resolveFallbackRoot?: () => Promise<string>;
}) {
  const primaryRoot = normalizeCacheRoot(mineruCacheDir);

  if (!primaryRoot) {
    return null;
  }

  const payload: TranslationCacheEnvelope = {
    version: 1,
    sourceLanguage,
    targetLanguage,
    translatedAt: new Date().toISOString(),
    translations: normalizeTranslationMap(translations),
  };
  const content = JSON.stringify(payload, null, 2);
  const primaryPath = buildMineruTranslationCachePath(
    primaryRoot,
    item,
    targetLanguage,
  );
  const preferredFallbackRoot = translationCacheFallbackRoots.get(primaryPath);

  if (preferredFallbackRoot) {
    const preferredFallbackPath = buildMineruTranslationCachePath(
      preferredFallbackRoot,
      item,
      targetLanguage,
    );

    try {
      await enqueueTranslationCacheWrite(
        preferredFallbackPath,
        () => writeText(preferredFallbackPath, content),
      );
      return preferredFallbackPath;
    } catch {
      translationCacheFallbackRoots.delete(primaryPath);
    }
  }

  try {
    await enqueueTranslationCacheWrite(primaryPath, () => writeText(primaryPath, content));
    translationCacheFallbackRoots.delete(primaryPath);
    return primaryPath;
  } catch (primaryError) {
    // 译文可能已经在缓存里（例如只读文件、重复点击全文翻译、上一次进度写入
    // 已完整落盘）。先读回比对，避免为了重写一份完全相同的数据而报错或再
    // 复制一份到备用目录。
    const existingCache = await readTranslationCache({
      item,
      mineruCacheDir: primaryRoot,
      targetLanguage,
      readText,
      resolveFallbackRoot,
    }).catch(() => null);

    if (
      existingCache
      && hasAllTranslations(existingCache.translations, payload.translations)
    ) {
      console.warn(
        `Translation cache write failed under ${primaryPath}, but the existing cache already contains every translation.`,
        primaryError,
      );
      return existingCache.path;
    }

    const fallbackRoot = await resolveFallbackTranslationCacheRoot(
      primaryRoot,
      resolveFallbackRoot,
    );

    if (!fallbackRoot) {
      throw primaryError;
    }

    const fallbackPath = buildMineruTranslationCachePath(
      fallbackRoot,
      item,
      targetLanguage,
    );

    try {
      await enqueueTranslationCacheWrite(fallbackPath, () => writeText(fallbackPath, content));
      translationCacheFallbackRoots.set(primaryPath, fallbackRoot);
      console.warn(
        `Translation cache write failed under ${primaryPath}; saved to the default cache instead.`,
        primaryError,
      );
      return fallbackPath;
    } catch (fallbackError) {
      throw new Error(
        `译文缓存写入失败。主缓存目录：${translationCacheErrorMessage(primaryError)}；备用缓存目录：${translationCacheErrorMessage(fallbackError)}`,
      );
    }
  }
}
