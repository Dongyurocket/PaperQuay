import { readLocalBinaryFile, readMineruAssetBytes } from './desktop';
import { bytesToDataUrl, guessMimeTypeFromPath } from '../utils/files';

const localAssetUrlCache = new Map<string, Promise<string>>();
const mineruAssetUrlCache = new Map<string, Promise<string>>();

export async function loadMineruAssetDataUrl(
  cacheDir: string,
  assetReference: string,
): Promise<string> {
  const normalizedCacheDir = cacheDir.trim();
  const normalizedReference = assetReference.trim();

  if (!normalizedCacheDir || !normalizedReference) {
    throw new Error('MinerU asset path is empty');
  }

  const cacheKey = `${normalizedCacheDir}\0${normalizedReference}`;
  const existingTask = mineruAssetUrlCache.get(cacheKey);

  if (existingTask) {
    return existingTask;
  }

  const nextTask = readMineruAssetBytes(normalizedCacheDir, normalizedReference).then((bytes) =>
    bytesToDataUrl(bytes, guessMimeTypeFromPath(normalizedReference)),
  );

  mineruAssetUrlCache.set(cacheKey, nextTask);

  try {
    return await nextTask;
  } catch (error) {
    mineruAssetUrlCache.delete(cacheKey);
    throw error;
  }
}

export async function loadLocalAssetDataUrl(path: string): Promise<string> {
  const normalizedPath = path.trim();

  if (!normalizedPath) {
    throw new Error('Asset path is empty');
  }

  if (/^[a-zA-Z]+:\/\//.test(normalizedPath)) {
    return normalizedPath;
  }

  const existingTask = localAssetUrlCache.get(normalizedPath);

  if (existingTask) {
    return existingTask;
  }

  const nextTask = readLocalBinaryFile(normalizedPath).then((bytes) =>
    bytesToDataUrl(bytes, guessMimeTypeFromPath(normalizedPath)),
  );

  localAssetUrlCache.set(normalizedPath, nextTask);

  try {
    return await nextTask;
  } catch (error) {
    localAssetUrlCache.delete(normalizedPath);
    throw error;
  }
}

export function clearLocalAssetDataUrlCache(path?: string): void {
  if (path) {
    localAssetUrlCache.delete(path.trim());
    return;
  }

  localAssetUrlCache.clear();
}
