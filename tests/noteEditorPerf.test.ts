import test from 'node:test';
import assert from 'node:assert/strict';
import type { JSONContent } from '@tiptap/core';

import {
  NOTE_EDITOR_SNAPSHOT_THROTTLE_MS,
  contentHash,
  createNoteEditorSnapshotTracker,
  fastContentSignature,
  fastSignature,
  fastSignatureFromContent,
  legacyFastSignatureV2,
  type EditorSnapshotSource,
} from '../src/features/notes/noteEditorUtils.ts';
import { collectText } from '../src/features/notes/notesTiptap.ts';

const BASE64_CHUNK = 'A'.repeat(256 * 1024);

/** 8 pasted screenshots, each a distinct ~256KB base64 data URL (≈2MB doc). */
function imageDocument(count = 8): JSONContent {
  const images: JSONContent[] = Array.from({ length: count }, (_, index) => ({
    type: 'image',
    attrs: {
      src: `data:image/png;base64,${BASE64_CHUNK}${index}`,
      alt: `pasted-image-${index}.png`,
      title: `pasted-image-${index}.png`,
    },
  }));
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Results' }] },
      ...images,
      { type: 'paragraph', content: [{ type: 'text', text: 'Discussion' }] },
    ],
  };
}

interface FakeSource extends EditorSnapshotSource {
  doc: JSONContent;
  getJsonCalls: number;
  getHtmlCalls: number;
  getTextCalls: number;
}

function fakeSource(initial: JSONContent): FakeSource {
  const source: FakeSource = {
    doc: initial,
    getJsonCalls: 0,
    getHtmlCalls: 0,
    getTextCalls: 0,
    getJSON() {
      source.getJsonCalls += 1;
      return source.doc;
    },
    getText() {
      source.getTextCalls += 1;
      return 'Results Discussion';
    },
    getHTML() {
      source.getHtmlCalls += 1;
      const images = (source.doc.content ?? [])
        .filter((node) => node.type === 'image')
        .map((node) => `<img src="${String(node.attrs?.src ?? '')}">`)
        .join('');
      return `<p>Results</p>${images}<p>Discussion</p>`;
    },
    wordCount() {
      return 2;
    },
  };
  return source;
}

function signatureFor(
  title: string,
  tagText: string,
  color: string,
  doc: JSONContent,
  text: string,
) {
  return fastSignature({ title, tagText, color, contentJson: doc, contentText: text });
}

test('throttled per-key path stays under 50ms with eight base64 screenshots', () => {
  const source = fakeSource(imageDocument(8));
  const tracker = createNoteEditorSnapshotTracker(source, {
    // 手动推进：本测试直接测量一次节流提交的耗时。
    schedule: () => null,
  });

  const started = performance.now();
  tracker.markDirty();
  const content = tracker.flushContent();
  const signature = signatureFor('Results', '', '#fef3c7', content.contentJson, content.contentText);
  const elapsed = performance.now() - started;

  console.log(`[note-editor-perf] 8-image throttled per-key path: ${elapsed.toFixed(3)}ms`);
  assert.ok(signature.length > 0);
  assert.equal(source.getHtmlCalls, 0, 'per-key path must not serialize HTML');
  assert.ok(
    elapsed < 50,
    `throttled per-key path must stay under 50ms, measured ${elapsed.toFixed(3)}ms`,
  );
});

test('multiple rapid updates coalesce into a single throttled snapshot computation', () => {
  const source = fakeSource(imageDocument(2));
  let scheduled: (() => void) | null = null;
  let scheduleCalls = 0;
  const tracker = createNoteEditorSnapshotTracker(source, {
    intervalMs: NOTE_EDITOR_SNAPSHOT_THROTTLE_MS,
    schedule: (callback) => {
      scheduleCalls += 1;
      scheduled = callback;
      return scheduleCalls;
    },
    cancelSchedule: () => {
      scheduled = null;
    },
  });

  const seedCalls = source.getJsonCalls;
  for (let index = 0; index < 6; index += 1) {
    tracker.markDirty();
  }

  assert.equal(scheduleCalls, 1, 'rapid updates share one scheduled commit');
  assert.equal(source.getJsonCalls, seedCalls, 'no snapshot work before the throttle fires');

  assert.ok(scheduled, 'a commit should be scheduled');
  const run = scheduled as unknown as () => void;
  run();

  assert.equal(source.getJsonCalls, seedCalls + 1, 'exactly one snapshot computation for the burst');
  assert.equal(tracker.hasPending(), false);
});

test('flush before save returns the latest editor content', () => {
  const source = fakeSource(imageDocument(1));
  const tracker = createNoteEditorSnapshotTracker(source, { schedule: () => null });

  source.doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest paragraph' }] }],
  };
  tracker.markDirty();
  // 节流回调尚未运行，flush 必须同步读取编辑器最新内容。
  const snapshot = tracker.flush();

  assert.equal(snapshot.contentText, 'Latest paragraph');
  assert.deepEqual(snapshot.contentJson, source.doc);
  assert.equal(snapshot.wordCount, 2);
  assert.ok(snapshot.contentHtml.includes('<p>Results</p>'));
  assert.equal(tracker.hasPending(), false);
});

test('identical content produces identical signatures and changes are detected', () => {
  const doc = imageDocument(8);
  const same = signatureFor('Title', 'tag', '#fff', doc, 'Results Discussion');
  const copy = JSON.parse(JSON.stringify(doc)) as JSONContent;

  assert.equal(same, signatureFor(' Title ', ' tag ', '#fff', copy, 'Results Discussion'));

  const editedText = signatureFor('Title', 'tag', '#fff', doc, 'Results Discussion!');
  assert.notEqual(same, editedText, 'text changes must change the signature');

  const editedTitle = signatureFor('Other', 'tag', '#fff', doc, 'Results Discussion');
  assert.notEqual(same, editedTitle, 'title changes must change the signature');

  const editedTags = signatureFor('Title', 'other', '#fff', doc, 'Results Discussion');
  assert.notEqual(same, editedTags, 'tag changes must change the signature');

  const editedColor = signatureFor('Title', 'tag', '#000', doc, 'Results Discussion');
  assert.notEqual(same, editedColor, 'color changes must change the signature');

  const movedImage = JSON.parse(JSON.stringify(doc)) as JSONContent;
  const images = (movedImage.content ?? []).filter((node) => node.type === 'image');
  if (images[0]?.attrs) images[0].attrs.src = `${String(images[0].attrs.src)}-changed`;
  assert.notEqual(same, signatureFor('Title', 'tag', '#fff', movedImage, 'Results Discussion'), 'image changes must change the signature');
});

test('contentHash is stable and sensitive to formatting-only edits', () => {
  const plain: JSONContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }],
  };
  const bold: JSONContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Same text', marks: [{ type: 'bold' }] }],
      },
    ],
  };

  assert.equal(contentHash(plain), contentHash(JSON.parse(JSON.stringify(plain))));
  assert.notEqual(contentHash(plain), contentHash(bold));

  const longText = `${'a'.repeat(400)}MIDDLE${'z'.repeat(400)}`;
  const middleEdit = `${'a'.repeat(400)}CHANGED${'z'.repeat(400)}`;
  const longDoc = (text: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  assert.notEqual(
    contentHash(longDoc(longText)),
    contentHash(longDoc(middleEdit)),
    'a change confined to the middle of a long paragraph must change the signature',
  );

  const image = (src: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'image', attrs: { src, alt: 'same', title: 'same' } }],
  });
  assert.notEqual(
    contentHash(image(`data:image/png;base64,${'A'.repeat(1000)}1`)),
    contentHash(image(`data:image/png;base64,${'A'.repeat(1000)}2`)),
    'replacing an embedded image must change the signature',
  );
});

test('external update detection still distinguishes local and incoming content', () => {
  const source = fakeSource(imageDocument(2));
  const tracker = createNoteEditorSnapshotTracker(source, { schedule: () => null });

  const localContent = tracker.flushContent();
  const localSignature = signatureFor('Note', '', '#fef3c7', localContent.contentJson, localContent.contentText);

  const incomingDoc: JSONContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'External edit' }] }],
  };
  const incomingSignature = signatureFor('Note', '', '#fef3c7', incomingDoc, 'External edit');
  assert.notEqual(localSignature, incomingSignature, 'external edits must trigger the banner');

  const sameDoc = JSON.parse(JSON.stringify(localContent.contentJson)) as JSONContent;
  const sameSignature = signatureFor('Note', '', '#fef3c7', sameDoc, localContent.contentText);
  assert.equal(localSignature, sameSignature, 'unchanged external content must not trigger the banner');
});

test('draft persistence flushes the full snapshot including HTML and word count', () => {
  const source = fakeSource(imageDocument(8));
  const tracker = createNoteEditorSnapshotTracker(source, { schedule: () => null });

  tracker.markDirty();
  const snapshot = tracker.flush();

  assert.ok(snapshot.contentHtml.includes('<img src="data:image/png;base64,'), 'draft snapshot must carry image HTML');
  assert.equal(snapshot.wordCount, 2);
  assert.equal(source.getHtmlCalls, 1);
});

test('dispose cancels a pending throttled commit', () => {
  const source = fakeSource(imageDocument(1));
  let scheduled: (() => void) | null = null;
  let cancelled = false;
  const tracker = createNoteEditorSnapshotTracker(source, {
    schedule: (callback) => {
      scheduled = callback;
      return 1;
    },
    cancelSchedule: () => {
      cancelled = true;
      scheduled = null;
    },
  });

  tracker.markDirty();
  const seedCalls = source.getJsonCalls;
  tracker.dispose();
  assert.equal(cancelled, true);
  assert.equal(tracker.hasPending(), false);
  assert.equal(source.getJsonCalls, seedCalls);
  assert.equal(scheduled, null);
});

test('flush reports consumed pending content so the signature cache advances', () => {
  const source = fakeSource(imageDocument(1));
  const commits: string[] = [];
  const tracker = createNoteEditorSnapshotTracker(source, {
    schedule: () => null,
    onCommit: (content) => commits.push(content.contentText),
  });

  tracker.markDirty();
  const snapshot = tracker.flush();

  assert.equal(tracker.hasPending(), false);
  assert.deepEqual(commits, [snapshot.contentText], 'flush must notify the snapshot commit hook');
});

test('metadata keystroke reuses the cached content signature without touching content', () => {
  const source = fakeSource(imageDocument(8));
  const doc = source.getJSON();
  const seedJsonCalls = source.getJsonCalls;
  const contentSignature = fastContentSignature(doc, 'Results Discussion');

  const iterations = 100;
  const started = performance.now();
  let signature = '';
  for (let index = 0; index < iterations; index += 1) {
    signature = fastSignatureFromContent(
      { title: `Title ${index}`, tagText: 'tag', color: '#fef3c7' },
      contentSignature,
    );
  }
  const perKey = (performance.now() - started) / iterations;

  const fullStarted = performance.now();
  const fullSignature = fastSignature({
    title: `Title ${iterations - 1}`,
    tagText: 'tag',
    color: '#fef3c7',
    contentJson: doc,
    contentText: 'Results Discussion',
  });
  const fullMs = performance.now() - fullStarted;

  console.log(
    `[note-editor-perf] metadata keystroke: ${perKey.toFixed(4)}ms/key; full content signature: ${fullMs.toFixed(3)}ms`,
  );

  assert.equal(source.getJsonCalls, seedJsonCalls, 'metadata path must not read editor content');
  assert.ok(perKey < 1, `metadata keystroke must stay under 1ms, measured ${perKey.toFixed(4)}ms`);
  assert.ok(perKey < fullMs, 'cached metadata path must be cheaper than the full content signature');
  assert.equal(signature, fullSignature, 'the cached and full signatures must stay byte-identical');
});

test('v3 signatures are distinct from legacy v2 draft signatures', () => {
  const doc = imageDocument(1);
  const value = {
    title: ' Title ',
    tagText: ' tag ',
    color: '#fff',
    contentJson: doc,
    contentText: 'Results Discussion',
  };

  const v3 = fastSignature(value);
  const v2 = legacyFastSignatureV2(value);

  assert.match(v3, /^\["v3",/);
  assert.match(v2, /^\["v2",/);
  assert.notEqual(v3, v2);
  assert.equal(v2, JSON.stringify(['v2', 'Title', 'tag', '#fff', contentHash(doc), 'Results Discussion']));
});

// 只在显式开启时跑对照基准：旧的“每次按键完整快照 + 全量 JSON 签名”成本。
test('benchmark: legacy per-key full snapshot cost (PAPERQUAY_PERF=1)', { skip: !process.env.PAPERQUAY_PERF }, () => {
  const doc = imageDocument(8);
  const iterations = 20;
  const legacyStarted = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    // 旧 onUpdate：getJSON + collectText + getHTML + 字数 + JSON.stringify(contentJson)。
    const source = fakeSource(doc);
    const json = source.getJSON();
    collectText(json);
    source.getHTML();
    source.wordCount();
    JSON.stringify({ title: 'T', tagText: '', color: '#fff', contentJson: json, contentText: 'Results Discussion' });
  }
  const legacyPerCall = (performance.now() - legacyStarted) / iterations;
  console.log(`[note-editor-perf] legacy per-key full snapshot: ${legacyPerCall.toFixed(3)}ms/call`);

  const source = fakeSource(doc);
  const tracker = createNoteEditorSnapshotTracker(source, { schedule: () => null });
  const cheapStarted = performance.now();
  tracker.markDirty();
  const content = tracker.flushContent();
  fastSignature({ title: 'T', tagText: '', color: '#fff', contentJson: content.contentJson, contentText: content.contentText });
  const cheapPerCall = performance.now() - cheapStarted;
  console.log(`[note-editor-perf] throttled signature path: ${cheapPerCall.toFixed(3)}ms/call`);
  assert.ok(cheapPerCall < legacyPerCall, 'throttled path should be cheaper than the legacy per-key full snapshot');
});
