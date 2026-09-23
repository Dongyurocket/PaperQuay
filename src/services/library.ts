import { invoke } from '../platform/electron/core';
import { listen } from '../platform/electron/event';
import type {
  AddAttachmentRequest,
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
  PaperReference,
  LiteratureAttachment,
  LiteratureCategory,
  LiteraturePaper,
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
