import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildQaNoteContent } from '../src/features/reader/readerQaNote.ts';
import { resolveNoteAnchorLocation } from '../src/features/notes/noteAnchorLocation.ts';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');

test('QA note preserves page indexes and keeps unlocatable citations as text', () => {
  const result = buildQaNoteContent({
    content: '## Question\n\nQuestion\n\n## Answer\n\nAnswer [1]',
    paperId: 'paper', paperTitle: 'Paper', messageId: 'message', createdAt: 10,
    citations: [
      { id: 'a', label: '1', sourceType: 'pdf-text', pageIndex: 0, previewText: 'Evidence' },
      { id: 'b', label: '2', sourceType: 'mineru-markdown', pageIndex: null, blockId: 'block-2', previewText: 'Block' },
      { id: 'c', label: '3', sourceType: 'pdf-text', pageIndex: -1, previewText: 'Unknown location' },
    ],
  });
  assert.equal(result.anchors.length, 2);
  assert.equal(result.anchors[0].pageIndex, 0);
  assert.equal(result.anchors[0].label, 'P1');
  assert.equal(result.anchors[1].blockId, 'block-2');
  assert.equal(result.contentJson.content?.filter((node) => node.type === 'noteAnchorBlock').length, 2);
  assert.match(result.content, /3: Unknown location/);
});

test('QA citation anchors survive SQLite storage and resolve to their source location', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-qa-note-'));
  const paths = { notesDatabasePath: path.join(directory, 'notes.sqlite') };
  let store = createNoteStore(paths);
  try {
    const qa = buildQaNoteContent({
      content: '## Question\n\nWhat?\n\n## Answer\n\nEvidence [1]',
      paperId: 'paper-1', paperTitle: 'Paper', messageId: 'message-1', createdAt: 10,
      citations: [{ id: 'citation-1', label: '1', sourceType: 'mineru-markdown', pageIndex: 11,
        blockId: 'page-12-block-3', previewText: 'Evidence text' }],
    });
    const created = store.createNote({ paperId: 'paper-1', type: 'ai-chat', title: 'Question',
      content: qa.content, contentJson: qa.contentJson, anchors: qa.anchors,
      aiChatId: 'session-1', aiChatMessageIds: ['message-1'] });
    store.close();
    store = createNoteStore(paths);
    const saved = store.getNote({ id: created.id });
    assert.equal(saved.aiChatId, 'session-1');
    assert.deepEqual(saved.aiChatMessageIds, ['message-1']);
    assert.equal(saved.anchors[0].paperId, 'paper-1');
    assert.equal(saved.anchors[0].excerpt, 'Evidence text');
    assert.deepEqual(resolveNoteAnchorLocation(saved.anchors[0]), {
      pageIndex: 11, blockId: 'page-12-block-3', pdfLocation: null,
    });
    assert.ok(saved.contentJson.content.some((node: { type: string }) => node.type === 'noteAnchorBlock'));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('QA note anchors use the citation paper instead of the current paper', () => {
  const result = buildQaNoteContent({
    content: '## Question\n\nQ\n\n## Answer\n\nCross-paper evidence [1]',
    paperId: 'current-paper', paperTitle: 'Current Paper', messageId: 'message-cross', createdAt: 20,
    citations: [{
      id: 'citation-1',
      label: '1',
      sourceType: 'mineru-markdown',
      pageIndex: 2,
      blockId: 'block-3',
      previewText: 'Evidence from another paper',
      paperId: 'other-paper',
      paperTitle: 'Other Paper',
      evidenceKind: 'table',
    }],
  });
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0].paperId, 'other-paper');
  assert.equal(result.anchors[0].sourceTitle, 'Other Paper');
});
