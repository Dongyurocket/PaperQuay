import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveBarePaperIds } from '../src/features/agent/agentMarkdownPaperIds.ts';
import type { LibraryAgentRagCitation } from '../src/services/libraryAgent.ts';

const mockCitations: LibraryAgentRagCitation[] = [
  {
    id: 'chunk-1',
    label: '1',
    sourceType: 'fullText',
    pageIndex: 82, // 1-based: 83
    paperId: 'paper_mtst6kd0_83967d5e',
    paperTitle: '民用飞机总体设计',
  },
];

test('resolveBarePaperIds resolves bare paper ID with page suffix to a link capsule', () => {
  const input = '采用雅可比矩阵法 (paper_mtst6kd0_83967d5e, p.83) 进行求解。';
  const result = resolveBarePaperIds(input, mockCitations);
  assert.equal(
    result,
    '采用雅可比矩阵法 ([民用飞机总体设计 · 第 83 页](#agent-paper-paper_mtst6kd0_83967d5e?page=83)) 进行求解。',
  );
});

test('resolveBarePaperIds handles Chinese page suffix like 第 83 页', () => {
  const input = '参考 paper_mtst6kd0_83967d5e，第 83 页 的公式。';
  const result = resolveBarePaperIds(input, mockCitations);
  assert.equal(
    result,
    '参考 [民用飞机总体设计 · 第 83 页](#agent-paper-paper_mtst6kd0_83967d5e?page=83) 的公式。',
  );
});

test('resolveBarePaperIds uses fallback title map when not in citations', () => {
  const fallbackMap = new Map<string, string>([
    ['paper_unknown_99999999', '未引用但库内存在的论文'],
  ]);
  const input = '根据 paper_unknown_99999999, p.12 的阐述';
  const result = resolveBarePaperIds(input, [], fallbackMap);
  assert.equal(
    result,
    '根据 [未引用但库内存在的论文 · 第 12 页](#agent-paper-paper_unknown_99999999?page=12) 的阐述',
  );
});

test('resolveBarePaperIds marks unresolved paper IDs with special unresolved target', () => {
  const input = '未知论文 paper_not_exist_12345 说明了情况。';
  const result = resolveBarePaperIds(input, []);
  assert.equal(
    result,
    '未知论文 [paper_not_exist_12345](#agent-paper-unresolved:paper_not_exist_12345) 说明了情况。',
  );
});

test('resolveBarePaperIds does not alter paper IDs inside fenced code blocks', () => {
  const input = '```\npaper_mtst6kd0_83967d5e, p.83\n```';
  const result = resolveBarePaperIds(input, mockCitations);
  assert.equal(result, input);
});

test('resolveBarePaperIds does not alter paper IDs inside inline code', () => {
  const input = '查看代码 `paper_mtst6kd0_83967d5e, p.83` 里的变量。';
  const result = resolveBarePaperIds(input, mockCitations);
  assert.equal(result, input);
});

test('resolveBarePaperIds preserves existing markdown links', () => {
  const input = '[已有链接](https://example.com/paper_mtst6kd0_83967d5e)';
  const result = resolveBarePaperIds(input, mockCitations);
  assert.equal(result, input);
});
