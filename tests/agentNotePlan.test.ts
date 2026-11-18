import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { applyAgentNoteWritePlan, assertNoteStructurePreserved, createAgentNoteWritePlan } from '../src/services/agentNotePlan.ts';
import { parseMarkdownToTiptap } from '../src/shared/markdownToTiptap.cjs';
import { resolveNoteAnchorLocation } from '../src/features/notes/noteAnchorLocation.ts';

const require = createRequire(import.meta.url);
const { createNoteStore } = require('../electron/backend/noteStore.cjs');

test('createAgentNoteWritePlan keeps valid create operations and fills defaults', async () => {
  const plan = await createAgentNoteWritePlan({
    summary: ' add notes ',
    operations: [
      {
        kind: 'create',
        title: ' 方法笔记 ',
        content: '## 方法\n内容',
        tags: ['llm', 'llm', 'agent', ''],
        paperId: 'paper-1',
        reason: '记录方法',
      },
    ],
  });

  assert.equal(plan.summary, 'add notes');
  assert.equal(plan.operations.length, 1);
  const [operation] = plan.operations;
  assert.equal(operation.kind, 'create');
  assert.equal(operation.title, '方法笔记');
  assert.equal(operation.content, '## 方法\n内容');
  assert.deepEqual(operation.tags, ['llm', 'agent']);
  assert.equal(operation.paperId, 'paper-1');
});

test('createAgentNoteWritePlan drops invalid operations', async () => {
  const plan = await createAgentNoteWritePlan({
    operations: [
      // update without any change payload → dropped
      { kind: 'update', noteId: 'n-1' },
      // valid delete
      { kind: 'delete', noteId: 'n-2' },
      // delete without noteId → dropped
      { kind: 'delete' },
      // update without noteId → dropped
      { kind: 'update', title: 'x' },
      null,
      'garbage',
      // unknown kind → dropped
      { kind: 'explode', noteId: 'n-3' },
    ],
  });

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].kind, 'delete');
  assert.equal(plan.operations[0].noteId, 'n-2');
});

test('createAgentNoteWritePlan keeps a valid update payload', async () => {
  const plan = await createAgentNoteWritePlan({
    operations: [
      {
        kind: 'update',
        noteId: 'n-9',
        title: '新标题',
        content: '新正文',
        tags: ['revised'],
      },
    ],
  });

  assert.equal(plan.operations.length, 1);
  const [operation] = plan.operations;
  assert.equal(operation.kind, 'update');
  assert.equal(operation.noteId, 'n-9');
  assert.equal(operation.title, '新标题');
  assert.equal(operation.content, '新正文');
  assert.deepEqual(operation.tags, ['revised']);
});

test('create plan preserves uniquely resolved citations as visible sources and navigable anchors', async () => {
  const plan = await createAgentNoteWritePlan({
    operations: [{ kind: 'create', title: 'Comparison', content: 'First [[cite:one]]. Second [[cite:two]].\n\n`[[cite:one]]`' }],
    citations: [
      { id: 'one', label: '1', paperId: 'paper-1', paperTitle: 'First paper', pageIndex: 0, previewText: 'First evidence', sourceType: 'pdf-text' },
      { id: 'two', label: '2', paperId: 'paper-2', paperTitle: 'Second paper', pageIndex: null },
    ],
  });
  const operation = plan.operations[0];
  assert.match(operation.content!, /First \[Source 1\]/);
  assert.match(operation.content!, /First paper, p\. 1/);
  assert.match(operation.content!, /Second paper \(location unavailable\)/);
  assert.match(operation.content!, /`\[\[cite:one\]\]`/);
  assert.equal(operation.anchors?.length, 1);
  assert.equal(operation.anchors?.[0].paperId, 'paper-1');
  assert.equal(operation.anchors?.[0].pageIndex, 0);
  const json = parseMarkdownToTiptap(operation.content!, { anchors: operation.anchors });
  assert.match(JSON.stringify(json), /noteAnchorLink/);
  assert.match(JSON.stringify(JSON.parse(JSON.stringify(plan))), /First evidence/);
});

test('ambiguous, missing, and legacy citation tokens do not create source anchors', async () => {
  const content = 'Ambiguous [[cite:duplicate]]. Unknown [[cite:missing]]. Legacy [1].';
  const plan = await createAgentNoteWritePlan({
    operations: [{ kind: 'create', title: 'Unresolved', content }],
    citations: [
      { id: 'duplicate', label: '1', paperId: 'paper-1', paperTitle: 'One', pageIndex: 0 },
      { id: 'duplicate', label: '2', paperId: 'paper-2', paperTitle: 'Two', pageIndex: 1 },
    ],
  });
  assert.equal(plan.operations[0].content, content);
  assert.equal(plan.operations[0].anchors, undefined);
});

test('structured evidence and tables cannot silently disappear from an update', () => {
  const before = { type: 'doc', content: [
    { type: 'paragraph', content: [
      { type: 'noteAnchorLink', attrs: { anchorId: 'anchor-1' } },
      { type: 'paperReference', attrs: { paperId: 'paper-1' } },
      { type: 'wikiLink', attrs: { id: 'note-1' } },
    ] },
    { type: 'table', content: [{ type: 'tableRow', content: [] }] },
  ] };
  assert.doesNotThrow(() => assertNoteStructurePreserved(before, structuredClone(before)));
  for (const node of before.content) {
    const after = structuredClone(before);
    after.content.splice(before.content.indexOf(node), 1);
    assert.throws(() => assertNoteStructurePreserved(before, after), /无法保留/);
  }
});

test('approval rejects stale note changes and submits unchanged structure with an optimistic lock', async () => {
  const originalWindow = globalThis.window;
  const existing: any = {
    id: 'note-1', title: 'Note', content: 'Text', contentText: 'Text', updatedAt: 10,
    anchors: [], tags: [], pageKind: null, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] },
  };
  const updates: any[] = [];
  (globalThis as any).window = {
    dispatchEvent() {},
    paperquay: { async invoke(command: string, args: any) {
      if (command === 'library_list_papers') return [];
      if (command === 'notes_get') return structuredClone(existing);
      if (command === 'notes_list') return [structuredClone(existing)];
      if (command === 'notes_update') {
        updates.push(args);
        if (args.expectedUpdatedAt !== existing.updatedAt) throw new Error('NOTE_CONFLICT');
        return { ...existing, ...args.patch };
      }
      if (command === 'notes_create') return { id: 'system', updatedAt: 1, ...args.request };
      throw new Error(`Unexpected command ${command}`);
    } },
  };
  try {
    const stale = await createAgentNoteWritePlan({ operations: [{ kind: 'update', noteId: 'note-1', title: 'New' }] });
    existing.updatedAt = 11;
    const rejected = await applyAgentNoteWritePlan(stale);
    assert.equal(rejected.failed, 1);
    assert.match(rejected.errors[0], /审批后已被修改/);
    assert.equal(updates.length, 0);

    const current = await createAgentNoteWritePlan({ operations: [{ kind: 'update', noteId: 'note-1', content: 'Text' }] });
    const applied = await applyAgentNoteWritePlan(current);
    assert.equal(applied.applied, 1);
    assert.equal(updates[0].expectedUpdatedAt, 11);
    assert.deepEqual(updates[0].patch.contentJson, existing.contentJson);

    const pageKindOnly = await createAgentNoteWritePlan({ operations: [{ kind: 'update', noteId: 'note-1', pageKind: 'synthesis' }] });
    assert.equal(pageKindOnly.operations.length, 1);
    const pageKindApplied = await applyAgentNoteWritePlan(pageKindOnly);
    assert.equal(pageKindApplied.applied, 1);
    assert.deepEqual(updates[1].patch, { pageKind: 'synthesis' });
  } finally {
    (globalThis as any).window = originalWindow;
  }
});

test('approved cited note persists its source link and anchor in an isolated SQLite store', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperquay-agent-note-'));
  let store = createNoteStore({ notesDatabasePath: path.join(directory, 'notes.sqlite') });
  const originalWindow = globalThis.window;
  (globalThis as any).window = {
    dispatchEvent() {},
    paperquay: { async invoke(command: string, args: any) {
      if (command === 'library_list_papers') return [];
      if (command === 'notes_list') return store.listNotes(args.request);
      if (command === 'notes_create') return store.createNote(args.request);
      if (command === 'notes_get') return store.getNote({ id: args.id });
      if (command === 'notes_update') return store.updateNote(args);
      throw new Error(`Unexpected command ${command}`);
    } },
  };
  try {
    const plan = await createAgentNoteWritePlan({
      operations: [{ kind: 'create', title: 'Evidence', content: 'A finding [[cite:evidence]].' }],
      citations: [{ id: 'evidence', label: '1', paperId: 'paper-1', paperTitle: 'Paper', pageIndex: 2, blockId: 'block-3', previewText: 'Source excerpt', sourceType: 'pdf-text' }],
    });
    assert.equal(store.listNotes().length, 0);
    const result = await applyAgentNoteWritePlan(JSON.parse(JSON.stringify(plan)));
    assert.equal(result.applied, 1);
    assert.equal(result.failed, 0);
    store.close();
    store = createNoteStore({ notesDatabasePath: path.join(directory, 'notes.sqlite') });
    const saved = store.getNote({ id: result.noteIds[0] });
    assert.equal(saved.anchors[0].paperId, 'paper-1');
    assert.equal(saved.anchors[0].excerpt, 'Source excerpt');
    assert.deepEqual(resolveNoteAnchorLocation(saved.anchors[0]), { pageIndex: 2, blockId: 'block-3', pdfLocation: null });
    assert.match(JSON.stringify(saved.contentJson), /noteAnchorLink/);
    assert.match(JSON.stringify(saved.contentJson), new RegExp(saved.anchors[0].id));
  } finally {
    (globalThis as any).window = originalWindow;
    store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
