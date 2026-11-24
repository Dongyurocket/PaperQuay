import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JSONContent } from '@tiptap/core';

import { resolveNoteEditorDraftFlush } from '../src/features/notes/editor/draft.ts';
import {
  createNoteEditorDraftStore,
  createNoteEditorSnapshotTracker,
  fastSignature,
  type EditorSnapshot,
  type EditorSnapshotSource,
  type NoteEditorDraft,
  type NoteEditorDraftStorage,
} from '../src/features/notes/noteEditorUtils.ts';
import type { Note } from '../src/types/notes.ts';

// batch 8 S5：正文首键后 120ms 节流窗口内切换/卸载必须仍能落盘草稿。
const LIVE_BODY = 'First keystroke body text';

const BASE64_CHUNK = 'A'.repeat(256 * 1024);

function imageDocument(count = 8, body = LIVE_BODY): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'noteAnchorLink', attrs: { anchorId: 'anchor-1' } },
        ],
      },
      ...Array.from({ length: count }, (_, index) => ({
        type: 'image',
        attrs: {
          src: `data:image/png;base64,${BASE64_CHUNK}${index}`,
          alt: `pasted-image-${index}.png`,
          title: `pasted-image-${index}.png`,
        },
      })),
      { type: 'paragraph', content: [{ type: 'text', text: body }] },
    ],
  };
}

interface FakeSource extends EditorSnapshotSource {
  doc: JSONContent;
  getJsonCalls: number;
  getHtmlCalls: number;
}

function fakeSource(initial: JSONContent): FakeSource {
  const source: FakeSource = {
    doc: initial,
    getJsonCalls: 0,
    getHtmlCalls: 0,
    getJSON() {
      source.getJsonCalls += 1;
      return source.doc;
    },
    getText() {
      return LIVE_BODY;
    },
    getHTML() {
      source.getHtmlCalls += 1;
      const images = (source.doc.content ?? [])
        .filter((node) => node.type === 'image')
        .map((node) => `<img src="${String(node.attrs?.src ?? '')}">`)
        .join('');
      return `<p>See anchor</p>${images}<p>${LIVE_BODY}</p>`;
    },
    wordCount() {
      return 5;
    },
  };
  return source;
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? 'note-1',
    paperId: overrides.paperId ?? 'paper-1',
    type: overrides.type ?? 'standalone',
    pageKind: overrides.pageKind ?? null,
    title: overrides.title ?? 'Note',
    content: overrides.content ?? '',
    contentJson: overrides.contentJson ?? null,
    contentHtml: overrides.contentHtml ?? '',
    contentText: overrides.contentText ?? '',
    aiChatMessageIds: overrides.aiChatMessageIds ?? [],
    anchors: overrides.anchors ?? [],
    tags: overrides.tags ?? [],
    color: overrides.color ?? '#fef3c7',
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
    linkedNoteIds: overrides.linkedNoteIds ?? [],
    linkedPaperIds: overrides.linkedPaperIds ?? [],
    ...overrides,
  };
}

class MemoryDraftStorage implements NoteEditorDraftStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return Array.from(this.values.keys());
  }
}

function emptySnapshot(): EditorSnapshot {
  return {
    contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    contentHtml: '<p></p>',
    contentText: '',
    wordCount: 0,
  };
}

function flushState(overrides: Partial<Parameters<typeof resolveNoteEditorDraftFlush>[0]> = {}) {
  const currentNote = overrides.note ?? note({ id: 'note-1', updatedAt: 5 });
  return {
    note: currentNote,
    loadedNoteId: 'note-1',
    title: 'Note',
    tagText: '',
    color: '#fef3c7',
    dirty: true,
    currentSignature: fastSignature({
      title: 'Note',
      tagText: '',
      color: '#fef3c7',
      contentJson: emptySnapshot().contentJson,
      contentText: '',
    }),
    appliedUpdatedAt: 5,
    lastSavedSignature: fastSignature({
      title: 'Note',
      tagText: '',
      color: '#fef3c7',
      contentJson: emptySnapshot().contentJson,
      contentText: '',
    }),
    hasPendingContent: false,
    baseAnchors: [],
    previousAnchors: [],
    pendingAnchors: [],
    ...overrides,
  };
}

test('first body keystroke persisted when the editor is flushed before the throttle commit', () => {
  const source = fakeSource(imageDocument(8));
  const tracker = createNoteEditorSnapshotTracker(source, { schedule: () => null });

  // 模拟首个正文按键：onUpdate 只 markDirty，120ms 节流提交尚未运行。
  tracker.markDirty();
  assert.equal(tracker.hasPending(), true);

  // 模拟 NoteEditor 的 flushLiveEditor：立即读取完整实时快照。
  const liveSnapshot = tracker.flush();
  assert.match(liveSnapshot.contentText, new RegExp(LIVE_BODY));

  // 此时 currentSignature 仍是保存时的旧签名（revision 未推进），dirty 也为 false；
  // 但 tracker 有未提交正文，必须补建草稿 payload。
  const state = flushState({ dirty: false, hasPendingContent: true });
  const payload = resolveNoteEditorDraftFlush(state, liveSnapshot, null);
  assert.ok(payload, 'a pending body edit must produce a draft payload');

  assert.match(payload.snapshot.contentText, new RegExp(LIVE_BODY));
  assert.match(payload.draftSignature, /^\["v3",/);
  assert.equal(
    payload.draftSignature,
    fastSignature({
      title: 'Note',
      tagText: '',
      color: '#fef3c7',
      contentJson: liveSnapshot.contentJson,
      contentText: liveSnapshot.contentText,
    }),
    'draft signature must describe the live content, not the stale signature',
  );

  const storage = new MemoryDraftStorage();
  createNoteEditorDraftStore({ storage }).write('note-editor-test', payload);
  const reopened = createNoteEditorDraftStore({ storage });
  assert.equal(
    reopened.read('note-editor-test', 'note-1')?.snapshot.contentText.includes(LIVE_BODY),
    true,
    'a reopened draft store must recover the body typed just before the switch',
  );
});

test('an existing pending draft is refreshed with the live snapshot on switch', () => {
  const source = fakeSource(imageDocument(2));
  const tracker = createNoteEditorSnapshotTracker(source, { schedule: () => null });
  const staleSnapshot = emptySnapshot();
  const existing: NoteEditorDraft = {
    noteId: 'note-1',
    baseUpdatedAt: 5,
    savedSignature: 'saved',
    draftSignature: 'draft',
    title: 'Note',
    tagText: '',
    color: '#fef3c7',
    snapshot: staleSnapshot,
    pendingAnchors: [],
    updatedAt: 1,
  };

  tracker.markDirty();
  const liveSnapshot = tracker.flush();
  const payload = resolveNoteEditorDraftFlush(
    flushState({ dirty: true, hasPendingContent: false }),
    liveSnapshot,
    existing,
  );

  assert.ok(payload);
  assert.equal(payload.noteId, 'note-1');
  assert.match(payload.snapshot.contentText, new RegExp(LIVE_BODY), 'pending payload must carry the live body');
  assert.equal(payload.snapshot.contentJson.content.length, 4);
});

test('a clean note does not produce a phantom draft on unmount', () => {
  const payload = resolveNoteEditorDraftFlush(
    flushState({ dirty: false, hasPendingContent: false }),
    emptySnapshot(),
    null,
  );
  assert.equal(payload, null);
});

test('a payload belonging to another note is not reused', () => {
  const foreignDraft: NoteEditorDraft = {
    noteId: 'note-2',
    baseUpdatedAt: 5,
    savedSignature: 'saved',
    draftSignature: 'draft',
    title: 'Other',
    tagText: '',
    color: '#fef3c7',
    snapshot: emptySnapshot(),
    pendingAnchors: [],
    updatedAt: 1,
  };
  const payload = resolveNoteEditorDraftFlush(
    flushState({ dirty: false, hasPendingContent: false }),
    emptySnapshot(),
    foreignDraft,
  );
  assert.equal(payload, null);
});

test('body edit changes the signature and the draft flush carries it', () => {
  const source = fakeSource(imageDocument(8));
  const tracker = createNoteEditorSnapshotTracker(source, { schedule: () => null });

  const before = tracker.flushContent();
  const beforeSignature = fastSignature({
    title: 'Note',
    tagText: '',
    color: '#fef3c7',
    contentJson: before.contentJson,
    contentText: before.contentText,
  });

  source.doc = imageDocument(8, 'Edited body paragraph');
  tracker.markDirty();
  const after = tracker.flushContent();
  const afterSignature = fastSignature({
    title: 'Note',
    tagText: '',
    color: '#fef3c7',
    contentJson: after.contentJson,
    contentText: after.contentText,
  });

  assert.notEqual(beforeSignature, afterSignature, 'a body edit must change the signature');
  assert.notEqual(before.contentJson, after.contentJson);

  tracker.markDirty();
  const full = tracker.flush();
  const payload = resolveNoteEditorDraftFlush(
    flushState({ dirty: true }),
    full,
    null,
  );
  assert.ok(payload);
  const bodyParagraph = payload.snapshot.contentJson.content.at(-1) as JSONContent;
  assert.equal(bodyParagraph.content?.[0]?.text, 'Edited body paragraph');
});

// 结构护栏：flushLiveEditor 必须把挂起正文与 dirty 状态交给草稿冲刷入口，
// 否则首个正文按键后立即切换/卸载仍会丢字（residual 2 的接线点）。
test('flushLiveEditor wires pending body edits into the draft flush', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/features/notes/NoteEditor.tsx'),
    'utf8',
  );
  const start = source.indexOf('const flushLiveEditor');
  const end = source.indexOf('return () => flushLiveEditor()');
  assert.ok(start > 0 && end > start, 'flushLiveEditor effect must stay in NoteEditor');

  const flush = source.slice(start, end);
  assert.match(flush, /tracker\?\.hasPending\(\)/);
  assert.match(flush, /dirtyRef\.current/);
  assert.match(flush, /draftFlushRef\.current\?\.\(full, hasPendingContent\)/);
});

test('a keystroke marks the editor dirty before the 120ms snapshot commits', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/features/notes/NoteEditor.tsx'),
    'utf8',
  );

  assert.match(source, /setLiveDirty\(true\)/, 'onUpdate must set the immediate dirty flag');
  const dirtyDeclaration = source.match(/const dirty = Boolean\(note &&[^;]+\);/)?.[0] ?? '';
  assert.match(dirtyDeclaration, /liveDirty/, 'dirty must include the throttle-window flag');
  assert.match(source, /setLiveDirty\(false\)/, 'commit/save/switch must clear the flag');
  // Ctrl+S 与保存按钮都读 dirty；liveDirty 让它们在节流窗口内可用。
  assert.match(source, /if \(!dirty \|\| saving\) return;/);
});
