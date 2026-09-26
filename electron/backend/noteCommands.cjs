function createNoteCommands(context) {
  const { noteStore, noteVault } = context;

  return {
    async notes_search({ request = {} }) {
      const { resolveNoteEmbedding } = require('./noteEmbedding.cjs');
      const { hybridNotes } = require('./noteHybridSearch.cjs');
      const { embedTexts } = require('./utils.cjs');
      const query = String(request.query ?? '').trim();
      const limit = Math.max(1, Math.min(50, Number(request.limit) || 10));
      const scope = { ...request, paperIdOnly: true };
      const keyword = noteStore.searchNotes({ ...scope, query, limit: Math.min(100, limit * 2) });
      const result = query && request.mode !== 'keyword'
        ? await hybridNotes({
          query, limit, keyword,
          eligible: () => noteStore.eligibleSearchNotes(scope),
          embedding: resolveNoteEmbedding(context.appPaths),
          embed: async (text, config) => (await embedTexts([text], config))[0],
          retrieve: (args) => context.ragStore.retrieveNoteVectors(args),
        })
        : { notes: keyword.rows.slice(0, limit).map((row) => ({ ...row, channels: [keyword.channel] })), retrievalMode: 'keyword' };
      const notes = result.notes.map((row) => ({
        ...noteStore.getNote({ id: row.id }), channels: row.channels, score: row.score,
      })).filter((note) => note.id && !note.deletedAt);
      return { ...result, notes, total: notes.length };
    },
    notes_rebuild_index() { return context.noteIndexer.rebuild(); },
    notes_index_status() { return context.noteIndexer.status(); },
    notes_list({ request = {} }) {
      return noteStore.listNotes(request);
    },

    notes_get({ id }) {
      return noteStore.getNote({ id });
    },

    notes_create({ request }) {
      return noteStore.createNote(request ?? {});
    },

    notes_update({ id, patch }) {
      return noteStore.updateNote({ id, patch: patch ?? {} });
    },

    notes_delete({ id }) {
      noteStore.deleteNote({ id });
    },

    notes_tags({ request = {} }) {
      return noteStore.listTags(request);
    },

    notes_backlinks({ noteId }) {
      return noteStore.listBacklinks({ noteId });
    },

    notes_folders_list() {
      return noteStore.listFolders();
    },

    notes_folder_create({ request }) {
      return noteStore.createFolder(request ?? {});
    },

    notes_folder_rename({ id, name }) {
      return noteStore.renameFolder({ id, name });
    },

    notes_folder_delete({ id }) {
      return noteStore.deleteFolder({ id });
    },

    notes_vault_get_settings() {
      return noteVault.getSettings();
    },

    async notes_vault_update_settings({ settings }) {
      return noteVault.updateSettings(settings ?? {});
    },

    notes_vault_sync_now() {
      return noteVault.syncNow();
    },
  };
}

module.exports = { createNoteCommands };
