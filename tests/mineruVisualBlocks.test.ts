import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTranslationMap } from "../src/features/reader/readerTranslation.ts";
import {
  buildRenderableBlocks,
  extractCaptionFromMineruBlock,
  extractTableHtmlFromMineruBlock,
  extractTextFromMineruBlock,
  extractTranslatableMarkdownFromMineruBlock,
  flattenMineruPages,
  parseMineruPages,
} from "../src/services/mineru.ts";

const MINERU_JSON_PATH = "C:/cache/document-demo/content_list_v2.json";

function parseBlocks(...rawBlocks: Record<string, unknown>[]) {
  return flattenMineruPages(parseMineruPages([rawBlocks]));
}

function normalizeAssetPath(path: string | undefined): string {
  return (path ?? "").replace(/\\/g, "/");
}

test("chart block with chart_caption is normalized to image with a resolved asset", () => {
  const [block] = parseBlocks({
    type: "chart",
    content: {
      image_source: { path: "images/chart-captioned.jpg" },
      content: "",
      chart_caption: [{ type: "text", content: "Fig. 8 Payload-range characteristics." }],
      chart_footnote: [],
    },
    bbox: [100, 120, 400, 360],
  });

  assert.equal(block.type, "image");

  const [renderable] = buildRenderableBlocks([block], MINERU_JSON_PATH);

  assert.equal(renderable.block.type, "image");
  assert.equal(
    normalizeAssetPath(renderable.assetPath),
    "C:/cache/document-demo/images/chart-captioned.jpg",
  );
  assert.equal(renderable.captionText, "Fig. 8 Payload-range characteristics.");
});

test("chart caption becomes clean translation input without asset paths", () => {
  const [block] = parseBlocks({
    type: "chart",
    content: {
      image_source: { path: "images/79b492dac9f66.jpg" },
      content: "",
      chart_caption: [{ type: "text", content: "Fig. 8 Simplified mission profile." }],
      chart_footnote: [],
    },
    bbox: [100, 120, 400, 360],
  });

  const input = extractTranslatableMarkdownFromMineruBlock(block);

  assert.match(input, /Fig\. 8 Simplified mission profile\./);
  assert.doesNotMatch(input, /images\//);
});

test("captionless chart is not a translation unit and produces no caption text", () => {
  const [block] = parseBlocks({
    type: "chart",
    content: {
      image_source: { path: "images/chart-plain.jpg" },
      content: "",
      chart_caption: [],
      chart_footnote: [],
    },
    bbox: [100, 120, 400, 360],
  });

  assert.equal(block.type, "image");
  assert.equal(extractTranslatableMarkdownFromMineruBlock(block), "");

  const [renderable] = buildRenderableBlocks([block], MINERU_JSON_PATH);

  assert.equal(renderable.captionText, "");
  assert.equal(renderable.markdown, "");
  assert.ok(renderable.assetPath, "asset path is still resolved for image rendering");
});

test("figure blocks are normalized to image and keep image_caption", () => {
  const [block] = parseBlocks({
    type: "figure",
    content: {
      image_source: { path: "images/figure.jpg" },
      image_caption: [{ type: "text", content: "Fig. 1 System overview." }],
      image_footnote: [],
    },
    bbox: [10, 20, 300, 220],
  });

  assert.equal(block.type, "image");
  assert.equal(extractCaptionFromMineruBlock(block), "Fig. 1 System overview.");
  assert.doesNotMatch(extractTranslatableMarkdownFromMineruBlock(block), /images\//);
});

test("image block with OCR content keeps its text as translatable input", () => {
  const [block] = parseBlocks({
    type: "image",
    content: {
      image_source: { path: "images/ocr-image.jpg" },
      content: "OCR text inside figure",
      image_caption: [],
      image_footnote: [],
    },
    bbox: [10, 20, 300, 220],
  });

  const input = extractTranslatableMarkdownFromMineruBlock(block);

  assert.match(input, /OCR text inside figure/);
  assert.doesNotMatch(input, /images\//);
});

test("table with empty table_caption keeps HTML for rendering but never leaks it as caption", () => {
  const tableHtml =
    "<table><tr><td>MTOW</td><td>1,013 kg</td><td>964 kg</td></tr></table>";
  const [block] = parseBlocks({
    type: "table",
    content: {
      image_source: { path: "images/table-body.jpg" },
      table_caption: [],
      table_footnote: [],
      html: tableHtml,
      table_type: "simple_table",
      table_nest_level: 1,
    },
    bbox: [78, 191, 917, 453],
  });

  assert.equal(extractCaptionFromMineruBlock(block), "");
  assert.equal(extractTableHtmlFromMineruBlock(block), tableHtml);
  assert.equal(extractTextFromMineruBlock(block), "MTOW 1,013 kg 964 kg");

  const input = extractTranslatableMarkdownFromMineruBlock(block);

  assert.doesNotMatch(input, /<table/i);
  assert.doesNotMatch(input, /images\//);
  assert.match(input, /MTOW/);

  const [renderable] = buildRenderableBlocks([block], MINERU_JSON_PATH);

  assert.equal(renderable.captionText, "");
  assert.equal(renderable.tableHtml, tableHtml);
  assert.doesNotMatch(renderable.markdown, /<table/i);
  assert.doesNotMatch(renderable.markdown, /images\//);
});

test("table with a real caption uses it for display and translation input", () => {
  const tableHtml = "<table><tr><td>Category</td><td>Requirement</td></tr></table>";
  const [block] = parseBlocks({
    type: "table",
    content: {
      image_source: { path: "images/table-1.jpg" },
      table_caption: [{ type: "text", content: "TABLE 1 Mission requirements." }],
      table_footnote: [],
      html: tableHtml,
      table_type: "simple_table",
      table_nest_level: 1,
    },
    bbox: [78, 336, 487, 499],
  });

  assert.equal(extractCaptionFromMineruBlock(block), "TABLE 1 Mission requirements.");

  const input = extractTranslatableMarkdownFromMineruBlock(block);

  assert.match(input, /TABLE 1 Mission requirements\./);
  assert.doesNotMatch(input, /<table/i);
  assert.doesNotMatch(input, /images\//);
});

test("flat content_list chart blocks are normalized to image without img_path noise", () => {
  const pages = parseMineruPages([
    {
      type: "chart",
      page_idx: 0,
      img_path: "images/flat-chart.jpg",
      chart_caption: [{ type: "text", content: "Fig. 1 Overview." }],
      chart_footnote: [],
      bbox: [0, 0, 10, 10],
    },
  ]);

  assert.equal(pages[0][0].type, "image");

  const [block] = flattenMineruPages(pages);

  assert.equal(extractCaptionFromMineruBlock(block), "Fig. 1 Overview.");
  assert.doesNotMatch(extractTranslatableMarkdownFromMineruBlock(block), /images\//);
});

test("normalizeTranslationMap drops asset-path polluted cache entries", () => {
  const normalized = normalizeTranslationMap({
    "chart-with-caption": "images/79b492dac9f66.jpg图8 Uber Elevate简化任务剖面。",
    "wrapped-pollution": "**图片说明** images/abcd1234.pngFig. 3 System overview.",
    "normal": "这是一段正常译文。",
    "mentions-assets-later": "详情请参见 images/ 目录中的资源。",
  });

  assert.deepEqual(normalized, {
    "normal": "这是一段正常译文。",
    "mentions-assets-later": "详情请参见 images/ 目录中的资源。",
  });
});
