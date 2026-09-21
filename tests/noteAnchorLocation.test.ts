import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageIndexFromAnchorLabel,
  pageIndexFromMineruBlockId,
  parseNotePolishAnchorLocation,
  resolveNoteAnchorLocation,
} from '../src/features/notes/noteAnchorLocation.ts';

test('pageIndexFromMineruBlockId 把 1 起始的 MinerU 块 id 换成 0 起始页下标', () => {
  assert.equal(pageIndexFromMineruBlockId('page-20-block-3'), 19);
  assert.equal(pageIndexFromMineruBlockId('page-1-block-1'), 0);
  assert.equal(pageIndexFromMineruBlockId('  page-101-block-20  '), 100);
  assert.equal(pageIndexFromMineruBlockId('block-3'), null);
  assert.equal(pageIndexFromMineruBlockId('page-0-block-1'), null);
});

test('pageIndexFromAnchorLabel 只认 P 页码标签', () => {
  assert.equal(pageIndexFromAnchorLabel('P20'), 19);
  assert.equal(pageIndexFromAnchorLabel('p 7'), 6);
  assert.equal(pageIndexFromAnchorLabel('定位'), null);
  assert.equal(pageIndexFromAnchorLabel(undefined), null);
});

test('parseNotePolishAnchorLocation 从润色锚点 id 还原块与页', () => {
  assert.deepEqual(
    parseNotePolishAnchorLocation('note-polish:paper_muazt87m_b0cd8e32:mineru:page-20-block-3:0'),
    { blockId: 'page-20-block-3', pageIndex: 19 },
  );
  assert.deepEqual(parseNotePolishAnchorLocation('note-polish:paper-1:mineru:page-2-block-11:3'), {
    blockId: 'page-2-block-11',
    pageIndex: 1,
  });
  // pdf 分块（pdf:<sectionIndex>）无法反推页码，交给页码标签兜底。
  assert.equal(parseNotePolishAnchorLocation('note-polish:paper-1:chunk-4'), null);
});

test('resolveNoteAnchorLocation 优先使用锚点自带的位置', () => {
  const location = resolveNoteAnchorLocation({
    id: 'note-polish:paper-1:mineru:page-9-block-1:0',
    label: 'P9',
    blockId: 'block-8',
    pageIndex: 7,
    pdfLocation: { pageNumber: 8 },
  });

  assert.equal(location.blockId, 'block-8');
  assert.equal(location.pageIndex, 7);
  assert.deepEqual(location.pdfLocation, { pageNumber: 8 });
});

test('resolveNoteAnchorLocation 用 pdfLocation.pageNumber 补出 pageIndex', () => {
  const location = resolveNoteAnchorLocation({
    id: 'anchor-1',
    label: '定位',
    blockId: null,
    pageIndex: null,
    pdfLocation: { pageNumber: 12 },
  });

  assert.equal(location.blockId, null);
  assert.equal(location.pageIndex, 11);
});

test('resolveNoteAnchorLocation 对丢失位置的历史锚点按 id 与页码标签降级', () => {
  // 用户实测数据：锚点只剩 id / label（blockId / pageIndex 曾被持久化层丢弃）。
  const location = resolveNoteAnchorLocation({
    id: 'note-polish:paper_muazt87m_b0cd8e32:mineru:page-20-block-3:0',
    label: 'P20',
    blockId: null,
    pageIndex: null,
    pdfLocation: null,
  });

  assert.equal(location.blockId, 'page-20-block-3');
  assert.equal(location.pageIndex, 19);

  const labelOnly = resolveNoteAnchorLocation({
    id: 'paper-ref:paper-2',
    label: 'P20',
    blockId: null,
    pageIndex: null,
    pdfLocation: null,
  });

  assert.equal(labelOnly.blockId, null);
  assert.equal(labelOnly.pageIndex, 19);

  const noLocation = resolveNoteAnchorLocation({
    id: 'anchor-3',
    label: '定位',
    blockId: null,
    pageIndex: null,
    pdfLocation: null,
  });

  assert.equal(noLocation.blockId, null);
  assert.equal(noLocation.pageIndex, null);
});
