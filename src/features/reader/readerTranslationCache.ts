import type { TranslationMap, WorkspaceItem } from '../../types/reader';
import { readLocalTextFileIfExists, writeLocalTextFile } from '../../services/desktop';
import {
  buildMineruTranslationCachePath,
  buildMineruTranslationCachePathCandidates,
} from '../../utils/mineruCache.ts';
import type { TranslationCacheEnvelope } from './readerShared';
import { normalizeTranslationMap } from './readerTranslation';

const translationCacheWriteChains = new Map<string, Promise<unknown>>();

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

export async function readTranslationCache({
  item,
  mineruCacheDir,
  targetLanguage,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  targetLanguage: string;
}): Promise<TranslationCacheReadResult | null> {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const candidatePaths = buildMineruTranslationCachePathCandidates(
    mineruCacheDir.trim(),
    item,
    targetLanguage,
  );
  let lastReadError: unknown = null;

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readLocalTextFileIfExists(candidatePath);
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
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  translations: TranslationMap;
}) {
  if (!mineruCacheDir.trim()) {
    return null;
  }

  const cachePath = buildMineruTranslationCachePath(
    mineruCacheDir.trim(),
    item,
    targetLanguage,
  );
  const payload: TranslationCacheEnvelope = {
    version: 1,
    sourceLanguage,
    targetLanguage,
    translatedAt: new Date().toISOString(),
    translations: normalizeTranslationMap(translations),
  };

  await enqueueTranslationCacheWrite(cachePath, () =>
    writeLocalTextFile(cachePath, JSON.stringify(payload, null, 2)),
  );
  return cachePath;
}
