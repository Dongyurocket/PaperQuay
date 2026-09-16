import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';

// @ts-ignore
import { planPdfSplits, getPdfPageCount, splitPdfFiles } from '../electron/backend/pdfSplitter.cjs';
// @ts-ignore
import { mergeMineruParseResults } from '../electron/backend/mineruMerge.cjs';

test('planPdfSplits correctly divides pages into batches', () => {
  // 320 页，每卷最大 150
  const plans = planPdfSplits(320, 150);
  assert.equal(plans.length, 3);

  assert.deepEqual(plans[0], {
    partIndex: 0,
    startPage: 1,
    endPage: 150,
    pageCount: 150,
    pageOffset: 0,
  });

  assert.deepEqual(plans[1], {
    partIndex: 1,
    startPage: 151,
    endPage: 300,
    pageCount: 150,
    pageOffset: 150,
  });

  assert.deepEqual(plans[2], {
    partIndex: 2,
    startPage: 301,
    endPage: 320,
    pageCount: 20,
    pageOffset: 300,
  });

  // <= 150 页，只有 1 卷
  assert.equal(planPdfSplits(120, 150).length, 1);
  assert.equal(planPdfSplits(0, 150).length, 0);
});

test('splitPdfFiles correctly generates valid split PDF documents', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-pdf-test-'));
  try {
    // 动态生成一个 5 页的测试 PDF
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) {
      doc.addPage([200, 200]);
    }
    const pdfBytes = await doc.save();
    const pdfPath = path.join(tmpDir, 'sample_5p.pdf');
    await fsp.writeFile(pdfPath, pdfBytes);

    const pageCount = await getPdfPageCount(pdfPath);
    assert.equal(pageCount, 5);

    // 计划：每卷 2 页 (1-2, 3-4, 5-5)
    const plans = planPdfSplits(5, 2);
    assert.equal(plans.length, 3);

    const splitDir = path.join(tmpDir, 'splits');
    const results = await splitPdfFiles(pdfPath, plans, splitDir);
    assert.equal(results.length, 3);

    const p1Count = await getPdfPageCount(results[0].path);
    const p2Count = await getPdfPageCount(results[1].path);
    const p3Count = await getPdfPageCount(results[2].path);
    assert.equal(p1Count, 2);
    assert.equal(p2Count, 2);
    assert.equal(p3Count, 1);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

test('mergeMineruParseResults accurately offsets page_idx and resolves image paths', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-merge-test-'));
  try {
    const part1Dir = path.join(tmpDir, 'part1');
    const part2Dir = path.join(tmpDir, 'part2');
    const finalDir = path.join(tmpDir, 'final');

    await fsp.mkdir(path.join(part1Dir, 'images'), { recursive: true });
    await fsp.mkdir(path.join(part2Dir, 'images'), { recursive: true });

    // 在各分卷放入模拟图片
    await fsp.writeFile(path.join(part1Dir, 'images', 'fig1.jpg'), 'fake-image-1');
    await fsp.writeFile(path.join(part2Dir, 'images', 'fig1.jpg'), 'fake-image-2'); // 相同文件名，需防重名

    const part1Blocks = [
      { type: 'text', page_idx: 0, text: 'Hello Part 1 Page 1' },
      { type: 'image', page_idx: 1, img_path: 'images/fig1.jpg' },
    ];
    const part2Blocks = [
      { type: 'text', page_idx: 0, text: 'Hello Part 2 Page 1' },
      { type: 'image', page_idx: 1, img_path: 'images/fig1.jpg' },
    ];

    const part1Middle = {
      pdf_info: [
        { page_idx: 0, para_blocks: [{ text: 'P1-0' }] },
        { page_idx: 1, para_blocks: [{ text: 'P1-1' }] },
      ],
    };
    const part2Middle = {
      pdf_info: [
        { page_idx: 0, para_blocks: [{ text: 'P2-0' }] },
        { page_idx: 1, para_blocks: [{ text: 'P2-1' }] },
      ],
    };

    const parts = [
      {
        partIndex: 0,
        pageOffset: 0,
        pageCount: 150,
        extracted: {
          contentJsonText: JSON.stringify(part1Blocks),
          middleJsonText: JSON.stringify(part1Middle),
          markdownText: '# Title 1\n\n![](images/fig1.jpg)',
          assetRootDir: part1Dir,
        },
      },
      {
        partIndex: 1,
        pageOffset: 150, // 偏移 150 页
        pageCount: 150,
        extracted: {
          contentJsonText: JSON.stringify(part2Blocks),
          middleJsonText: JSON.stringify(part2Middle),
          markdownText: '# Title 2\n\n![](images/fig1.jpg)',
          assetRootDir: part2Dir,
        },
      },
    ];

    const merged = await mergeMineruParseResults(parts, finalDir);

    // 检查合并后的 content_list
    assert.ok(merged.contentJsonText);
    const mergedBlocks = JSON.parse(merged.contentJsonText);
    assert.equal(mergedBlocks.length, 4);
    assert.equal(mergedBlocks[0].page_idx, 0);
    assert.equal(mergedBlocks[1].page_idx, 1);
    assert.equal(mergedBlocks[1].img_path, 'images/part_1_fig1.jpg');

    // 第二分卷 page_idx 必须偏移 150
    assert.equal(mergedBlocks[2].page_idx, 150);
    assert.equal(mergedBlocks[3].page_idx, 151);
    assert.equal(mergedBlocks[3].img_path, 'images/part_2_fig1.jpg');

    // 检查 middle.json
    assert.ok(merged.middleJsonText);
    const mergedMiddle = JSON.parse(merged.middleJsonText);
    assert.equal(mergedMiddle.pdf_info.length, 4);
    assert.equal(mergedMiddle.pdf_info[0].page_idx, 0);
    assert.equal(mergedMiddle.pdf_info[1].page_idx, 1);
    assert.equal(mergedMiddle.pdf_info[2].page_idx, 150);
    assert.equal(mergedMiddle.pdf_info[3].page_idx, 151);

    // 检查 Markdown
    assert.ok(merged.markdownText);
    assert.ok(merged.markdownText.includes('images/part_1_fig1.jpg'));
    assert.ok(merged.markdownText.includes('images/part_2_fig1.jpg'));

    // 检查两张图片都被保留，无互相覆盖
    const img1 = await fsp.readFile(path.join(finalDir, 'images', 'part_1_fig1.jpg'), 'utf8');
    const img2 = await fsp.readFile(path.join(finalDir, 'images', 'part_2_fig1.jpg'), 'utf8');
    assert.equal(img1, 'fake-image-1');
    assert.equal(img2, 'fake-image-2');
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

// 回归：MinerU v2 / vlm 的 content_list_v2.json 是「页数组 + 页内块字典」形状
// （`[{ "0": block, "1": block }, ...]`，没有 page_idx）。旧实现只处理扁平 block
// 数组，导致超 200 页拆分文档的全部图片引用未被改写（实测 9 份文档 2859 条缺失）。
test('mergeMineruParseResults remaps images inside page-dictionary content_list', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-merge-dict-'));
  try {
    const part1Dir = path.join(tmpDir, 'part1');
    const part2Dir = path.join(tmpDir, 'part2');
    const finalDir = path.join(tmpDir, 'final');

    await fsp.mkdir(path.join(part1Dir, 'images'), { recursive: true });
    await fsp.mkdir(path.join(part2Dir, 'images'), { recursive: true });

    await fsp.writeFile(path.join(part1Dir, 'images', 'aaa.jpg'), 'image-a');
    await fsp.writeFile(path.join(part2Dir, 'images', 'bbb.jpg'), 'image-b');

    // v2 真实形状：路径嵌在 content.image_source.path
    const part1Pages = [
      {
        0: { type: 'paragraph', content: { paragraph_content: [{ type: 'text', content: 'P1' }] } },
        1: { type: 'image', content: { image_source: { path: 'images/aaa.jpg' } }, bbox: [10, 10, 100, 100] },
      },
      {
        0: { type: 'title', content: { title_content: [{ type: 'text', content: 'Chapter' }] } },
      },
    ];
    const part2Pages = [
      {
        0: { type: 'image', content: { image_source: { path: 'images/bbb.jpg' } }, bbox: [20, 20, 200, 200] },
      },
    ];

    const parts = [
      {
        partIndex: 0,
        pageOffset: 0,
        pageCount: 2,
        extracted: {
          contentJsonText: JSON.stringify(part1Pages),
          markdownText: '![](images/aaa.jpg)',
          assetRootDir: part1Dir,
        },
      },
      {
        partIndex: 1,
        pageOffset: 2,
        pageCount: 1,
        extracted: {
          contentJsonText: JSON.stringify(part2Pages),
          markdownText: '![](images/bbb.jpg)',
          assetRootDir: part2Dir,
        },
      },
    ];

    const merged = await mergeMineruParseResults(parts, finalDir);
    const mergedPages = JSON.parse(merged.contentJsonText as string);

    // 页序必须保持：part1 的 2 页在前，part2 的 1 页在后
    assert.equal(mergedPages.length, 3);

    // 形状必须保持为页字典，否则阅读器的分页还原会失效
    for (const page of mergedPages) {
      assert.equal(Array.isArray(page), false);
      assert.equal('type' in page, false);
      assert.ok(Object.keys(page).length > 0);
    }

    assert.equal(mergedPages[0]['1'].content.image_source.path, 'images/part_1_aaa.jpg');
    assert.equal(mergedPages[2]['0'].content.image_source.path, 'images/part_2_bbb.jpg');

    // 引用必须真实落地到磁盘
    assert.equal(
      await fsp.readFile(path.join(finalDir, 'images', 'part_1_aaa.jpg'), 'utf8'),
      'image-a',
    );
    assert.equal(
      await fsp.readFile(path.join(finalDir, 'images', 'part_2_bbb.jpg'), 'utf8'),
      'image-b',
    );

    assert.ok(merged.markdownText?.includes('images/part_1_aaa.jpg'));
    assert.ok(merged.markdownText?.includes('images/part_2_bbb.jpg'));
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

// 回归：扁平数组 + 嵌套 content.image_source.path（v2 扁平形态）也必须改写。
// 实测本地 62 份缓存共 8955 条资产引用全部是嵌套形状，顶层 img_path 为 0 条，
// 因此只查顶层字段的实现对 v2 产物从未生效。
test('mergeMineruParseResults remaps nested v2 asset paths in a flat array', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paperquay-merge-nested-'));
  try {
    const part1Dir = path.join(tmpDir, 'part1');
    const finalDir = path.join(tmpDir, 'final');

    await fsp.mkdir(path.join(part1Dir, 'images'), { recursive: true });
    await fsp.writeFile(path.join(part1Dir, 'images', 'ccc.jpg'), 'image-c');

    const part1Blocks = [
      {
        type: 'chart',
        page_idx: 0,
        content: {
          image_source: { path: 'images/ccc.jpg' },
          chart_caption: [{ type: 'text', content: 'Fig. 7' }],
        },
      },
    ];

    const merged = await mergeMineruParseResults(
      [
        {
          partIndex: 0,
          pageOffset: 3,
          pageCount: 1,
          extracted: {
            contentJsonText: JSON.stringify(part1Blocks),
            assetRootDir: part1Dir,
          },
        },
      ],
      finalDir,
    );

    const mergedBlocks = JSON.parse(merged.contentJsonText as string);
    assert.equal(mergedBlocks.length, 1);
    assert.equal(mergedBlocks[0].content.image_source.path, 'images/part_1_ccc.jpg');
    // 图注文本不能被路径改写逻辑破坏
    assert.equal(mergedBlocks[0].content.chart_caption[0].content, 'Fig. 7');
    assert.equal(mergedBlocks[0].page_idx, 3);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});
