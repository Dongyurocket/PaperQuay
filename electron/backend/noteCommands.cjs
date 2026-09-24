function createNoteCommands(context) {
  const { noteStore, noteVault } = context;

  return {
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
