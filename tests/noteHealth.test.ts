import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTE_STALE_THRESHOLD_MS,
  buildNoteHealthReport,
  noteHealthBadges,
  noteHealthCategoryIds,
} from '../src/features/notes/noteHealth.ts';

const NOW = 1_800_000_000_000;

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    paperId: 'global-notes',
    type: 'standalone',
    title: '标题',
    content: '',
    aiChatMessageIds: [],
    anchors: [],
    tags: ['x'],
    color: '',
    createdAt: NOW,
    updatedAt: NOW,
    linkedNoteIds: [],
    linkedPaperIds: [],
    ...overrides,
  } as never;
}

test('健康笔记不产生任何问题分类', () => {
  const note = makeNote({ folderId: 'f1' });
  const report = buildNoteHealthReport([note], { now: NOW });
  assert.equal(report.total, 1);
  assert.deepEqual(report.orphanNoteIds, []);
  assert.deepEqual(report.brokenLinkNoteIds, []);
  assert.deepEqual(report.untitledNoteIds, []);
  assert.deepEqual(report.untaggedNoteIds, []);
  assert.deepEqual(report.staleNoteIds, []);
});

test('孤儿/断链/无标题/无标签/陈旧各归其类', () => {
  const orphan = makeNote({ id: 'orphan', tags: [], folderId: null });
  const broken = makeNote({ id: 'broken', linkedNoteIds: ['ghost'] });
  const untitled = makeNote({ id: 'untitled', title: '' });
  const defaultTitled = makeNote({ id: 'untitled2', title: '未命名笔记' });
  const untagged = makeNote({ id: 'untagged', tags: [], folderId: 'f1' });
  const stale = makeNote({ id: 'stale', updatedAt: NOW - NOTE_STALE_THRESHOLD_MS - 1 });
  const healthy = makeNote({ id: 'ok', linkedNoteIds: ['stale'] });

  const report = buildNoteHealthReport(
    [orphan, broken, untitled, defaultTitled, untagged, stale, healthy],
    { now: NOW },
  );

  assert.deepEqual(report.orphanNoteIds, ['orphan']);
  assert.deepEqual(report.brokenLinkNoteIds, ['broken']);
  assert.deepEqual(report.untitledNoteIds, ['untitled', 'untitled2']);
  assert.deepEqual(report.untaggedNoteIds, ['orphan', 'untagged']);
  assert.deepEqual(report.staleNoteIds, ['stale']);
  // 有出链/入链或论文关联的笔记不算孤立
  assert.equal(report.orphanNoteIds.includes('broken'), false);
  assert.equal(report.orphanNoteIds.includes('ok'), false);
});

test('论文归属阻止孤立判定', () => {
  const note = makeNote({ id: 'paper-note', paperId: 'paper-1', tags: [], folderId: null });
  const report = buildNoteHealthReport([note], { now: NOW });
  assert.deepEqual(report.orphanNoteIds, []);
});

test('badges 固定顺序且 categoryIds 与 report 一致', () => {
  const report = buildNoteHealthReport([makeNote({ id: 'a', tags: [], folderId: null })], { now: NOW });
  const badges = noteHealthBadges(report);
  assert.deepEqual(badges.map((b) => b.category), ['orphan', 'broken-link', 'untitled', 'untagged', 'stale']);
  assert.equal(noteHealthCategoryIds(report, 'orphan'), report.orphanNoteIds);
  assert.equal(badges.find((b) => b.category === 'orphan')?.count, 1);
});
