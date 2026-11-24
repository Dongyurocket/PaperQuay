import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  assignPaperToLibraryCategory,
  createLibraryCategory,
  getLibrarySettings,
  importPdfsToLibrary,
  listLibraryCategories,
  selectLibraryPdfFiles,
  updateLibrarySettings,
} from '../../../services/library';
import {
  detectLocalZoteroDataDir,
  listLocalZoteroCollectionItems,
  listLocalZoteroCollections,
  listLocalZoteroLibraryItems,
} from '../../../services/zotero';
import { lookupLiteratureMetadata } from '../../../services/metadata';
import { extractLocalPdfMetadataPreview } from '../../../services/pdfMetadata';
import { getFileNameFromPath } from '../../../utils/text';
import type { MetadataLookupResult } from '../../../types/metadata';
import type { ZoteroCollection, ZoteroLibraryItem } from '../../../types/reader';
import {
  mergeLocalPdfMetadataIntoDraft,
  mergeRemoteMetadataIntoDraft,
  titleFromPdfPath,
} from '../importMetadata';
import type { ImportDraftItem } from '../importTypes';
import {
  buildImportDraftsFromPdfPaths,
  categorySignature,
  metadataFromDraft,
  metadataFromZoteroItem,
} from '../literatureLibraryUtils';
import {
  emitLibrarySettingsUpdated,
  LIBRARY_SETTINGS_UPDATED_EVENT,
  ZOTERO_IMPORT_REQUEST_EVENT,
  type LibrarySettingsUpdatedEventDetail,
  type ZoteroImportRequestEventDetail,
} from '../libraryEvents';
import { useDesktopPdfDrop } from '../useDesktopPdfDrop';
import { filterZoteroItemsOutsideCollections, uniqueZoteroItems } from '../zoteroImport';
import type { LibraryCatalog } from './useLibraryCatalog';

type LocaleText = (zh: string, en: string) => string;

export interface ImportFlowOptions {
  catalog: LibraryCatalog;
  demoMode: boolean;
  l: LocaleText;
  metadataWorking: boolean;
  setMetadataWorking: Dispatch<SetStateAction<boolean>>;
  resolveLlmMetadataFallback: (input: {
    title: string;
    excerptText: string | null | undefined;
  }) => Promise<MetadataLookupResult | null>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  working: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;
}

export interface ImportFlowState {
  importDrafts: ImportDraftItem[];
  importDialogOpen: boolean;
  dropActive: boolean;
  localImportMetadataWorking: boolean;
  importFirstPageTextRef: MutableRefObject<Map<string, string>>;
  beginImportDrafts: (paths: string[]) => void;
  handleImportPdfs: () => Promise<void>;
  handleImportDraftChange: (path: string, patch: Partial<ImportDraftItem>) => void;
  handleRemoveImportDraft: (path: string) => void;
  handleAutoFillImportMetadata: (
    targetDrafts?: ImportDraftItem[],
    silent?: boolean,
    allowLlm?: boolean,
  ) => Promise<void>;
  handleCloseImportDialog: () => void;
  handleConfirmImportDrafts: () => Promise<void>;
}

/** 导入流程：文件选择、桌面拖放、元数据确认、自动补全与导入进度。 */
export function useImportFlow({
  catalog,
  demoMode,
  l,
  metadataWorking,
  setMetadataWorking,
  resolveLlmMetadataFallback,
  setStatusMessage,
  setError,
  working,
  setWorking,
}: ImportFlowOptions): ImportFlowState {
  const { categories, selectedCategoryId, refreshAll, settings, setSettings, showDemoLockedMessage } = catalog;
  // 导入对话框中文献首页文本缓存（path -> firstPageText），供中文文献 LLM 元数据兜底使用。
  const importFirstPageTextRef = useRef(new Map<string, string>());
  const [importDrafts, setImportDrafts] = useState<ImportDraftItem[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [metadataAttemptedPaths, setMetadataAttemptedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [localImportMetadataWorking, setLocalImportMetadataWorking] = useState(false);

  const hydrateImportDraftsFromLocalPdf = useCallback(
    async (drafts: ImportDraftItem[]) => {
      if (drafts.length === 0) {
        return;
      }

      setLocalImportMetadataWorking(true);

      try {
        for (const draft of drafts) {
          const preview = await extractLocalPdfMetadataPreview(draft.path).catch(() => null);

          if (!preview) {
            continue;
          }

          if (preview.firstPageText?.trim()) {
            importFirstPageTextRef.current.set(draft.path, preview.firstPageText);
          }

          setImportDrafts((current) =>
            current.map((item) => {
              if (item.path !== draft.path) {
                return item;
              }

              return mergeLocalPdfMetadataIntoDraft(item, preview);
            }),
          );
        }
      } finally {
        setLocalImportMetadataWorking(false);
      }
    },
    [],
  );

  const beginImportDrafts = useCallback(
    (paths: string[]) => {
      if (demoMode) {
        showDemoLockedMessage();
        return;
      }

      const { pdfPaths, drafts: nextDrafts } = buildImportDraftsFromPdfPaths({
        paths,
        existingDrafts: importDrafts,
        categories,
        selectedCategoryId,
      });

      if (pdfPaths.length === 0) {
        setStatusMessage(l('没有可导入的 PDF 文件', 'No importable PDF files were found'));
        return;
      }

      setImportDrafts((current) => [...current, ...nextDrafts]);
      setImportDialogOpen(true);
      setStatusMessage(
        l(
          `已准备 ${pdfPaths.length} 个 PDF，请确认元数据。`,
          `${pdfPaths.length} PDFs are ready. Please confirm metadata.`,
        ),
      );

      if (nextDrafts.length > 0) {
        void hydrateImportDraftsFromLocalPdf(nextDrafts);
      }
    },
    [
      categories,
      demoMode,
      hydrateImportDraftsFromLocalPdf,
      importDrafts,
      l,
      selectedCategoryId,
      showDemoLockedMessage,
    ],
  );

  useDesktopPdfDrop({
    onPdfPaths: beginImportDrafts,
    onDragStateChange: setDropActive,
  });

  const handleImportZoteroLibrary = async (preferredDataDir?: string) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setWorking(true);
    setError('');

    try {
      const activeSettings = settings ?? await getLibrarySettings();
      let dataDir = preferredDataDir?.trim() || activeSettings.zoteroLocalDataDir.trim();

      if (!dataDir) {
        dataDir = (await detectLocalZoteroDataDir()) ?? '';
      }

      if (!dataDir) {
        setStatusMessage(
          l(
            '未找到 Zotero 本地数据目录。请先选择包含 zotero.sqlite 的文件夹。',
            'No Zotero local data directory was found. Choose the folder containing zotero.sqlite first.',
          ),
        );
        return;
      }

      const nextSettings = await updateLibrarySettings({
        ...activeSettings,
        zoteroLocalDataDir: dataDir,
      });
      setSettings(nextSettings);
      emitLibrarySettingsUpdated(nextSettings, 'literature-zotero-import');

      setStatusMessage(l('正在读取 Zotero 分类树...', 'Reading Zotero collection tree...'));
      const zoteroCollections = await listLocalZoteroCollections({ dataDir });
      setStatusMessage(l('正在读取 Zotero PDF 条目...', 'Reading Zotero PDF items...'));
      const allZoteroItems = uniqueZoteroItems(await listLocalZoteroLibraryItems({ dataDir }));

      if (zoteroCollections.length === 0 && allZoteroItems.length === 0) {
        setStatusMessage(l('没有可导入的 Zotero PDF。', 'No Zotero PDFs are available to import.'));
        return;
      }

      let currentCategories = await listLibraryCategories();
      const categoryIdByZoteroKey = new Map<string, string>();
      const collectionByKey = new Map(
        zoteroCollections.map((collection) => [collection.collectionKey, collection]),
      );

      const ensureCategoryForCollection = async (
        collection: ZoteroCollection,
        visiting = new Set<string>(),
      ): Promise<string> => {
        const existingId = categoryIdByZoteroKey.get(collection.collectionKey);

        if (existingId) {
          return existingId;
        }

        if (visiting.has(collection.collectionKey)) {
          throw new Error(
            l(
              'Zotero 分类树存在循环引用，无法导入。',
              'The Zotero collection tree has a cycle and cannot be imported.',
            ),
          );
        }

        visiting.add(collection.collectionKey);

        const parentCollection = collection.parentCollectionKey
          ? collectionByKey.get(collection.parentCollectionKey)
          : null;
        const parentId = parentCollection
          ? await ensureCategoryForCollection(parentCollection, visiting)
          : null;
        const normalizedName = collection.name.trim() || l('未命名 Zotero 分类', 'Untitled Zotero Collection');
        const existingCategory = currentCategories.find(
          (category) =>
            !category.isSystem &&
            category.parentId === parentId &&
            categorySignature(category.name, category.parentId) === categorySignature(normalizedName, parentId),
        );
        const category = existingCategory ?? await createLibraryCategory({
          name: normalizedName,
          parentId,
        });

        if (!existingCategory) {
          currentCategories = [...currentCategories, category];
        }

        categoryIdByZoteroKey.set(collection.collectionKey, category.id);
        return category.id;
      };

      const ensureTopLevelCategory = async (name: string): Promise<string> => {
        const normalizedName = name.trim();
        const existingCategory = currentCategories.find(
          (category) =>
            !category.isSystem &&
            category.parentId === null &&
            categorySignature(category.name, category.parentId) === categorySignature(normalizedName, null),
        );
        const category = existingCategory ?? await createLibraryCategory({
          name: normalizedName,
          parentId: null,
        });

        if (!existingCategory) {
          currentCategories = [...currentCategories, category];
        }

        return category.id;
      };

      for (const collection of zoteroCollections) {
        await ensureCategoryForCollection(collection);
      }

      let importedCount = 0;
      let duplicateCount = 0;
      let failedCount = 0;
      let missingPdfCount = 0;
      let unfiledCount = 0;
      const collectionItems: ZoteroLibraryItem[] = [];

      for (const collection of zoteroCollections) {
        const categoryId = categoryIdByZoteroKey.get(collection.collectionKey);

        if (!categoryId) {
          continue;
        }

        const items = await listLocalZoteroCollectionItems({
          dataDir,
          collectionKey: collection.collectionKey,
        });
        collectionItems.push(...items);

        const importableItems = items.filter((item) => item.localPdfPath);
        missingPdfCount += items.length - importableItems.length;

        if (importableItems.length === 0) {
          continue;
        }

        const metadata = Object.fromEntries(
          importableItems.map((item) => [item.localPdfPath as string, metadataFromZoteroItem(item)]),
        );
        const results = await importPdfsToLibrary({
          paths: importableItems.map((item) => item.localPdfPath as string),
          targetCategoryId: categoryId,
          importMode: 'copy',
          source: 'zotero',
          metadata,
        });

        for (const result of results) {
          if (result.status === 'imported') {
            importedCount += 1;
          } else if (result.status === 'duplicate') {
            duplicateCount += 1;

            if (result.existingPaperId) {
              await assignPaperToLibraryCategory({
                paperId: result.existingPaperId,
                categoryId,
              });
            }
          } else {
            failedCount += 1;
          }
        }
      }

      const unfiledItems = filterZoteroItemsOutsideCollections(allZoteroItems, collectionItems);
      unfiledCount = unfiledItems.length;

      if (unfiledItems.length > 0) {
        const unfiledCategoryId = await ensureTopLevelCategory(l('Zotero 未归档', 'Zotero Unfiled'));
        const importableItems = unfiledItems.filter((item) => item.localPdfPath);
        missingPdfCount += unfiledItems.length - importableItems.length;

        if (importableItems.length > 0) {
          const metadata = Object.fromEntries(
            importableItems.map((item) => [item.localPdfPath as string, metadataFromZoteroItem(item)]),
          );
          const results = await importPdfsToLibrary({
            paths: importableItems.map((item) => item.localPdfPath as string),
            targetCategoryId: unfiledCategoryId,
            importMode: 'copy',
            source: 'zotero',
            metadata,
          });

          for (const result of results) {
            if (result.status === 'imported') {
              importedCount += 1;
            } else if (result.status === 'duplicate') {
              duplicateCount += 1;

              if (result.existingPaperId) {
                await assignPaperToLibraryCategory({
                  paperId: result.existingPaperId,
                  categoryId: unfiledCategoryId,
                });
              }
            } else {
              failedCount += 1;
            }
          }
        }
      }

      await refreshAll();
      setStatusMessage(
        l(
          `Zotero 导入完成：${zoteroCollections.length} 个分类，${unfiledCount} 个未归档条目，导入 ${importedCount}，重复 ${duplicateCount}，失败 ${failedCount}，缺少本地 PDF ${missingPdfCount}。`,
          `Zotero import finished: ${zoteroCollections.length} collections, ${unfiledCount} unfiled items, ${importedCount} imported, ${duplicateCount} duplicated, ${failedCount} failed, ${missingPdfCount} missing local PDFs.`,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('导入 Zotero 文库失败', 'Failed to import the Zotero library');
      setError(message);
      setStatusMessage(message);
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    const handleLibrarySettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<LibrarySettingsUpdatedEventDetail>).detail;

      if (!detail?.settings || detail.source?.startsWith('literature')) {
        return;
      }

      setSettings(detail.settings);
    };

    const handleZoteroImportRequest = (event: Event) => {
      const detail = (event as CustomEvent<ZoteroImportRequestEventDetail>).detail;

      void handleImportZoteroLibrary(detail?.dataDir);
    };

    window.addEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);
    window.addEventListener(ZOTERO_IMPORT_REQUEST_EVENT, handleZoteroImportRequest);

    return () => {
      window.removeEventListener(LIBRARY_SETTINGS_UPDATED_EVENT, handleLibrarySettingsUpdated);
      window.removeEventListener(ZOTERO_IMPORT_REQUEST_EVENT, handleZoteroImportRequest);
    };
  }, [handleImportZoteroLibrary]);

  const handleImportPdfs = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setError('');

    try {
      const paths = await selectLibraryPdfFiles();

      if (paths.length === 0) {
        setStatusMessage(l('未选择 PDF', 'No PDFs selected'));
        return;
      }

      beginImportDrafts(paths);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('导入 PDF 失败', 'Failed to import PDFs');
      setError(message);
      setStatusMessage(message);
    }
  };

  const handleImportDraftChange = (path: string, patch: Partial<ImportDraftItem>) => {
    setImportDrafts((current) =>
      current.map((draft) => (draft.path === path ? { ...draft, ...patch } : draft)),
    );
  };

  const handleRemoveImportDraft = (path: string) => {
    setImportDrafts((current) => current.filter((draft) => draft.path !== path));
  };

  const handleAutoFillImportMetadata = useCallback(
    // allowLlm=false 用于对话框打开后的静默自动补全：免费远程检索照跑，
    // 但可能产生模型费用的 LLM 兑底只在用户手动点击「自动补全」时启用。
    async (targetDrafts = importDrafts, silent = false, allowLlm = true) => {
      if (demoMode) {
        showDemoLockedMessage();
        return;
      }

      const draftsToLookup = targetDrafts.filter((draft) => draft.path.trim());

      if (draftsToLookup.length === 0) {
        return;
      }

      setMetadataWorking(true);
      setError('');

      let filledCount = 0;
      let missedCount = 0;
      let llmFilledCount = 0;

      try {
        for (const draft of draftsToLookup) {
          let metadata = await lookupLiteratureMetadata({
            doi: draft.doi || null,
            title: draft.title || titleFromPdfPath(draft.path),
            path: draft.path,
          });

          // 中文文献在 Crossref/OpenAlex 中通常检索不到，用 LLM 从首页文本提取作为兑底。
          if (!metadata && allowLlm) {
            metadata = await resolveLlmMetadataFallback({
              title: draft.title || titleFromPdfPath(draft.path),
              excerptText: importFirstPageTextRef.current.get(draft.path),
            });

            if (metadata) {
              llmFilledCount += 1;
            }
          }

          if (!metadata) {
            missedCount += 1;
            continue;
          }

          const mergedDraft = mergeRemoteMetadataIntoDraft(draft, metadata);
          const changed =
            mergedDraft.title !== draft.title ||
            mergedDraft.authors !== draft.authors ||
            mergedDraft.year !== draft.year ||
            mergedDraft.publication !== draft.publication ||
            mergedDraft.doi !== draft.doi ||
            mergedDraft.url !== draft.url ||
            mergedDraft.abstractText !== draft.abstractText;

          if (!changed) {
            missedCount += 1;
            continue;
          }

          setImportDrafts((current) =>
            current.map((item) =>
              item.path === draft.path ? mergeRemoteMetadataIntoDraft(item, metadata) : item,
            ),
          );
          filledCount += 1;
        }

        if (!silent) {
          setStatusMessage(
            l(
              `元数据补全完成：匹配 ${filledCount}（其中智能提取 ${llmFilledCount}），未匹配 ${missedCount}。`,
              `Metadata enrichment finished: ${filledCount} matched (${llmFilledCount} via AI extraction), ${missedCount} not matched.`,
            ),
          );
        }
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : l('自动补全元数据失败', 'Failed to auto-fill metadata');
        setError(message);
        setStatusMessage(message);
      } finally {
        setMetadataWorking(false);
      }
    },
    [demoMode, importDrafts, l, resolveLlmMetadataFallback, showDemoLockedMessage],
  );

  useEffect(() => {
    if (
      !importDialogOpen ||
      importDrafts.length === 0 ||
      metadataWorking ||
      localImportMetadataWorking
    ) {
      return;
    }

    const nextDrafts = importDrafts.filter((draft) => !metadataAttemptedPaths.has(draft.path));

    if (nextDrafts.length === 0) {
      return;
    }

    setMetadataAttemptedPaths((current) => {
      const next = new Set(current);

      nextDrafts.forEach((draft) => next.add(draft.path));
      return next;
    });
    void handleAutoFillImportMetadata(nextDrafts, true, false);
  }, [
    handleAutoFillImportMetadata,
    importDialogOpen,
    demoMode,
    importDrafts,
    localImportMetadataWorking,
    showDemoLockedMessage,
    metadataAttemptedPaths,
    metadataWorking,
  ]);

  const handleCloseImportDialog = () => {
    if (working) {
      return;
    }

    setImportDialogOpen(false);
    setImportDrafts([]);
    setMetadataAttemptedPaths(new Set());
    setLocalImportMetadataWorking(false);
    importFirstPageTextRef.current.clear();
  };

  const handleConfirmImportDrafts = async () => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (importDrafts.length === 0) {
      return;
    }

    setWorking(true);
    setError('');

    try {
      const groupedDrafts = new Map<string, ImportDraftItem[]>();

      for (const draft of importDrafts) {
        const categoryKey = draft.categoryId.trim();
        groupedDrafts.set(categoryKey, [...(groupedDrafts.get(categoryKey) ?? []), draft]);
      }

      const results = [];

      for (const [categoryId, drafts] of groupedDrafts) {
        const metadata = Object.fromEntries(
          drafts.map((draft) => [draft.path, metadataFromDraft(draft)]),
        );
        const imported = await importPdfsToLibrary({
          paths: drafts.map((draft) => draft.path),
          targetCategoryId: categoryId || null,
          metadata,
        });

        results.push(...imported);
      }

      const importedCount = results.filter((result) => result.status === 'imported').length;
      const duplicateCount = results.filter((result) => result.status === 'duplicate').length;
      const failedCount = results.filter((result) => result.status === 'failed').length;
      const duplicateNames = results
        .filter((result) => result.status === 'duplicate')
        .map((result) => getFileNameFromPath(result.sourcePath))
        .slice(0, 3);
      const failedNames = results
        .filter((result) => result.status === 'failed')
        .map((result) => `${getFileNameFromPath(result.sourcePath)}: ${result.message}`)
        .slice(0, 2);

      await refreshAll();
      setImportDialogOpen(false);
      setImportDrafts([]);
      importFirstPageTextRef.current.clear();
      setMetadataAttemptedPaths(new Set());
      setLocalImportMetadataWorking(false);
      const duplicateSummary =
        duplicateNames.length > 0
          ? l(` 重复：${duplicateNames.join('、')}`, ` Duplicates: ${duplicateNames.join(', ')}`)
          : '';
      const failedSummary =
        failedNames.length > 0
          ? l(` 失败：${failedNames.join('；')}`, ` Failed: ${failedNames.join('; ')}`)
          : '';
      setStatusMessage(
        l(
          `导入完成：新增 ${importedCount}，重复 ${duplicateCount}，失败 ${failedCount}。${duplicateSummary}${failedSummary}`,
          `Import finished: ${importedCount} imported, ${duplicateCount} duplicated, ${failedCount} failed.${duplicateSummary}${failedSummary}`,
        ),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('导入 PDF 失败', 'Failed to import PDFs');
      setError(message);
      setStatusMessage(message);
    } finally {
      setWorking(false);
    }
  };

  return {
    importDrafts,
    importDialogOpen,
    dropActive,
    localImportMetadataWorking,
    importFirstPageTextRef,
    beginImportDrafts,
    handleImportPdfs,
    handleImportDraftChange,
    handleRemoveImportDraft,
    handleAutoFillImportMetadata,
    handleCloseImportDialog,
    handleConfirmImportDrafts,
  };
}
