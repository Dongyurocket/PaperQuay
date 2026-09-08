const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * 递归获取目录下所有文件的相对路径
 */
async function listRelativeFiles(dir, baseDir = dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await listRelativeFiles(fullPath, baseDir);
        files.push(...subFiles);
      } else {
        files.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
      }
    }
    return files;
  } catch {
    return [];
  }
}

/**
 * 合并多个分卷的 MinerU 解析产物
 * @param {Array<{
 *   partIndex: number,
 *   pageOffset: number,
 *   pageCount: number,
 *   extracted: {
 *     contentJsonText?: string | null,
 *     middleJsonText?: string | null,
 *     markdownText?: string | null,
 *     assetRootDir?: string | null,
 *     zipEntries?: string[]
 *   }
 * }>} parts 各分卷信息与解析产物
 * @param {string} finalExtractDir 目标合并输出目录
 */
async function mergeMineruParseResults(parts, finalExtractDir) {
  await fsp.mkdir(finalExtractDir, { recursive: true });
  const finalImagesDir = path.join(finalExtractDir, 'images');
  await fsp.mkdir(finalImagesDir, { recursive: true });

  const allMergedBlocks = [];
  const allMergedPdfInfo = [];
  const markdownSections = [];

  for (const part of parts) {
    const { partIndex, pageOffset, extracted } = part;
    const assetRootDir = extracted.assetRootDir;
    const partImagesDir = assetRootDir ? path.join(assetRootDir, 'images') : null;

    // 1. 处理图片复制与重命名
    const imageMap = new Map(); // oldRelPath -> newRelPath
    if (partImagesDir && fs.existsSync(partImagesDir)) {
      try {
        const imageFiles = await fsp.readdir(partImagesDir);
        for (const imgName of imageFiles) {
          const srcImgPath = path.join(partImagesDir, imgName);
          const stat = await fsp.stat(srcImgPath).catch(() => null);
          if (!stat || !stat.isFile()) continue;

          const newImgName = `part_${partIndex + 1}_${imgName}`;
          const destImgPath = path.join(finalImagesDir, newImgName);
          await fsp.copyFile(srcImgPath, destImgPath);

          imageMap.set(`images/${imgName}`, `images/${newImgName}`);
          imageMap.set(imgName, newImgName);
        }
      } catch (err) {
        console.warn(`[MinerU Merge] Failed to copy images for part ${partIndex + 1}:`, err);
      }
    }

    const remapImagePath = (rawPath) => {
      if (!rawPath || typeof rawPath !== 'string') return rawPath;
      const normalized = rawPath.replace(/\\/g, '/');
      if (imageMap.has(normalized)) return imageMap.get(normalized);
      const base = path.basename(normalized);
      if (imageMap.has(base)) return `images/${imageMap.get(base)}`;
      return rawPath;
    };

    // 2. 合并 content_list.json / content_list_v2.json
    if (extracted.contentJsonText) {
      try {
        const parsed = JSON.parse(extracted.contentJsonText);
        if (Array.isArray(parsed)) {
          for (const block of parsed) {
            if (block && typeof block === 'object') {
              const adjusted = { ...block };
              if (typeof adjusted.page_idx === 'number') {
                adjusted.page_idx = adjusted.page_idx + pageOffset;
              }
              if (adjusted.img_path) {
                adjusted.img_path = remapImagePath(adjusted.img_path);
              }
              if (adjusted.image_source && typeof adjusted.image_source === 'object' && adjusted.image_source.path) {
                adjusted.image_source = {
                  ...adjusted.image_source,
                  path: remapImagePath(adjusted.image_source.path),
                };
              }
              allMergedBlocks.push(adjusted);
            }
          }
        }
      } catch (err) {
        console.warn(`[MinerU Merge] Error parsing contentJson for part ${partIndex + 1}:`, err);
      }
    }

    // 3. 合并 middle.json
    if (extracted.middleJsonText) {
      try {
        const parsedMiddle = JSON.parse(extracted.middleJsonText);
        if (parsedMiddle && Array.isArray(parsedMiddle.pdf_info)) {
          for (const pageInfo of parsedMiddle.pdf_info) {
            if (pageInfo && typeof pageInfo === 'object') {
              const adjustedPage = { ...pageInfo };
              if (typeof adjustedPage.page_idx === 'number') {
                adjustedPage.page_idx = adjustedPage.page_idx + pageOffset;
              }
              allMergedPdfInfo.push(adjustedPage);
            }
          }
        }
      } catch (err) {
        console.warn(`[MinerU Merge] Error parsing middleJson for part ${partIndex + 1}:`, err);
      }
    }

    // 4. 合并 markdownText
    if (extracted.markdownText) {
      let md = extracted.markdownText;
      for (const [oldRel, newRel] of imageMap.entries()) {
        if (oldRel.startsWith('images/')) {
          md = md.split(oldRel).join(newRel);
        }
      }
      markdownSections.push(md.trim());
    }
  }

  // 写入最终合并产物
  const finalContentJsonPath = path.join(finalExtractDir, 'content_list_v2.json');
  const finalMiddleJsonPath = path.join(finalExtractDir, 'middle.json');
  const finalMarkdownPath = path.join(finalExtractDir, 'full.md');

  let mergedContentJsonText = null;
  if (allMergedBlocks.length > 0) {
    mergedContentJsonText = JSON.stringify(allMergedBlocks, null, 2);
    await fsp.writeFile(finalContentJsonPath, mergedContentJsonText, 'utf8');
  }

  let mergedMiddleJsonText = null;
  if (allMergedPdfInfo.length > 0) {
    const mergedMiddle = { pdf_info: allMergedPdfInfo };
    mergedMiddleJsonText = JSON.stringify(mergedMiddle, null, 2);
    await fsp.writeFile(finalMiddleJsonPath, mergedMiddleJsonText, 'utf8');
  }

  let mergedMarkdownText = null;
  if (markdownSections.length > 0) {
    mergedMarkdownText = markdownSections.join('\n\n');
    await fsp.writeFile(finalMarkdownPath, mergedMarkdownText, 'utf8');
  }

  const zipEntries = await listRelativeFiles(finalExtractDir);

  return {
    contentJsonText: mergedContentJsonText,
    middleJsonText: mergedMiddleJsonText,
    markdownText: mergedMarkdownText,
    assetRootDir: finalExtractDir,
    contentJsonPath: mergedContentJsonText ? finalContentJsonPath : null,
    middleJsonPath: mergedMiddleJsonText ? finalMiddleJsonPath : null,
    markdownPath: mergedMarkdownText ? finalMarkdownPath : null,
    zipEntries,
  };
}

module.exports = {
  mergeMineruParseResults,
};
