import test from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/core';

import {
  clearNoteEditorDraft,
  componentBlockNode,
  contentHash,
  createNoteEditorDraftStore,
  getImageFilesFromDataTransfer,
  headingNode,
  isImageFile,
  isNoteRecord,
  mergeAnchors,
  normalizeAnchorPageLabel,
  normalizeAnchorSourceTitle,
  normalizeSuggestionQuery,
  NOTE_EDITOR_DRAFT_MAX_BYTES,
  NOTE_EDITOR_DRAFT_STORAGE_PREFIX,
  NOTE_TEMPLATES,
  paragraphNode,
  readNoteEditorDraft,
  signature,
  slashCommandItems,
  snapshotFromNote,
  writeNoteEditorDraft,
} from '../src/features/notes/noteEditorUtils.ts';
import type { NoteEditorDraft, NoteEditorDraftStorage } from '../src/features/notes/noteEditorUtils.ts';
import type { Note, NoteAnchor } from '../src/types/notes.ts';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? 'note-1',
    paperId: overrides.paperId ?? 'paper-1',
    type: overrides.type ?? 'standalone',
    pageKind: overrides.pageKind ?? null,
    title: overrides.title ?? 'Note',
    content: overrides.content ?? 'Plain note',
    contentJson: overrides.contentJson ?? null,
    contentHtml: overrides.contentHtml ?? '<p>Plain note</p>',
    contentText: overrides.contentText ?? 'Plain note',
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

function anchor(overrides: Partial<NoteAnchor> & Pick<NoteAnchor, 'id'>): NoteAnchor {
  return {
    id: overrides.id,
    label: overrides.label ?? 'P1',
    excerpt: overrides.excerpt ?? 'excerpt',
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  };
}

function imageFile(name: string, type = '', size = 10, lastModified = 1): File {
  return new File(['x'.repeat(size)], name, { type, lastModified });
}

test('node builders create stable Tiptap JSON blocks', () => {
  assert.deepEqual(paragraphNode('hello'), {
    type: 'paragraph',
    content: [{ type: 'text', text: 'hello' }],
  });
  assert.deepEqual(headingNode(2, 'Section'), {
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'Section' }],
  });
  assert.deepEqual(componentBlockNode('Card'), {
    type: 'noteComponentBlock',
    attrs: { title: 'Card', variant: 'note' },
    content: [{ type: 'paragraph' }],
  });
});

test('note templates expose expected slash-command templates', () => {
  assert.deepEqual(
    NOTE_TEMPLATES.map((template) => template.id),
    [
      'literature-review',
      'method-analysis',
      'experiment-note',
      'qa-summary',
      // 页面类型模板（docs/notes-charter.md §1）
      'paper-card',
      'concept',
      'synthesis',
      'excerpt-card',
      'index-page',
      'research-log',
      'overview-page',
    ],
  );
});

test('slash command items filter base commands and note templates', () => {
  assert.equal(slashCommandItems('').some((item) => item.id === 'paragraph'), true);
  assert.deepEqual(slashCommandItems('/h2').map((item) => item.id), ['heading-2']);
  assert.deepEqual(
    slashCommandItems('/literature').map((item) => item.id),
    ['template:literature-review'],
  );
  assert.deepEqual(slashCommandItems('/missing-command'), []);
});

test('anchor labels and source titles normalize legacy values', () => {
  assert.equal(normalizeAnchorPageLabel(' p 12 '), 'P12');
  assert.equal(normalizeAnchorPageLabel(''), '定位');
  assert.equal(normalizeAnchorSourceTitle('PDF 12', '正文摘录'), '文献');
  assert.equal(normalizeAnchorSourceTitle('', 'Actual Paper'), 'Actual Paper');
  assert.equal(normalizeAnchorSourceTitle('Paper Title', '摘录'), 'Paper Title');
});

test('normalizeSuggestionQuery removes repeated triggers and hidden characters', () => {
  assert.equal(normalizeSuggestionQuery('\u200B[[[[Graph', ['[[']), 'graph');
  assert.equal(normalizeSuggestionQuery('///Heading', ['/', '//']), 'heading');
});

test('snapshotFromNote and signature normalize saved note state', () => {
  const snapshot = snapshotFromNote(note({
    title: 'Saved',
    contentText: 'Saved text',
    wordCount: 2,
  }));

  assert.equal(snapshot.contentText, 'Saved text');
  assert.equal(snapshot.wordCount, 2);
  assert.equal(
    signature({ title: ' Saved ', tagText: ' tag ', color: '#fff', snapshot }),
    JSON.stringify({
      title: 'Saved',
      tagText: 'tag',
      color: '#fff',
      contentJson: snapshot.contentJson,
      contentText: 'Saved text',
    }),
  );
});

test('note editor drafts preserve their base version for conflict detection', () => {
  const sourceId = 'reader-sidebar';
  const noteId = 'note-1';
  const saved = note({ id: noteId, title: 'Saved', updatedAt: 10 });
  const savedSnapshot = snapshotFromNote(saved);
  const savedSignature = signature({
    title: saved.title,
    tagText: saved.tags.join(', '),
    color: saved.color,
    snapshot: savedSnapshot,
  });
  const draftSnapshot = {
    ...savedSnapshot,
    contentText: 'Unsaved draft',
    contentJson: paragraphNode('Unsaved draft'),
  };

  writeNoteEditorDraft(sourceId, {
    noteId,
    baseUpdatedAt: saved.updatedAt,
    savedSignature,
    draftSignature: signature({
      title: 'Draft title',
      tagText: '',
      color: saved.color,
      snapshot: draftSnapshot,
    }),
    title: 'Draft title',
    tagText: '',
    color: saved.color,
    snapshot: draftSnapshot,
    pendingAnchors: [],
    updatedAt: 20,
  });

  const restored = readNoteEditorDraft(sourceId, noteId);
  assert.equal(restored?.title, 'Draft title');
  assert.equal(restored?.baseUpdatedAt, saved.updatedAt);
  assert.notEqual(restored?.baseUpdatedAt, saved.updatedAt + 1);
  assert.equal(readNoteEditorDraft(sourceId, noteId)?.title, 'Draft title');

  writeNoteEditorDraft(sourceId, {
    noteId,
    baseUpdatedAt: saved.updatedAt,
    savedSignature,
    draftSignature: savedSignature,
    title: saved.title,
    tagText: '',
    color: saved.color,
    snapshot: savedSnapshot,
    pendingAnchors: [],
    updatedAt: 30,
  });
  clearNoteEditorDraft(sourceId, noteId);

  assert.equal(readNoteEditorDraft(sourceId, noteId), null);
});

test('isNoteRecord validates note identity and update timestamp', () => {
  assert.equal(isNoteRecord(note({ id: 'n1' }), 'n1'), true);
  assert.equal(isNoteRecord(note({ id: 'n1' }), 'n2'), false);
  assert.equal(isNoteRecord({ id: 'n1' }, 'n1'), false);
});

test('mergeAnchors keeps later anchors with the same id', () => {
  const merged = mergeAnchors(
    [anchor({ id: 'a1', excerpt: 'old' })],
    [anchor({ id: 'a1', excerpt: 'new' }), anchor({ id: 'a2' })],
  );

  assert.deepEqual(merged.map((item) => [item.id, item.excerpt]), [
    ['a1', 'new'],
    ['a2', 'excerpt'],
  ]);
});

test('image file helpers accept image MIME types and image extensions', () => {
  const png = imageFile('image.png', '');
  const text = imageFile('note.txt', 'text/plain');
  const jpeg = imageFile('photo.bin', 'image/jpeg');

  assert.equal(isImageFile(png), true);
  assert.equal(isImageFile(jpeg), true);
  assert.equal(isImageFile(text), false);

  const transfer = {
    files: [png, text],
    items: [
      { kind: 'file', getAsFile: () => png },
      { kind: 'file', getAsFile: () => jpeg },
      { kind: 'string', getAsFile: () => null },
    ],
  } as unknown as DataTransfer;

  assert.deepEqual(getImageFilesFromDataTransfer(transfer).map((file) => file.name), [
    'image.png',
    'photo.bin',
  ]);
});

class MemoryDraftStorage implements NoteEditorDraftStorage {
  private readonly values = new Map<string, string>();
  quota: number | null = null;
  failWrites = false;

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
    if (this.failWrites) throw new Error('storage unavailable');
    if (this.quota !== null) {
      const existing = this.values.get(key)?.length ?? 0;
      let total = value.length - existing;
      for (const [storedKey, storedValue] of this.values) {
        if (storedKey !== key) total += storedKey.length + storedValue.length;
      }
      if (total > this.quota) {
        throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      }
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return Array.from(this.values.keys());
  }
}

function draftFor(noteId: string, title: string, updatedAt = 1): NoteEditorDraft {
  const snapshot = snapshotFromNote(note({ id: noteId, title }));
  return {
    noteId,
    baseUpdatedAt: 1,
    savedSignature: 'saved',
    draftSignature: `draft-${title}`,
    title,
    tagText: '',
    color: '#fef3c7',
    snapshot: { ...snapshot, contentText: title },
    pendingAnchors: [],
    updatedAt,
  };
}

test('note editor drafts survive a module reload through the injected storage', () => {
  const storage = new MemoryDraftStorage();
  const first = createNoteEditorDraftStore({ storage });
  first.write('reader', draftFor('note-1', 'Unsaved crash draft', 10));

  // 新实例模拟崩溃/重启后重新加载模块：只能从存储恢复。
  const reopened = createNoteEditorDraftStore({ storage });
  assert.equal(reopened.read('reader', 'note-1')?.title, 'Unsaved crash draft');
  assert.equal(reopened.read('reader', 'note-2'), null);
});

test('draft store evicts the oldest entries beyond its capacity', () => {
  const storage = new MemoryDraftStorage();
  const store = createNoteEditorDraftStore({ storage, maxEntries: 2 });
  store.write('reader', draftFor('note-1', 'Oldest', 1));
  store.write('reader', draftFor('note-2', 'Middle', 2));
  store.write('reader', draftFor('note-3', 'Newest', 3));

  assert.equal(store.read('reader', 'note-3')?.title, 'Newest');
  const reopened = createNoteEditorDraftStore({ storage, maxEntries: 2 });
  assert.equal(reopened.read('reader', 'note-3')?.title, 'Newest');
  assert.equal(reopened.read('reader', 'note-2')?.title, 'Middle');
  assert.equal(reopened.read('reader', 'note-1'), null);
});

test('draft persistence prunes older entries when the storage quota is exceeded', () => {
  const storage = new MemoryDraftStorage();
  const store = createNoteEditorDraftStore({ storage, maxBytes: 4096 });
  store.write('reader', draftFor('note-1', 'A'.repeat(200), 1));
  const firstBytes = storage.getItem(`${NOTE_EDITOR_DRAFT_STORAGE_PREFIX}reader::note-1`)?.length ?? 0;
  assert.ok(firstBytes > 0);
  storage.quota = Math.floor(firstBytes * 1.5);
  store.write('reader', draftFor('note-2', 'B'.repeat(200), 2));

  const reopened = createNoteEditorDraftStore({ storage });
  assert.equal(reopened.read('reader', 'note-2')?.title, 'B'.repeat(200));
  assert.equal(reopened.read('reader', 'note-1'), null, 'the oldest persisted draft makes room for the newest');
});

test('an oversized draft stays in memory without breaking later persistence', () => {
  const storage = new MemoryDraftStorage();
  const store = createNoteEditorDraftStore({ storage, maxBytes: 1200 });
  store.write('reader', draftFor('note-big', 'X'.repeat(4000), 1));
  store.write('reader', draftFor('note-small', 'small', 2));

  assert.equal(store.read('reader', 'note-big')?.title, 'X'.repeat(4000), 'same-session edits still restore');
  const reopened = createNoteEditorDraftStore({ storage });
  assert.equal(reopened.read('reader', 'note-big'), null);
  assert.equal(reopened.read('reader', 'note-small')?.title, 'small');
});

test('storage failures and corrupt values never break draft editing', () => {
  const storage = new MemoryDraftStorage();
  const store = createNoteEditorDraftStore({ storage });
  store.write('reader', draftFor('note-1', 'Draft', 1));
  storage.failWrites = true;
  assert.doesNotThrow(() => store.write('reader', draftFor('note-2', 'Offline draft', 2)));
  assert.equal(store.read('reader', 'note-2')?.title, 'Offline draft');

  const corruptKey = `${NOTE_EDITOR_DRAFT_STORAGE_PREFIX}reader::note-corrupt`;
  storage.failWrites = false;
  storage.setItem(corruptKey, '{not json');
  assert.equal(store.read('reader', 'note-corrupt'), null);
  assert.equal(storage.getItem(corruptKey), null, 'corrupt drafts are removed instead of retried forever');
});

test('clear removes both the memory copy and the persisted draft', () => {
  const storage = new MemoryDraftStorage();
  const store = createNoteEditorDraftStore({ storage });
  store.write('reader', draftFor('note-1', 'Draft', 1));
  store.clear('reader', 'note-1');
  assert.equal(store.read('reader', 'note-1'), null);

  const reopened = createNoteEditorDraftStore({ storage });
  assert.equal(reopened.read('reader', 'note-1'), null);
  assert.deepEqual(storage.keys(), []);
});

test('data URL hashing samples evenly spaced middle windows', () => {
  const head = 'data:image/png;base64,';
  const body = 'A'.repeat(160 * 1024);
  const original = `${head}${body}`;
  const middle = Math.floor(original.length / 2);
  const mutated = `${original.slice(0, middle)}B${original.slice(middle + 1)}`;
  assert.equal(original.length, mutated.length);

  const imageDoc = (src: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'image', attrs: { src, alt: 'same', title: 'same' } }],
  });

  assert.notEqual(
    contentHash(imageDoc(original)),
    contentHash(imageDoc(mutated)),
    'an equal-length replacement in the middle of a data URL must change the hash',
  );
});

test('drafts with eight 256KB screenshots persist without duplicated HTML', () => {
  const storage = new MemoryDraftStorage();
  const store = createNoteEditorDraftStore({ storage });
  const src = (index: number) => `data:image/png;base64,${'A'.repeat(256 * 1024)}${index}`;
  const contentJson: JSONContent = {
    type: 'doc',
    content: Array.from({ length: 8 }, (_, index) => ({
      type: 'image',
      attrs: { src: src(index), alt: `shot-${index}.png`, title: `shot-${index}.png` },
    })),
  };
  const sentinel = 'data-persisted-html-sentinel';

  store.write('reader', {
    noteId: 'note-screenshots',
    baseUpdatedAt: 1,
    savedSignature: 'saved',
    draftSignature: 'draft',
    title: 'Screenshots',
    tagText: '',
    color: '#fef3c7',
    snapshot: {
      contentJson,
      contentHtml: `<p>${sentinel}</p><img src="${src(0)}">`,
      contentText: 'caption text',
      wordCount: 2,
    },
    pendingAnchors: [],
    updatedAt: 10,
  });

  const storageKey = `${NOTE_EDITOR_DRAFT_STORAGE_PREFIX}reader::note-screenshots`;
  const serialized = storage.getItem(storageKey);
  assert.ok(serialized, 'the 8-image draft must persist instead of exceeding the size cap');
  assert.ok(
    serialized.length < NOTE_EDITOR_DRAFT_MAX_BYTES,
    `persisted draft (${serialized.length} chars) must stay under the cap`,
  );
  assert.doesNotMatch(serialized, new RegExp(sentinel), 'persisted drafts must omit duplicated HTML');

  const reopened = createNoteEditorDraftStore({ storage });
  const restored = reopened.read('reader', 'note-screenshots');
  assert.equal(restored?.snapshot.contentText, 'caption text');
  assert.equal(restored?.snapshot.contentHtml, '', 'persisted drafts restore from contentJson only');
  assert.equal(restored?.snapshot.contentJson.content?.length, 8);
  assert.equal(
    String(restored?.snapshot.contentJson.content?.[7]?.attrs?.src).length,
    'data:image/png;base64,'.length + 256 * 1024 + 1,
  );
});
