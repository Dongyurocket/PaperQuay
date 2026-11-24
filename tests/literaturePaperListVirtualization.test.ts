import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVirtualWindow } from '../src/utils/virtualWindow.ts';
import { resolvePaperListNavigation } from '../src/features/literature/paperListKeyboard.ts';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROW_HEIGHT = 132 + 8;

test('5000-row literature list renders only the viewport window', () => {
  const paperCount = 5000;
  const viewportSize = 800;
  let renderedMax = 0;
  let totalMs = 0;

  for (let scrollTop = 0; scrollTop < paperCount * ROW_HEIGHT; scrollTop += viewportSize) {
    const started = performance.now();
    const window = resolveVirtualWindow({
      itemCount: paperCount,
      getItemSize: () => ROW_HEIGHT,
      scrollOffset: scrollTop,
      viewportSize,
      overscan: 6,
    });
    totalMs += performance.now() - started;
    renderedMax = Math.max(renderedMax, window.endIndex - window.startIndex);
    assert.equal(window.totalSize, paperCount * ROW_HEIGHT);
  }

  // 视口约 6 行 + 上下各 6 行 overscan，远小于 5000。
  assert.equal(renderedMax <= 20, true, `rendered ${renderedMax} rows`);
  assert.equal(totalMs < 500, true, `window math took ${totalMs.toFixed(1)}ms`);

  if (process.env.PAPERQUAY_PERF === '1') {
    console.log(`[perf] 5000-row virtual window: max ${renderedMax} rendered rows, ${totalMs.toFixed(2)}ms over ${Math.ceil((paperCount * ROW_HEIGHT) / viewportSize)} scroll positions`);
  }
});

test('paper list keyboard navigation stays inside the loaded rows', () => {
  // ArrowDown/ArrowUp 到边界不越界。
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 10, key: 'ArrowDown' }), 1);
  assert.equal(resolvePaperListNavigation({ currentIndex: 9, total: 10, key: 'ArrowDown' }), 9);
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 10, key: 'ArrowUp' }), 0);
  assert.equal(resolvePaperListNavigation({ currentIndex: 5, total: 10, key: 'ArrowUp' }), 4);

  // Home/End 跳到首尾。
  assert.equal(resolvePaperListNavigation({ currentIndex: 7, total: 10, key: 'Home' }), 0);
  assert.equal(resolvePaperListNavigation({ currentIndex: 2, total: 10, key: 'End' }), 9);

  // 单行列表与未聚焦（-1）时的边界。
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 1, key: 'ArrowDown' }), 0);
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 1, key: 'End' }), 0);
  assert.equal(resolvePaperListNavigation({ currentIndex: -1, total: 10, key: 'ArrowDown' }), 0);

  // 越界的当前索引按最后一行处理。
  assert.equal(resolvePaperListNavigation({ currentIndex: 12, total: 10, key: 'ArrowDown' }), 9);

  // 无关键与空列表返回 null，交给行内 Enter/Space 与浏览器默认行为。
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 10, key: ' ' }), null);
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 10, key: 'Enter' }), null);
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 10, key: 'Tab' }), null);
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 0, key: 'End' }), null);
  assert.equal(resolvePaperListNavigation({ currentIndex: 0, total: 0, key: 'ArrowDown' }), null);
});

test('literature list and row keep virtualization, memo and interaction hooks', () => {
  // 源码字符串护栏（不是行为证据，行为用例见 literaturePaperListA11y/Stability）：
  // 防止虚拟化、memo 与回调稳定化结构在后续重构中被悄悄移除。
  const listSource = readFileSync(
    path.join(repoRoot, 'src/features/literature/components/LiteraturePaperList.tsx'),
    'utf8',
  );
  const rowSource = readFileSync(
    path.join(repoRoot, 'src/features/literature/components/LiteraturePaperRow.tsx'),
    'utf8',
  );

  assert.equal(listSource.includes('resolveVirtualWindow'), true);
  assert.equal(listSource.includes('papers.slice(virtualWindow.startIndex, virtualWindow.endIndex)'), true);
  assert.equal(listSource.includes('PAPER_LIST_VIRTUALIZE_AFTER'), true);
  assert.equal(rowSource.includes('memo(LiteraturePaperRowImpl)'), true);
  assert.equal(rowSource.includes('data-paper-row-id={paper.id}'), true);
  assert.equal(rowSource.includes("event.key === 'Enter'"), true);
  assert.equal(rowSource.includes("event.key === ' '"), true);
  assert.equal(rowSource.includes('onDoubleClick={() => onOpenPaper(paper)}'), true);
  assert.equal(rowSource.includes('onContextMenu={(event) => onContextMenu(event, paper)}'), true);
  assert.equal(rowSource.includes('onDragStart={(event) => onDragStart(event, paper)}'), true);
  assert.equal(rowSource.includes('onPointerDown={(event) => onSortPointerDown(event, paper)}'), true);
  assert.equal(listSource.includes('space-y-2'), false, 'row spacing moved into the memoized row');
  // 外部回调经 ref + 空依赖 useCallback 稳定化，避免父组件新闭包击穿行 memo。
  assert.equal(listSource.includes('useStableCallback'), true);
  // 虚拟高度占位不参与 ARIA list 内容模型。
  assert.equal(listSource.includes('role="presentation"'), true);
  assert.equal(listSource.includes('aria-hidden="true"'), true);
});
