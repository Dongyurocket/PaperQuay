const { createAiCommands } = require('./backend/aiCommands.cjs');
const { createAppSettingsCommands } = require('./backend/appSettingsCommands.cjs');
const { createAppSettingsStore } = require('./backend/appSettings.cjs');
const { createBackupCommands } = require('./backend/backupCommands.cjs');
const { cleanupLegacyBackupSettings } = require('./backend/legacyBackupCleanup.cjs');
const { createAppPaths, createLibraryStore } = require('./backend/libraryStore.cjs');
const { createFileCommands } = require('./backend/fileCommands.cjs');
const { createIntegrationCommands } = require('./backend/integrationCommands.cjs');
const { createKnowledgeGraphCommands } = require('./backend/knowledgeGraphCommands.cjs');
const { createLibraryCommands } = require('./backend/libraryCommands.cjs');
const { createMcpClientConfigCommands } = require('./backend/mcpClientConfig.cjs');
const { createMineruCacheCommands } = require('./backend/mineruCacheCommands.cjs');
const { createNoteCommands } = require('./backend/noteCommands.cjs');
const { createNoteStore } = require('./backend/noteStore.cjs');
const { createNoteVault } = require('./backend/noteVault.cjs');
const { createPdfMetadataCommands } = require('./backend/pdfMetadataCommands.cjs');
const { createRetainPdfIntegration } = require('./backend/retainPdfIntegration.cjs');
const { cleanupRetiredAgentData } = require('./backend/agentRetiredCleanup.cjs');
const { createUpdateCommands } = require('./backend/updateCommands.cjs');
const { externalWriteRevisions, readExternalWriteMarker } = require('./backend/externalWriteMarker.cjs');
const { perfMark, perfMeasure } = require('./perfTrace.cjs');
const { validateIpcArgs, validateIpcResult } = require('./ipcCommandRegistry.cjs');
const {
  createPaperRagLock,
  guardRagIndexCommands,
  scheduleExcludedRagIndexReconciliation,
  setLibraryRagMembership,
} = require('./backend/ragMembership.cjs');

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 单一 `paperquay:invoke` 通道的调用包装（D1-14）：先查 handler，再按注册表
 * 校验 args，最后才执行。result 校验默认关闭，只在 PAPERQUAY_VALIDATE_IPC_RESULTS=1
 * 时启用，避免历史命令的宽松返回形状把线上调用变成硬失败。
 */
function createCommandInvoker(commands) {
  return async function invoke(command, args, event) {
    const handler = commands[command];

    if (!handler) {
      throw new Error(`Unsupported Electron command: ${command}`);
    }

    const normalizedArgs = args ?? {};
    validateIpcArgs(command, normalizedArgs);

    const result = await handler(normalizedArgs, event);

    if (process.env.PAPERQUAY_VALIDATE_IPC_RESULTS === '1') {
      validateIpcResult(command, result);
    }

    return result;
  };
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
    getChunkContext: fail,
    createAgentRun: fail,
    appendAgentRunEvent: fail,
    finishAgentRun: fail,
    getAgentRun: fail,
    getAgentRunEvents: fail,
    listInterruptedAgentRuns: fail,
    listAgentRunUsageBySession: fail,
    snapshotTo: fail,
    replaceWithSnapshot: fail,
    removeDocumentIndex: fail,
  };
}

function createInProcessRagStore(appPaths) {
  const { createRagStore } = require('./backend/ragStore.cjs');
  return {
    available: true,
    execution: 'in-process',
    ...createRagStore(appPaths),
  };
}

function createRagStoreSafely(appPaths) {
  if (process.env.PAPERQUAY_RAG_INPROCESS === '1') {
    try {
      return createInProcessRagStore(appPaths);
    } catch (error) {
      console.error('[paperquay] Local RAG storage failed to initialize', error);
      return createUnavailableRagStore(error);
    }
  }

  try {
    const { createRagWorkerStore } = require('./backend/ragWorkerHost.cjs');
    return createRagWorkerStore(appPaths);
  } catch (error) {
    console.error('[paperquay] RAG worker failed to start; falling back to the main process.', error);
    try {
      return createInProcessRagStore(appPaths);
    } catch (fallbackError) {
      console.error('[paperquay] Local RAG storage failed to initialize', fallbackError);
      return createUnavailableRagStore(fallbackError);
    }
  }
}

function createBackend({ app }) {
  perfMark('backend:init-start');
  const appPaths = createAppPaths(app);
  cleanupLegacyBackupSettings(appPaths.libraryDatabasePath);
  const store = createLibraryStore(appPaths);
  const appSettings = createAppSettingsStore({
    appPaths,
    legacyZoteroDir: () => store.loadSettings().zoteroLocalDataDir,
  });
  perfMeasure('backend:init library-store', 'backend:init-start');
  const { createPathPolicy } = require('./backend/pathPolicy.cjs');
  const approvedReadPaths = new Set();
  const approvedWritePaths = new Set();
  const pathPolicy = createPathPolicy({
    appPaths,
    store,
    approvedReadPaths,
    approvedWritePaths,
  });
  const noteStore = createNoteStore(appPaths);
  perfMeasure('backend:init note-store', 'backend:init-start');
  const ragStore = createRagStoreSafely(appPaths);
  perfMeasure('backend:init rag-store', 'backend:init-start');
  try {
    const agentCleanup = cleanupRetiredAgentData(appPaths, { ragStore });
    if (!agentCleanup.alreadyDone) {
      console.info('[paperquay] Retired agent data cleaned.', {
        memoryFilesRemoved: agentCleanup.memoryFilesRemoved,
        runsRemoved: agentCleanup.runsRemoved,
        eventsRemoved: agentCleanup.eventsRemoved,
      });
    }
  } catch (error) {
    console.warn('[paperquay] Retired agent data cleanup failed; it will retry on next launch.', error);
  }
  const legacyRagIndexes = store.loadLegacyRagIndexes();

  if (ragStore.available && Object.keys(legacyRagIndexes).length > 0) {
    // 迁移在 RAG 执行单元的队列里继续，不挡住窗口。失败时保留旧 JSON，下次启动再试。
    Promise.resolve(ragStore.migrateFromLibraryRagIndexes(legacyRagIndexes))
      .then((migration) => {
        perfMeasure('backend:init legacy-rag-migration', 'backend:init-start');
        if (migration?.failedCount === 0) {
          store.clearLegacyRagIndexesSync();
        } else {
          console.warn('PaperQuay legacy RAG index migration had failures; legacy JSON indexes were kept for retry.', migration);
        }
      })
      .catch((error) => {
        console.warn('PaperQuay legacy RAG index migration did not finish; legacy JSON indexes were kept.', error);
      });
  }

  const context = {
    app,
    appPaths,
    appSettings,
    noteStore,
    approvedReadPaths,
    approvedWritePaths,
    pathPolicy,
    ragStore,
    store,
  };
  context.noteVault = createNoteVault(context);
  const { createNoteIndexer } = require('./backend/noteEmbedding.cjs');
  if (!ragStore.indexNote) {
    ragStore.indexNote = (request) => require('./backend/noteEmbedding.cjs').indexNote(ragStore, request);
  }
  context.noteIndexer = createNoteIndexer(context);
  noteStore.setMutationListener(context.noteIndexer.enqueue);
  const fileCommands = createFileCommands(context);
  context.fileCommands = fileCommands;

  const paperRagLock = createPaperRagLock();
  let closePromise = null;
  function closeBackend({ ragCloseTimeoutMs = null } = {}) {
    if (closePromise) return closePromise;
    context.noteIndexer.close();
    noteStore.close();
    store.close();
    // RAG 执行单元可能是 worker 线程：在剩余退出预算内等待它关闭，
    // 超时由 ragWorkerHost 直接终止线程，避免只靠外层 3 秒强制退出。
    closePromise = Promise.resolve()
      .then(() => (
        ragCloseTimeoutMs === null
          ? ragStore.close()
          : ragStore.close({ timeoutMs: ragCloseTimeoutMs })
      ))
      .then((result) => ({ timedOut: Boolean(result?.timedOut) }))
      .catch((error) => {
        console.warn('[paperquay] RAG store close failed.', error);
        return { timedOut: false, failed: true };
      });
    return closePromise;
  }

  const commands = {
    ...fileCommands,
    ...createAppSettingsCommands(context),
    ...createMineruCacheCommands(context),
    ...createLibraryCommands(context),
    ...createNoteCommands(context),
    ...createPdfMetadataCommands(context),
    ...createAiCommands(context),
    ...createKnowledgeGraphCommands(context),
    ...createBackupCommands(context),
    ...createIntegrationCommands(context),
    ...createUpdateCommands(context),
    ...createMcpClientConfigCommands(context),
    ...createRetainPdfIntegration(context),
    ...require('./backend/secretStorage.cjs').createConfigSecretCommands(context),
  };
  guardRagIndexCommands(commands, {
    store,
    withPaperRagLock: paperRagLock.withPaperRagLock,
  });
  commands.external_write_state = () => externalWriteRevisions(
    readExternalWriteMarker(appPaths.dataDir).state,
  );
  commands.library_set_rag_membership = (args) => setLibraryRagMembership({
    store,
    ragStore,
    withPaperRagLock: paperRagLock.withPaperRagLock,
  }, args);
  scheduleExcludedRagIndexReconciliation({
    store,
    ragStore,
    withPaperRagLock: paperRagLock.withPaperRagLock,
  });

  return {
    appPaths,
    pathPolicy,
    // 供 preload 在真实文件拖放后登记读权限（渲染层拿不到这个入口）。
    approveReadPath(filePath) {
      pathPolicy.approveReadPath(filePath);
    },
    close: closeBackend,
    /**
     * Quit path: stop accepting note work, wait (bounded) for the queue to drain,
     * then tear down the stores. Returns the drain summary for logging.
     */
    async shutdown({ timeoutMs = 2500 } = {}) {
      const budget = Math.max(0, Number(timeoutMs) || 0);
      const deadline = budget > 0 ? Date.now() + budget : Number.POSITIVE_INFINITY;
      let drained = { drained: true, timedOut: false, pending: 0 };
      try {
        drained = await context.noteIndexer.closeWhenIdle({ timeoutMs: budget });
      } catch (error) {
        console.warn('[paperquay] Note index drain before shutdown failed.', error);
      }
      const remaining = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : null;
      const closeResult = await closeBackend({ ragCloseTimeoutMs: remaining });
      return {
        ...drained,
        ragStoreClosed: !closeResult?.timedOut && !closeResult?.failed,
        ragStoreCloseTimedOut: Boolean(closeResult?.timedOut),
      };
    },
    invoke: createCommandInvoker(commands),
  };
}

module.exports = { createBackend, createCommandInvoker };
