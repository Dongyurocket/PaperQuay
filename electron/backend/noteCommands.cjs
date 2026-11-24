const GLOBAL_NOTES_PAPER_ID = 'global-notes';
const NATIVE_LIBRARY_PREFIX = 'native-library:';
const STANDALONE_PREFIX = 'standalone:';
const NOTES_LIST_MAX_LIMIT = 5000;

/**
 * 桌面写路径的 paper 目标校验（与 MCP 的 paperExists 语义一致）：
 * - global-notes 永远合法；
 * - 阅读器把文库文档的 workspaceId 记为 `native-library:<paperId>`，笔记沿用该值，
 *   校验时还原为文库主键再查；
 * - `standalone:<path>` 是本地独立 PDF（不属于文库），阅读器笔记仍允许创建；
 * - 文库缺失或查询失败时视为目标不存在。
 */
function paperExists(context, paperId) {
  const target = String(paperId ?? '').trim();
  if (!target || target === GLOBAL_NOTES_PAPER_ID) return true;
  if (target.startsWith(STANDALONE_PREFIX)) return true;
  const libraryPaperId = target.startsWith(NATIVE_LIBRARY_PREFIX)
    ? target.slice(NATIVE_LIBRARY_PREFIX.length)
    : target;
  // `native-library:` 后必须带文库主键；空 id 是无效目标，不能当成 global-notes。
  if (!libraryPaperId) return false;
  try {
    return Boolean(context?.store?.getPaper?.(libraryPaperId));
  } catch {
    return false;
  }
}

/** 读取应用设置里的自动同步开关；读取失败返回 null（不做取消策略）。 */
function readVaultAutoSyncEnabled(context) {
  try {
    const settings = context?.appSettings?.getPublic?.()?.settings;
    return settings?.notesVaultAutoSyncEnabled === true;
  } catch {
    return null;
  }
}

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
      const offset = Math.max(0, Math.trunc(Number(request?.offset)) || 0);
      if (!offset) return noteStore.listNotes(request);
      const limit = Math.max(1, Math.min(NOTES_LIST_MAX_LIMIT, Math.trunc(Number(request?.limit)) || 500));
      // noteStore.listNotes 只有 limit 上限（5000），没有 offset。命令层用它
      // 「多取 offset+limit 再切片」实现等价分页；只有窗口超出 5000 才退到无上限
      // 的 listAllNotes（分页第二次请求起才会发生，常见笔记量走不到这里）。
      if (offset + limit <= NOTES_LIST_MAX_LIMIT) {
        return noteStore.listNotes({ ...request, limit: offset + limit }).slice(offset, offset + limit);
      }
      return noteStore.listAllNotes(request).slice(offset, offset + limit);
    },

    notes_get({ id }) {
      return noteStore.getNote({ id });
    },

    notes_create({ request }) {
      const next = request ?? {};
      // 目标 paper 必须存在（global-notes 由 noteStore 跳过校验）；与 MCP 一致。
      return noteStore.createNote({
        ...next,
        assertPaperExists: (paperId) => paperExists(context, paperId),
      });
    },

    notes_update({ id, patch, expectedUpdatedAt }) {
      return noteStore.updateNote({
        id,
        patch: patch ?? {},
        expectedUpdatedAt,
        // paperId 变更的校验由 noteStore 在同一写事务内通过该回调执行。
        assertPaperExists: (paperId) => paperExists(context, paperId),
      });
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

    async notes_vault_update_settings({ settings } = {}) {
      const next = settings ?? {};
      // cancelAutoSync 是渲染层清理函数发来的内部取消请求：只中断在跑的
      // 调度器同步，不写设置（清理函数不能 await，也不应产生设置写入）。
      if (next.cancelAutoSync === true) {
        noteVault.cancelAutoSync();
        if (next.dir === undefined) return noteVault.getSettings();
      }
      const saved = await noteVault.updateSettings(next);
      // 自动同步已关闭时，调度器启动的后台同步不应继续占用主线程。
      if (readVaultAutoSyncEnabled(context) === false) {
        noteVault.cancelAutoSync();
      }
      return saved;
    },

    async notes_vault_sync_now({ options } = {}) {
      // syncNow 对小 vault 同步返回、对大 vault / 后台模式返回 Promise；统一 await。
      return await noteVault.syncNow(options ?? {});
    },
  };
}

module.exports = { createNoteCommands, paperExists };
