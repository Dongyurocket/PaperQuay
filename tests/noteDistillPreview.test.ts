import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDistillPreviewCommit,
  cancelDistillPreview,
  confirmDistillPreview,
  createDistillPreviewState,
  markDistillPreviewReady,
} from '../src/features/notes/noteDistillPreview.ts';
import { isAiEnhancedAnchor, noteAnchorBlockFromAnchor, noteAnchorProvenanceLabel } from '../src/features/notes/noteUtils.ts';
import type { Note } from '../src/types/notes.ts';
import type { SelectedExcerpt } from '../src/types/reader.ts';

function excerpt(text = 'The gate improves retrieval.') {
  return {
    text,
    source: 'pdf',
    createdAt: 1_700_000_000_000,
    pdfLocation: { pageNumber: 3 },
  } as SelectedExcerpt;
}

function readyState(options: {
  text?: string;
  sourceText?: string;
  aiEnhanced?: boolean;
} = {}) {
  const editing = createDistillPreviewState({ selectedExcerpt: excerpt(options.text) });
  return markDistillPreviewReady(editing, {
    title: '门控机制',
    text: '提炼正文',
    sourceText: options.sourceText,
    aiEnhanced: options.aiEnhanced,
  });
}

function noteFromCommit(commit: ReturnType<typeof buildDistillPreviewCommit>) {
  assert.ok(commit && commit.kind === 'create');
  return {
    id: 'note-1',
    paperId: 'paper-1',
    type: 'highlight',
    pageKind: 'excerpt',
    title: commit.request.title,
    content: commit.request.content ?? '',
    contentJson: commit.request.contentJson,
    contentText: commit.request.contentText,
    anchors: commit.request.anchors ?? [],
    tags: commit.request.tags ?? [],
    color: '#dbeafe',
    createdAt: 1,
    updatedAt: 1,
    aiChatMessageIds: [],
    linkedNoteIds: [],
    linkedPaperIds: [],
  } satisfies Note;
}

test('preview does not produce a write request before confirmation-ready state', () => {
  const state = createDistillPreviewState({ selectedExcerpt: excerpt() });
  assert.equal(buildDistillPreviewCommit({ state, paperId: 'paper-1' }), null);

  const cancelled = cancelDistillPreview(readyState());
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(buildDistillPreviewCommit({ state: cancelled, paperId: 'paper-1' }), null);
});

test('confirm path produces the create request and preserves the editable draft', () => {
  const ready = readyState();
  const confirmed = confirmDistillPreview(ready);
  const commit = buildDistillPreviewCommit({
    state: confirmed,
    paperId: 'paper-1',
    sourceTitle: 'Paper',
  });

  assert.equal(confirmed.phase, 'confirmed');
  assert.ok(commit && commit.kind === 'create');
  assert.equal(commit.request.title, '门控机制');
  assert.match(commit.request.contentText ?? '', /提炼正文/);
  assert.equal(commit.request.anchors?.[0]?.excerpt, 'The gate improves retrieval.');
});

test('append preview adds one anchor and inserts the new distill before my thoughts', () => {
  const first = buildDistillPreviewCommit({
    state: readyState(),
    paperId: 'paper-1',
    sourceTitle: 'Paper',
  });
  const base = noteFromCommit(first);
  const secondExcerpt = excerpt('Ablation confirms the gate is essential.');
  const secondState = markDistillPreviewReady(
    createDistillPreviewState({ selectedExcerpt: secondExcerpt, appendTarget: base }),
    { title: '消融结果', text: '新增提炼段', sourceText: secondExcerpt.text },
  );
  const commit = buildDistillPreviewCommit({
    state: secondState,
    paperId: 'paper-1',
    sourceTitle: 'Paper',
    appendTarget: base,
  });

  assert.ok(commit && commit.kind === 'append');
  assert.equal(commit.patch.anchors?.length, 2);
  assert.equal(commit.patch.anchors?.[0], base.anchors[0]);
  assert.equal(commit.patch.anchors?.[1]?.excerpt, secondExcerpt.text);
  const blocks = commit.patch.contentJson?.content ?? [];
  const thoughtsIndex = blocks.findIndex((node) => String(node?.content?.[0]?.text ?? '').startsWith('💭 我的想法：'));
  const newAnchorIndex = blocks.findIndex((node) => node?.attrs?.anchorId === commit.anchor.id);
  assert.ok(thoughtsIndex >= 0);
  assert.ok(newAnchorIndex >= 0 && newAnchorIndex < thoughtsIndex);
  assert.match(commit.patch.contentText ?? '', /新增提炼段/);
});

test('re-identification failure fallback keeps the original snapshot and does not mark it enhanced', () => {
  const editing = createDistillPreviewState({ selectedExcerpt: excerpt() });
  const failed = markDistillPreviewReady(editing, {
    title: '纯文本结果',
    text: '回退后的提炼',
    sourceText: editing.originalText,
    aiEnhanced: false,
    fallbackNotice: '重识别失败，已回退纯文本提炼',
  });
  const commit = buildDistillPreviewCommit({ state: failed, paperId: 'paper-1' });

  assert.equal(failed.sourceText, failed.originalText);
  assert.equal(failed.aiEnhanced, false);
  assert.equal(failed.fallbackNotice, '重识别失败，已回退纯文本提炼');
  assert.ok(commit && commit.kind === 'create');
  assert.equal(commit.request.anchors?.[0]?.excerpt, failed.originalText);
  assert.equal(commit.request.anchors?.[0]?.aiEnhanced, undefined);
});

test('confirmed re-identification writes and displays the aiEnhanced marker', () => {
  const state = readyState({
    sourceText: '\\\\frac{a}{b}',
    aiEnhanced: true,
  });
  const commit = buildDistillPreviewCommit({ state, paperId: 'paper-1' });

  assert.ok(commit && commit.kind === 'create');
  const anchor = commit.request.anchors?.[0];
  assert.equal(anchor?.excerpt, '\\\\frac{a}{b}');
  assert.equal(anchor?.aiEnhanced, true);
  assert.equal(isAiEnhancedAnchor(anchor), true);
  assert.equal(noteAnchorProvenanceLabel(anchor), 'AI 重识别');
  assert.equal(noteAnchorBlockFromAnchor(anchor!).attrs?.aiEnhanced, true);
});
