import type { TranslationMap, TranslationSourceHashes, WorkspaceItem } from '../../types/reader';
import {
  buildMineruCachePathCandidates,
  buildMineruTranslationCacheFileName,
  buildMineruTranslationCachePath,
  buildMineruTranslationCachePathCandidates,
  buildMineruTranslationCachePathCandidatesForLayout,
  isMineruTranslationCacheFileName,
  type MineruTranslationCacheIdentity,
} from '../../utils/mineruCache.ts';
import { getFileNameFromPath } from '../../utils/text.ts';
import type { TranslationCacheEnvelope } from './readerShared.ts';
import { normalizeTranslationMap } from './readerTranslation.ts';

export type TranslationCacheIdentity = MineruTranslationCacheIdentity;

const translationCacheWriteChains = new Map<string, Promise<unknown>>();
const translationCacheFallbackRoots = new Map<string, string>();
const translationCacheEpochs = new Map<string, number>();
const clearedTranslationCacheKeys = new Set<string>();

async function defaultReadText(path: string): Promise<string | null> {
  const { readLocalTextFileIfExists } = await import('../../services/desktop.ts');
  return readLocalTextFileIfExists(path);
}

async function defaultWriteText(path: string, content: string): Promise<void> {
  const { writeLocalTextFile } = await import('../../services/desktop.ts');
  await writeLocalTextFile(path, content);
}

async function defaultDeleteText(path: string): Promise<boolean> {
  const { deleteLocalTextFile } = await import('../../services/desktop.ts');
  return deleteLocalTextFile(path);
}

async function defaultListTranslationCacheFiles(directory: string): Promise<string[]> {
  const { listLocalDirectoryFiles } = await import('../../services/desktop.ts');
  const entries = await listLocalDirectoryFiles(directory, 'json');
  return entries.map((entry) => entry.path);
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

export function createTranslationCacheIdentity(
  baseUrl?: string,
  model?: string,
  sourceLanguage?: string,
): TranslationCacheIdentity | null {
  const trimmedBaseUrl = String(baseUrl ?? '').trim();
  const trimmedModel = String(model ?? '').trim();

  if (!trimmedBaseUrl && !trimmedModel) {
    return null;
  }

  return {
    baseUrl: trimmedBaseUrl,
    model: trimmedModel,
    sourceLanguage: String(sourceLanguage ?? '').trim(),
  };
}

/**
 * 未显式传入模型身份时（文库页预览、文库页翻译等调用方），从渲染层设置
 * 缓存里解析当前翻译预设，让这些路径和阅读器写入同一份身份缓存。缓存未
 * hydrate、纯 Node 环境或解析失败时返回 null，退回旧版 `<targetLanguage>.json`。
 */
async function resolveDefaultTranslationCacheIdentity(): Promise<TranslationCacheIdentity | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const [{ getAppSettingsSnapshot, getAppSettingsSecretsSnapshot }, { resolveModelPreset }] =
      await Promise.all([
        import('../../app/settings/appSettingsCache.ts'),
        import('./readerShared.ts'),
      ]);
    const settingsSnapshot = getAppSettingsSnapshot();

    if (!settingsSnapshot) {
      return null;
    }

    const presets = getAppSettingsSecretsSnapshot()?.qaModelPresets ?? [];
    const preset = resolveModelPreset(
      presets,
      settingsSnapshot.settings.translationModelPresetId,
    );

    return createTranslationCacheIdentity(
      preset?.baseUrl,
      preset?.model,
      settingsSnapshot.settings.translationSourceLanguage,
    );
  } catch {
    return null;
  }
}

export function translationCacheSessionKey(
  item: WorkspaceItem,
  targetLanguage: string,
): string {
  const itemKey = item.workspaceId || item.itemKey || item.title || 'document';
  return `${itemKey}\u0000${targetLanguage.trim()}`;
}

export interface TranslationCacheRestoreToken {
  key: string;
  generation: number;
}

/**
 * 开始一次磁盘译文恢复。返回 null 表示当前文稿+目标语言在本会话内已被清除，
 * 不应再读磁盘；返回 token 时，读取完成后再用
 * `isTranslationCacheRestoreTokenCurrent` 判断期间是否发生过清除。
 */
export function beginTranslationCacheRestore(
  item: WorkspaceItem,
  targetLanguage: string,
): TranslationCacheRestoreToken | null {
  const key = translationCacheSessionKey(item, targetLanguage);

  if (clearedTranslationCacheKeys.has(key)) {
    return null;
  }

  return { key, generation: translationCacheEpochs.get(key) ?? 0 };
}

export function isTranslationCacheRestoreTokenCurrent(
  token: TranslationCacheRestoreToken,
): boolean {
  return (translationCacheEpochs.get(token.key) ?? 0) === token.generation;
}

export function markTranslationCacheCleared(
  item: WorkspaceItem,
  targetLanguage: string,
): void {
  const key = translationCacheSessionKey(item, targetLanguage);

  clearedTranslationCacheKeys.add(key);
  translationCacheEpochs.set(key, (translationCacheEpochs.get(key) ?? 0) + 1);
}

export function hasTranslationCacheClearedMarker(
  item: WorkspaceItem,
  targetLanguage: string,
): boolean {
  return clearedTranslationCacheKeys.has(translationCacheSessionKey(item, targetLanguage));
}

export function clearTranslationCacheClearedMarker(
  item: WorkspaceItem,
  targetLanguage: string,
): void {
  clearedTranslationCacheKeys.delete(translationCacheSessionKey(item, targetLanguage));
}

/** 测试用：清空会话内的 epoch / 清除标记。 */
export function resetTranslationCacheSessionState(): void {
  translationCacheEpochs.clear();
  clearedTranslationCacheKeys.clear();
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
  /** 译文写入时记录的源文本指纹；旧版缓存没有该字段 */
  sourceHashes: TranslationSourceHashes;
}

function translationCacheCompleteness(result: TranslationCacheReadResult): number {
  return Object.keys(result.translations).length;
}

function translationCacheTime(result: TranslationCacheReadResult): number {
  const value = Date.parse(result.translatedAt);
  return Number.isFinite(value) ? value : 0;
}

function readSourceHashes(value: unknown): TranslationSourceHashes {
  const hashes: TranslationSourceHashes = {};

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return hashes;
  }

  for (const [blockId, hash] of Object.entries(value as Record<string, unknown>)) {
    const nextBlockId = blockId.trim();
    const nextHash = typeof hash === 'string' ? hash.trim() : '';

    if (nextBlockId && nextHash) {
      hashes[nextBlockId] = nextHash;
    }
  }

  return hashes;
}

function pruneSourceHashes(
  sourceHashes: TranslationSourceHashes,
  translations: TranslationMap,
): TranslationSourceHashes {
  const pruned: TranslationSourceHashes = {};

  for (const [blockId, hash] of Object.entries(sourceHashes)) {
    if (blockId in translations) {
      pruned[blockId] = hash;
    }
  }

  return pruned;
}

export async function readTranslationCache({
  item,
  mineruCacheDir,
  targetLanguage,
  identity,
  readText = defaultReadText,
  resolveFallbackRoot = resolveDefaultTranslationCacheRoot,
  resolveIdentity = resolveDefaultTranslationCacheIdentity,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  targetLanguage: string;
  identity?: TranslationCacheIdentity | null;
  readText?: (path: string) => Promise<string | null>;
  resolveFallbackRoot?: () => Promise<string>;
  resolveIdentity?: () => Promise<TranslationCacheIdentity | null>;
}): Promise<TranslationCacheReadResult | null> {
  const primaryRoot = normalizeCacheRoot(mineruCacheDir);

  if (!primaryRoot) {
    return null;
  }

  const resolvedIdentity = identity === undefined ? await resolveIdentity() : identity;
  let lastReadError: unknown = null;

  const readCandidates = async (candidatePaths: string[]) => {
    const results: TranslationCacheReadResult[] = [];

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

        results.push({
          path: candidatePath,
          sourceLanguage: parsed?.sourceLanguage ?? '',
          targetLanguage: parsed?.targetLanguage ?? targetLanguage,
          translatedAt: parsed?.translatedAt ?? '',
          translations,
          sourceHashes: readSourceHashes(parsed?.sourceHashes),
        });
      } catch (error) {
        lastReadError = error;
        continue;
      }
    }

    return results;
  };

  const readRootCandidates = async (root: string) => {
    const results: TranslationCacheReadResult[] = [];

    // 一个文稿最多有三种历史目录布局。保持原来的提前退出策略：某个布局
    // 读到有效缓存后就不再扫后续布局，但同一布局内会同时读新身份缓存和
    // 旧版 <targetLanguage>.json，合并两边的块。
    for (const cachePaths of buildMineruCachePathCandidates(root, item)) {
      const layoutResults = await readCandidates(
        buildMineruTranslationCachePathCandidatesForLayout(
          cachePaths,
          targetLanguage,
          resolvedIdentity,
        ),
      );

      if (layoutResults.length > 0) {
        results.push(...layoutResults);
        break;
      }
    }

    return results;
  };

  const primaryResults = await readRootCandidates(primaryRoot);
  const fallbackRoot = await resolveFallbackTranslationCacheRoot(
    primaryRoot,
    resolveFallbackRoot,
  );
  const fallbackResults = fallbackRoot
    ? await readRootCandidates(fallbackRoot)
    : [];
  const allResults = [...primaryResults, ...fallbackResults];

  if (allResults.length === 0) {
    if (lastReadError) {
      const message = lastReadError instanceof Error
        ? lastReadError.message
        : String(lastReadError);
      throw new Error(`Failed to read translation cache: ${message}`);
    }

    return null;
  }

  // 最完整的缓存作为基准，其余候选只补齐缺失块：新身份缓存、旧版
  // <targetLanguage>.json 和备用缓存目录里的历史译文都能继续生效，
  // 但不会用更旧的译文覆盖更完整的缓存。当前模型的身份缓存优先于旧版
  // 语言缓存，避免旧缓存块更多时把当前模型刚写入的译文盖掉；同一优先级
  // 内再按完整度和写入时间排序。
  const identityFileName = resolvedIdentity
    ? buildMineruTranslationCacheFileName(targetLanguage, resolvedIdentity).toLowerCase()
    : '';
  const isCurrentIdentityResult = (result: TranslationCacheReadResult) =>
    Boolean(identityFileName)
    && getFileNameFromPath(result.path).toLowerCase() === identityFileName;
  const sortedResults = [...allResults].sort((left, right) => {
    const identityRank = Number(isCurrentIdentityResult(right))
      - Number(isCurrentIdentityResult(left));

    if (identityRank !== 0) {
      return identityRank;
    }

    const completeness = translationCacheCompleteness(right) - translationCacheCompleteness(left);

    return completeness !== 0
      ? completeness
      : translationCacheTime(right) - translationCacheTime(left);
  });
  const bestResult = sortedResults[0];
  const mergedTranslations: TranslationMap = {};
  const mergedSourceHashes: TranslationSourceHashes = {};

  for (const result of sortedResults) {
    for (const [blockId, translatedText] of Object.entries(result.translations)) {
      if (!(blockId in mergedTranslations)) {
        mergedTranslations[blockId] = translatedText;
      }
    }

    for (const [blockId, sourceHash] of Object.entries(result.sourceHashes)) {
      if (!(blockId in mergedSourceHashes)) {
        mergedSourceHashes[blockId] = sourceHash;
      }
    }
  }

  return {
    ...bestResult,
    translations: mergedTranslations,
    sourceHashes: pruneSourceHashes(mergedSourceHashes, mergedTranslations),
  };
}

export async function writeTranslationCache({
  item,
  mineruCacheDir,
  sourceLanguage,
  targetLanguage,
  translations,
  sourceHashes,
  identity,
  writeText = defaultWriteText,
  readText = defaultReadText,
  resolveFallbackRoot = resolveDefaultTranslationCacheRoot,
  resolveIdentity = resolveDefaultTranslationCacheIdentity,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  sourceLanguage: string;
  targetLanguage: string;
  translations: TranslationMap;
  /** 本次写入的译文对应的块级源文本指纹；旧调用方可省略。 */
  sourceHashes?: TranslationSourceHashes | null;
  identity?: TranslationCacheIdentity | null;
  writeText?: (path: string, content: string) => Promise<void>;
  readText?: (path: string) => Promise<string | null>;
  resolveFallbackRoot?: () => Promise<string>;
  resolveIdentity?: () => Promise<TranslationCacheIdentity | null>;
}): Promise<string | null> {
  const primaryRoot = normalizeCacheRoot(mineruCacheDir);

  if (!primaryRoot) {
    return null;
  }

  const resolvedIdentity = identity === undefined ? await resolveIdentity() : identity;
  const incomingTranslations = normalizeTranslationMap(translations);
  const incomingSourceHashes = pruneSourceHashes(
    readSourceHashes(sourceHashes),
    incomingTranslations,
  );
  const primaryPath = buildMineruTranslationCachePath(
    primaryRoot,
    item,
    targetLanguage,
    resolvedIdentity,
  );
  const sessionKey = translationCacheSessionKey(item, targetLanguage);
  const generationAtWriteStart = translationCacheEpochs.get(sessionKey) ?? 0;

  // 同一缓存文件的写入都走这把进程内锁：锁内先读回磁盘上的旧译文，按块
  // 合并后再写，因此全文翻译进度、单块重译和文库页翻译并发写入时不会互相
  // 覆盖。限制：锁只覆盖当前渲染进程；多窗口或独立 MCP 进程同时写同一文件
  // 时，原子替换只能保证文件不撕裂，后写者仍可能覆盖先写者刚写入的块。
  const savedPath = await enqueueTranslationCacheWrite(primaryPath, async () => {
    // 用户刚清除缓存且磁盘删除失败时，会话清除标记仍在；此时不要把旧文件
    // 合并回来，否则下一次翻译会把刚清除的旧译文重新写进缓存。
    const existingCache = hasTranslationCacheClearedMarker(item, targetLanguage)
      ? null
      : await readTranslationCache({
          item,
          mineruCacheDir: primaryRoot,
          targetLanguage,
          identity: resolvedIdentity,
          readText,
          resolveFallbackRoot,
        }).catch((error) => {
          console.warn('Failed to read the translation cache before merging', error);
          return null;
        });
    const mergedTranslations: TranslationMap = {
      ...(existingCache?.translations ?? {}),
      ...incomingTranslations,
    };
    // 旧版缓存没有指纹，只有本次新写入的块带指纹；合并时按块覆盖，
    // 并剪掉已经没有译文的块，避免缓存文件无限增长。本次重写的块即使
    // 没有携带指纹，也必须丢掉旧指纹，否则新译文会被旧指纹判成过期。
    const mergedSourceHashes: TranslationSourceHashes = {
      ...(existingCache?.sourceHashes ?? {}),
    };

    for (const blockId of Object.keys(incomingTranslations)) {
      delete mergedSourceHashes[blockId];
    }

    Object.assign(mergedSourceHashes, incomingSourceHashes);
    const payload: TranslationCacheEnvelope = {
      version: 2,
      sourceLanguage,
      targetLanguage,
      translatedAt: new Date().toISOString(),
      translations: mergedTranslations,
      sourceHashes: pruneSourceHashes(mergedSourceHashes, mergedTranslations),
    };
    const content = JSON.stringify(payload, null, 2);
    const preferredFallbackRoot = translationCacheFallbackRoots.get(primaryPath);

    if (preferredFallbackRoot) {
      const preferredFallbackPath = buildMineruTranslationCachePath(
        preferredFallbackRoot,
        item,
        targetLanguage,
        resolvedIdentity,
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
      // 已经在 primaryPath 的写锁里，直接写，不能再 enqueue 同一路径。
      await writeText(primaryPath, content);
      translationCacheFallbackRoots.delete(primaryPath);
      return primaryPath;
    } catch (primaryError) {
      // 译文可能已经在缓存里（例如只读文件、重复点击全文翻译、上一次进度写入
      // 已完整落盘）。先读回比对，避免为了重写一份完全相同的数据而报错或再
      // 复制一份到备用目录。
      const existingCacheAfterFailure = await readTranslationCache({
        item,
        mineruCacheDir: primaryRoot,
        targetLanguage,
        identity: resolvedIdentity,
        readText,
        resolveFallbackRoot,
      }).catch(() => null);

      if (
        existingCacheAfterFailure
        && hasAllTranslations(existingCacheAfterFailure.translations, mergedTranslations)
      ) {
        console.warn(
          `Translation cache write failed under ${primaryPath}, but the existing cache already contains every translation.`,
          primaryError,
        );
        return existingCacheAfterFailure.path;
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
        resolvedIdentity,
      );

      try {
        await enqueueTranslationCacheWrite(
          fallbackPath,
          () => writeText(fallbackPath, content),
        );
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
  });

  // 成功写入（含备用目录和“已有完整缓存”）说明清除后的新基线已经建立，
  // 后续恢复可以正常读取这份缓存。若这次写入期间用户点了清除（generation
  // 已变化），保留清除标记：本次写入发生在清除之前，不能解除屏蔽。
  if ((translationCacheEpochs.get(sessionKey) ?? 0) === generationAtWriteStart) {
    clearTranslationCacheClearedMarker(item, targetLanguage);
  }

  return savedPath;
}

export interface TranslationCacheDeleteFailure {
  path: string;
  message: string;
}

export interface TranslationCacheDeleteResult {
  deletedPaths: string[];
  failed: TranslationCacheDeleteFailure[];
}

export async function deleteTranslationCache({
  item,
  mineruCacheDir,
  targetLanguage,
  identity,
  deleteText = defaultDeleteText,
  listFiles = defaultListTranslationCacheFiles,
  resolveFallbackRoot = resolveDefaultTranslationCacheRoot,
  resolveIdentity = resolveDefaultTranslationCacheIdentity,
}: {
  item: WorkspaceItem;
  mineruCacheDir: string;
  targetLanguage: string;
  identity?: TranslationCacheIdentity | null;
  deleteText?: (path: string) => Promise<boolean>;
  listFiles?: (directory: string) => Promise<string[]>;
  resolveFallbackRoot?: () => Promise<string>;
  resolveIdentity?: () => Promise<TranslationCacheIdentity | null>;
}): Promise<TranslationCacheDeleteResult> {
  // 先记录会话清除状态：即使接下来的磁盘删除失败，恢复流程也不能把用户
  // 刚清除的旧译文重新读回来。
  markTranslationCacheCleared(item, targetLanguage);

  const result: TranslationCacheDeleteResult = { deletedPaths: [], failed: [] };
  const primaryRoot = normalizeCacheRoot(mineruCacheDir);

  if (!primaryRoot) {
    return result;
  }

  const resolvedIdentity = identity === undefined ? await resolveIdentity() : identity;
  const fallbackRoot = await resolveFallbackTranslationCacheRoot(
    primaryRoot,
    resolveFallbackRoot,
  );
  const roots = fallbackRoot ? [primaryRoot, fallbackRoot] : [primaryRoot];
  const candidatePaths = new Set<string>();

  for (const root of roots) {
    for (const candidatePath of buildMineruTranslationCachePathCandidates(
      root,
      item,
      targetLanguage,
      resolvedIdentity,
    )) {
      candidatePaths.add(candidatePath);
    }

    // 目录里可能还有其它模型写下的身份缓存；按文件名规则一并清掉。
    // 目录不存在或没有读取权限时退回上面的候选路径，不影响清除主流程。
    for (const cachePaths of buildMineruCachePathCandidates(root, item)) {
      try {
        for (const listedPath of await listFiles(cachePaths.translationsDir)) {
          if (isMineruTranslationCacheFileName(getFileNameFromPath(listedPath), targetLanguage)) {
            candidatePaths.add(listedPath);
          }
        }
      } catch {
        // 目录读取失败时忽略：候选路径删除仍然有效。
      }
    }
  }

  for (const candidatePath of candidatePaths) {
    // 清除期间如果已有新译文成功落盘，它会解除会话标记并建立新基线；
    // 此时继续删除会破坏刚写入的译文，保留新缓存即可。
    if (!hasTranslationCacheClearedMarker(item, targetLanguage)) {
      break;
    }

    try {
      // 与写入共用同一把路径锁：已经排队的写入先落盘，然后由删除覆盖，
      // 避免一次清除被更早发起的进度写入重新创建文件。
      const deleted = await enqueueTranslationCacheWrite(
        candidatePath,
        () => deleteText(candidatePath),
      );

      if (deleted) {
        result.deletedPaths.push(candidatePath);
      }
    } catch (error) {
      result.failed.push({
        path: candidatePath,
        message: translationCacheErrorMessage(error),
      });
    }
  }

  return result;
}
