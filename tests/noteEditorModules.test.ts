import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');
const NOTE_EDITOR = 'src/features/notes/NoteEditor.tsx';
const EDITOR_DIR = 'src/features/notes/editor';

const MODULES = {
  extensions: `${EDITOR_DIR}/extensions.tsx`,
  draft: `${EDITOR_DIR}/draft.ts`,
  images: `${EDITOR_DIR}/images.ts`,
  toolbar: `${EDITOR_DIR}/toolbar.tsx`,
  slashMenu: `${EDITOR_DIR}/slashMenu.ts`,
  tableCell: `${EDITOR_DIR}/tableCell.tsx`,
} as const;

function lineCount(source: string) {
  return source.trimEnd().split(/\r?\n/).length;
}

function importPattern(specifier: string) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`from '${escaped}(?:\\.tsx?)?'`);
}

test('note editor modules exist under src/features/notes/editor', () => {
  for (const [name, relativePath] of Object.entries(MODULES)) {
    assert.equal(existsSync(path.join(root, relativePath)), true, `${name} module must exist at ${relativePath}`);
  }
});

test('NoteEditor imports every extracted module and keeps its public surface', () => {
  const source = read(NOTE_EDITOR);

  for (const specifier of [
    './editor/extensions',
    './editor/draft',
    './editor/images',
    './editor/toolbar',
    './editor/slashMenu',
    './editor/tableCell',
  ]) {
    assert.match(source, importPattern(specifier), `NoteEditor must import ${specifier}`);
  }

  assert.match(source, /export function NoteEditor\(/);
  assert.match(source, /interface NoteEditorProps \{/);
  assert.match(source, /<NoteEditorToolbar/);
  assert.match(source, /<EditorContent/);
  assert.match(source, /useEditor\(/);
  assert.match(source, /pq-note-editor-body min-h-0 flex-1 overflow-y-auto/);
});

test('NoteEditor is a shell under 1200 lines', () => {
  const source = read(NOTE_EDITOR);
  const lines = lineCount(source);

  assert.ok(lines <= 1200, `NoteEditor.tsx must stay at or below 1200 lines, found ${lines}`);

  for (const [name, pattern] of [
    ['Tiptap node views', /TiptapNode\.create/],
    ['slash command execution', /function runSlashCommand/],
    ['table cell selection helpers', /function setTableCellTextSelection/],
    ['draft flush listeners', /beforeunload/],
    ['draft writes', /writeNoteEditorDraft\(/],
    ['image paste handling', /getImageFilesFromDataTransfer/],
    ['toolbar tag button markup', /pq-icon-button/],
    ['title input markup', /value=\{title\}/],
    ['save button markup', /pq-button-primary/],
    ['context menu table commands', /table-add-row-before/],
    ['localization table', /const NOTE_TEXT = \{/],
  ] as const) {
    assert.doesNotMatch(source, pattern, `NoteEditor must not inline ${name}`);
  }

  assert.match(source, /useNoteEditorDraftPersistence\(/);
  assert.match(source, /createNoteEditorExtensions\(/);
  assert.match(source, /createTableCellEditorProps\(\)/);
  assert.match(source, /createImageEditorProps\(\)/);
  assert.match(source, /buildEditorContextMenuEntries\(/);
  assert.match(source, /<NoteEditorHeader/);
  assert.match(source, /<NoteEditorFooter/);
});

test('draft persistence hook stays between note hydration and anchor insertion effects', () => {
  const source = read(NOTE_EDITOR);
  const hydration = source.indexOf('const hasConflict = !draftSignatureMatches(draft.savedSignature);');
  const draftHook = source.indexOf('useNoteEditorDraftPersistence({');
  const anchorInsert = source.indexOf('pendingAnchorInsert.noteId');

  assert.ok(hydration > 0, 'draft hydration branch must remain in NoteEditor');
  assert.ok(draftHook > hydration, 'draft persistence hook must run after hydration');
  assert.ok(anchorInsert > draftHook, 'anchor insertion effect must stay after draft persistence');
});

test('note editor throttles per-keystroke snapshots instead of full serialization', () => {
  const source = read(NOTE_EDITOR);

  assert.match(source, /createNoteEditorSnapshotTracker\(/);
  assert.match(source, /tracker\.markDirty\(\)/);
  assert.match(source, /flushSnapshot\(/);
  assert.match(source, /fastSignature\(/);
  assert.doesNotMatch(
    source,
    /snapshotRef\.current = snapshotFromEditor\(/,
    'onUpdate must not take a full snapshot per keystroke',
  );
  assert.match(read(MODULES.draft), /snapshotProvider/);
});

test('extensions module owns Tiptap node views and extension assembly', () => {
  const source = read(MODULES.extensions);

  assert.match(source, /export function createNoteEditorExtensions\(/);
  assert.match(source, /StarterKit\.configure\(/);
  assert.match(source, /const NoteComponentBlock = TiptapNode\.create/);
  assert.match(source, /const NoteAnchorBlock = TiptapNode\.create/);
  assert.match(source, /ReactNodeViewRenderer/);
  assert.match(source, /BlockMath\.configure/);
  assert.match(source, /SlashCommand\.configure/);
  assert.match(source, /PaperReference\.configure/);
  assert.match(source, /items: slashCommandItems/);
  assert.match(source, importPattern('./tableCell'));
});

test('tableCell module owns table selection helpers and table commands', () => {
  const source = read(MODULES.tableCell);

  assert.match(source, /export const EditableTable = Table\.extend/);
  assert.match(source, /export function setTableCellTextSelection\(/);
  assert.match(source, /export function createTableCellEditorProps\(/);
  assert.match(source, /export function buildTableContextMenuEntries\(/);
  assert.match(source, /table-add-row-before/);
  assert.match(source, /tableEditingKey/);
});

test('draft module owns debounced persistence and unload flushing', () => {
  const source = read(MODULES.draft);

  assert.match(source, /export function useNoteEditorDraftPersistence\(/);
  assert.match(source, /writeNoteEditorDraft\(/);
  assert.match(source, /window\.setTimeout\(/);
  assert.match(source, /beforeunload/);
  assert.match(source, /pagehide/);
  assert.match(source, /visibilitychange/);
});

test('images module owns image paste and drop insertion', () => {
  const source = read(MODULES.images);

  assert.match(source, /export function createImageEditorProps\(/);
  assert.match(source, /getImageFilesFromDataTransfer/);
  assert.match(source, /insertImageFilesIntoView/);
});

test('slash menu module owns slash command data and execution', () => {
  const source = read(MODULES.slashMenu);

  assert.match(source, /export function runSlashCommand\(/);
  assert.match(source, /slashCommandItems/);
  assert.match(source, /NOTE_TEMPLATES/);
});

test('toolbar module owns header/footer rendering and context-menu commands', () => {
  const source = read(MODULES.toolbar);

  assert.match(source, /export function NoteEditorHeader\(/);
  assert.match(source, /export function NoteEditorFooter\(/);
  assert.match(source, /export function buildEditorContextMenuEntries\(/);
  assert.match(source, /export function localizeNoteText\(/);
  assert.match(source, /export function formatNoteLength\(/);
  assert.match(source, /pq-icon-button/);
  assert.match(source, /value=\{title\}/);
  assert.match(source, /pq-button-primary/);
  assert.match(source, importPattern('./tableCell'));
});
