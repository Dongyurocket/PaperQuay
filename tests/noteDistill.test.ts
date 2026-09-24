import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDistilledExcerptAppendPatch, buildDistilledExcerptNoteCreateRequest, isExcerptCard } from '../src/features/notes/noteDistill.ts';
import type { SelectedExcerpt } from '../src/types/reader.ts';

function selectedExcerpt(): SelectedExcerpt {
  return {
    text: 'We propose a gated KV store that improves retrieval by 12.4%.',
    source: 'pdf',
    createdAt: 1_700_000_000_000,
    pdfLocation: { pageNumber: 3 } as SelectedExcerpt['pdfLocation'],
  } as SelectedExcerpt;
}

test('distilled excerpt card keeps anchor fidelity and puts distilled text after the anchor block', () => {
  const request = buildDistilledExcerptNoteCreateRequest({
    paperId: 'paper-1',
    selectedExcerpt: selectedExcerpt(),
    sourceTitle: 'KVNet: A Study',
    distilledTitle: '门控 KV 存储提升检索',
    distilledText: '## 要点\n\n- 检索指标提升 12.4%',
  });

  // 锚点保真：原文 excerpt 与定位信息完整进入 anchors 与锚点块
  assert.equal(request.anchors?.length, 1);
  const anchor = request.anchors![0];
  assert.equal(anchor.excerpt, 'We propose a gated KV store that improves retrieval by 12.4%.');
  assert.equal(anchor.paperId, 'paper-1');
  assert.equal(anchor.sourceTitle, 'KVNet: A Study');
  assert.equal(anchor.label, 'P3');

  const blocks = request.contentJson?.content ?? [];
  assert.equal(blocks[0]?.type, 'noteAnchorBlock');
  assert.equal(blocks[0]?.attrs?.anchorId, anchor.id);
  assert.equal(blocks[0]?.attrs?.excerpt, anchor.excerpt);

  // 提炼正文可编辑（普通段落/列表节点），不含第二份锚点块
  const rest = blocks.slice(1);
  assert.equal(rest.some((node) => node?.type === 'noteAnchorBlock'), false);
  assert.equal(rest.some((node) => node?.type === 'heading'), true);
  assert.match(request.contentText ?? '', /12\.4%/);

  assert.equal(request.title, '门控 KV 存储提升检索');
  assert.deepEqual(request.tags, ['摘录卡']);
  assert.equal(request.type, 'highlight');
});

test('distilled excerpt card falls back to excerpt-derived title when model title is empty', () => {
  const request = buildDistilledExcerptNoteCreateRequest({
    paperId: 'paper-1',
    selectedExcerpt: selectedExcerpt(),
    distilledTitle: '   ',
    distilledText: '正文',
  });
  assert.match(request.title, /gated KV store/);
});

test('append patch keeps existing anchors immutable and inserts new distill before the thoughts section', () => {
  const base = buildDistilledExcerptNoteCreateRequest({
    paperId: 'paper-1',
    selectedExcerpt: selectedExcerpt(),
    sourceTitle: 'KVNet: A Study',
    distilledTitle: '门控 KV 存储提升检索',
    distilledText: '第一段提炼。',
  });
  const note = {
    id: 'note-1',
    paperId: 'paper-1',
    type: 'highlight',
    title: base.title,
    content: base.content ?? '',
    contentJson: base.contentJson,
    contentText: base.contentText,
    anchors: base.anchors ?? [],
    tags: ['摘录卡'],
    color: '#dbeafe',
    createdAt: 1,
    updatedAt: 1,
    aiChatMessageIds: [],
  } as const;

  const secondExcerpt: SelectedExcerpt = {
    text: 'Ablation shows the gate is the key factor.',
    source: 'pdf',
    createdAt: 1_700_000_100_000,
    pdfLocation: { pageNumber: 5 } as SelectedExcerpt['pdfLocation'],
  } as SelectedExcerpt;

  const { patch, anchor } = buildDistilledExcerptAppendPatch({
    note: note as never,
    paperId: 'paper-1',
    selectedExcerpt: secondExcerpt,
    sourceTitle: 'KVNet: A Study',
    distilledText: '消融实验表明门控是关键。',
  });

  // 已有锚点原样保留，新锚点追加（一卡多锚点）
  assert.equal(patch.anchors?.length, 2);
  assert.equal(patch.anchors?.[0], note.anchors[0]);
  assert.equal(patch.anchors?.[1], anchor);
  assert.equal(anchor.excerpt, 'Ablation shows the gate is the key factor.');
  assert.equal(anchor.label, 'P5');

  const blocks = patch.contentJson?.content ?? [];
  const anchorBlocks = blocks.filter((node) => node?.type === 'noteAnchorBlock');
  assert.equal(anchorBlocks.length, 2);
  assert.equal(anchorBlocks[0]?.attrs?.anchorId, note.anchors[0]?.id);
  assert.equal(anchorBlocks[1]?.attrs?.anchorId, anchor.id);

  // 「我的想法」区仍在末尾，新提炼插入到它之前
  const last = blocks[blocks.length - 1];
  assert.equal(last?.type, 'paragraph');
  assert.match(String(last?.content?.[0]?.text ?? ''), /^💭 我的想法：/);
  const thoughtsIndex = blocks.indexOf(last);
  assert.equal(blocks.indexOf(anchorBlocks[1]) < thoughtsIndex, true);
  assert.match(patch.contentText ?? '', /消融实验表明门控是关键/);
});

test('isExcerptCard requires at least one anchor', () => {
  assert.equal(isExcerptCard(null), false);
  assert.equal(isExcerptCard({ anchors: [] } as never), false);
  assert.equal(isExcerptCard({ anchors: [{ id: 'a1' }] } as never), true);
});
