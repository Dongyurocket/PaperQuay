/**
 * 文献级 RAG 成员关系。
 * 标记写入与索引写入共用按 paperId 串行的锁；排除不是索引失败。
 */

const RAG_INDEX_EXCLUDED_MESSAGE = 'rag_index_excluded';
const RAG_INDEX_WRITE_COMMANDS = [
  'rag_index_document',
  'rag_finalize_document_index',
  'rag_report_document_index_failure',
];

function cleanId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createPaperRagLock() {
  const tails = new Map();

  function withPaperRagLock(paperId, task) {
    const key = cleanId(paperId) || String(paperId ?? '');
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(() => task(), () => task());
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    tail.finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  }

  return { withPaperRagLock };
}

function ragIndexDocumentKey(request) {
  if (!request || request.sourceType === 'note') return '';
  return cleanId(request.documentKey);
}

function assertPaperAllowsRagIndex(store, request) {
  const documentKey = ragIndexDocumentKey(request);
  if (!documentKey || typeof store?.getPaper !== 'function') return;

  const paper = store.getPaper(documentKey);
  if (!paper || paper.ragEnabled !== false) return;

  throw new Error(RAG_INDEX_EXCLUDED_MESSAGE);
}

function guardRagIndexCommands(commands, { store, withPaperRagLock }) {
  for (const name of RAG_INDEX_WRITE_COMMANDS) {
    const original = commands[name];
    if (typeof original !== 'function') continue;

    commands[name] = async function guardedRagIndexWrite(args, event) {
      const request = args?.request;
      const documentKey = ragIndexDocumentKey(request);
      const write = () => original(args, event);
      if (!documentKey) return write();

      return withPaperRagLock(documentKey, async () => {
        assertPaperAllowsRagIndex(store, request);
        return write();
      });
    };
  }

  return commands;
}

function normalizeMembershipIds(paperIds) {
  if (!Array.isArray(paperIds)) {
    throw new Error('paperIds is required');
  }

  const ids = [];
  const seen = new Set();
  for (const raw of paperIds) {
    const id = cleanId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (ids.length === 0) {
    throw new Error('paperIds is required');
  }

  return ids;
}

async function setLibraryRagMembership({ store, ragStore, withPaperRagLock }, args = {}) {
  const request = args.request ?? {};
  if (typeof request.enabled !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }

  const paperIds = normalizeMembershipIds(request.paperIds);
  const missing = paperIds.filter((id) => !store.getPaper(id));
  if (missing.length > 0) {
    throw new Error(`Unknown paper ids: ${missing.join(', ')}`);
  }

  const enabled = request.enabled;
  const papers = [];
  const failures = [];

  for (const paperId of paperIds) {
    try {
      const result = await withPaperRagLock(paperId, async () => {
        if (!store.getPaper(paperId)) {
          throw new Error(`Unknown paper id: ${paperId}`);
        }

        store.setPapersRagEnabled([paperId], enabled);
        let removed = false;
        if (!enabled) {
          const removal = await Promise.resolve(ragStore.removeDocumentIndex({ documentKey: paperId }));
          removed = Boolean(removal?.removed);
        }

        return { paperId, enabled, removed };
      });
      papers.push(result);
    } catch (error) {
      failures.push({ paperId, error: errorMessage(error) });
    }
  }

  return { papers, failures };
}

function scheduleExcludedRagIndexReconciliation({ store, ragStore, withPaperRagLock }) {
  if (!ragStore?.available || typeof ragStore.removeDocumentIndex !== 'function') return;
  if (typeof store?.listRagDisabledPaperIds !== 'function') return;

  let ids = [];
  try {
    ids = store.listRagDisabledPaperIds();
  } catch (error) {
    console.warn('PaperQuay excluded RAG index reconciliation could not read papers.', error);
    return;
  }

  if (!Array.isArray(ids) || ids.length === 0) return;

  const batchSize = 50;
  void (async () => {
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      for (const paperId of batch) {
        await withPaperRagLock(paperId, async () => {
          const paper = store.getPaper(paperId);
          if (!paper || paper.ragEnabled !== false) return;
          await Promise.resolve(ragStore.removeDocumentIndex({ documentKey: paperId }));
        });
      }
    }
  })().catch((error) => {
    console.warn('PaperQuay excluded RAG index reconciliation did not finish.', error);
  });
}

module.exports = {
  RAG_INDEX_EXCLUDED_MESSAGE,
  assertPaperAllowsRagIndex,
  createPaperRagLock,
  guardRagIndexCommands,
  ragIndexDocumentKey,
  scheduleExcludedRagIndexReconciliation,
  setLibraryRagMembership,
};
