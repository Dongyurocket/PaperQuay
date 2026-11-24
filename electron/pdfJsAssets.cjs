const fs = require('node:fs/promises');
const path = require('node:path');

/** PDF.js 运行时资源目录（paperquay-pdf-assets 协议只服务这三类）。 */
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'image_decoders'];

/** extraResources 中放置 PDF.js 资源的目录名（resources/pdfjs/<dir>）。 */
const PDFJS_RESOURCES_DIR_NAME = 'pdfjs';

/** 主进程 PDF 元数据预览需要的 legacy 构建文件（D4-13）。 */
const PDFJS_LEGACY_REQUIRED_FILES = [
  path.join('legacy', 'build', 'pdf.mjs'),
  path.join('legacy', 'build', 'pdf.worker.mjs'),
];

/** 每个目录至少要有的代表文件，避免只复制到空目录或部分文件。 */
const PDFJS_REQUIRED_FILES = {
  cmaps: ['Adobe-Japan1-0.bcmap', 'UniGB-UCS2-H.bcmap'],
  standard_fonts: ['FoxitFixed.pfb', 'FoxitSerif.pfb'],
  image_decoders: ['pdf.image_decoders.mjs'],
};

/**
 * 开发态从 node_modules/pdfjs-dist 读取；安装版从 resources/pdfjs 读取
 * （pdfjs-dist 是 devDependency，不会进入 asar，必须由 extraResources 复制）。
 */
function resolvePdfJsAssetRoot({ isPackaged, resourcesPath, appDir }) {
  return isPackaged
    ? path.join(resourcesPath, PDFJS_RESOURCES_DIR_NAME)
    : path.join(appDir, '..', 'node_modules', 'pdfjs-dist');
}

async function countFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

/**
 * 打包后校验 PDF.js 资源齐全。
 *
 * 除目录与代表文件外，还要求每个目录的文件数不少于源目录（`sourceRoot`）——
 * 只校验代表文件时，部分复制（例如只剩两个 bcmap）仍会通过，正是 F2 要防的丢字场景。
 * 缺目录、缺代表文件或数量不足都抛错，让打包失败。
 */
async function assertPdfJsAssets(resourcesDir, sourceRoot) {
  const root = path.join(resourcesDir, PDFJS_RESOURCES_DIR_NAME);
  const counts = {};
  const problems = [];

  for (const dirName of PDFJS_ASSET_DIRS) {
    const dirPath = path.join(root, dirName);
    let entries;

    try {
      entries = await fs.readdir(dirPath);
    } catch {
      problems.push(`PDF.js asset directory not found: ${dirPath}`);
      continue;
    }

    if (entries.length === 0) {
      problems.push(`PDF.js asset directory is empty: ${dirPath}`);
      continue;
    }

    for (const requiredFile of PDFJS_REQUIRED_FILES[dirName] ?? []) {
      try {
        await fs.access(path.join(dirPath, requiredFile));
      } catch {
        problems.push(`PDF.js asset file not found: ${path.join(dirPath, requiredFile)}`);
      }
    }

    counts[dirName] = entries.length;
  }

  if (sourceRoot) {
    for (const dirName of PDFJS_ASSET_DIRS) {
      const sourceDir = path.join(sourceRoot, dirName);

      try {
        const expected = await countFiles(sourceDir);
        const actual = counts[dirName];

        if (actual !== undefined && actual < expected) {
          problems.push(
            `PDF.js asset directory is incomplete: ${path.join(root, dirName)} has ${actual} files, expected at least ${expected}`,
          );
        }
      } catch {
        // 源目录不可读（例如跨平台打包机未安装 devDependencies）时只做代表文件校验。
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }

  return counts;
}

async function assertPdfJsRuntime(resourcesDir) {
  const root = path.join(resourcesDir, PDFJS_RESOURCES_DIR_NAME);
  const problems = [];

  for (const relativePath of PDFJS_LEGACY_REQUIRED_FILES) {
    try {
      await fs.access(path.join(root, relativePath));
    } catch {
      problems.push(`PDF.js legacy runtime file not found: ${path.join(root, relativePath)}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

module.exports = {
  PDFJS_ASSET_DIRS,
  PDFJS_LEGACY_REQUIRED_FILES,
  PDFJS_RESOURCES_DIR_NAME,
  PDFJS_REQUIRED_FILES,
  resolvePdfJsAssetRoot,
  assertPdfJsAssets,
  assertPdfJsRuntime,
};
