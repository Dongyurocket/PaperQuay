/**
 * 把 PaddleOCR-VL 的 layoutParsingResults 归一化成 PaperQuay 现有的 MinerU 缓存契约。
 *
 * 设计决策：适配层产出与 MinerU 完全同构的 content_list_v2.json + images/ + full.md，
 * 而不是在渲染层新增第二条解析路径。这样阅读器、图片渲染、PDF↔块 bbox 联动、翻译、
 * RAG 与缓存自愈全部零改动复用。
 *
 * PaddleOCR-VL 每页结果的字段口径（PaddleX 3.4 / PaddleOCR-VL-1.5~1.6 实测代码路径）：
 *   prunedResult.width / height            页面像素尺寸
 *   prunedResult.parsing_res_list[]        { block_label, block_content, block_bbox, block_id, block_order, group_id }
 *   markdown.text                          Markdown 正文
 *   markdown.images                        { "imgs/img_in_<label>_box_<x1>_<y1>_<x2>_<y2>.jpg": base64 或 URL }
 */

const path = require('node:path');

const TITLE_LABELS = new Set([
  'doc_title',
  'paragraph_title',
  'sub_paragraph_title',
  'abstract_title',
  'content_title',
  'reference_title',
]);

const PARAGRAPH_LABELS = new Set([
  'text',
  'ocr',
  'vertical_text',
  'content',
  'abstract',
  'reference',
  'reference_content',
  'algorithm',
  'aside_text',
  'vision_footnote',
  'number',
  'footnote',
  'header',
  'footer',
  'spotting',
]);

const IMAGE_LABELS = new Set(['image', 'header_image', 'footer_image', 'seal']);
const CHART_LABELS = new Set(['chart']);
const TABLE_LABELS = new Set(['table']);
const FORMULA_LABELS = new Set(['formula', 'display_formula', 'inline_formula', 'equation']);
const IMAGE_CAPTION_LABELS = new Set(['figure_title', 'chart_title', 'vision_title']);
const TABLE_CAPTION_LABELS = new Set(['table_title']);

const MARKDOWN_TABLE_PATTERN = /^\s*\|.*\|\s*$/m;

function readFiniteNumbers(value, length) {
  if (!Array.isArray(value) || value.length < length) return null;

  const numbers = value.slice(0, length).map((item) => Number(item));

  return numbers.every((item) => Number.isFinite(item)) ? numbers : null;
}

function readBbox(value) {
  const numbers = readFiniteNumbers(value, 4);
  if (!numbers) return null;

  const [x1, y1, x2, y2] = numbers.map((item) => Math.round(item));

  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}

function readPageSize(prunedResult) {
  const width = Number(prunedResult?.width);
  const height = Number(prunedResult?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return [Math.round(width), Math.round(height)];
}

function stripMathDelimiters(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\$\$?/, '')
    .replace(/\$\$?$/, '')
    .trim();
}

/** PaddleOCR 与 MinerU 共用 `imgs/img_in_<label>_box_<x1>_<y1>_<x2>_<y2>.jpg` 命名。 */
function constructPaddleImageKey(label, bbox) {
  if (!bbox) return null;

  const [x1, y1, x2, y2] = bbox;

  return `imgs/img_in_${label}_box_${x1}_${y1}_${x2}_${y2}.jpg`;
}

function sanitizeAssetFileName(value) {
  const base = path.basename(String(value ?? '').replace(/\\/g, '/')) || 'asset.jpg';
  const safe = base.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').slice(0, 120);

  return safe || 'asset.jpg';
}

function textContent(value) {
  return [{ type: 'text', content: String(value ?? '') }];
}

function buildContentForLabel({ label, content, assetPath }) {
  if (FORMULA_LABELS.has(label)) {
    return { type: 'equation_interline', content: { math_content: stripMathDelimiters(content) } };
  }

  if (TABLE_LABELS.has(label)) {
    return {
      type: 'table',
      content: { table_body: content, table_caption: [], table_footnote: [] },
    };
  }

  if (CHART_LABELS.has(label) && !assetPath) {
    // 开启 useChartRecognition 后 PaddleOCR 会把图表转成 Markdown 表格返回，
    // 此时没有图片资产，按表格渲染；未开启时走下面的图片分支。
    if (MARKDOWN_TABLE_PATTERN.test(content)) {
      return {
        type: 'table',
        content: { table_body: content, table_caption: [], table_footnote: [] },
      };
    }

    return { type: 'paragraph', content: { paragraph_content: textContent(content) } };
  }

  if (IMAGE_LABELS.has(label) || CHART_LABELS.has(label)) {
    return {
      type: 'image',
      content: {
        image_source: assetPath ? { path: assetPath } : {},
        // 保留上游给出的图内 OCR 正文（真实 image 块通常为空字符串），
        // 供图注缺失时展示，以及资产写盘失败时降级为文本。
        content,
        image_caption: [],
        chart_caption: [],
        image_footnote: [],
      },
    };
  }

  if (TITLE_LABELS.has(label)) {
    return {
      type: 'title',
      content: {
        title_content: textContent(content),
        text_level: label === 'doc_title' ? 1 : 2,
      },
    };
  }

  return { type: 'paragraph', content: { paragraph_content: textContent(content) } };
}

function createVisualBlock({ label, content, bbox, pageSize, assetPath, assetKey, pageIndex }) {
  const built = buildContentForLabel({ label, content, assetPath });
  const block = {
    type: built.type,
    content: built.content,
  };

  if (bbox) {
    block.bbox = bbox;
    block.bboxCoordinateSystem = 'pdf';
  }

  if (pageSize) {
    block.bboxPageSize = pageSize;
  }

  if (assetKey) {
    block._paddleAssetKey = assetKey;
  }

  block._paddlePageIndex = pageIndex;

  return block;
}

/**
 * 归一化单页。
 *
 * @returns {{ blocks: object[], assets: object[], markdownImages: Record<string, string> }}
 */
function normalizePaddleOcrPage(page, pageIndex) {
  const prunedResult = page?.prunedResult && typeof page.prunedResult === 'object' ? page.prunedResult : {};
  const markdown = page?.markdown && typeof page.markdown === 'object' ? page.markdown : {};
  const markdownImages = markdown.images && typeof markdown.images === 'object' ? markdown.images : {};
  const entries = Array.isArray(prunedResult.parsing_res_list) ? prunedResult.parsing_res_list : [];
  const pageSize = readPageSize(prunedResult);

  const assets = [];
  const assetsByKey = new Map();
  const assetPathByKey = new Map();
  const consumedKeys = new Set();

  const registerAsset = (key) => {
    if (!key || consumedKeys.has(key)) return null;
    if (!(key in markdownImages)) return null;

    const existing = assetPathByKey.get(key);
    if (existing) {
      consumedKeys.add(key);
      return existing;
    }

    const assetPath = `images/paddle_p${pageIndex + 1}_${sanitizeAssetFileName(key)}`;
    assetPathByKey.set(key, assetPath);
    assetsByKey.set(key, { key, assetPath, value: markdownImages[key] });
    assets.push(assetsByKey.get(key));
    consumedKeys.add(key);

    return assetPath;
  };

  const blocks = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    const label = typeof entry.block_label === 'string' ? entry.block_label.trim().toLowerCase() : '';
    const content = typeof entry.block_content === 'string' ? entry.block_content : '';
    const bbox = readBbox(entry.block_bbox);

    if (!label) continue;

    const isImageCaption = IMAGE_CAPTION_LABELS.has(label);
    const isTableCaption = TABLE_CAPTION_LABELS.has(label);

    if (isImageCaption || isTableCaption) {
      // PaddleOCR 的 reading order 把图注/表注排在视觉块之后（figure_title 在
      // SKIP_ORDER_LABELS 内），因此直接并入紧邻的上一个同类视觉块。
      const host = blocks[blocks.length - 1];
      const text = content.trim();
      const matchesHost = Boolean(host) && text &&
        (isTableCaption ? host.type === 'table' : host.type === 'image');

      if (matchesHost) {
        if (isTableCaption) {
          host.content.table_caption = textContent(text);
        } else {
          host.content.image_caption = textContent(text);
          host.content.chart_caption = textContent(text);
        }
        continue;
      }

      // 找不到宿主时退化为普通段落，避免丢内容。
      blocks.push({
        type: 'paragraph',
        content: { paragraph_content: textContent(content) },
      });
      continue;
    }

    let assetPath = null;
    let assetKey = null;

    if (IMAGE_LABELS.has(label) || CHART_LABELS.has(label)) {
      const expectedKey = constructPaddleImageKey(label, bbox);
      assetKey = registerAsset(expectedKey);
      if (assetKey) {
        assetPath = assetKey;
      } else {
        // 兜底 1：按 bbox 数字后缀匹配（上游若调整了命名前缀仍可命中）。
        if (bbox) {
          const suffix = `_box_${bbox[0]}_${bbox[1]}_${bbox[2]}_${bbox[3]}.`;
          const fuzzyKey = Object.keys(markdownImages).find(
            (key) => !consumedKeys.has(key) && key.includes(suffix),
          );
          if (fuzzyKey) {
            assetPath = registerAsset(fuzzyKey);
            if (assetPath) assetKey = fuzzyKey;
          }
        }

        // 兜底 2：按顺序消费尚未分配的图片资产。
        if (!assetPath) {
          const nextKey = Object.keys(markdownImages).find((key) => !consumedKeys.has(key));
          if (nextKey) {
            assetPath = registerAsset(nextKey);
            if (assetPath) assetKey = nextKey;
          }
        }
      }
    }

    const block = createVisualBlock({
      label,
      content,
      bbox,
      pageSize,
      assetPath,
      assetKey,
      pageIndex,
    });

    if (block.type === 'image' && !assetPath) {
      // 没有图片资产的视觉块：保留占位说明，交给上层过滤，避免生成空块。
      block.content.image_caption = textContent(content);
    }

    blocks.push(block);
  }

  return { blocks, assets, markdownImages };
}

/**
 * 归一化整份文档。
 *
 * @param {unknown[]} layoutParsingResults 云端 JSONL 汇总后的 layoutParsingResults
 * @returns {{ pages: object[][], assets: object[], markdownText: string, pageCount: number }}
 */
function normalizePaddleOcrDocument(layoutParsingResults) {
  const pages = [];
  const assets = [];
  const markdownSections = [];

  const pageList = Array.isArray(layoutParsingResults) ? layoutParsingResults : [];

  pageList.forEach((page, pageIndex) => {
    const normalized = normalizePaddleOcrPage(page, pageIndex);

    // 去掉内部标记字段，产物必须与 MinerU content_list_v2 完全同构。
    const cleaned = normalized.blocks.map((block) => {
      const rest = { ...block };
      delete rest._paddleAssetKey;
      delete rest._paddlePageIndex;

      return rest;
    });

    pages.push(cleaned);
    assets.push(...normalized.assets);

    const rawMarkdown = typeof page?.markdown?.text === 'string' ? page.markdown.text : '';
    let markdown = rawMarkdown;

    for (const asset of normalized.assets) {
      markdown = markdown.split(asset.key).join(asset.assetPath);
    }

    if (markdown.trim()) markdownSections.push(markdown.trim());
  });

  return {
    pages,
    assets,
    markdownText: markdownSections.join('\n\n'),
    pageCount: pageList.length,
  };
}

module.exports = {
  IMAGE_CAPTION_LABELS,
  TABLE_CAPTION_LABELS,
  constructPaddleImageKey,
  normalizePaddleOcrDocument,
  normalizePaddleOcrPage,
  sanitizeAssetFileName,
};
