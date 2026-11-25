const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { buildEmbeddingModelKey, resolveEmbeddingConfigFromDocument } = require('../../src/shared/embeddingConfig.cjs');
const { resolveReaderConfigSecrets } = require('./secretStorage.cjs');
const { applyRagStatusFilter } = require('./libraryRagStatusFilter.cjs');
const { resolveAttachmentFilters, invalidateAttachmentAvailability } = require('./libraryAttachmentAvailability.cjs');
const {
  paperMatches,
  sortPapers,
} = require('./libraryStore.cjs');
const {
  cleanString,
  ensureFile,
  fileNameFromPath,
  hashFile,
  id,
  isPdf,
  now,
  safeFileName,
} = require('./utils.cjs');
const {
  DEFAULT_JSON_MAX_BYTES,
  DEFAULT_JSON_TIMEOUT_MS,
  resolveLimit,
} = require('./httpIO.cjs');
const {
  resolveTranslatedPdfStorageDir,
} = require('./translatedPdfAttachments.cjs');
const { isRealManagedFilePath } = require('./pdfAssetGovernance.cjs');
const {
  findDuplicatePaper,
  buildImportedAttachmentFileName,
  applyPaperMetadataPatch,
  buildImportedPaperRecord,
} = require('../shared/libraryDomain.cjs');
const {
  createLibraryMetadataCommands,
  fetchCrossrefReferences,
} = require('./libraryMetadata.cjs');
const { createLibraryAttachmentCommands } = require('./libraryAttachments.cjs');
const { createLibraryCategoryCommands } = require('./libraryCategories.cjs');

const DEFAULT_PDF_IMPORT_MAX_BYTES = 512 * 1024 * 1024;

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function isSubPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathExists(filePath) {
  return fsp.access(filePath).then(() => true).catch(() => false);
}

async function copyFileIfNeeded(sourcePath, targetPath) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });

  if (await pathExists(targetPath)) {
    if ((await hashFile(sourcePath)) !== (await hashFile(targetPath))) {
      throw new Error(`Storage migration target contains different data: ${targetPath}`);
    }
    return false;
  }

  await fsp.copyFile(sourcePath, targetPath, require('node:fs').constants.COPYFILE_EXCL);
  return true;
}

async function migrateLibraryStorageDirectory(library, previousStorageDir, nextStorageDir) {
  const previousDir = cleanString(previousStorageDir);
  const targetDir = cleanString(nextStorageDir);

  if (!previousDir || !targetDir || isSamePath(previousDir, targetDir)) {
    return { copiedFiles: 0, updatedAttachments: 0, changedPaperIds: [] };
  }

  await fsp.mkdir(targetDir, { recursive: true });
  let copiedFiles = 0;
  let updatedAttachments = 0;
  const changedPaperIds = new Set();

  const canCopyWholeDirectory =
    !isSubPath(previousDir, targetDir) &&
    !isSubPath(targetDir, previousDir);

  if (canCopyWholeDirectory && await pathExists(previousDir)) {
    await fsp.cp(previousDir, targetDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }

  for (const paper of library.papers) {
    for (const attachment of paper.attachments ?? []) {
      if (!attachment?.storedPath) {
        continue;
      }

      const storedPath = attachment.storedPath;
      const relativePath = cleanString(attachment.relativePath) ||
        (isSubPath(previousDir, storedPath) ? path.relative(previousDir, storedPath) : '');

      if (!relativePath || !isSubPath(previousDir, storedPath)) {
        continue;
      }

      const nextPath = path.join(targetDir, relativePath);

      if (!isSamePath(storedPath, nextPath)) {
        if (await pathExists(storedPath)) {
          copiedFiles += await copyFileIfNeeded(storedPath, nextPath) ? 1 : 0;
        }

        attachment.storedPath = nextPath;
        attachment.relativePath = relativePath;
        attachment.fileName = attachment.fileName || fileNameFromPath(nextPath);
        attachment.missing = !(await pathExists(nextPath));
        updatedAttachments += 1;
        paper.updatedAt = now();
        changedPaperIds.add(paper.id);
      }
    }
  }

  return { copiedFiles, updatedAttachments, changedPaperIds: [...changedPaperIds] };
}

async function migrateTranslatedPdfDirectory(library, previousDir, nextDir, storageDir) {
  const prev = cleanString(previousDir);
  const next = cleanString(nextDir);

  if (!prev || !next || isSamePath(prev, next)) {
    return { copiedFiles: 0, updatedAttachments: 0, changedPaperIds: [] };
  }

  await fsp.mkdir(next, { recursive: true });
  let copiedFiles = 0;
  let updatedAttachments = 0;
  const changedPaperIds = new Set();

  for (const paper of library.papers) {
    for (const attachment of paper.attachments ?? []) {
      if (attachment?.kind !== 'translated-pdf' || !attachment?.storedPath) {
        continue;
      }

      const storedPath = attachment.storedPath;
      if (!isSubPath(prev, storedPath) && !isSamePath(path.dirname(storedPath), prev)) {
        continue;
      }

      const fileName = fileNameFromPath(storedPath);
      const nextPath = path.join(next, fileName);

      if (!isSamePath(storedPath, nextPath)) {
        if (await pathExists(storedPath)) {
          copiedFiles += (await copyFileIfNeeded(storedPath, nextPath)) ? 1 : 0;
        }

        attachment.storedPath = nextPath;
        if (storageDir && isSubPath(storageDir, nextPath)) {
          attachment.relativePath = path.relative(storageDir, nextPath).replace(/\\/g, '/');
        } else {
          attachment.relativePath = null;
        }
        attachment.fileName = attachment.fileName || fileName;
        attachment.missing = !(await pathExists(nextPath));
        updatedAttachments += 1;
        paper.updatedAt = now();
        changedPaperIds.add(paper.id);
      }
    }
  }

  return { copiedFiles, updatedAttachments, changedPaperIds: [...changedPaperIds] };
}

function createLibraryCommands(context) {
  const { appPaths, appSettings, pathPolicy, ragStore, store } = context;
  const httpLimits = {
    timeoutMs: resolveLimit(context.httpLimits?.metadataTimeoutMs, DEFAULT_JSON_TIMEOUT_MS),
    maxBytes: resolveLimit(context.httpLimits?.metadataMaxBytes, DEFAULT_JSON_MAX_BYTES),
  };
  const maxImportBytes = resolveLimit(context.importLimits?.maxPdfBytes, DEFAULT_PDF_IMPORT_MAX_BYTES);
  // RAG 状态行数百条，按状态筛选时可能被翻页/输入反复读取；2 秒 TTL 足够
  // 掩盖连续查询，又不会让索引完成后的筛选明显滞后。
  const ragStatusCache = { at: 0, statuses: null };

  const resolveRagEmbeddingModelKey = () => {
    try {
      const raw = JSON.parse(fs.readFileSync(appPaths.configPath, 'utf8'));
      const config = resolveEmbeddingConfigFromDocument({
        settings: raw.settings || {},
        secrets: resolveReaderConfigSecrets(raw, appPaths) || {},
      }, { requireApiKey: false });
      return config ? buildEmbeddingModelKey(config) : null;
    } catch {
      return null;
    }
  };

  const readRagStatuses = async () => {
    if (!ragStore || ragStore.available === false || typeof ragStore.listIndexStatuses !== 'function') {
      return null;
    }
    const nowMs = Date.now();
    if (ragStatusCache.statuses && nowMs - ragStatusCache.at < 2000) {
      return ragStatusCache.statuses;
    }
    try {
      const statuses = await ragStore.listIndexStatuses();
      ragStatusCache.statuses = Array.isArray(statuses) ? statuses : [];
      ragStatusCache.at = nowMs;
      return ragStatusCache.statuses;
    } catch (error) {
      console.warn('[paperquay] Failed to read RAG index statuses for library filtering.', error);
      return null;
    }
  };

  /** 只在实际带了 ragStatus 时读 RAG 库；普通列表查询不受影响。 */
  const withRagStatusFilter = async (request) => {
    if (!request || request.ragStatus == null) return request;
    const snapshot = typeof store.listRagStatusSnapshot === 'function'
      ? store.listRagStatusSnapshot()
      : [];
    const statuses = await readRagStatuses();
    return applyRagStatusFilter(request, {
      papers: snapshot,
      statuses,
      ragAvailable: statuses !== null,
      embeddingModelKey: resolveRagEmbeddingModelKey(),
    });
  };

  /**
   * storageDir/translatedPdfDir 会成为 pathPolicy 的信任根，不能由渲染层
   * 直接改成任意目录；新目录必须已通过目录对话框授权（或位于 dataDir 内）。
   */
  const assertSettingsPathAllowed = (nextValue, previousValue, mode) => {
    const next = cleanString(nextValue);
    const previous = cleanString(previousValue);
    if (!next || next === previous || !pathPolicy) return;

    const allowed = mode === 'write'
      ? pathPolicy.isWriteAllowed(next)
      : pathPolicy.isReadAllowed(next);
    if (!allowed) {
      throw new Error(`Settings path is not allowed without a directory picker: ${next}`);
    }
  };

  /**
   * zoteroLocalDataDir 的唯一所有者是应用设置文档；library_settings 只作为
   * 旧版本兼容镜像。读取时始终覆盖为规范值，避免两份值漂移。
   */
  const withCanonicalZoteroDir = (settings) => {
    if (!appSettings || !settings) return settings;
    try {
      const canonical = appSettings.getPublic().zoteroLocalDataDir;
      if (!canonical) return settings;
      return { ...settings, zoteroLocalDataDir: canonical };
    } catch {
      return settings;
    }
  };

  const resolvePaperRequest = async (request, library) => {
    if (!['hasPdf', 'hasTranslatedPdf', 'missingFile'].some((key) => typeof request[key] === 'boolean')) {
      return { request, applyToPapers: (papers) => papers };
    }
    if (library) {
      return resolveAttachmentFilters(request, library, {
        cache: context.attachmentAvailabilityCache,
      });
    }
    // 附件筛选只需 paper id + 附件行；不要为了 stat 水合整个文库。
    const { paperIds, attachments } = store.listAttachmentFilterSnapshot();
    const attachmentsByPaper = new Map();
    for (const attachment of attachments) {
      const list = attachmentsByPaper.get(attachment.paperId);
      if (list) list.push(attachment);
      else attachmentsByPaper.set(attachment.paperId, [attachment]);
    }
    return resolveAttachmentFilters(request, {
      settings: store.loadSettings(),
      papers: paperIds.map((id) => ({ id, attachments: attachmentsByPaper.get(id) ?? [] })),
    }, {
      cache: context.attachmentAvailabilityCache,
    });
  };

  const commands = {
    ...createLibraryMetadataCommands({ store, httpLimits }),
    ...createLibraryAttachmentCommands({ appPaths, pathPolicy, store }),
    ...createLibraryCategoryCommands({ store }),

    async library_init() {
      // 首屏只返回设置与分类计数；文献列表由 library_query_papers 分页拉取，
      // 避免启动时把整库（含作者/标签/附件/摘要）水合进渲染进程。
      return {
        settings: withCanonicalZoteroDir(store.loadSettings()),
        categories: store.listCategoriesWithCounts(),
      };
    },

    async library_get_settings() {
      return withCanonicalZoteroDir(store.load().settings);
    },

    async library_update_settings({ settings }) {
      const library = store.load();
      const previousStorageDir = library.settings.storageDir;
      const previousTranslatedDir = resolveTranslatedPdfStorageDir(library.settings, appPaths);

      assertSettingsPathAllowed(settings.storageDir, previousStorageDir, 'write');
      assertSettingsPathAllowed(settings.translatedPdfDir, library.settings.translatedPdfDir, 'write');

      if (appSettings && Object.prototype.hasOwnProperty.call(settings, 'zoteroLocalDataDir')) {
        try {
          const currentRevision = appSettings.getPublic().revision;
          const zoteroResult = appSettings.patchZoteroDir(settings.zoteroLocalDataDir, {
            expectedRevision: currentRevision,
          });
          if (!zoteroResult.ok) {
            throw new Error(zoteroResult.message || 'Failed to update the Zotero data directory');
          }
          settings = { ...settings, zoteroLocalDataDir: zoteroResult.zoteroLocalDataDir };
        } catch (error) {
          // 设置文档损坏时不阻断文库设置保存；下次启动会继续提示修复。
          console.warn('[paperquay] Failed to persist the Zotero data directory in app settings.', error);
        }
      }

      library.settings = {
        ...library.settings,
        ...settings,
        importMode: settings.importMode || library.settings.importMode,
      };
      const nextStorageDir = library.settings.storageDir;
      const nextTranslatedDir = resolveTranslatedPdfStorageDir(library.settings, appPaths);
      const changedPaperIds = new Set();

      if (nextStorageDir) {
        const migration = await migrateLibraryStorageDirectory(
          library,
          previousStorageDir,
          nextStorageDir,
        );
        for (const paperId of migration.changedPaperIds) changedPaperIds.add(paperId);
        await fsp.mkdir(nextStorageDir, { recursive: true });
      }

      if (!isSamePath(previousTranslatedDir, nextTranslatedDir)) {
        const migration = await migrateTranslatedPdfDirectory(
          library,
          previousTranslatedDir,
          nextTranslatedDir,
          nextStorageDir,
        );
        for (const paperId of migration.changedPaperIds) changedPaperIds.add(paperId);
      }

      // 只写 library_settings 与被迁移改写过附件路径的文献；不再整库
      // DELETE + 重插，避免覆盖并发的桌面/MCP 写入。
      await store.saveSettings(library.settings);
      for (const paperId of changedPaperIds) {
        const paper = library.papers.find((item) => item.id === paperId);
        if (paper) store.savePaper(paper);
      }
      if (changedPaperIds.size > 0) invalidateAttachmentAvailability();
      return library.settings;
    },

    async library_list_tags() {
      return store.listTags();
    },

    /** 详情表单的 citationKey 查重索引（只返回 id + key，不水合整库）。 */
    async library_list_citation_keys() {
      return store.listCitationKeys();
    },

    async library_list_papers({ request = {} }) {
      const library = store.load();
      const resolved = await resolvePaperRequest(await withRagStatusFilter(request), library);
      const limit = Math.max(1, Math.min(5000, resolved.request.limit ?? 300));
      return resolved.applyToPapers(sortPapers(library.papers.filter((paper) => paperMatches(paper, resolved.request, library)), resolved.request).slice(0, limit));
    },

    /**
     * SQL 分页查询（P2-1）：筛选/搜索/排序/分页下推到 SQLite，返回
     * { papers, total, offset, limit }；total 为当前筛选的完整匹配数，不受分页限制。
     */
    async library_query_papers({ request = {} }) {
      const resolved = await resolvePaperRequest(await withRagStatusFilter(request));
      const result = store.queryPapers(resolved.request);
      return { ...result, papers: resolved.applyToPapers(result.papers) };
    },

    /** 单条文献查询：跨文献跳转不受 library_list_papers 的 1000 条截断影响。 */
    async library_get_paper({ paperId }) {
      const idValue = cleanString(paperId);
      if (!idValue) return null;
      return store.getPaper(idValue);
    },

    /** 单篇列表摘要：阅读进度/收藏等增量刷新只取列表字段，不返回正文大字段。 */
    async library_get_paper_summary({ paperId }) {
      const idValue = cleanString(paperId);
      if (!idValue) return null;
      return store.getPaperSummary(idValue);
    },

    /**
     * 批量收藏/移动分类：一个命令、一个事务，避免全选后逐篇 IPC。
     * 任一条目失败时整批回滚（与单篇命令相同的版本/存在性校验）。
     */
    async library_batch_update_papers({ request = {} }) {
      const paperIds = [...new Set((Array.isArray(request.paperIds) ? request.paperIds : [])
        .map(cleanString)
        .filter(Boolean))];
      if (paperIds.length === 0) return { papers: [], updated: 0 };

      const favorite = typeof request.isFavorite === 'boolean' ? request.isFavorite : undefined;
      const addCategoryId = cleanString(request.addCategoryId);
      if (favorite === undefined && !addCategoryId) {
        throw new Error('isFavorite or addCategoryId is required');
      }
      if (addCategoryId) {
        const category = store.getCategory(addCategoryId);
        if (!category || category.isSystem) {
          throw new Error(`Invalid user category: ${addCategoryId}`);
        }
      }

      const papers = store.applyPaperChanges({
        requireVersion: false,
        changes: paperIds.map((paperId) => ({
          paperId,
          change(paper) {
            if (favorite !== undefined) paper.isFavorite = favorite;
            if (addCategoryId && !paper.categoryIds.includes(addCategoryId)) {
              paper.categoryIds.push(addCategoryId);
            }
          },
        })),
      });
      return { papers, updated: papers.length };
    },

    /**
     * 批量删除：先算出可安全清理的托管文件，再在单事务里删除记录，最后清理文件
     * 与 RAG 索引。事务失败时文件尚未删除（不会出现“记录还在、PDF 已没了”）；
     * 文件删除与 RAG 清理是 best-effort，失败只上报不回滚文献删除。
     */
    async library_batch_delete_papers({ request = {} }) {
      const paperIds = [...new Set((Array.isArray(request.paperIds) ? request.paperIds : [])
        .map(cleanString)
        .filter(Boolean))];
      if (paperIds.length === 0) return { deleted: 0, ragFailures: [], fileFailures: [] };

      const papers = paperIds.map((paperId) => store.getPaper(paperId)).filter(Boolean);
      const managedFiles = [];

      // 共享附件判断必须在删除前完成：删除后再查 references 永远为空。
      if (request.deleteFiles && papers.length > 0) {
        const settings = store.loadSettings();
        for (const paper of papers) {
          for (const attachment of paper.attachments) {
            const references = store.findAttachmentsByStoredPath(attachment.storedPath);
            const shared = references.some((entry) => entry.paperId !== paper.id || entry.id !== attachment.id);
            if (!shared && await isRealManagedFilePath(attachment.storedPath, settings)) {
              managedFiles.push(attachment.storedPath);
            }
          }
        }
      }

      const deleted = store.deletePapers(paperIds);
      invalidateAttachmentAvailability();

      const fileFailures = [];
      for (const filePath of managedFiles) {
        try {
          await fsp.rm(filePath, { force: true });
        } catch (error) {
          fileFailures.push({
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const ragFailures = [];
      if (ragStore && typeof ragStore.removeDocumentIndex === 'function') {
        for (const paper of papers) {
          try {
            await ragStore.removeDocumentIndex({ documentKey: paper.id });
          } catch (error) {
            ragFailures.push({
              paperId: paper.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      return { deleted, ragFailures, fileFailures };
    },

    /** 与 library_query_papers 同筛选同排序，仅分批枚举 id（供全选/批量目标管理，P2-2）。 */
    async library_list_paper_ids({ request = {} }) {
      const resolved = await resolvePaperRequest(await withRagStatusFilter(request));
      return store.listPaperIds(resolved.request);
    },

    /** 当前筛选的完整匹配计数（供全选三态与批量目标校验，P2-2）。 */
    async library_count_papers({ request = {} }) {
      const resolved = await resolvePaperRequest(await withRagStatusFilter(request));
      return store.countPapers(resolved.request);
    },

    async library_reorder_papers({ request }) {
      const library = store.load();
      const order = new Map((request.paperIds ?? []).map((paperId, index) => [paperId, index]));
      const updates = [];
      for (const paper of library.papers) {
        if (order.has(paper.id)) {
          updates.push({ paperId: paper.id, sortOrder: order.get(paper.id) });
        }
      }
      store.savePaperSortOrders(updates);
    },

    async library_import_pdfs({ request }) {
      if (request.source != null && request.source !== 'local' && request.source !== 'zotero') {
        throw new Error('Invalid import source');
      }
      const library = store.load();
      const results = [];
      const moveSourcesAfterCommit = [];
      const storageDir = library.settings.storageDir || path.join(appPaths.dataDir, 'paperquay-data');
      await fsp.mkdir(storageDir, { recursive: true });

      for (const sourcePath of request.paths ?? []) {
        const normalizedSourcePath = path.resolve(cleanString(sourcePath));
        try {
          if (!isPdf(normalizedSourcePath)) throw new Error('Only PDF files can be imported');
          // 只允许导入文库/缓存/Zotero 目录或用户通过对话框、拖放显式选择的 PDF。
          if (pathPolicy && !pathPolicy.isReadAllowed(normalizedSourcePath)) {
            throw new Error(`Import source is outside the allowed paths: ${normalizedSourcePath}`);
          }
          await ensureFile(normalizedSourcePath);
          const sourceStat = await fsp.stat(normalizedSourcePath);
          if (sourceStat.size > maxImportBytes) {
            throw new Error(
              `PDF exceeds the import size limit (${maxImportBytes} bytes): ${normalizedSourcePath}`,
            );
          }
          const contentHash = await hashFile(normalizedSourcePath);
          const metadata = request.metadata?.[sourcePath] ?? {};
          const duplicateMatch = findDuplicatePaper({
            papers: library.papers,
            contentHash,
            doi: metadata.doi,
            title: metadata.title,
          });

          if (duplicateMatch) {
            results.push({
              sourcePath,
              paper: duplicateMatch.paper,
              duplicated: true,
              existingPaperId: duplicateMatch.paper.id,
              status: 'duplicate',
              message: 'Duplicate PDF',
            });
            continue;
          }

          const paperId = id('paper');
          const originalFileName = safeFileName(fileNameFromPath(normalizedSourcePath));
          const attachmentId = id('att');
          const fileName = originalFileName;
          let storedPath = normalizedSourcePath;
          let relativePath = null;
          const importMode = request.importMode || library.settings.importMode;

          if (importMode !== 'keep') {
            const storedName = buildImportedAttachmentFileName({
              settings: library.settings,
              paperId,
              attachmentId,
              fileName,
              metadata,
            });
            storedPath = path.join(storageDir, storedName);
            if (await pathExists(storedPath)) throw new Error(`PDF destination already exists: ${storedPath}`);
            await fsp.copyFile(normalizedSourcePath, storedPath, require('node:fs').constants.COPYFILE_EXCL);
            if (importMode === 'move') moveSourcesAfterCommit.push(normalizedSourcePath);
            relativePath = path.relative(storageDir, storedPath);
          }

          const stat = await fsp.stat(storedPath);
          const paper = buildImportedPaperRecord({
            paperId,
            attachmentId,
            metadata,
            source: request.source === 'zotero' ? 'zotero' : 'local',
            sortOrder: Math.min(0, ...library.papers.map((item) => item.sortOrder ?? 0)) - 1,
            categoryIds: request.targetCategoryId ? [request.targetCategoryId] : [],
            attachment: {
              originalPath: normalizedSourcePath,
              storedPath,
              relativePath,
              fileName,
              fileSize: stat.size,
              contentHash,
            },
          });
          library.papers.push(paper);
          results.push({ sourcePath, paper, duplicated: false, existingPaperId: null, status: 'imported', message: 'Imported' });
        } catch (error) {
          results.push({ sourcePath, paper: null, duplicated: false, existingPaperId: null, status: 'failed', message: error instanceof Error ? error.message : String(error) });
        }
      }

      // 只插入本次新增的文献；已有记录与设置保持不动。
      for (const result of results) {
        if (result.status === 'imported' && result.paper) {
          store.savePaper(result.paper);
        }
      }
      for (const sourcePath of moveSourcesAfterCommit) {
        await fsp.rm(sourcePath, { force: true }).catch((error) => {
          console.warn(`[PaperQuay] Imported file is stored but the original could not be removed: ${sourcePath}`, error);
        });
      }
      if (results.some((result) => result.status === 'imported')) invalidateAttachmentAvailability();
      for (const result of results) {
        const paper = result.status === 'imported' ? result.paper : null;
        if (!paper?.id || !paper.doi) {
          continue;
        }

        fetchCrossrefReferences(paper.doi, paper.id, httpLimits)
          .then((refs) => {
            if (refs.length > 0) {
              store.saveReferences(paper.id, refs);
            }
          })
          .catch((error) => {
            console.warn(`[PaperQuay] Failed to fetch Crossref references for imported paper ${paper.id}: ${error instanceof Error ? error.message : String(error)}`);
          });
      }
      return results;
    },

    async library_record_reading({ request }) {
      const paperId = cleanString(request?.paperId);
      const timestamp = request?.lastReadAt;
      const progress = request?.readingProgress;
      if (!paperId || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now() + 60_000) {
        throw new Error('Invalid reading timestamp or paper ID');
      }
      if (progress != null && (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1)) {
        throw new Error('Invalid reading progress');
      }
      return store.recordPaperReading(paperId, timestamp, progress ?? 0);
    },

    async library_update_paper({ request }) {
      // 与 MCP update_paper 共用同一套字段白名单/规范化；language: '' 与 null 均清空。
      const updatePaperFields = (paper) => applyPaperMetadataPatch(paper, request);

      // 详情表单携带读取时的版本：外部（MCP/其他窗口）已更新则拒绝，由界面提示重载或覆盖。
      const expectedUpdatedAt = request.expectedUpdatedAt;
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== null) {
        return store.applyPaperChange({
          paperId: request.paperId,
          expectedUpdatedAt,
          requireVersion: true,
          change(paper) {
            updatePaperFields(paper);
          },
        });
      }

      const paper = store.getPaper(request.paperId);
      if (!paper) throw new Error('Paper does not exist');
      updatePaperFields(paper);
      paper.updatedAt = Math.max(now(), Number(paper.updatedAt || 0) + 1);
      store.savePaper(paper);
      return paper;
    },

    async library_delete_paper({ request }) {
      const paper = store.getPaper(request.paperId);

      if (request.deleteFiles && paper) {
        const settings = store.loadSettings();
        for (const attachment of paper.attachments) {
          const references = store.findAttachmentsByStoredPath(attachment.storedPath);
          const shared = references.some((entry) => entry.paperId !== paper.id || entry.id !== attachment.id);
          if (!shared && await isRealManagedFilePath(attachment.storedPath, settings)) {
            await fsp.rm(attachment.storedPath, { force: true }).catch(() => {});
          }
        }
      }

      store.deletePaper(request.paperId);
      invalidateAttachmentAvailability();

      // 同步清理 RAG 索引；否则已删除论文会继续出现在检索结果中。
      if (ragStore && typeof ragStore.removeDocumentIndex === 'function') {
        try {
          await ragStore.removeDocumentIndex({ documentKey: request.paperId });
        } catch (error) {
          console.warn(
            `[PaperQuay] Failed to remove the RAG index for deleted paper ${request.paperId}.`,
            error,
          );
        }
      }
    },

    async library_get_paper_references({ paperId }) {
      return store.loadReferences(cleanString(paperId));
    },
  };

  return commands;
}

module.exports = { createLibraryCommands };
