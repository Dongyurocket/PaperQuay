const fsp = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

/**
 * 获取 PDF 文件总页数
 * @param {string | Buffer | Uint8Array} source
 * @returns {Promise<number>}
 */
async function getPdfPageCount(source) {
  const bytes = typeof source === 'string' ? await fsp.readFile(source) : source;
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdfDoc.getPageCount();
}

/**
 * 计算 PDF 分卷拆分计划
 * @param {number} totalPages 总页数
 * @param {number} maxPagesPerPart 每卷最大页数（默认 150，确保 <= 200 限制）
 * @returns {Array<{ partIndex: number, startPage: number, endPage: number, pageCount: number, pageOffset: number }>}
 */
function planPdfSplits(totalPages, maxPagesPerPart = 150) {
  if (totalPages <= 0) return [];
  const normalizedMax = Math.max(1, Math.min(maxPagesPerPart, 180));
  const parts = [];
  let currentStart = 1;
  let partIndex = 0;

  while (currentStart <= totalPages) {
    const currentEnd = Math.min(currentStart + normalizedMax - 1, totalPages);
    const count = currentEnd - currentStart + 1;
    parts.push({
      partIndex,
      startPage: currentStart,
      endPage: currentEnd,
      pageCount: count,
      pageOffset: currentStart - 1,
    });
    currentStart = currentEnd + 1;
    partIndex += 1;
  }

  return parts;
}

/**
 * 按分卷计划拆分 PDF 并保存到指定目录
 * @param {string} sourcePdfPath
 * @param {Array<{ partIndex: number, startPage: number, endPage: number, pageCount: number, pageOffset: number }>} splitPlans
 * @param {string} outputDir
 * @returns {Promise<Array<{ partIndex: number, path: string, startPage: number, endPage: number, pageCount: number, pageOffset: number }>>}
 */
async function splitPdfFiles(sourcePdfPath, splitPlans, outputDir) {
  await fsp.mkdir(outputDir, { recursive: true });
  const sourceBytes = await fsp.readFile(sourcePdfPath);
  const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const baseName = path.basename(sourcePdfPath, path.extname(sourcePdfPath));

  const results = [];

  for (const plan of splitPlans) {
    const subDoc = await PDFDocument.create();
    // pdf-lib 使用 0-based 索引
    const pageIndices = [];
    for (let p = plan.startPage; p <= plan.endPage; p++) {
      const idx = p - 1;
      if (idx >= 0 && idx < totalPages) {
        pageIndices.push(idx);
      }
    }

    if (pageIndices.length === 0) continue;

    const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
    for (const page of copiedPages) {
      subDoc.addPage(page);
    }

    const subBytes = await subDoc.save();
    const partFileName = `${baseName}_part_${plan.partIndex + 1}_p${plan.startPage}-${plan.endPage}.pdf`;
    const partFilePath = path.join(outputDir, partFileName);
    await fsp.writeFile(partFilePath, subBytes);

    results.push({
      ...plan,
      path: partFilePath,
    });
  }

  return results;
}

module.exports = {
  getPdfPageCount,
  planPdfSplits,
  splitPdfFiles,
};
