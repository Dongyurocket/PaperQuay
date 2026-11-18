import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: ['src/stores/useNotesStore.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['react', 'react/*'],
  write: false,
  plugins: [{
    name: 'mock-notes-service',
    setup(builder) {
      builder.onResolve({ filter: /\.\.\/services\/notes$/ }, () => ({ path: 'notes', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: `export const updateNote = (...args) => globalThis.__testUpdateNote(...args);
          export const listNoteTags = async () => [];
          export const createNote = (...args) => globalThis.__testCreateNote(...args);
          export const deleteNote = async () => {};
          export const listNotes = async () => [];`,
        loader: 'js',
      }));
    },
  }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { useNotesStore } = module.exports;

test('a delayed update does not change the selected note', async () => {
  const first = { id: 'first', title: 'First', updatedAt: 1, isPinned: false };
  const second = { id: 'second', title: 'Second', updatedAt: 1, isPinned: false };
  useNotesStore.setState({ notes: [first, second], activeNoteId: first.id });
  let finish;
  globalThis.__testUpdateNote = () => new Promise((resolve) => { finish = resolve; });
  try {
    const pending = useNotesStore.getState().updateWorkspaceNote(first.id, { title: 'Saved' });
    useNotesStore.getState().setActiveNoteId(second.id);
    finish({ ...first, title: 'Saved', updatedAt: 2 });
    await pending;
    assert.equal(useNotesStore.getState().activeNoteId, second.id);
    assert.equal(useNotesStore.getState().notes.find((note) => note.id === first.id).title, 'Saved');
  } finally {
    delete globalThis.__testUpdateNote;
  }
});

test('creating a note still selects it', async () => {
  globalThis.__testCreateNote = async () => ({ id: 'created', updatedAt: 3 });
  try {
    await useNotesStore.getState().createWorkspaceNote();
    assert.equal(useNotesStore.getState().activeNoteId, 'created');
  } finally {
    delete globalThis.__testCreateNote;
  }
});
