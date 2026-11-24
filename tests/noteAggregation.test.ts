import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildNoteAggregationDraft, buildNoteHealthRepairInstruction } from '../src/services/noteAggregation.ts';

const require = createRequire(import.meta.url);
const { parseMarkdownToTiptap } = require('../src/shared/markdownToTiptap.cjs');

const papers = [
  { id: 'paper-1', title: 'Attention Is All You Need', citation: 'Vaswani et al. Attention Is All You Need[C]. NeurIPS, 2017.' },
  { id: 'paper-2', title: 'BERT: Pre-training of Deep Bidirectional Transformers', citation: 'Devlin et al. BERT: Pre-training of Deep Bidirectional Transformers[J]. NAACL, 2019.' },
];

function excerpt(id: string, title: string, paperId: string, anchorId: string, snapshot: string) {
  return {
    id,
    title,
    paperId,
    linkedPaperId: paperId,
    pageKind: 'excerpt' as const,
    type: 'standalone' as const,
    contentText: `${snapshot} [定位](paperquay://anchor/${anchorId})`,
    content: `${snapshot} [定位](paperquay://anchor/${anchorId})`,
    anchors: [{ id: anchorId, paperId, label: title, excerpt: snapshot, createdAt: 1 }],
    tags: ['evidence'],
    linkedNoteIds: [],
    linkedPaperIds: [paperId],
  } as any;
}

test('聚合草稿保留摘录回链，并由共享解析器重建 noteId 与 paperReference', () => {
  const sourceNotes = [
    excerpt('excerpt-1', '注意力摘录', 'paper-1', 'a-1', '注意力允许全局依赖。'),
    excerpt('excerpt-2', '预训练摘录', 'paper-2', 'a-2', '预训练改善迁移能力。'),
    excerpt('excerpt-3', '结构摘录', 'paper-1', 'a-3', '多头结构提供多个表示子空间。'),
  ];
  const snapshots = sourceNotes.map((note) => ({
    id: note.id,
    anchors: JSON.stringify(note.anchors),
    content: note.contentText,
  }));
  const draft = buildNoteAggregationDraft({
    notes: sourceNotes,
    mode: 'concept',
    title: '跨文献注意力概念页',
    topic: '注意力机制',
    papers,
  });

  assert.deepEqual(draft.sourceNoteIds, ['excerpt-1', 'excerpt-2', 'excerpt-3']);
  assert.match(draft.content, /\[\[注意力摘录\]\]/);
  assert.match(draft.content, /\[\[预训练摘录\]\]/);
  assert.match(draft.content, /\[\[结构摘录\]\]/);
  assert.match(draft.content, /\[1\]/);
  assert.match(draft.content, /\[2\]/);

  const parsed = parseMarkdownToTiptap(draft.content, {
    notes: sourceNotes,
    papers,
    anchors: sourceNotes.flatMap((note) => note.anchors),
  });
  const serialized = JSON.stringify(parsed);
  assert.match(serialized, /"type":"wikiLink"/);
  assert.match(serialized, /"noteId":"excerpt-1"/);
  assert.match(serialized, /"noteId":"excerpt-2"/);
  assert.match(serialized, /"noteId":"excerpt-3"/);
  assert.match(serialized, /"type":"paperReference"/);
  assert.match(serialized, /"paperId":"paper-1"/);
  assert.match(serialized, /"paperId":"paper-2"/);
  assert.deepEqual(
    sourceNotes.map((note) => ({ id: note.id, anchors: JSON.stringify(note.anchors), content: note.contentText })),
    snapshots,
  );
});

test('体检修复指令把删除操作收窄为清单，并要求按 noteId 重挂断链', () => {
  const instruction = buildNoteHealthRepairInstruction({
    orphanNoteIds: ['orphan'],
    brokenLinkNoteIds: ['broken'],
    untitledNoteIds: [],
    untaggedNoteIds: ['untagged'],
    staleNoteIds: [],
  });
  assert.match(instruction, /只列出清单/);
  assert.match(instruction, /noteId/);
  assert.match(instruction, /不执行 delete/);
});

const CJK_PATTERN = /[一-鿿]/;

function englishExcerpt(id: string, title: string, paperId: string, anchorId: string, snapshot: string) {
  return {
    id,
    title,
    paperId,
    linkedPaperId: paperId,
    pageKind: 'excerpt' as const,
    type: 'standalone' as const,
    contentText: `${snapshot} [Location](paperquay://anchor/${anchorId})`,
    content: `${snapshot} [Location](paperquay://anchor/${anchorId})`,
    anchors: [{ id: anchorId, paperId, label: title, excerpt: snapshot, createdAt: 1 }],
    tags: ['evidence'],
    linkedNoteIds: [],
    linkedPaperIds: [paperId],
  } as any;
}

test('英文聚合草稿输出英文小节与提示，引用条目与摘录锚点保真', () => {
  const sourceNotes = [
    englishExcerpt('excerpt-1', 'Attention excerpt', 'paper-1', 'a-1', 'Attention allows global dependencies.'),
    englishExcerpt('excerpt-2', 'Pretraining excerpt', 'paper-2', 'a-2', 'Pretraining improves transfer.'),
  ];
  const draft = buildNoteAggregationDraft({
    notes: sourceNotes,
    mode: 'paper-card',
    title: '',
    paperId: 'paper-1',
    papers,
    locale: 'en-US',
  });

  assert.equal(draft.title, 'Paper reading card');
  assert.doesNotMatch(draft.content, CJK_PATTERN);
  assert.match(draft.content, /## Research question/);
  assert.match(draft.content, /## Core method and findings/);
  assert.match(draft.content, /Synthesized from \[\[Attention excerpt\]\], \[\[Pretraining excerpt\]\]\./);
  assert.match(draft.content, /\(source: \[\[Attention excerpt\]\]\)/);
  assert.match(draft.content, /## References/);
  assert.match(draft.content, /Vaswani et al\. Attention Is All You Need\[C\]\. NeurIPS, 2017\./);
  assert.match(draft.content, /Devlin et al\. BERT: Pre-training of Deep Bidirectional Transformers\[J\]\. NAACL, 2019\./);

  const parsed = parseMarkdownToTiptap(draft.content, {
    notes: sourceNotes,
    papers,
    anchors: sourceNotes.flatMap((note) => note.anchors),
  });
  const serialized = JSON.stringify(parsed);
  assert.match(serialized, /"type":"wikiLink"/);
  assert.match(serialized, /"noteId":"excerpt-1"/);
  assert.match(serialized, /"noteId":"excerpt-2"/);
  assert.match(serialized, /"type":"noteAnchorLink"/);
  assert.match(serialized, /"anchorId":"a-1"/);
  assert.match(serialized, /"anchorId":"a-2"/);

  const concept = buildNoteAggregationDraft({
    notes: sourceNotes,
    mode: 'concept',
    title: '',
    topic: 'Attention',
    papers,
    locale: 'en-US',
  });
  assert.doesNotMatch(concept.content, CJK_PATTERN);
  assert.match(concept.content, /## Definition/);
  assert.match(concept.content, /## Key insights/);
  assert.match(concept.content, /## Related papers/);
  assert.match(concept.content, /## References/);
});

test('英文界面聚合中文摘录时保留来源标题与引用原文，只本地化小节文案', () => {
  const sourceNotes = [
    excerpt('excerpt-1', '注意力摘录', 'paper-1', 'a-1', '注意力允许全局依赖。'),
  ];
  const draft = buildNoteAggregationDraft({
    notes: sourceNotes,
    mode: 'concept',
    title: '',
    topic: '注意力机制',
    papers,
    locale: 'en-US',
  });

  assert.equal(draft.title, '注意力机制');
  assert.match(draft.content, /## Definition/);
  assert.match(draft.content, /## Key insights/);
  assert.match(draft.content, /\[\[注意力摘录\]\]/);
  assert.match(draft.content, /注意力允许全局依赖。/);
  assert.match(draft.content, /Vaswani et al\. Attention Is All You Need\[C\]\. NeurIPS, 2017\./);
  assert.match(draft.content, /paperquay:\/\/anchor\/a-1/);

  const zhDraft = buildNoteAggregationDraft({
    notes: sourceNotes,
    mode: 'paper-card',
    title: '',
    papers,
  });
  assert.equal(zhDraft.title, '文献精读卡');
  assert.match(zhDraft.content, /## 研究问题/);
  assert.match(zhDraft.content, /## 核心方法与发现/);
  assert.match(zhDraft.content, /（来源：\[\[注意力摘录\]\]）/);
});
