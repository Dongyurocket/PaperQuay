import { invoke } from '../platform/electron/core';
import { emitRagIndexStatusUpdated } from './ragIndexStatus.ts';
import { listen } from '../platform/electron/event';
import type {
  AddAttachmentRequest,
  UpdateTranslatedPdfLanguagesRequest,
  UpdateTranslatedPdfLanguagesResult,
  AssignPaperCategoryRequest,
  CreateCategoryRequest,
  DeletePaperRequest,
  FetchAllReferencesResult,
  FetchPaperReferencesResult,
  ImportedPdfResult,
  ImportPdfRequest,
  LibraryReferenceProgress,
  LibrarySettings,
  LibrarySnapshot,
  ListPapersRequest,
  QueryPapersResult,
  PapersByIdsResult,
  PaperReference,
  LiteratureAttachment,
  LiteratureCategory,
  LiteraturePaper,
  PdfAssetInventoryReport,
  PdfAssetNamePlan,
  MoveCategoryRequest,
  RelocateAttachmentRequest,
  RemoveAttachmentRequest,
  ReorderPapersRequest,
  UpdatePaperRequest,
  UpdateCategoryRequest,
} from '../types/library';

export const LIBRARY_REFERENCE_PROGRESS_EVENT = 'paperquay://library-reference-progress';

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallback;
}

export async function selectLibraryPdfFiles(): Promise<string[]> {
  try {
    return (await invoke<string[] | null>('library_select_pdf_files')) ?? [];
  } catch (error) {
    throw new Error(toErrorMessage(error, '选择 PDF 文件失败'));
  }
}

export async function initializeLiteratureLibrary(): Promise<LibrarySnapshot> {
  try {
    return await invoke<LibrarySnapshot>('library_init');
  } catch (error) {
    throw new Error(toErrorMessage(error, '初始化文献库失败'));
  }
}

export async function getLibrarySettings(): Promise<LibrarySettings> {
  try {
    return await invoke<LibrarySettings>('library_get_settings');
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取文献库设置失败'));
  }
}

export async function inspectLibraryPdfAssets(): Promise<PdfAssetInventoryReport> {
  try {
    return await invoke<PdfAssetInventoryReport>('library_inspect_pdf_assets');
  } catch (error) {
    throw new Error(toErrorMessage(error, '盘点 PDF 附件失败'));
  }
}

export async function previewLibraryPdfAssetNames(): Promise<PdfAssetNamePlan> {
  try {
    return await invoke<PdfAssetNamePlan>('library_plan_pdf_asset_names');
  } catch (error) {
    throw new Error(toErrorMessage(error, '生成 PDF 命名预览失败'));
  }
}

export async function updateLibrarySettings(
  settings: LibrarySettings,
): Promise<LibrarySettings> {
  try {
    return await invoke<LibrarySettings>('library_update_settings', { settings });
  } catch (error) {
    throw new Error(toErrorMessage(error, '保存文献库设置失败'));
  }
}

export async function listLibraryCategories(): Promise<LiteratureCategory[]> {
  try {
    return await invoke<LiteratureCategory[]>('library_list_categories');
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取分类失败'));
  }
}

export async function createLibraryCategory(
  request: CreateCategoryRequest,
): Promise<LiteratureCategory> {
  try {
    return await invoke<LiteratureCategory>('library_create_category', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '创建分类失败'));
  }
}

export async function updateLibraryCategory(
  request: UpdateCategoryRequest,
): Promise<LiteratureCategory> {
  try {
    return await invoke<LiteratureCategory>('library_update_category', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '更新分类失败'));
  }
}

export async function moveLibraryCategory(
  request: MoveCategoryRequest,
): Promise<LiteratureCategory> {
  try {
    return await invoke<LiteratureCategory>('library_move_category', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '移动分类失败'));
  }
}

export async function deleteLibraryCategory(categoryId: string): Promise<void> {
  try {
    await invoke('library_delete_category', { categoryId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '删除分类失败'));
  }
}

export async function listLibraryPapers(
  request: ListPapersRequest = {},
): Promise<LiteraturePaper[]> {
  try {
    return await invoke<LiteraturePaper[]>('library_list_papers', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取文献列表失败'));
  }
}

export async function getLibraryPaper(paperId: string): Promise<LiteraturePaper> {
  try {
    return await invoke<LiteraturePaper>('library_get_paper', { paperId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取文献失败'));
  }
}

const PAPER_LOOKUP_ID_BATCH_SIZE = 200;

/** Read a frozen paper-ID selection without applying the current list filters. */
export async function getLibraryPapersByIds(paperIds: string[]): Promise<PapersByIdsResult> {
  const ids = [...new Set(paperIds.map((id) => id.trim()).filter(Boolean))];
  const papersById = new Map<string, LiteraturePaper>();
  const requested = new Set(ids);
  for (let start = 0; start < ids.length; start += PAPER_LOOKUP_ID_BATCH_SIZE) {
    const response = await invoke<PapersByIdsResult>('library_get_papers_by_ids', {
      paperIds: ids.slice(start, start + PAPER_LOOKUP_ID_BATCH_SIZE),
    });
    for (const paper of response.papers) {
      if (requested.has(paper.id)) papersById.set(paper.id, paper);
    }
  }
  const papers = ids.flatMap((id) => {
    const paper = papersById.get(id);
    return paper ? [paper] : [];
  });
  return { papers, missingIds: ids.filter((id) => !papersById.has(id)) };
}

/** SQL 分页查询（P2-1）：筛选/排序/分页在 SQLite 完成，返回当前筛选的完整匹配数。 */
export async function queryLibraryPapers(
  request: ListPapersRequest = {},
): Promise<QueryPapersResult> {
  try {
    return await invoke<QueryPapersResult>('library_query_papers', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取文献列表失败'));
  }
}

/** 当前筛选的完整匹配计数（供全选三态与批量目标管理，P2-2）。 */
export async function countLibraryPapers(
  request: ListPapersRequest = {},
): Promise<number> {
  try {
    return await invoke<number>('library_count_papers', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '统计文献数量失败'));
  }
}

export interface LibraryMineruParseStatus {
  paperId: string;
  sourceVersion: string;
  status: 'unknown' | 'available' | 'missing' | 'error';
  checkedAt: number | null;
  updatedAt: number;
}

export async function getLibraryMineruParseStatuses(
  paperIds: string[],
): Promise<LibraryMineruParseStatus[]> {
  try {
    return await invoke<LibraryMineruParseStatus[]>('library_get_mineru_parse_statuses', { paperIds });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取解析成果状态失败'));
  }
}

export async function saveLibraryMineruParseStatuses(
  entries: Array<Pick<LibraryMineruParseStatus, 'paperId' | 'sourceVersion' | 'status' | 'checkedAt'>>,
): Promise<{ accepted: number; stale: number }> {
  try {
    return await invoke('library_save_mineru_parse_statuses', { entries });
  } catch (error) {
    throw new Error(toErrorMessage(error, '保存解析成果状态失败'));
  }
}

/** 与 queryLibraryPapers 同筛选同排序，分批枚举文献 id（供全选目标展开，P2-2）。 */
export async function listLibraryPaperIds(
  request: ListPapersRequest = {},
): Promise<string[]> {
  try {
    return await invoke<string[]>('library_list_paper_ids', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '枚举文献失败'));
  }
}

/** 按同一后端调用内的筛选快照枚举文献 ID，避免多次 IPC 分页之间被写入推移 offset。 */
export async function listAllLibraryPaperIds(
  request: ListPapersRequest = {},
): Promise<string[]> {
  try {
    return await invoke<string[]>('library_list_all_paper_ids', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '枚举文献失败'));
  }
}

export async function reorderLibraryPapers(
  request: ReorderPapersRequest,
): Promise<void> {
  try {
    await invoke('library_reorder_papers', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '保存文献排序失败'));
  }
}

export async function importPdfsToLibrary(
  request: ImportPdfRequest,
): Promise<ImportedPdfResult[]> {
  try {
    return await invoke<ImportedPdfResult[]>('library_import_pdfs', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '导入 PDF 失败'));
  }
}

export async function assignPaperToLibraryCategory(
  request: AssignPaperCategoryRequest,
): Promise<LiteraturePaper> {
  try {
    return await invoke<LiteraturePaper>('library_assign_paper_category', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '移动文献到分类失败'));
  }
}

export async function updateLibraryPaper(
  request: UpdatePaperRequest,
): Promise<LiteraturePaper> {
  try {
    return await invoke<LiteraturePaper>('library_update_paper', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '更新文献信息失败'));
  }
}

export interface LibraryRagMembershipResult {
  papers: Array<{ paperId: string; enabled: boolean; removed: boolean }>;
  failures: Array<{ paperId: string; error: string }>;
}

export async function setLibraryRagMembership(
  paperIds: string[],
  enabled: boolean,
): Promise<LibraryRagMembershipResult> {
  try {
    const result = await invoke<LibraryRagMembershipResult>('library_set_rag_membership', {
      request: { paperIds, enabled },
    });

    if (typeof window !== 'undefined') {
      for (const paper of result.papers) {
        emitRagIndexStatusUpdated({ documentKey: paper.paperId });
      }
    }

    return result;
  } catch (error) {
    throw new Error(toErrorMessage(error, enabled ? '加入本地知识库失败' : '移出本地知识库失败'));
  }
}

export async function deleteLibraryPaper(
  request: DeletePaperRequest,
): Promise<void> {
  try {
    await invoke('library_delete_paper', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '删除文献记录失败'));
  }
}

export async function relocateLibraryAttachment(
  request: RelocateAttachmentRequest,
): Promise<LiteratureAttachment> {
  try {
    return await invoke<LiteratureAttachment>('library_relocate_attachment', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '重新定位 PDF 文件失败'));
  }
}

export async function addLibraryAttachment(
  request: AddAttachmentRequest,
): Promise<LiteraturePaper> {
  try {
    return await invoke<LiteraturePaper>('library_add_attachment', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '添加附件失败'));
  }
}

export async function updateTranslatedPdfLanguages(
  request: UpdateTranslatedPdfLanguagesRequest,
): Promise<UpdateTranslatedPdfLanguagesResult> {
  try {
    return await invoke<UpdateTranslatedPdfLanguagesResult>(
      'library_update_translated_pdf_languages', { request },
    );
  } catch (error) {
    throw new Error(toErrorMessage(error, '更新译版语言失败'));
  }
}

export async function removeLibraryAttachment(
  request: RemoveAttachmentRequest,
): Promise<LiteraturePaper> {
  try {
    return await invoke<LiteraturePaper>('library_remove_attachment', { request });
  } catch (error) {
    throw new Error(toErrorMessage(error, '移除附件失败'));
  }
}

export async function getLibraryPaperReferences(paperId: string): Promise<PaperReference[]> {
  try {
    return await invoke<PaperReference[]>('library_get_paper_references', { paperId });
  } catch (error) {
    throw new Error(toErrorMessage(error, '读取参考文献缓存失败'));
  }
}

export async function fetchLibraryPaperReferences(
  paperId: string,
  force = false,
): Promise<FetchPaperReferencesResult> {
  try {
    return await invoke<FetchPaperReferencesResult>('library_fetch_paper_references', { paperId, force });
  } catch (error) {
    throw new Error(toErrorMessage(error, '同步参考文献失败'));
  }
}

export async function fetchAllLibraryReferences(force = false): Promise<FetchAllReferencesResult> {
  try {
    return await invoke<FetchAllReferencesResult>('library_fetch_all_references', { force });
  } catch (error) {
    throw new Error(toErrorMessage(error, '批量同步参考文献失败'));
  }
}

export async function listenLibraryReferenceProgress(
  handler: (progress: LibraryReferenceProgress) => void,
): Promise<() => void> {
  return listen<LibraryReferenceProgress>(LIBRARY_REFERENCE_PROGRESS_EVENT, ({ payload }) => {
    if (payload) {
      handler(payload);
    }
  });
}
