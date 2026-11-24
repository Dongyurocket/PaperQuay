import { useState, type Dispatch, type SetStateAction } from 'react';
import type { DragEvent } from 'react';
import {
  assignPaperToLibraryCategory,
  createLibraryCategory,
  deleteLibraryCategory,
  listLibraryCategories,
  moveLibraryCategory,
  updateLibraryCategory,
} from '../../../services/library';
import type { LiteratureCategory, LiteraturePaper } from '../../../types/library';
import type { LibraryCatalog } from './useLibraryCatalog';
import type { LibraryConfirmDialogState } from './useBatchOperations';

type LocaleText = (zh: string, en: string) => string;

export type CategoryNameDialogState =
  | { mode: 'create'; parentCategory: LiteratureCategory | null }
  | { mode: 'rename'; category: LiteratureCategory };

export interface CategoryActionsOptions {
  catalog: LibraryCatalog;
  demoMode: boolean;
  l: LocaleText;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setDialogBusy: Dispatch<SetStateAction<boolean>>;
  setConfirmDialog: Dispatch<SetStateAction<LibraryConfirmDialogState | null>>;
}

export interface CategoryActionsState {
  categoryNameDialog: CategoryNameDialogState | null;
  setCategoryNameDialog: Dispatch<SetStateAction<CategoryNameDialogState | null>>;
  paperDragOverCategoryId: string | null;
  setPaperDragOverCategoryId: Dispatch<SetStateAction<string | null>>;
  handleCreateCategory: (parentCategory?: LiteratureCategory | null) => void;
  handleRenameCategory: (category: LiteratureCategory) => void;
  handleSubmitCategoryName: (name: string) => Promise<void>;
  handleDeleteCategory: (category: LiteratureCategory) => void;
  deleteCategoryAfterConfirm: (category: LiteratureCategory) => Promise<void>;
  handleMoveCategory: (categoryId: string, parentId: string | null) => Promise<void>;
  assignPaperToCategory: (paperId: string, category: LiteratureCategory) => Promise<void>;
  handlePaperDropOnCategory: (paperId: string, categoryId: string) => void;
  handleCategoryDrop: (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => Promise<void>;
  handlePaperDragStart: (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => void;
}

/** 分类动作：创建/重命名/删除/移动分类，以及把文献拖放分配到分类。 */
export function useCategoryActions({
  catalog,
  demoMode,
  l,
  setStatusMessage,
  setError,
  setDialogBusy,
  setConfirmDialog,
}: CategoryActionsOptions): CategoryActionsState {
  const {
    categories,
    setCategories,
    setSelectedCategoryId,
    setSelectedPaperId,
    refreshPapers,
    markCategoryQueryHandled,
    showDemoLockedMessage,
  } = catalog;
  const [categoryNameDialog, setCategoryNameDialog] =
    useState<CategoryNameDialogState | null>(null);
  const [paperDragOverCategoryId, setPaperDragOverCategoryId] = useState<string | null>(null);

  const handleCreateCategory = (parentCategory?: LiteratureCategory | null) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setCategoryNameDialog({
      mode: 'create',
      parentCategory: parentCategory && !parentCategory.isSystem ? parentCategory : null,
    });
  };

  const handleRenameCategory = (category: LiteratureCategory) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    setCategoryNameDialog({
      mode: 'rename',
      category,
    });
  };

  const handleSubmitCategoryName = async (name: string) => {
    if (demoMode) {
      showDemoLockedMessage();
      setCategoryNameDialog(null);
      return;
    }

    if (!categoryNameDialog) {
      return;
    }

    setDialogBusy(true);
    setError('');
    try {
      if (categoryNameDialog.mode === 'create') {
        const category = await createLibraryCategory({
          name,
          parentId: categoryNameDialog.parentCategory?.id ?? null,
        });

        const nextCategories = await listLibraryCategories();
        setCategories(nextCategories);
        // 创建后切到新分类并直接查询：先登记条件键，避免防抖 effect 重复同一查询。
        markCategoryQueryHandled(category.id);
        setSelectedCategoryId(category.id);
        await refreshPapers(category.id);
        setCategoryNameDialog(null);
        setStatusMessage(
          categoryNameDialog.parentCategory
            ? l(`已创建子分类：${category.name}`, `Created subcategory: ${category.name}`)
            : l(`已创建分类：${category.name}`, `Created category: ${category.name}`),
        );
        return;
      }

      if (name !== categoryNameDialog.category.name) {
        await updateLibraryCategory({
          id: categoryNameDialog.category.id,
          name,
        });
        setCategories(await listLibraryCategories());
        setStatusMessage(l('分类已重命名', 'Category renamed'));
      }

      setCategoryNameDialog(null);
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : categoryNameDialog.mode === 'create'
            ? l('创建分类失败', 'Failed to create category')
            : l('重命名分类失败', 'Failed to rename category');
      setError(message);
      setStatusMessage(message);
    } finally {
      setDialogBusy(false);
    }
  };

  const handleDeleteCategory = (category: LiteratureCategory) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    setConfirmDialog({
      kind: 'delete-category',
      category,
    });
  };

  const deleteCategoryAfterConfirm = async (category: LiteratureCategory) => {
    setDialogBusy(true);
    setError('');
    try {
      await deleteLibraryCategory(category.id);
      const nextCategories = await listLibraryCategories();
      const allCategory = nextCategories.find((item) => item.systemKey === 'all');
      const nextSelectedCategoryId = allCategory?.id ?? nextCategories[0]?.id ?? null;

      setCategories(nextCategories);
      // 删除后切到回退分类并直接查询：先登记条件键，避免防抖 effect 重复同一查询。
      markCategoryQueryHandled(nextSelectedCategoryId);
      setSelectedCategoryId(nextSelectedCategoryId);
      await refreshPapers(nextSelectedCategoryId);
      setStatusMessage(l('分类已删除', 'Category deleted'));
      setConfirmDialog(null);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('删除分类失败', 'Failed to delete category');
      setError(message);
      setStatusMessage(message);
    } finally {
      setDialogBusy(false);
    }
  };

  const handleMoveCategory = async (categoryId: string, parentId: string | null) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    setError('');

    try {
      const movedCategory = await moveLibraryCategory({
        categoryId,
        parentId,
      });

      setCategories(await listLibraryCategories());
      setSelectedCategoryId(movedCategory.id);
      setStatusMessage(
        parentId
          ? l(`已调整分类层级：${movedCategory.name}`, `Updated category hierarchy: ${movedCategory.name}`)
          : l(`已移到顶层分类：${movedCategory.name}`, `Moved category to root: ${movedCategory.name}`),
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('移动分类失败', 'Failed to move category');
      setError(message);
      setStatusMessage(message);
    }
  };

  const assignPaperToCategory = async (paperId: string, category: LiteratureCategory) => {
    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    try {
      await assignPaperToLibraryCategory({
        paperId,
        categoryId: category.id,
      });
      const nextCategories = await listLibraryCategories();

      setCategories(nextCategories);
      // 拖放分配后切到目标分类并直接查询：先登记条件键，避免防抖 effect 重复同一查询。
      markCategoryQueryHandled(category.id);
      setSelectedCategoryId(category.id);
      await refreshPapers(category.id);
      setSelectedPaperId(paperId);
      setStatusMessage(l(`已添加到分类：${category.name}`, `Added to category: ${category.name}`));
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : l('移动文献失败', 'Failed to move paper');
      setError(message);
      setStatusMessage(message);
    } finally {
      setPaperDragOverCategoryId(null);
    }
  };

  const handlePaperDropOnCategory = (paperId: string, categoryId: string) => {
    const category = categories.find((item) => item.id === categoryId);

    if (!category) {
      setPaperDragOverCategoryId(null);
      return;
    }

    void assignPaperToCategory(paperId, category);
  };

  const handleCategoryDrop = async (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (demoMode) {
      showDemoLockedMessage();
      return;
    }

    if (category.isSystem) {
      return;
    }

    const paperId =
      event.dataTransfer.getData('application/x-paperquay-paper-id') ||
      event.dataTransfer.getData('text/plain');

    if (!paperId) {
      return;
    }

    await assignPaperToCategory(paperId, category);
  };

  const handlePaperDragStart = (
    event: DragEvent<HTMLDivElement>,
    paper: LiteraturePaper,
  ) => {
    event.dataTransfer.setData('application/x-paperquay-paper-id', paper.id);
    event.dataTransfer.setData('text/plain', paper.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  return {
    categoryNameDialog,
    setCategoryNameDialog,
    paperDragOverCategoryId,
    setPaperDragOverCategoryId,
    handleCreateCategory,
    handleRenameCategory,
    handleSubmitCategoryName,
    handleDeleteCategory,
    deleteCategoryAfterConfirm,
    handleMoveCategory,
    assignPaperToCategory,
    handlePaperDropOnCategory,
    handleCategoryDrop,
    handlePaperDragStart,
  };
}
