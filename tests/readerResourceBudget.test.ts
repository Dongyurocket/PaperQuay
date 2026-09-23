import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ByteBudgetLruCache,
  chooseMountedReaderTabIds,
  estimateDataUrlBytes,
  estimateMineruParseBytes,
  estimatePdfDocumentBytes,
  estimateThumbnailBytes,
} from '../src/features/reader/readerResourceBudget.ts';
import { sliceMineruPages } from '../src/features/reader/mineruSegments.ts';

test('inactive reader tabs hibernate after the mounted limit', () => {
  const mounted = chooseMountedReaderTabIds({
    readerTabIds: ['a', 'b', 'c'],
    activeTabId: 'c',
    recentTabIds: ['b', 'a'],
  });

  assert.deepEqual(mounted, ['b', 'c']);
});

test('a translating tab stays mounted even when it is not recent', () => {
  const mounted = chooseMountedReaderTabIds({
    readerTabIds: ['a', 'b', 'c'],
    activeTabId: 'home',
    recentTabIds: ['c'],
    busyTabIds: ['a'],
  });

  assert.deepEqual(mounted, ['a', 'c']);
});

test('MinerU page segments keep order and stop at the document end', () => {
  const pages = ['p0', 'p1', 'p2', 'p3'];
  assert.deepEqual(sliceMineruPages(pages, 1, 2), ['p1', 'p2']);
  assert.deepEqual(sliceMineruPages(pages, -4, 2), ['p0', 'p1']);
  assert.deepEqual(sliceMineruPages(pages, 3, 5), ['p3']);
});

test('resource budget estimates byte sizes conservatively for PDF, MinerU and DataURLs', () => {
  assert.equal(estimatePdfDocumentBytes(null), 0);
  const pdf10 = estimatePdfDocumentBytes({ numPages: 10 });
  const pdf100 = estimatePdfDocumentBytes({ numPages: 100 });
  assert.ok(pdf10 > 4 * 1024 * 1024, 'PDF 10 pages includes base overhead');
  assert.ok(pdf100 > pdf10, 'PDF 100 pages is larger than 10 pages');

  const emptyMineru = estimateMineruParseBytes([]);
  assert.equal(emptyMineru, 0);

  const parsedPages = [
    {
      pageIndex: 0,
      blocks: [
        { blockId: 'b1', text: 'Hello world' },
        { blockId: 'b2', content: { text: 'A short sentence' } },
      ],
    },
  ];
  const pagesBytes = estimateMineruParseBytes(parsedPages);
  assert.ok(pagesBytes > 512, 'Includes page object and block bytes');

  const longerPages = [
    {
      pageIndex: 0,
      blocks: [
        { blockId: 'b1', text: 'Hello world'.repeat(100) },
      ],
    },
  ];
  assert.ok(estimateMineruParseBytes(longerPages) > pagesBytes, 'Longer text yields larger estimated bytes');

  // DataURL 估算
  const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const dataUrlBytes = estimateDataUrlBytes(sampleDataUrl);
  assert.ok(dataUrlBytes > 50, 'Calculates reasonable byte size for Data URL');
  assert.equal(estimateThumbnailBytes(sampleDataUrl), dataUrlBytes, 'Thumbnail estimator matches Data URL');
});

test('ByteBudgetLruCache evicts least-recently-used items when exceeding byte budget', () => {
  const evicted: string[] = [];
  const cache = new ByteBudgetLruCache<string>({
    maxBytes: 100,
    computeBytes: (val) => val.length,
  });

  cache.set('a', '12345678901234567890', { // 20 bytes
    onEvict: (_, k) => evicted.push(k),
  });
  cache.set('b', '123456789012345678901234567890', { // 30 bytes
    onEvict: (_, k) => evicted.push(k),
  });
  cache.set('c', '1234567890123456789012345678901234567890', { // 40 bytes
    onEvict: (_, k) => evicted.push(k),
  });

  // 当前占用 20 + 30 + 40 = 90 <= 100，未淘汰
  assert.equal(cache.getCurrentBytes(), 90);
  assert.equal(cache.size(), 3);
  assert.deepEqual(evicted, []);

  // 访问 a，使其成为最近使用，顺序变为 b, c, a
  cache.get('a');

  // 加入 d (30 bytes)，总字节 90 + 30 = 120 > 100，应淘汰最久未访问的 b (30 bytes)，剩余 c (40), a (20), d (30) = 90
  cache.set('d', '123456789012345678901234567890', {
    onEvict: (_, k) => evicted.push(k),
  });

  assert.deepEqual(evicted, ['b']);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.has('d'), true);
  assert.equal(cache.getCurrentBytes(), 90);
});

test('ByteBudgetLruCache respects reference borrowing and avoids destroying in-use items', () => {
  const evicted: string[] = [];
  const cache = new ByteBudgetLruCache<{ id: string }>({
    maxBytes: 50,
    computeBytes: () => 20,
  });

  cache.set('item1', { id: '1' }, { onEvict: (_, k) => evicted.push(k) });
  cache.set('item2', { id: '2' }, { onEvict: (_, k) => evicted.push(k) });

  // 借用 item1
  const releaseBorrow1 = cache.acquire('item1');
  assert.ok(cache.isPinned('item1'));

  // 插入 item3，导致预算超额 (20 * 3 = 60 > 50)
  // item1 在最前面但被借用，不能被淘汰，应该跳过 item1 淘汰 item2！
  cache.set('item3', { id: '3' }, { onEvict: (_, k) => evicted.push(k) });

  assert.deepEqual(evicted, ['item2']);
  assert.equal(cache.has('item1'), true);
  assert.equal(cache.has('item2'), false);
  assert.equal(cache.has('item3'), true);

  // 归还 item1 借用
  releaseBorrow1();
  assert.equal(cache.isPinned('item1'), false);

  // 此时若预算收紧为 30，item1（未被借用且处于队首）应被淘汰
  cache.setMaxBytes(30);
  assert.deepEqual(evicted, ['item2', 'item1']);
  assert.equal(cache.has('item1'), false);
  assert.equal(cache.has('item3'), true);
});

test('chooseMountedReaderTabIds enforces byte budget across mounted tabs', () => {
  const mounted = chooseMountedReaderTabIds({
    readerTabIds: ['tab1', 'tab2', 'tab3'],
    activeTabId: 'tab1',
    recentTabIds: ['tab2', 'tab3'],
    tabByteEstimates: {
      tab1: 60 * 1024 * 1024,
      tab2: 50 * 1024 * 1024,
      tab3: 30 * 1024 * 1024,
    },
    maxTotalBytes: 100 * 1024 * 1024, // 100 MB 预算
  });

  // tab1 (60MB) 优先挂载。
  // tab2 (50MB) 加进来会达到 110MB > 100MB，超限因此不挂载！
  // 最终只有 tab1 挂载
  assert.deepEqual(mounted, ['tab1']);
});
