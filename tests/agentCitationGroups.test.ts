import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupAgentCitations,
  formatGroupPageSummary,
} from '../src/features/agent/agentCitationGroups.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';

function createMockCitation(overrides: Partial<LibraryAgentRagCitation>): LibraryAgentRagCitation {
  return {
    id: 'chunk-1',
    label: '1',
    sourceType: 'fullText',
    pageIndex: 0,
    paperId: 'paper-1',
    paperTitle: 'Paper One',
    ...overrides,
  };
}

test('groupAgentCitations returns empty array on empty or undefined citations', () => {
  assert.deepEqual(groupAgentCitations([]), []);
  assert.deepEqual(groupAgentCitations(undefined), []);
});

test('groupAgentCitations aggregates multiple citations of the same paper into one group', () => {
  const citations: LibraryAgentRagCitation[] = [
    createMockCitation({ id: 'c1', label: '1', paperId: 'paper-1', paperTitle: 'Paper One', pageIndex: 5 }),
    createMockCitation({ id: 'c2', label: '2', paperId: 'paper-1', paperTitle: 'Paper One', pageIndex: 1 }),
    createMockCitation({ id: 'c3', label: '3', paperId: 'paper-2', paperTitle: 'Paper Two', pageIndex: 10 }),
  ];

  const groups = groupAgentCitations(citations);
  assert.equal(groups.length, 2);

  const group1 = groups.find((g) => g.paperId === 'paper-1');
  assert.ok(group1);
  assert.equal(group1.paperTitle, 'Paper One');
  assert.equal(group1.count, 2);
  // 升序排序：先 pageIndex 1，再 pageIndex 5
  assert.equal(group1.pages[0].pageIndex, 1);
  assert.equal(group1.pages[0].label, '2');
  assert.equal(group1.pages[1].pageIndex, 5);
  assert.equal(group1.pages[1].label, '1');

  const group2 = groups.find((g) => g.paperId === 'paper-2');
  assert.ok(group2);
  assert.equal(group2.paperTitle, 'Paper Two');
  assert.equal(group2.count, 1);
  assert.equal(group2.pages[0].pageIndex, 10);
});

test('groupAgentCitations deduplicates citations on the same page', () => {
  const citations: LibraryAgentRagCitation[] = [
    createMockCitation({ id: 'c1', label: '1', paperId: 'paper-1', paperTitle: 'Paper One', pageIndex: 3 }),
    createMockCitation({ id: 'c2', label: '2', paperId: 'paper-1', paperTitle: 'Paper One', pageIndex: 3 }),
    createMockCitation({ id: 'c3', label: '3', paperId: 'paper-1', paperTitle: 'Paper One', pageIndex: 7 }),
  ];

  const groups = groupAgentCitations(citations);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].pages[0].pageIndex, 3);
  assert.equal(groups[0].pages[0].label, '1'); // 保留首条
  assert.equal(groups[0].pages[1].pageIndex, 7);
  assert.equal(groups[0].pages[1].label, '3');
});

test('groupAgentCitations handles null pageIndex and places them at the end', () => {
  const citations: LibraryAgentRagCitation[] = [
    createMockCitation({ id: 'c1', label: '1', paperId: 'paper-1', pageIndex: null }),
    createMockCitation({ id: 'c2', label: '2', paperId: 'paper-1', pageIndex: 2 }),
    createMockCitation({ id: 'c3', label: '3', paperId: 'paper-1', pageIndex: null }), // 重复无页码
  ];

  const groups = groupAgentCitations(citations);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].pages[0].pageIndex, 2);
  assert.equal(groups[0].pages[1].pageIndex, null);
});

test('formatGroupPageSummary formats single, multiple, and full-text pages correctly', () => {
  const l = (zh: string, _en: string) => zh;

  const singlePageGroup = groupAgentCitations([
    createMockCitation({ id: 'c1', label: '1', paperId: 'p1', pageIndex: 82 }), // 0-based 82 -> 1-based 83
  ])[0];
  assert.equal(formatGroupPageSummary(singlePageGroup, l), '第 83 页');

  const multiPageGroup = groupAgentCitations([
    createMockCitation({ id: 'c1', label: '1', paperId: 'p1', pageIndex: 1 }), // 第 2 页
    createMockCitation({ id: 'c2', label: '2', paperId: 'p1', pageIndex: 15 }), // 第 16 页
  ])[0];
  assert.equal(formatGroupPageSummary(multiPageGroup, l), '第 2–16 页');

  const fullTextGroup = groupAgentCitations([
    createMockCitation({ id: 'c1', label: '1', paperId: 'p1', pageIndex: null }),
  ])[0];
  assert.equal(formatGroupPageSummary(fullTextGroup, l), '全文');
});
