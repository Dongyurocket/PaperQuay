const { createAiCommands } = require('./backend/aiCommands.cjs');
const { createAgentMemoryStore } = require('./backend/agentMemoryStore.cjs');
const { createAppPaths, createLibraryStore } = require('./backend/libraryStore.cjs');
const { createFileCommands } = require('./backend/fileCommands.cjs');
const { createIntegrationCommands } = require('./backend/integrationCommands.cjs');
const { createKnowledgeGraphCommands } = require('./backend/knowledgeGraphCommands.cjs');
const { createLibraryCommands } = require('./backend/libraryCommands.cjs');
const { createMineruCacheCommands } = require('./backend/mineruCacheCommands.cjs');
const { createNoteCommands } = require('./backend/noteCommands.cjs');
const { createNoteStore } = require('./backend/noteStore.cjs');
const { createPaddleOcrCommands } = require('./backend/paddleOcrCommands.cjs');
const { createReviewCommands } = require('./backend/reviewCommands.cjs');
const { createUpdateCommands } = require('./backend/updateCommands.cjs');
const { perfMark, perfMeasure } = require('./perfTrace.cjs');

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function createUnavailableRagStore(error) {
  const message = toErrorMessage(error);
  const fail = () => {
    throw new Error(`Local RAG storage is unavailable: ${message}`);
  };

  return {
    available: false,
    initializationError: message,
    close() {},
    migrateFromLibraryRagIndexes(legacyRagIndexes = {}) {
      return {
        migratedCount: 0,
        failedCount: Object.keys(legacyRagIndexes).length,
        errors: Object.keys(legacyRagIndexes).map((key) => ({ key, error: message })),
      };
    },
    indexDocument: fail,
    reportFailure: fail,
    getDocumentIndexStatus: fail,
    listIndexStatuses: fail,
    retrieveDocumentChunks: fail,
    createAgentRun: fail,
    appendAgentRunEvent: fail,
    finishAgentRun: fail,
    getAgentRun: fail,
    getAgentRunEvents: fail,
    listInterruptedAgentRuns: fail,
    listAgentRunUsageBySession: fail,
    snapshotTo: fail,
    replaceWithSnapshot: fail,
  };
}

function createRagStoreSafely(appPaths) {
  try {
    const { createRagStore } = require('./backend/ragStore.cjs');
    const ragStore = createRagStore(appPaths);
    return {
      available: true,
      ...ragStore,
    };
  } catch (error) {
    console.error('[paperquay] Local RAG storage failed to initialize', error);
    return createUnavailableRagStore(error);
  }
}

function createBackend({ app }) {
  perfMark('backend:init-start');
  const appPaths = createAppPaths(app);
  const store = createLibraryStore(appPaths);
  perfMeasure('backend:init library-store', 'backend:init-start');
  const noteStore = createNoteStore(appPaths);
  perfMeasure('backend:init note-store', 'backend:init-start');
  const agentMemoryStore = createAgentMemoryStore(appPaths);
  perfMeasure('backend:init agent-memory-store', 'backend:init-start');
  const ragStore = createRagStoreSafely(appPaths);
  perfMeasure('backend:init rag-store', 'backend:init-start');
  const legacyRagIndexes = store.loadLegacyRagIndexes();

  if (ragStore.available && Object.keys(legacyRagIndexes).length > 0) {
    const migration = ragStore.migrateFromLibraryRagIndexes(legacyRagIndexes);
    perfMeasure('backend:init legacy-rag-migration', 'backend:init-start');

    if (migration.failedCount === 0) {
      store.clearLegacyRagIndexesSync();
    } else {
      console.warn('PaperQuay legacy RAG index migration had failures; legacy JSON indexes were kept for retry.', migration);
    }
  }

  const context = {
    app,
    appPaths,
    agentMemoryStore,
    noteStore,
    approvedWritePaths: new Set(),
    ragStore,
    store,
  };
  const fileCommands = createFileCommands(context);
  context.fileCommands = fileCommands;

  const commands = {
    ...fileCommands,
    ...createMineruCacheCommands(context),
    ...createPaddleOcrCommands(context),
    ...createLibraryCommands(context),
    ...createNoteCommands(context),
    ...createAiCommands(context),
    ...createKnowledgeGraphCommands(context),
    ...createIntegrationCommands(context),
    ...createReviewCommands(context),
    ...createUpdateCommands(context),
  };

  return {
    close() {
      noteStore.close();
      ragStore.close();
      store.close();
    },
    async invoke(command, args, event) {
      const handler = commands[command];

      if (!handler) {
        throw new Error(`Unsupported Electron command: ${command}`);
      }

      return handler(args ?? {}, event);
    },
  };
}

module.exports = { createBackend };
