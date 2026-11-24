const fsp = require('node:fs/promises');
const path = require('node:path');
const { toError } = require('./utils.cjs');
const { buildFtsMatchQuery } = require('../../src/shared/ragQueryUtils.cjs');
const { rrfFuse } = require('../shared/ragSearch.cjs');
const schema = require('./rag/schema.cjs');
const indexing = require('./rag/indexing.cjs');
const retrieval = require('./rag/retrieval.cjs');
const runs = require('./rag/runs.cjs');

function createRagStore(appPaths, options = {}) {
  if (!appPaths?.ragDatabasePath) {
    throw new Error('ragDatabasePath is required');
  }

  let db = schema.openDatabase(appPaths.ragDatabasePath, {
    deferVectorBackfill: options.deferVectorBackfill === true,
  }, { backfillDocumentVectors: indexing.backfillDocumentVectors });
  let ftsAvailable = schema.initializeFtsSchema(db, { disabled: options.disableFts === true });
  let vectorBackfillClosed = false;

  function scheduleVectorBackfill() {
    const timer = setImmediate(() => {
      if (vectorBackfillClosed || !db.isOpen) {
        return;
      }

      try {
        const step = indexing.stepDocumentVectorBackfill(db, 8);
        if (!step.done) {
          scheduleVectorBackfill();
        }
      } catch (error) {
        console.warn('[paperquay] RAG document vector backfill paused.', toError(error));
      }
    });

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  if (!schema.readStoreMeta(db, schema.VECTOR_BACKFILL_META_KEY) && options.deferVectorBackfill !== true) {
    scheduleVectorBackfill();
  }

  return {
    appendAgentRunEvent(request) {
      return runs.appendAgentRunEvent(db, request);
    },
    clearAgentHistory() {
      return runs.clearAgentHistory(db);
    },
    close() {
      vectorBackfillClosed = true;
      if (db.isOpen) {
        db.close();
      }
    },
    createAgentRun(request) {
      return runs.createAgentRun(db, request);
    },
    finalizeDocumentIndex(request) {
      return indexing.finalizeDocumentIndex(db, request);
    },
    finishAgentRun(request) {
      return runs.finishAgentRun(db, request);
    },
    getAgentRun(request) {
      return runs.getAgentRun(db, request);
    },
    getAgentRunEvents(request) {
      return runs.getAgentRunEvents(db, request);
    },
    getChunkContext(request) {
      return retrieval.getChunkContext(db, request);
    },
    getDocumentIndexStatus(request) {
      return indexing.getDocumentIndexStatus(db, request);
    },
    stepVectorBackfill(limit = 8) {
      return indexing.stepDocumentVectorBackfill(db, limit);
    },
    vectorBackfillStatus() {
      return indexing.documentVectorBackfillStatus(db);
    },
    indexDocument(request) {
      return indexing.indexDocument(db, request);
    },
    isFtsAvailable() {
      return ftsAvailable;
    },
    listAgentRunUsageBySession(request) {
      return runs.listAgentRunUsageBySession(db, request);
    },
    listDocumentSimilarities(request) {
      return retrieval.listDocumentSimilarities(db, request);
    },
    listIndexedChunkIds(request) {
      return indexing.listIndexedChunkIds(db, request);
    },
    listIndexStatuses() {
      return indexing.listIndexStatuses(db);
    },
    listInterruptedAgentRuns(request) {
      return runs.listInterruptedAgentRuns(db, request);
    },
    migrateFromLibraryRagIndexes(ragIndexes) {
      return indexing.migrateFromLibraryRagIndexes(db, ragIndexes);
    },
    reportFailure(request) {
      return indexing.reportFailure(db, request);
    },
    retrieveDocumentChunks(request) {
      return retrieval.retrieveDocumentChunks(db, request, ftsAvailable);
    },
    retrieveNoteVectors(request) {
      return retrieval.retrieveNoteVectors(db, request);
    },
    removeNoteIndex(request) {
      return indexing.removeNoteIndex(db, request);
    },
    removeDocumentIndex(request) {
      return indexing.removeDocumentIndex(db, request);
    },
    snapshotTo(targetPath) {
      return schema.snapshotTo(db, targetPath);
    },
    async replaceWithSnapshot(snapshotPath) {
      const replacementPath = `${appPaths.ragDatabasePath}.restore-${Date.now()}.tmp`;
      await fsp.mkdir(path.dirname(appPaths.ragDatabasePath), { recursive: true });
      await fsp.copyFile(snapshotPath, replacementPath);

      if (db.isOpen) db.close();

      try {
        await fsp.rm(appPaths.ragDatabasePath, { force: true });
        await fsp.rm(`${appPaths.ragDatabasePath}-wal`, { force: true });
        await fsp.rm(`${appPaths.ragDatabasePath}-shm`, { force: true });
        await fsp.rename(replacementPath, appPaths.ragDatabasePath);
      } finally {
        await fsp.rm(replacementPath, { force: true }).catch(() => {});
        db = schema.openDatabase(appPaths.ragDatabasePath, {
          deferVectorBackfill: options.deferVectorBackfill === true,
        }, { backfillDocumentVectors: indexing.backfillDocumentVectors });
        ftsAvailable = schema.initializeFtsSchema(db, { disabled: options.disableFts === true });
        if (!schema.readStoreMeta(db, schema.VECTOR_BACKFILL_META_KEY) && options.deferVectorBackfill !== true) {
          scheduleVectorBackfill();
        }
      }
    },
  };
}

module.exports = { buildFtsMatchQuery, createRagStore, rrfFuse };
