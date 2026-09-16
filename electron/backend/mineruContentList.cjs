/**
 * MinerU content_list 产物的形状与路径改写工具。
 *
 * MinerU 云端在不同 model_version / 页数下会产出三种形状的 content_list：
 *
 *   flat : [block, block, ...]                     content_list v1，块自带 page_idx
 *   pages: [[block, ...], [block, ...], ...]       每页一个子数组
 *   dict : [{ "0": block, "1": block }, ...]       content_list v2 / vlm，
 *                                                  每页一个以块索引为键的对象，没有 page_idx
 *
 * 2026-09 对本地 62 份 content_list_v2.json 的只读对账：
 *   9 份为 dict 形状（超 200 页拆分合并产物），53 份为 flat 形状。
 * 旧版 mergeMineruParseResults 只处理 flat，并且只在块顶层查 img_path /
 * image_source，导致 9 份文档共 2859 条图片引用未被改写而全部失效。
 * 真实产物中 100% 的资产路径位于块内嵌套的 content.image_source.path。
 */

const path = require('node:path');

/** 可作为图片资源引用的文件扩展名。 */
const IMAGE_FILE_PATTERN = /\.(?:jpe?g|jpe|png|webp|bmp|gif|tiff?)$/i;

/** 承载资源路径的字段名（MinerU v1 / v2 及 PaddleOCR 适配层统一口径）。 */
const ASSET_PATH_KEYS = new Set(['img_path', 'image_path', 'path', 'image_source']);

/**
 * 判断一个 content_list 条目是否为「块」。
 * 页字典本身也可能带 type 之外的同名字段，因此只在没有 type 时按页容器处理。
 */
function isBlockEntry(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && 'type' in value;
}

/**
 * 结构保持地遍历 content_list 并逐块映射。
 *
 * - flat / pages / dict 三种形状都会被识别；
 * - 页字典保持对象形状与键顺序（阅读器 parseMineruPages 依赖它还原分页）；
 * - mapper 返回非对象时保留原块，避免任何形状误判造成内容丢失。
 *
 * @param {unknown} parsed 解析后的 content_list
 * @param {(block: Record<string, unknown>) => unknown} mapper 逐块映射
 * @returns {unknown[] | null} 映射后的 content_list；输入不是数组时返回 null
 */
function mapContentListBlocks(parsed, mapper) {
  if (!Array.isArray(parsed)) return null;

  const applyToBlock = (block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return block;
    const mapped = mapper(block);
    return mapped && typeof mapped === 'object' && !Array.isArray(mapped) ? mapped : block;
  };

  const output = [];

  for (const entry of parsed) {
    if (Array.isArray(entry)) {
      output.push(entry.map(applyToBlock));
      continue;
    }

    if (!entry || typeof entry !== 'object') {
      output.push(entry);
      continue;
    }

    if (isBlockEntry(entry)) {
      output.push(applyToBlock(entry));
      continue;
    }

    const page = {};
    for (const [key, block] of Object.entries(entry)) {
      page[key] = applyToBlock(block);
    }
    output.push(page);
  }

  return output;
}

/**
 * 递归改写任意深度的字符串值。
 *
 * 必须递归而不是只查固定字段：v2 把资源路径放在 block.content.image_source.path，
 * v1 才放在顶层 img_path，跨页合并表格的续块还可能只留下 "images/" 目录。
 *
 * @param {unknown} value
 * @param {(input: string) => string | null | undefined} remap 返回新字符串则替换，否则保留原值
 */
function remapStringValuesDeep(value, remap) {
  if (typeof value === 'string') {
    const next = remap(value);
    return typeof next === 'string' ? next : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => remapStringValuesDeep(item, remap));
  }

  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = remapStringValuesDeep(nested, remap);
    }
    return output;
  }

  return value;
}

/**
 * 收集一个块内所有结构性的资源路径字符串（不扫描正文文本，避免把正文里
 * 恰好出现的文件名当成资源引用）。
 *
 * @param {unknown} block
 * @returns {string[]}
 */
function collectBlockAssetPaths(block) {
  const found = [];

  const visit = (value) => {
    if (value == null) return;

    if (typeof value === 'string') return;

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (typeof value !== 'object') return;

    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string') {
        if (ASSET_PATH_KEYS.has(key) && nested.trim()) found.push(nested);
        continue;
      }

      visit(nested);
    }
  };

  visit(block);

  return found;
}

/** 从 `images/part_1_abc.jpg` 或 `abc.jpg` 中取出 basename。 */
function assetBasename(assetPath) {
  return path.basename(String(assetPath).replace(/\\/g, '/'));
}

module.exports = {
  ASSET_PATH_KEYS,
  IMAGE_FILE_PATTERN,
  assetBasename,
  collectBlockAssetPaths,
  isBlockEntry,
  mapContentListBlocks,
  remapStringValuesDeep,
};
