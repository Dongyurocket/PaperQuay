import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeExtractedMetadata } = require('../electron/backend/aiCommands.cjs');

test('normalizeExtractedMetadata normalizes a complete Chinese metadata payload', () => {
  const result = normalizeExtractedMetadata({
    title: '  基于深度学习的滚动轴承故障诊断方法  ',
    authors: [' 张三 ', '李四', 123, null],
    year: '2024年',
    publication: '振动工程学报',
    doi: 'https://doi.org/10.12345/example.2024.001',
    abstractText: '本文提出了一种基于深度学习的故障诊断方法。',
    keywords: ['深度学习', '故障诊断', '', '滚动轴承'],
    publisher: '某出版社',
    volume: ' 37 ',
    issue: '2',
    pages: '123-135',
    issn: '1000-1234',
    itemType: 'journalArticle',
  });

  assert.deepEqual(result, {
    source: 'llm-extract',
    doi: '10.12345/example.2024.001',
    title: '基于深度学习的滚动轴承故障诊断方法',
    authors: ['张三', '李四'],
    year: '2024',
    publication: '振动工程学报',
    url: null,
    abstractText: '本文提出了一种基于深度学习的故障诊断方法。',
    keywords: ['深度学习', '故障诊断', '滚动轴承'],
    publisher: '某出版社',
    volume: '37',
    issue: '2',
    pages: '123-135',
    issn: '1000-1234',
    itemType: 'journalArticle',
  });
});

test('normalizeExtractedMetadata returns null when no useful field is present', () => {
  assert.equal(normalizeExtractedMetadata({}), null);
  assert.equal(normalizeExtractedMetadata(null), null);
  assert.equal(
    normalizeExtractedMetadata({ title: '  ', authors: [], keywords: ['只有关键词'] }),
    null,
  );
});

test('normalizeExtractedMetadata rejects unknown itemType values', () => {
  const result = normalizeExtractedMetadata({
    title: '某论文',
    itemType: 'magazineArticle',
  });

  assert.equal(result?.itemType, null);

  const thesis = normalizeExtractedMetadata({
    title: '某学位论文',
    itemType: 'thesis',
  });

  assert.equal(thesis?.itemType, 'thesis');
});
