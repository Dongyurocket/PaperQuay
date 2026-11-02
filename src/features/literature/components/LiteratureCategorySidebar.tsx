import clsx from 'clsx';
import { useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useAppLocale, useLocaleText } from '../../../i18n/uiLanguage';
import type {
  LiteratureCategory,
} from '../../../types/library';
import { useWheelScrollDelegate } from '../../../hooks/useWheelScrollDelegate';
import {
  categoryIcon,
  categoryDisplayName,
  type FlatLiteratureCategory,
} from '../literatureUi';

interface LiteratureCategorySidebarProps {
  categories: FlatLiteratureCategory[];
  selectedCategoryId: string | null;
  onCreateCategory: (parentCategory?: LiteratureCategory | null) => void;
  onSelectCategory: (categoryId: string) => void;
  onRenameCategory: (category: LiteratureCategory) => void;
  onDeleteCategory: (category: LiteratureCategory) => void;
  onCategoryMove: (categoryId: string, parentId: string | null) => void;
  externalDragOverCategoryId?: string | null;
  onCategoryDrop: (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => void;
}

interface CategoryContextMenuState {
  x: number;
  y: number;
  category: FlatLiteratureCategory | null;
}

export default function LiteratureCategorySidebar({
  categories,
  selectedCategoryId,
  onCreateCategory,
  onSelectCategory,
  onRenameCategory,
  onDeleteCategory,
  onCategoryMove,
  externalDragOverCategoryId = null,
  onCategoryDrop,
}: LiteratureCategorySidebarProps) {
  const l = useLocaleText();
  const locale = useAppLocale();
  const rootRef = useRef<HTMLElement | null>(null);
  const handleWheelCapture = useWheelScrollDelegate({ rootRef });
  const [contextMenu, setContextMenu] = useState<CategoryContextMenuState | null>(null);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(() => new Set());
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const categoryIdsWithChildren = new Set(
    categories
      .filter((category) => category.parentId)
      .map((category) => category.parentId as string),
  );
  const visibleCategories = (() => {
    let collapsedDepth: number | null = null;

    return categories.filter((category) => {
      if (collapsedDepth !== null) {
        if (category.depth > collapsedDepth) {
          return false;
        }

        collapsedDepth = null;
      }

      if (!category.isSystem && collapsedCategoryIds.has(category.id)) {
        collapsedDepth = category.depth;
      }

      return true;
    });
  })();
  const systemCategories = visibleCategories.filter(
    (category) => category.isSystem || category.systemKey,
  );
  const userCategories = visibleCategories.filter(
    (category) => !category.isSystem && !category.systemKey,
  );
  const contextMenuCategoryHasChildren =
    contextMenu?.category ? categoryIdsWithChildren.has(contextMenu.category.id) : false;

  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategoryIds((current) => {
      const next = new Set(current);

      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }

      return next;
    });
  };

  const expandCategory = (categoryId: string) => {
    setCollapsedCategoryIds((current) => {
      if (!current.has(categoryId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(categoryId);
      return next;
    });
  };

  const openContextMenu = (
    event: MouseEvent,
    category: FlatLiteratureCategory | null,
  ) => {
    event.preventDefault();
    setContextMenu({
      x: Math.max(12, Math.min(event.clientX, window.innerWidth - 232)),
      y: Math.max(12, Math.min(event.clientY, window.innerHeight - (category && !category.isSystem ? 168 : 60))),
      category,
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleCategoryDragStart = (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => {
    if (category.isSystem) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.setData('application/x-paperquay-category-id', category.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleCategoryRowDrop = (
    event: DragEvent<HTMLButtonElement>,
    category: LiteratureCategory,
  ) => {
    event.preventDefault();
    setDragOverCategoryId(null);

    const draggedCategoryId = event.dataTransfer.getData('application/x-paperquay-category-id');

    if (draggedCategoryId) {
      if (!category.isSystem && draggedCategoryId !== category.id) {
        onCategoryMove(draggedCategoryId, category.id);
      }
      return;
    }

    onCategoryDrop(event, category);
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOverCategoryId(null);

    const draggedCategoryId = event.dataTransfer.getData('application/x-paperquay-category-id');

    if (draggedCategoryId) {
      onCategoryMove(draggedCategoryId, null);
    }
  };

  const hasDragType = (event: DragEvent, type: string) =>
    Array.from(event.dataTransfer.types).includes(type);

  const renderCategoryRow = (category: FlatLiteratureCategory) => {
    const hasChildren = categoryIdsWithChildren.has(category.id);
    const collapsed = hasChildren && collapsedCategoryIds.has(category.id);
    const canDropOnCategory = !category.isSystem;
    const dragOver = dragOverCategoryId === category.id || externalDragOverCategoryId === category.id;

    return (
      <div key={category.id} className="group flex items-center gap-1">
        <button
          type="button"
          data-paperquay-category-drop-id={!category.isSystem ? category.id : undefined}
          draggable={!category.isSystem}
          onDragStart={(event) => handleCategoryDragStart(event, category)}
          onClick={() => onSelectCategory(category.id)}
          onContextMenu={(event) => openContextMenu(event, category)}
          onDoubleClick={() => {
            if (hasChildren && !category.isSystem) {
              toggleCategoryCollapse(category.id);
            }
          }}
          onDragOver={(event) => {
            if (
              canDropOnCategory &&
              (hasDragType(event, 'application/x-paperquay-category-id') ||
                hasDragType(event, 'application/x-paperquay-paper-id') ||
                hasDragType(event, 'text/plain'))
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOverCategoryId(category.id);
            }
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget;

            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setDragOverCategoryId((current) => (current === category.id ? null : current));
            }
          }}
          onDrop={(event) => handleCategoryRowDrop(event, category)}
          className={clsx(
            'flex min-w-0 flex-1 items-center justify-between rounded-xl px-2.5 py-2 text-left text-[13px] transition',
            dragOver
              ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)] ring-1 ring-[var(--pq-accent-ring)]'
              : selectedCategoryId === category.id
              ? 'bg-[var(--pq-accent-soft)] text-[var(--pq-accent)] shadow-[0_8px_20px_var(--pq-accent-shadow)] ring-1 ring-[var(--pq-accent-ring)]'
              : category.isSystem
                ? 'text-[var(--pq-text)] hover:bg-white/70 dark:hover:bg-white/8'
                : 'text-[var(--pq-text-muted)] hover:bg-white/70 hover:text-[var(--pq-text)] dark:hover:bg-white/8',
          )}
          style={{ paddingLeft: `${12 + category.depth * 18}px` }}
          aria-expanded={hasChildren ? !collapsed : undefined}
        >
          <span className="flex min-w-0 items-center gap-2">
            {hasChildren && !category.isSystem ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCategoryCollapse(category.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleCategoryCollapse(category.id);
                  }
                }}
                title={collapsed ? l('展开分类', 'Expand category') : l('折叠分类', 'Collapse category')}
                className={clsx(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10',
                  selectedCategoryId === category.id ? 'text-white' : 'text-[var(--pq-text-faint)] dark:text-[#8d8d8d]',
                )}
              >
                <ChevronRight
                  className={clsx('h-3.5 w-3.5 transition-transform', !collapsed && 'rotate-90')}
                  strokeWidth={2}
                />
              </span>
            ) : (
              <span className="h-5 w-5 shrink-0" />
            )}
            <span className="shrink-0">{categoryIcon(category)}</span>
            <span className="truncate">{categoryDisplayName(category, locale)}</span>
          </span>
          <span
            className={clsx(
              'ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px]',
              selectedCategoryId === category.id
                ? 'bg-white/75 text-[var(--pq-accent)] dark:bg-white/14'
                : 'bg-white/62 text-[var(--pq-text-faint)] dark:bg-white/8',
            )}
          >
            {category.paperCount}
          </span>
        </button>
      </div>
    );
  };

  return (
    <aside
      ref={rootRef}
      onWheelCapture={handleWheelCapture}
      className="pq-library-pane flex h-full min-h-0 flex-col overflow-hidden border-r"
    >
      <div className="pq-toolbar px-3.5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a8f94] dark:text-[#a0a0a0]">
              PaperQuay
            </div>
            <div className="mt-0.5 text-base font-semibold tracking-tight text-[#202124] dark:text-[#e8e8e8]">
              {l('本地文库', 'Local Library')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onCreateCategory(null)}
            className="pq-icon-button h-8 w-8 border border-[var(--pq-border)] bg-white/65 dark:bg-white/6"
            title={l('新建分类', 'New Category')}
          >
            <FolderPlus className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div
        data-wheel-scroll-target
        className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2.5"
      >
        <div className="mb-3 space-y-1">
          {systemCategories.map(renderCategoryRow)}
        </div>

        <div
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-paperquay-category-id')) {
              event.preventDefault();
            }
          }}
          onDrop={handleRootDrop}
          onContextMenu={(event) => openContextMenu(event, null)}
          className="mb-2 rounded-xl border border-dashed border-[var(--pq-border)] bg-white/32 px-2.5 py-2 text-xs text-[var(--pq-text-muted)] transition hover:border-[var(--pq-accent-border-strong)] hover:bg-[var(--pq-accent-soft)] hover:text-[var(--pq-accent)]"
        >
          {l('拖动分类到这里可移到顶层；右键可新建顶层分类。', 'Drop a category here to move it to the root level. Right-click to create a root category.')}
        </div>

        <div className="space-y-1">
          {userCategories.map(renderCategoryRow)}
        </div>
      </div>

      {contextMenu ? createPortal(
        <div
          className="fixed inset-0 z-[10000]"
          onClick={closeContextMenu}
          onContextMenu={(event) => {
            event.preventDefault();
            closeContextMenu();
          }}
        >
          <div
            className="pq-acrylic min-w-52 overflow-hidden py-1.5"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              position: 'fixed',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextMenu.category && !contextMenu.category.isSystem ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const category = contextMenu.category;

                    if (category) {
                      expandCategory(category.id);
                      onCreateCategory(category);
                    }
                    closeContextMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--pq-text-muted)] transition hover:bg-[var(--pq-surface-2)] dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
                >
                  <FolderPlus className="h-4 w-4 text-[var(--pq-accent)] dark:text-[#79c6c9]" strokeWidth={1.9} />
                  {l('新建子分类', 'New Subcategory')}
                </button>
                {contextMenuCategoryHasChildren ? (
                  <button
                    type="button"
                    onClick={() => {
                      const category = contextMenu.category;

                      if (category) {
                        toggleCategoryCollapse(category.id);
                      }
                      closeContextMenu();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--pq-text-muted)] transition hover:bg-[var(--pq-surface-2)] dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
                  >
                    <ChevronRight
                      className={clsx(
                        'h-4 w-4 text-[var(--pq-text-muted)] transition-transform dark:text-[#a0a0a0]',
                        !collapsedCategoryIds.has(contextMenu.category.id) && 'rotate-90',
                      )}
                      strokeWidth={1.9}
                    />
                    {collapsedCategoryIds.has(contextMenu.category.id)
                      ? l('展开分类', 'Expand Category')
                      : l('折叠分类', 'Collapse Category')}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    const category = contextMenu.category;

                    if (category) {
                      onRenameCategory(category);
                    }
                    closeContextMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--pq-text-muted)] transition hover:bg-[var(--pq-surface-2)] dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
                >
                  <Pencil className="h-4 w-4 text-[var(--pq-text-muted)] dark:text-[#a0a0a0]" strokeWidth={1.9} />
                  {l('重命名分类', 'Rename Category')}
                </button>
                <div className="my-1 border-t border-[var(--pq-border)] dark:border-white/10" />
                <button
                  type="button"
                  onClick={() => {
                    const category = contextMenu.category;

                    if (category) {
                      onDeleteCategory(category);
                    }
                    closeContextMenu();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--pq-danger)] transition hover:bg-[var(--pq-danger-bg)] dark:text-rose-200 dark:hover:bg-rose-400/10"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                  {l('删除分类', 'Delete Category')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onCreateCategory(null);
                  closeContextMenu();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--pq-text-muted)] transition hover:bg-[var(--pq-surface-2)] dark:text-[#e0e0e0] dark:hover:bg-[#2f2f2f]"
              >
                <FolderPlus className="h-4 w-4 text-[var(--pq-accent)] dark:text-[#79c6c9]" strokeWidth={1.9} />
                {l('新建顶层分类', 'New Root Category')}
              </button>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </aside>
  );
}

