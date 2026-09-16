import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

// @ts-ignore
import {
  constructPaddleImageKey,
  normalizePaddleOcrDocument,
} from '../electron/backend/paddleOcrNormalize.cjs';
// @ts-ignore
import { persistPaddleOcrDocument, buildOptionalPayload } from '../electron/backend/paddleOcrCommands.cjs';

const ONE_PIXEL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function buildPage(overrides: Record<string, unknown> = {}) {
  return {
    prunedResult: {
      width: 1000,
      height: 1414,
      parsing_res_list: [],
    },
    markdown: { text: '', images: {} },
    ...overrides,
  };
}

test('normalizePaddleOcrDocument maps PaddleOCR labels onto MinerU block types', () => {
  const page = buildPage({
    prunedResult: {
      width: 1000,
      height: 1414,
      parsing_res_list: [
        { block_label: 'doc_title', block_content: 'Title', block_bbox: [100, 50, 900, 120] },
        { block_label: 'text', block_content: 'Body', block_bbox: [100, 140, 900, 260] },
        { block_label: 'paragraph_title', block_content: '2. Method', block_bbox: [100, 300, 500, 340] },
        { block_label: 'table', block_content: '<table></table>', block_bbox: [100, 400, 900, 600] },
        { block_label: 'display_formula', block_content: '$$a=b$$', block_bbox: [200, 700, 800, 760] },
      ],
    },
  });

  const document = normalizePaddleOcrDocument([page]);
  const blocks = document.pages[0];

  assert.deepEqual(
    blocks.map((block: { type: string }) => block.type),
    ['title', 'paragraph', 'title', 'table', 'equation_interline'],
  );

  // bbox 以 pdf 像素坐标 + 页尺寸表达，才能保住 PDF↔块的几何联动
  assert.deepEqual(blocks[0].bbox, [100, 50, 900, 120]);
  assert.equal(blocks[0].bboxCoordinateSystem, 'pdf');
  assert.deepEqual(blocks[0].bboxPageSize, [1000, 1414]);
  assert.equal(blocks[0].content.text_level, 1);
  assert.equal(blocks[2].content.text_level, 2);

  // 公式分隔符由前端统一处理，这里必须去掉裸 $$
  assert.equal(blocks[4].content.math_content, 'a=b');
  // 表格 HTML 走 table_body，与 MinerU 一致
  assert.equal(blocks[3].content.table_body, '<table></table>');
});

test('normalizePaddleOcrDocument attaches figure and table captions to the preceding visual block', () => {
  const imageKey = constructPaddleImageKey('image', [10, 20, 300, 400]);
  assert.equal(imageKey, 'imgs/img_in_image_box_10_20_300_400.jpg');

  const page = buildPage({
    prunedResult: {
      width: 1000,
      height: 1414,
      parsing_res_list: [
        { block_label: 'image', block_content: '', block_bbox: [10, 20, 300, 400] },
        { block_label: 'figure_title', block_content: 'Fig. 1: Layout', block_bbox: [10, 410, 300, 440] },
        { block_label: 'table', block_content: '<table></table>', block_bbox: [350, 300, 900, 600] },
        { block_label: 'table_title', block_content: 'Table 1: Mass', block_bbox: [350, 270, 900, 295] },
      ],
    },
    markdown: { text: '', images: { [imageKey]: ONE_PIXEL_JPEG_BASE64 } },
  });

  const document = normalizePaddleOcrDocument([page]);
  const blocks = document.pages[0];

  // 图注/表注被并入宿主块，而不是留下重复的独立段落
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'image');
  assert.equal(blocks[0].content.image_caption[0].content, 'Fig. 1: Layout');
  assert.equal(blocks[0].content.chart_caption[0].content, 'Fig. 1: Layout');
  assert.equal(blocks[1].type, 'table');
  assert.equal(blocks[1].content.table_caption[0].content, 'Table 1: Mass');
});

test('normalizePaddleOcrDocument rewrites markdown image refs and exposes the asset list', () => {
  const imageKey = constructPaddleImageKey('image', [10, 20, 300, 400]);
  const page = buildPage({
    prunedResult: {
      width: 1000,
      height: 1414,
      parsing_res_list: [{ block_label: 'image', block_content: '', block_bbox: [10, 20, 300, 400] }],
    },
    markdown: {
      text: `Body text\n\n![](${imageKey})`,
      images: { [imageKey]: ONE_PIXEL_JPEG_BASE64 },
    },
  });

  const document = normalizePaddleOcrDocument([page]);

  assert.equal(document.assets.length, 1);
  assert.equal(document.pages[0][0].content.image_source.path, document.assets[0].assetPath);

  // full.md 必须自洽：引用指向本地 images/ 副本，而不是上游的 imgs/ 路径
  assert.ok(document.markdownText.includes(document.assets[0].assetPath));
  assert.equal(document.markdownText.includes('imgs/img_in_'), false);
});

test('normalizePaddleOcrDocument falls back to sequential asset matching', () => {
  // 上游若改了图片命名，精确重建 key 会失败，此时按顺序消费资产仍须拿到图片。
  const oddKey = 'imgs/whatever_123.jpg';
  const page = buildPage({
    prunedResult: {
      width: 1000,
      height: 1414,
      parsing_res_list: [{ block_label: 'image', block_content: '', block_bbox: [10, 20, 300, 400] }],
    },
    markdown: { text: '![](imgs/whatever_123.jpg)', images: { [oddKey]: ONE_PIXEL_JPEG_BASE64 } },
  });

  const document = normalizePaddleOcrDocument([page]);

  assert.equal(document.assets.length, 1);
  assert.ok(document.pages[0][0].content.image_source.path);
  assert.ok(document.pages[0][0].content.image_source.path.startsWith('images/paddle_p1_'));
});

test('persistPaddleOcrDocument writes assets and degrades blocks whose asset failed', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-paddle-persist-'));

  try {
    const goodKey = constructPaddleImageKey('image', [10, 20, 300, 400]);
    const badKey = constructPaddleImageKey('image', [500, 20, 800, 400]);

    const page = buildPage({
      prunedResult: {
        width: 1000,
        height: 1414,
        parsing_res_list: [
          { block_label: 'image', block_content: '', block_bbox: [10, 20, 300, 400] },
          { block_label: 'image', block_content: 'Fig. 9: broken', block_bbox: [500, 20, 800, 400] },
        ],
      },
      markdown: {
        text: 'x',
        images: { [goodKey]: ONE_PIXEL_JPEG_BASE64, [badKey]: 'not-an-image' },
      },
    });

    const persisted = await persistPaddleOcrDocument({
      layoutResults: [page],
      extractDir: directory,
    });

    assert.equal(persisted.assetCount, 1);
    assert.equal(persisted.missingAssetCount, 1);

    const pages = JSON.parse(persisted.contentJsonText as string);
    assert.equal(pages[0][0].type, 'image');
    assert.equal(pages[0][0].content.image_source.path.startsWith('images/'), true);

    // 资产写盘失败的块不能留下指向不存在文件的引用
    assert.equal(pages[0][1].type, 'paragraph');
    assert.equal(pages[0][1].content.paragraph_content[0].content, 'Fig. 9: broken');

    const written = await fsp.readFile(
      path.join(directory, ...(pages[0][0].content.image_source.path as string).split('/')),
    );
    assert.ok(written.length > 0);
    assert.ok(persisted.zipEntries.includes('content_list_v2.json'));
    assert.ok(persisted.zipEntries.includes('full.md'));
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('buildOptionalPayload keeps chart recognition off by default', () => {
  assert.equal(buildOptionalPayload({}).useChartRecognition, false);
  assert.equal(buildOptionalPayload({ useChartRecognition: true }).useChartRecognition, true);
});
