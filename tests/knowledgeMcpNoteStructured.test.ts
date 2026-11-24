import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PaperQuayKnowledgeService } = require('../electron/mcp/knowledgeMcpService.cjs');
const { TOOLS } = require('../electron/mcp/mcpTools.cjs');
const { DatabaseSync } = require('../electron/backend/nodeSqlite.cjs');

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error: any) {
    console.warn(`cleanup skipped for ${dir}: ${error?.code ?? error}`);
  }
}

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'paperquay-mcp-note-structured-test-'));
  const { createLibraryStore } = require('../electron/backend/libraryStore.cjs');
  const libraryStore = createLibraryStore({
    dataDir: dir,
    libraryDatabasePath: path.join(dir, 'paperquay-library.sqlite'),
  });
  const library = libraryStore.load();
  const timestamp = Date.now();
  for (const [paperId, title] of [['paper-1', 'Paper One'], ['paper-2', 'Paper Two']]) {
    library.papers.push({
      id: paperId,
      title,
      titleZh: null,
      year: '2024',
      publication: null,
      doi: null,
      url: null,
      abstractText: null,
      itemType: 'journalArticle',
      publisher: null,
      institution: null,
      reportNumber: null,
      volume: null,
      issue: null,
      pages: null,
      isbn: null,
      issn: null,
      keywords: [],
      importedAt: timestamp,
      updatedAt: timestamp,
      lastReadAt: null,
      readingProgress: 0,
      isFavorite: false,
      userNote: null,
      aiSummary: null,
      citation: null,
      source: 'local',
      sortOrder: 0,
      authors: [],
      tags: [],
      categoryIds: [],
      attachments: [],
    });
  }
  libraryStore.save(library);
  libraryStore.close();
  const service = new PaperQuayKnowledgeService({ dataDir: dir, isAppRunning: () => false });
  return { dir, service };
}

function richDocument(text: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text, marks: [{ type: 'bold' }] },
          { type: 'text', text: ' plain tail' },
        ],
      },
      {
        type: 'noteAnchorBlock',
        attrs: {
          anchorId: 'anchor-roundtrip',
          label: 'P3',
          sourceTitle: 'Paper One',
          excerpt: 'quoted excerpt',
        },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted excerpt' }] }],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] },
        ],
      },
    ],
  };
}

function createRichNote(service: any) {
  return service.withWritableNoteStore((store: any) => store.createNote({
    paperId: 'paper-1',
    type: 'standalone',
    title: 'Rich note',
    content: 'legacy body',
    contentJson: richDocument('First version'),
    anchors: [{
      id: 'anchor-roundtrip',
      paperId: 'paper-1',
      label: 'P3',
      excerpt: 'quoted excerpt',
      sourceTitle: 'Paper One',
      createdAt: 1,
    }],
  }));
}

test('get_note omits contentJson above the 2M character budget and flags truncation', () => {
  const { dir, service } = setup();
  try {
    const hugeText = 'x'.repeat(2_050_000);
    const hugeDocument = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: hugeText }] }],
    };
    const created = service.withWritableNoteStore((store: any) => store.createNote({
      paperId: 'paper-1',
      type: 'standalone',
      title: 'Huge note',
      content: 'huge body',
      contentJson: hugeDocument,
    }));

    const page: any = service.getNote({ noteId: created.id, limit: 100 });
    assert.equal(page.note.contentJson, null, 'oversized JSON must not be shipped over MCP');
    assert.equal(page.note.contentJsonTruncated, true);
    assert.equal(page.note.contentFormat, 'text');
    assert.equal(page.note.totalCharacters, hugeText.length);
    assert.equal(page.note.contentText.length, 100, 'paginated text stays available');
    assert.equal(page.note.nextOffset, 100);
  } finally {
    cleanupDir(dir);
  }
});

test('get_note returns structured contentJson that round-trips through update_note', () => {
  const { dir, service } = setup();
  try {
    const created = createRichNote(service);
    const page: any = service.getNote({ noteId: created.id });

    assert.ok(page.note.contentJson, 'get_note must expose structured contentJson');
    assert.equal(page.note.contentJson.type, 'doc');
    assert.equal(page.note.contentFormat, 'tiptap-json');
    assert.deepEqual(page.note.contentJson, richDocument('First version'));
    assert.ok(page.note.contentText.includes('First version'));

    const nextDocument = richDocument('Second version');
    const updated: any = service.updateNote({
      noteId: created.id,
      contentJson: nextDocument,
      expectedUpdatedAt: page.note.updatedAt,
    });
    assert.equal(updated.noteId, created.id);

    const reread: any = service.getNote({ noteId: created.id });
    assert.deepEqual(reread.note.contentJson, nextDocument);
    assert.ok(reread.note.contentText.includes('Second version'));
    assert.equal(reread.note.anchors.length, 1);
    assert.equal(reread.note.anchors[0].id, 'anchor-roundtrip');
  } finally {
    cleanupDir(dir);
  }
});

test('update_note rejects structured content that drops an existing anchor', () => {
  const { dir, service } = setup();
  try {
    const created = createRichNote(service);
    const page: any = service.getNote({ noteId: created.id });
    const withoutAnchor = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'anchor removed' }] }],
    };

    assert.throws(
      () => service.updateNote({ noteId: created.id, contentJson: withoutAnchor }),
      (error: any) => error?.code === 'NOTE_ANCHOR_MISSING',
    );
    const reread: any = service.getNote({ noteId: created.id });
    assert.deepEqual(reread.note.contentJson, page.note.contentJson, 'rejected update must not mutate the note');
  } finally {
    cleanupDir(dir);
  }
});

test('update_note can move a note to another paper and rejects unknown papers', () => {
  const { dir, service } = setup();
  try {
    const note = service.createNote({ title: 'Movable', content: 'body', paperId: 'paper-1' });
    const page: any = service.getNote({ noteId: note.noteId });

    service.updateNote({
      noteId: note.noteId,
      paperId: 'paper-2',
      expectedUpdatedAt: page.note.updatedAt,
    });
    assert.equal(service.getNote({ noteId: note.noteId }).note.paperId, 'paper-2');

    assert.throws(
      () => service.updateNote({ noteId: note.noteId, paperId: 'missing-paper' }),
      (error: any) => error?.code === 'PAPER_NOT_FOUND',
    );
    assert.equal(service.getNote({ noteId: note.noteId }).note.paperId, 'paper-2');
  } finally {
    cleanupDir(dir);
  }
});

test('search_notes schema declares pageKind clear and the supported filters', () => {
  const tool: any = TOOLS.find((entry: any) => entry.name === 'search_notes');
  assert.ok(tool, 'search_notes tool must exist');
  const properties = tool.inputSchema.properties;
  assert.ok(properties.pageKind.enum.includes(''), 'pageKind must allow an empty string to clear the filter');
  for (const key of ['tag', 'type', 'noteIds', 'linkedPaperId']) {
    assert.ok(properties[key], `search_notes schema must declare ${key}`);
  }
  assert.equal(properties.type.enum.includes('standalone'), true);
});

test('search_notes keyword mode honors tag/type/noteIds/linkedPaperId filters', () => {
  const { dir, service } = setup();
  try {
    const tagged = service.createNote({ title: 'Tagged', content: 'tag body', tags: ['alpha'] });
    const concept = service.createNote({ title: 'Concept', content: 'concept body', pageKind: 'concept' });
    const linked = service.withWritableNoteStore((store: any) => store.createNote({
      paperId: 'global-notes',
      linkedPaperId: 'paper-1',
      type: 'standalone',
      title: 'Linked',
      content: 'linked body',
    }));

    assert.deepEqual(service.searchNotes({ tag: 'alpha' }).notes.map((note: any) => note.id), [tagged.noteId]);
    assert.deepEqual(service.searchNotes({ type: 'standalone' }).notes.length, 3);
    assert.deepEqual(
      service.searchNotes({ noteIds: [concept.noteId] }).notes.map((note: any) => note.id),
      [concept.noteId],
    );
    assert.deepEqual(
      service.searchNotes({ linkedPaperId: 'paper-1' }).notes.map((note: any) => note.id),
      [linked.id],
    );
    // pageKind: '' 表示不按页面类型过滤，不应抛错。
    assert.equal(service.searchNotes({ pageKind: '' }).notes.length, 3);
  } finally {
    cleanupDir(dir);
  }
});

test('search_notes keyword mode falls back to LIKE when FTS rows are missing', () => {
  const { dir, service } = setup();
  try {
    const note = service.createNote({ title: 'Fallback phrase', content: 'unique searchable residue' });
    const db = new DatabaseSync(service.appPaths.notesDatabasePath);
    db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(note.noteId);
    db.close();
    const result = service.searchNotes({ query: 'searchable residue', mode: 'keyword' });
    assert.equal(result.notes.some((item: any) => item.id === note.noteId), true);
  } finally {
    cleanupDir(dir);
  }
});
