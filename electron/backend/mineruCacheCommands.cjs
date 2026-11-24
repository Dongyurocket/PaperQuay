/**
 * MinerU 解析缓存的维护命令：
 *
 *  1. repairMineruCacheImages      修复 content_list 中指向不存在文件的图片引用
 *                                  （历史缺陷：拆分合并时未改写图片路径，见 mineruMerge.cjs）。
 *  2. prepareMineruCacheForReparse 强制重新识别前，备份 translations / summaries / images，
 *                                  并清理上一次的解析产物。
 *  3. finishMineruCacheReparse     重新识别成功后清理备份代。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  assetBasename,
  collectBlockAssetPaths,
  mapContentListBlocks,
  remapStringValuesDeep,
} = require('./mineruContentList.cjs');
const { cleanString } = require('./utils.cjs');
const { resolveMineruAssetPath } = require('./mineruAssetPaths.cjs');
const { hasUnsafePathSyntax, isUncPath, isWithinRoot } = require('./pathPolicy.cjs');
const { resolveTranslatedPdfStorageDir } = require('./translatedPdfAttachments.cjs');

const CONTENT_LIST_FILE_NAMES = ['content_list_v2.json', 'content_list.json'];
const PARSE_OUTPUT_FILE_NAMES = ['content_list_v2.json', 'content_list.json', 'middle.json', 'full.md'];
const CACHE_MARKER_FILE_NAMES = [...PARSE_OUTPUT_FILE_NAMES];
const MAX_MINERU_ASSET_BYTES = 64 * 1024 * 1024;
const BACKUP_TARGET_NAMES = ['translations', 'summaries', 'images'];
const BACKUP_SUFFIX_PATTERN = /\.bak-\d+$/;

async function pathKind(target) {
  try {
    const stat = await fsp.lstat(target);
    return stat.isDirectory() ? 'directory' : 'file';
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function listDirectoryNames(directory) {
  try {
    return await fsp.readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function writeTextFileAtomically(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await fsp.writeFile(temporaryPath, content, 'utf8');
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function hasUnsafeSegments(normalizedPath) {
  return normalizedPath.split('/').some((segment) => segment === '..');
}

/**
 * 解析单条图片引用：
 *  - 已经是本地绝对路径 / 远程 URL：原样返回
 *  - 目标文件存在：原样返回
 *  - 目标缺失但 images/ 下存在唯一的 part_<N>_<basename>：返回改写后的相对路径
 *  - 其余（真缺失或有多个候选）：返回 null
 */
function resolveImageReference(rawPath, cacheDir, imageNamesByBasename) {
  const trimmed = String(rawPath ?? '').trim();
  if (!trimmed) return rawPath;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) return rawPath;
  if (/^[a-zA-Z][a-zA-Z+.-]*:\/\//.test(trimmed)) return rawPath;

  const normalized = trimmed.replace(/\\/g, '/');
  if (hasUnsafeSegments(normalized)) return null;

  if (fs.existsSync(path.join(cacheDir, ...normalized.split('/')))) return rawPath;

  const candidates = imageNamesByBasename.get(assetBasename(normalized));
  if (!candidates || candidates.length !== 1) return null;

  return `images/${candidates[0]}`;
}

/**
 * 修复一个缓存目录中 content_list 的图片引用。
 *
 * 幂等：已经正确的引用不会被改写；返回统计便于界面反馈与回归测试。
 *
 * 进程内按「content_list 的 mtime + size」做记忆化：阅读器每次打开文档都会调用
 * 本函数，只有文件真的变化过（重新识别写入新产物）才重新解析 JSON。
 */
const repairedContentListSignatures = new Map();

async function readContentListSignature(directory) {
  const parts = [];

  for (const fileName of CONTENT_LIST_FILE_NAMES) {
    const stat = await fsp.stat(path.join(directory, fileName)).catch(() => null);
    parts.push(stat ? `${fileName}:${stat.mtimeMs}:${stat.size}` : `${fileName}:-`);
  }

  return parts.join('|');
}

async function repairMineruCacheImages({ directory }) {
  const resolvedDirectory = path.resolve(cleanString(directory));
  if (!resolvedDirectory) throw new Error('MinerU cache directory cannot be empty');

  const signature = await readContentListSignature(resolvedDirectory);
  const memoKey = process.platform === 'win32' ? resolvedDirectory.toLowerCase() : resolvedDirectory;
  const memo = repairedContentListSignatures.get(memoKey);

  if (memo && memo.signature === signature) {
    // 文件自上次修复后没有变化：不再解析大 JSON，也不重复上报修复条数，
    // 否则界面会把同一批修复当成新修复再次汇报。
    return { ...memo.report, fixed: 0, changedFiles: [], memoized: true };
  }

  const imageNames = await listDirectoryNames(path.join(resolvedDirectory, 'images'));
  const imageNamesByBasename = new Map();

  for (const name of imageNames) {
    const prefixed = /^part_\d+_(.+)$/.exec(name);
    const basename = prefixed ? prefixed[1] : name;
    const bucket = imageNamesByBasename.get(basename) ?? [];
    bucket.push(name);
    imageNamesByBasename.set(basename, bucket);
  }

  const report = {
    directory: resolvedDirectory,
    imageFileCount: imageNames.length,
    scannedFiles: [],
    changedFiles: [],
    scannedRefs: 0,
    fixed: 0,
    unresolved: 0,
    unresolvedSamples: [],
    memoized: false,
  };

  for (const fileName of CONTENT_LIST_FILE_NAMES) {
    const filePath = path.join(resolvedDirectory, fileName);
    if ((await pathKind(filePath)) !== 'file') continue;

    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    } catch {
      continue;
    }

    report.scannedFiles.push(fileName);

    let fileChanged = false;

    const repaired = mapContentListBlocks(parsed, (block) => {
      const assetPaths = new Set(collectBlockAssetPaths(block));
      if (assetPaths.size === 0) return block;

      return remapStringValuesDeep(block, (value) => {
        if (!assetPaths.has(value)) return value;

        report.scannedRefs += 1;
        const resolvedRef = resolveImageReference(value, resolvedDirectory, imageNamesByBasename);

        if (resolvedRef === value) return value;

        if (resolvedRef == null) {
          report.unresolved += 1;
          if (report.unresolvedSamples.length < 5) report.unresolvedSamples.push(value);
          return value;
        }

        report.fixed += 1;
        fileChanged = true;
        return resolvedRef;
      });
    });

    if (fileChanged && repaired) {
      await writeTextFileAtomically(filePath, `${JSON.stringify(repaired, null, 2)}\n`);
      report.changedFiles.push(fileName);
    }
  }

  repairedContentListSignatures.set(memoKey, {
    signature: await readContentListSignature(resolvedDirectory),
    report,
  });

  return report;
}

/**
 * 强制重新识别前的准备：清理上一代备份 → 备份 translations / summaries / images
 * → 删除上一次的解析产物。
 *
 * 备份而不是直接删除的原因：译文与摘要按 blockId（page-N-block-M）索引，重新识别后
 * blockId 顺序会变，旧数据必须与新结果隔离，否则会静默错配到别的段落。
 */
async function prepareMineruCacheForReparse({ directory }) {
  const resolvedDirectory = path.resolve(cleanString(directory));
  if (!resolvedDirectory) throw new Error('MinerU cache directory cannot be empty');

  const stamp = Date.now();
  const existing = await listDirectoryNames(resolvedDirectory);

  const removedStaleBackups = [];
  for (const name of existing) {
    if (!BACKUP_SUFFIX_PATTERN.test(name)) continue;
    await fsp.rm(path.join(resolvedDirectory, name), { recursive: true, force: true });
    removedStaleBackups.push(name);
  }

  const backups = [];
  for (const name of BACKUP_TARGET_NAMES) {
    const source = path.join(resolvedDirectory, name);
    if (!(await pathKind(source))) continue;

    const destination = `${source}.bak-${stamp}`;
    await fsp.rm(destination, { recursive: true, force: true });
    await fsp.rename(source, destination);
    backups.push({ name, backupName: path.basename(destination) });
  }

  const removedFiles = [];
  for (const name of PARSE_OUTPUT_FILE_NAMES) {
    const target = path.join(resolvedDirectory, name);
    if (!(await pathKind(target))) continue;
    await fsp.rm(target, { force: true });
    removedFiles.push(name);
  }

  return { directory: resolvedDirectory, removedStaleBackups, backups, removedFiles };
}

/** 重新识别成功（success !== false）后清理备份代，失败时保留以便回退。 */
async function finishMineruCacheReparse({ directory, success = true }) {
  const resolvedDirectory = path.resolve(cleanString(directory));
  if (!resolvedDirectory) throw new Error('MinerU cache directory cannot be empty');
  if (success === false) return { directory: resolvedDirectory, removed: [] };

  const removed = [];
  for (const name of await listDirectoryNames(resolvedDirectory)) {
    if (!BACKUP_SUFFIX_PATTERN.test(name)) continue;
    await fsp.rm(path.join(resolvedDirectory, name), { recursive: true, force: true });
    removed.push(name);
  }

  return { directory: resolvedDirectory, removed };
}

/**
 * 写/删/修复/重解析只允许：
 *   1. 默认 MinerU 缓存根（appPaths.mineruCacheDir，主进程决定）；
 *   2. 目录对话框 approveWritePath 登记过的目录。
 * 不再读取 configPath 里的 settings.mineruCacheDir：那是渲染层可写值，
 * 升级后必须由用户在设置页重新选择目录才能获得写权限。
 */
function createCacheDirectoryGuard({ appPaths, pathPolicy }) {
  const defaultRoot = appPaths.mineruCacheDir ? path.resolve(appPaths.mineruCacheDir) : '';

  return (directory) => {
    const target = path.resolve(cleanString(directory));
    if (!target) throw new Error('MinerU cache directory cannot be empty');

    const withinDefaultRoot = Boolean(defaultRoot) && isWithinRoot(target, defaultRoot);
    const approved = typeof pathPolicy?.isApprovedPath === 'function'
      && pathPolicy.isApprovedPath(target, 'write');

    if (!withinDefaultRoot && !approved) {
      throw new Error(`Refusing to modify a directory outside the MinerU cache root: ${target}`);
    }

    return target;
  };
}

function readReaderSettings(appSettings) {
  try {
    const settings = appSettings?.getPublic?.()?.settings;
    return settings && typeof settings === 'object' ? settings : {};
  } catch {
    return {};
  }
}

function readLibrarySettings(store) {
  try {
    return (typeof store?.loadSettings === 'function' ? store.loadSettings() : null) ?? {};
  } catch {
    return {};
  }
}

/**
 * 只读授权状态：返回三类目录的 { path, exists, authorized, reason }。
 *
 * 只用于设置页提示“已配置但未授权/目录不存在”，不授予任何权限；写权限仍由
 * pathPolicy 与目录对话框决定。
 */
function buildPathAuthorizationStatus({ appPaths, appSettings, store, pathPolicy }) {
  const readerSettings = readReaderSettings(appSettings);
  const librarySettings = readLibrarySettings(store);
  const dataDir = cleanString(appPaths.dataDir);
  const defaultStorageDir = dataDir ? path.join(dataDir, 'paperquay-data') : '';
  const hasTranslatedBase = Boolean(
    cleanString(librarySettings.translatedPdfDir)
    || cleanString(librarySettings.storageDir)
    || dataDir,
  );
  const translatedPdfDir = hasTranslatedBase
    ? resolveTranslatedPdfStorageDir(librarySettings, appPaths)
    : '';
  const defaultTranslatedPdfDir = hasTranslatedBase
    ? resolveTranslatedPdfStorageDir({ ...librarySettings, translatedPdfDir: '' }, appPaths)
    : '';
  const defaultMineruCacheDir = cleanString(appPaths.mineruCacheDir);

  const describe = (value, { defaultPaths = [], trustedRoots = [] }) => {
    const target = cleanString(value);
    if (!target) {
      return { path: '', exists: false, authorized: false, reason: 'missing' };
    }
    if (typeof pathPolicy?.getAuthorizationStatus !== 'function') {
      return { path: path.resolve(target), exists: false, authorized: false, reason: 'unavailable' };
    }

    return pathPolicy.getAuthorizationStatus(target, {
      mode: 'write',
      defaultPaths,
      trustedRoots,
    });
  };

  return {
    storageDir: describe(cleanString(librarySettings.storageDir) || defaultStorageDir, {
      defaultPaths: [defaultStorageDir],
      // storageDir 沿用既有语义：pathPolicy 的写根直接信任该设置值。
      trustedRoots: [dataDir, cleanString(librarySettings.storageDir)].filter(Boolean),
    }),
    translatedPdfDir: describe(translatedPdfDir, {
      defaultPaths: [defaultTranslatedPdfDir],
      // 与 pathPolicy 共用同一套信任根：dataDir 与 storageDir 覆盖默认位置；
      // 自定义译版目录必须经目录对话框授权，状态才能和 isReadAllowed/isWriteAllowed 一致。
      trustedRoots: [dataDir, cleanString(librarySettings.storageDir) || defaultStorageDir].filter(Boolean),
    }),
    mineruCacheDir: describe(
      cleanString(readerSettings.mineruCacheDir) || defaultMineruCacheDir,
      {
        defaultPaths: [defaultMineruCacheDir],
        // 自定义 MinerU 目录没有 dataDir 例外：必须经目录对话框授权。
        trustedRoots: [],
      },
    ),
  };
}

function createMineruCacheCommands(context) {
  const { appPaths, pathPolicy } = context;
  const assertAllowedCacheDirectory = createCacheDirectoryGuard({ appPaths, pathPolicy });

  /**
   * 读取 asset 的目录必须是 MinerU 缓存目录（至少含一个解析产物），且仍在
   * pathPolicy 的读根内。UNC/设备路径在 pathPolicy 做 realpath 之前拒绝，
   * 避免 SMB 探测。
   */
  function assertReadableCacheDirectory(directory) {
    const raw = cleanString(directory);
    if (!raw || !path.isAbsolute(raw) || isUncPath(raw) || hasUnsafePathSyntax(raw)) {
      throw new Error('MinerU cache directory is not allowed');
    }
    if (typeof pathPolicy?.isReadAllowed === 'function' && !pathPolicy.isReadAllowed(raw)) {
      throw new Error('MinerU cache directory is not allowed');
    }

    const resolved = path.resolve(raw);
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new Error('MinerU cache directory is not a MinerU cache directory');
    }
    if (!stat.isDirectory()) {
      throw new Error('MinerU cache directory is not a MinerU cache directory');
    }
    if (!CACHE_MARKER_FILE_NAMES.some((name) => fs.existsSync(path.join(resolved, name)))) {
      throw new Error('MinerU cache directory is not a MinerU cache directory');
    }

    return resolved;
  }

  return {
    async path_authorization_status() {
      return buildPathAuthorizationStatus(context);
    },

    async repair_mineru_cache_images({ directory }) {
      return repairMineruCacheImages({ directory: assertAllowedCacheDirectory(directory) });
    },

    async prepare_mineru_reparse({ directory }) {
      return prepareMineruCacheForReparse({ directory: assertAllowedCacheDirectory(directory) });
    },

    async finish_mineru_cache_reparse({ directory, success }) {
      return finishMineruCacheReparse({
        directory: assertAllowedCacheDirectory(directory),
        success: success !== false,
      });
    },

    async read_mineru_asset_base64({ cacheDir, assetPath } = {}) {
      const directory = assertReadableCacheDirectory(cacheDir);
      const resolved = resolveMineruAssetPath(directory, assetPath);

      if (!resolved.path) {
        throw new Error(
          resolved.reason === 'missing'
            ? 'MinerU asset file is missing'
            : 'Invalid MinerU asset path',
        );
      }
      if (typeof pathPolicy?.isReadAllowed === 'function' && !pathPolicy.isReadAllowed(resolved.path)) {
        throw new Error('Reading this path is not allowed');
      }

      const stat = await fsp.stat(resolved.path);
      if (!stat.isFile()) throw new Error('Invalid MinerU asset path');
      if (stat.size > MAX_MINERU_ASSET_BYTES) throw new Error('MinerU asset is too large');
      if (stat.size <= 0) throw new Error('MinerU asset is empty');

      return (await fsp.readFile(resolved.path)).toString('base64');
    },
  };
}

module.exports = {
  CONTENT_LIST_FILE_NAMES,
  PARSE_OUTPUT_FILE_NAMES,
  createMineruCacheCommands,
  finishMineruCacheReparse,
  prepareMineruCacheForReparse,
  repairMineruCacheImages,
  resolveImageReference,
};
