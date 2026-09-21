import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiteraturePaper } from '../src/types/library.ts';
import type { NoteAnchor } from '../src/types/notes.ts';
import {
  buildReferenceListNodes,
  extractNoteReferences,
  formatReferenceListEntryText,
  paperIdFromNotePolishAnchorId,
  REFERENCE_LIST_HEADING,
  upsertNoteReferenceList,
} from '../src/features/notes/noteReferences.ts';

const papers = [
  {
    id: 'paper-1',
    title: 'Attention Is All You Need.',
    authors: [{ name: 'Ashish Vaswani' }, { name: 'Noam Shazeer' }],
    year: '2017',
  },
  {
    id: 'paper-2',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers',
    authors: [{ name: 'Jacob Devlin' }],
    year: '2019',
  },
] as unknown as LiteraturePaper[];

test('paperIdFromNotePolishAnchorId parses the note-polish anchor id convention', () => {
  assert.equal(paperIdFromNotePolishAnchorId('note-polish:paper-1:chunk-4'), 'paper-1');
  assert.equal(paperIdFromNotePolishAnchorId('note-polish:arxiv:2401.0001:c1'), 'arxiv:2401.0001');
  assert.equal(paperIdFromNotePolishAnchorId('note-polish:no-chunk'), '');
  assert.equal(paperIdFromNotePolishAnchorId('other-anchor'), '');
});

test('extractNoteReferences dedupes by paper id and keeps first-appearance order', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '引用 ' },
          { type: 'paperReference', attrs: { paperId: 'paper-2', label: 'BERT' } },
          { type: 'text', text: ' 与 ' },
          { type: 'paperReference', attrs: { paperId: 'paper-1', label: 'Attention' } },
          { type: 'paperReference', attrs: { paperId: 'paper-2', label: 'BERT again' } },
        ],
      },
    ],
  };

  const references = extractNoteReferences(doc);
  assert.deepEqual(references.map((entry) => entry.paperId), ['paper-2', 'paper-1']);
  assert.equal(references[0].label, 'BERT');
  assert.deepEqual(references[0].locations, []);
});

test('extractNoteReferences aggregates locations from paper reference attrs', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'paperReference',
            attrs: { paperId: 'paper-1', label: 'A', blockId: 'b-1', pageIndex: 3 },
          },
          {
            type: 'paperReference',
            attrs: { paperId: 'paper-1', label: 'A', blockId: 'b-1', pageIndex: 3 },
          },
          {
            type: 'paperReference',
            attrs: { paperId: 'paper-1', label: 'A', pageIndex: 7 },
          },
        ],
      },
    ],
  };

  const [entry] = extractNoteReferences(doc);
  assert.equal(entry.locations.length, 2);
  assert.deepEqual(entry.locations[0], {
    anchorId: null,
    blockId: 'b-1',
    pageIndex: 3,
    sourceType: null,
  });
  assert.equal(entry.locations[1].pageIndex, 7);
});

test('extractNoteReferences resolves polish anchors via note anchors and anchor ids', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'noteAnchorBlock',
        attrs: { anchorId: 'note-polish:paper-1:chunk-4', label: 'S1', sourceTitle: '', excerpt: 'x' },
      },
      {
        type: 'noteAnchorBlock',
        attrs: { anchorId: 'note-polish:paper-3:chunk-9', label: 'S2', sourceTitle: 'Polished Source', excerpt: 'y' },
      },
    ],
  };
  const anchors = [
    {
      id: 'note-polish:paper-1:chunk-4',
      paperId: 'paper-1',
      label: 'S1',
      excerpt: 'x',
      source: 'pdf',
      blockId: 'block-4',
      pageIndex: 4,
      createdAt: 1,
    },
  ] as NoteAnchor[];

  const references = extractNoteReferences(doc, anchors);
  assert.deepEqual(references.map((entry) => entry.paperId), ['paper-1', 'paper-3']);

  assert.equal(references[0].locations.length, 1);
  assert.equal(references[0].locations[0].blockId, 'block-4');
  assert.equal(references[0].locations[0].pageIndex, 4);
  assert.equal(references[0].locations[0].sourceType, 'pdf');

  // 没有 anchors 记录时退回解析 note-polish 锚点 id 拿 paperId。
  assert.equal(references[1].label, 'Polished Source');
  assert.equal(references[1].locations[0].anchorId, 'note-polish:paper-3:chunk-9');
  assert.equal(references[1].locations[0].pageIndex, null);
});

test('extractNoteReferences recovers locations from polish anchor ids and page labels', () => {
  // 历史笔记的锚点只剩 id / label（blockId、pageIndex 曾被持久化层丢掉）。
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'noteAnchorBlock',
        attrs: {
          anchorId: 'note-polish:paper-1:mineru:page-20-block-3:0',
          label: 'P20',
          sourceTitle: '',
          excerpt: 'z',
        },
      },
      {
        type: 'noteAnchorBlock',
        attrs: { anchorId: 'paper-ref:paper-2', label: 'P9', sourceTitle: '', excerpt: 'w' },
      },
    ],
  };
  const anchors = [
    {
      id: 'note-polish:paper-1:mineru:page-20-block-3:0',
      paperId: 'paper-1',
      label: 'P20',
      excerpt: 'z',
      source: 'blocks',
      createdAt: 1,
    },
    {
      id: 'paper-ref:paper-2',
      paperId: 'paper-2',
      label: 'P9',
      excerpt: 'w',
      source: 'manual',
      createdAt: 2,
    },
  ] as NoteAnchor[];

  const references = extractNoteReferences(doc, anchors);

  assert.equal(references[0].locations[0].blockId, 'page-20-block-3');
  assert.equal(references[0].locations[0].pageIndex, 19);
  // 只有页码标签时至少能定位到页。
  assert.equal(references[1].locations[0].blockId, null);
  assert.equal(references[1].locations[0].pageIndex, 8);
});

test('formatReferenceListEntryText renders title, authors and year', () => {
  const entry = { paperId: 'paper-1', label: 'Fallback', locations: [] };
  assert.equal(
    formatReferenceListEntryText(entry, papers[0]),
    'Attention Is All You Need. Ashish Vaswani, Noam Shazeer. 2017.',
  );
  assert.equal(
    formatReferenceListEntryText({ paperId: 'paper-x', label: 'Unknown Paper', locations: [] }, undefined),
    'Unknown Paper.',
  );
});

test('buildReferenceListNodes builds a heading plus ordered list', () => {
  const entries = extractNoteReferences({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'paperReference', attrs: { paperId: 'paper-1', label: 'A' } },
        { type: 'paperReference', attrs: { paperId: 'paper-2', label: 'B' } },
      ],
    }],
  });

  const nodes = buildReferenceListNodes(entries, papers);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].type, 'heading');
  assert.equal(nodes[0].content[0].text, REFERENCE_LIST_HEADING);
  assert.equal(nodes[1].type, 'orderedList');
  assert.equal(nodes[1].content.length, 2);
  assert.equal(
    nodes[1].content[0].content[0].content[0].text,
    'Attention Is All You Need. Ashish Vaswani, Noam Shazeer. 2017.',
  );
});

test('upsertNoteReferenceList is a no-op without references', () => {
  assert.equal(upsertNoteReferenceList({} as never, [], papers), false);
});
