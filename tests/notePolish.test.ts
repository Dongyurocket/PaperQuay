import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNotePolishAnchor,
  buildNotePolishNodes,
  normalizeNotePolishScope,
  notePolishTextToNodes,
} from '../src/features/notes/notePolish.ts';

const citation = {
  id: 'S1',
  paperId: 'paper-1',
  paperTitle: 'Evidence Paper',
  chunkId: 'chunk-4',
  blockId: 'block-4',
  pageIndex: 3,
  excerpt: 'Evidence excerpt.',
  sourceType: 'mineru-markdown',
};

test('note polishing normalizes the supported knowledge scopes', () => {
  assert.equal(normalizeNotePolishScope('linked-papers'), 'linked-papers');
  assert.equal(normalizeNotePolishScope('library'), 'library');
  assert.equal(normalizeNotePolishScope('unknown'), 'none');
});

test('note polishing converts trustworthy RAG citations into note anchors', () => {
  const anchor = buildNotePolishAnchor(citation);
  assert.equal(anchor.id, 'note-polish:paper-1:chunk-4');
  assert.equal(anchor.paperId, 'paper-1');
  assert.equal(anchor.label, 'P4');
  assert.equal(anchor.sourceTitle, 'Evidence Paper');
  assert.equal(anchor.blockId, 'block-4');
  assert.equal(anchor.pageIndex, 3);
  assert.ok(anchor.createdAt > 0);
});

test('note polishing preserves basic Markdown structure and appends clickable anchors', () => {
  const textNodes = notePolishTextToNodes('# Summary\n\n- First\n- Second\n\nConclusion');
  assert.deepEqual(textNodes.map((node) => node.type), ['heading', 'bulletList', 'paragraph']);

  const result = buildNotePolishNodes('Polished note', [citation]);
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0].id, 'note-polish:paper-1:chunk-4');
  assert.equal(result.content.at(-2)?.type, 'noteAnchorBlock');
  assert.equal(result.content.at(-2)?.attrs?.anchorId, 'note-polish:paper-1:chunk-4');
});
