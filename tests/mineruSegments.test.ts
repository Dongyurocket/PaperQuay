import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMineruOutlineIndex,
  splitMineruPagesIntoParts,
  type MineruOutlineIndexItem,
} from '../src/features/reader/mineruSegments.ts';
import {
  parseMineruDocumentOffThread,
  parseMineruPagesOffThread,
} from '../src/features/reader/mineruParseWorker.ts';
import { buildMineruOutlineFromIndex } from '../src/features/pdf/pdfOutline.ts';
import type { MineruPage } from '../src/types/reader.ts';

function createMockPages(pageCount: number, blocksPerPage: number): MineruPage[] {
  const pages: MineruPage[] = [];
  for (let p = 0; p < pageCount; p++) {
    const page: MineruPage = [];
    // 偶数页包含一个标题块
    if (p % 2 === 0) {
      page.push({
        type: 'title',
        content: { text: `Chapter or Section ${p + 1}`, text_level: p === 0 ? 1 : 2 },
      });
    }
    for (let b = 0; b < blocksPerPage; b++) {
      page.push({
        type: 'paragraph',
        content: { text: `Paragraph content on page ${p + 1} block ${b + 1}` },
      });
    }
    pages.push(page);
  }
  return pages;
}

test('splitMineruPagesIntoParts separates metadata, outline index and page segments', () => {
  const mockPages = createMockPages(60, 4); // 60 页，每批 25 页应拆为 3 段
  const parts = splitMineruPagesIntoParts(mockPages, 25, '/test/paper.json');

  // 1. 元数据验证
  assert.equal(parts.metadata.pageCount, 60);
  assert.ok(parts.metadata.blockCount > 240);
  assert.equal(parts.metadata.sourcePath, '/test/paper.json');

  // 2. 章节索引验证（从标题块抽取，含层级、页码、blockId 与标题）
  assert.ok(parts.outlineIndex.length > 0);
  assert.equal(parts.outlineIndex[0].title, 'Chapter or Section 1');
  assert.equal(parts.outlineIndex[0].level, 1);
  assert.equal(parts.outlineIndex[0].pageIndex, 0);
  assert.equal(parts.outlineIndex[0].blockId, 'page-1-block-1');

  // 3. 正文分段验证
  assert.equal(parts.segments.length, 3);
  // 第一段：0-24 页
  assert.equal(parts.segments[0].segmentIndex, 0);
  assert.equal(parts.segments[0].startPageIndex, 0);
  assert.equal(parts.segments[0].pageCount, 25);
  assert.equal(parts.segments[0].done, false);
  assert.equal(parts.segments[0].blocks[0].blockId, 'page-1-block-1');

  // 第二段：25-49 页
  assert.equal(parts.segments[1].segmentIndex, 1);
  assert.equal(parts.segments[1].startPageIndex, 25);
  assert.equal(parts.segments[1].pageCount, 25);
  assert.equal(parts.segments[1].done, false);
  // 校验跨分段时全局 pageIndex 与 blockId 保持全局绝对连续，而非从 0 开始
  assert.equal(parts.segments[1].blocks[0].pageIndex, 25);
  assert.equal(parts.segments[1].blocks[0].blockId, 'page-26-block-1');

  // 第三段：50-59 页（最后一段）
  assert.equal(parts.segments[2].segmentIndex, 2);
  assert.equal(parts.segments[2].startPageIndex, 50);
  assert.equal(parts.segments[2].pageCount, 10);
  assert.equal(parts.segments[2].done, true);
});

test('progressive availability: outline is ready from index without waiting for later segments', () => {
  const mockPages = createMockPages(80, 5);
  const parts = splitMineruPagesIntoParts(mockPages, 25);

  // 模拟渐进式到达过程：
  // 步骤 A：第 0 步首先到达 outlineIndex，正文尚无任何块到达
  const immediateOutline = buildMineruOutlineFromIndex(parts.outlineIndex);
  assert.ok(immediateOutline.length > 0, 'Outline is fully built from index');
  assert.equal(immediateOutline[0].title, 'Chapter or Section 1');
  assert.ok(immediateOutline[0].children.length > 0, 'Outline hierarchy is preserved');

  // 步骤 B：第 1 批正文分段到达（前 25 页），正文前段已可渲染
  const firstSegmentBlocks = parts.segments[0].blocks;
  assert.equal(parts.segments[0].pageCount, 25);
  assert.ok(firstSegmentBlocks.length > 0);

  // 步骤 C：各分段累加，最终结果完整保留原有结构
  const allBlocksProgressive = parts.segments.flatMap((seg) => seg.blocks);
  const totalBlocks = parts.metadata.blockCount;
  assert.equal(allBlocksProgressive.length, totalBlocks);
});

test('parseMineruPagesOffThread and parseMineruDocumentOffThread support progressive callbacks', async () => {
  const mockPages = createMockPages(30, 2);
  const jsonText = JSON.stringify(mockPages);

  let capturedOutline: MineruOutlineIndexItem[] = [];
  const segmentsReceived: number[] = [];

  const pages = await parseMineruPagesOffThread(jsonText, {
    sourcePath: '/path/doc.json',
    onOutlineIndex: (outline) => {
      capturedOutline = outline;
    },
    onSegment: (segmentPages, progress) => {
      segmentsReceived.push(segmentPages.length);
      assert.ok(progress.totalSegments >= 1);
    },
  });

  // 保证回调在解析完成前已被正常调用
  assert.ok(capturedOutline.length > 0, 'onOutlineIndex triggered');
  assert.ok(segmentsReceived.length > 0, 'onSegment triggered for each batch');
  // 最终 resolve 的数据依然是完整的 MinerU 页面数组（原有完整路径不变）
  assert.equal(pages.length, 30);

  // parseMineruDocumentOffThread 结构化返回元数据、章节索引和完整页面
  const docResult = await parseMineruDocumentOffThread(jsonText, { sourcePath: '/path/doc.json' });
  assert.equal(docResult.metadata.pageCount, 30);
  assert.ok(docResult.outlineIndex.length > 0);
  assert.equal(docResult.pages.length, 30);
});
