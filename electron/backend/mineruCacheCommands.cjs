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
const { cleanString, readJson } = require('./utils.cjs');

const CONTENT_LIST_FILE_NAMES = ['content_list_v2.json', 'content_list.json'];
const PARSE_OUTPUT_FILE_NAMES = ['content_list_v2.json', 'content_list.json', 'middle.json', 'full.md'];
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

/** 与 fileCommands.assertWriteAllowed 同口径：只允许在 MinerU 缓存根内改动。 */
function createCacheDirectoryGuard(appPaths) {
  const configuredCacheDir = cleanString(
    readJson(appPaths.configPath, null)?.settings?.mineruCacheDir,
  );
  const roots = [appPaths.mineruCacheDir, configuredCacheDir]
    .filter(Boolean)
    .map((root) => path.resolve(root));

  const comparable = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

  return (directory) => {
    const target = path.resolve(cleanString(directory));
    if (!target) throw new Error('MinerU cache directory cannot be empty');

    const allowed = roots.some((root) => {
      const left = comparable(target);
      const right = comparable(root);
      return left === right || left.startsWith(`${right}${path.sep}`);
    });

    if (!allowed) {
      throw new Error(`Refusing to modify a directory outside the MinerU cache root: ${target}`);
    }

    return target;
  };
}

function createMineruCacheCommands(context) {
  const { appPaths } = context;
  const assertAllowedCacheDirectory = createCacheDirectoryGuard(appPaths);

  return {
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
