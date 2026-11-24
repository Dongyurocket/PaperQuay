const { cleanString, id, now } = require('./utils.cjs');

/**
 * 分类父级校验：新父级不能是自身、自己的后代、系统分类或不存在的分类。
 * 历史上已经存在环时 visited 集合保证遍历终止（环上的移动会被拒绝并提示修复）。
 */
function assertCategoryParentAllowed(categories, categoryId, parentId) {
  const nextParentId = cleanString(parentId);
  if (!nextParentId) return;
  if (nextParentId === categoryId) {
    throw new Error('A category cannot be its own parent');
  }

  const parent = categories.find((item) => item.id === nextParentId);
  if (!parent) throw new Error(`Parent category does not exist: ${nextParentId}`);
  if (parent.isSystem) throw new Error('System categories cannot be used as a parent');

  const seen = new Set([categoryId]);
  let cursor = nextParentId;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error('A category cannot be moved under itself or its descendants');
    }
    seen.add(cursor);
    cursor = categories.find((item) => item.id === cursor)?.parentId ?? null;
  }
}

function createLibraryCategoryCommands({ store }) {
  const commands = {
    async library_list_categories() {
      return store.listCategoriesWithCounts();
    },

    async library_create_category({ request }) {
      const library = store.load();
      const name = cleanString(request?.name);
      if (!name) throw new Error('Category name cannot be empty');

      const parentId = cleanString(request?.parentId) || null;
      const categoryId = id('cat');
      if (parentId) {
        assertCategoryParentAllowed(library.categories, categoryId, parentId);
      }
      const category = {
        id: categoryId,
        name,
        parentId,
        sortOrder: library.categories.filter((item) => item.parentId === parentId && !item.isSystem).length,
        isSystem: false,
        systemKey: null,
        createdAt: now(),
        updatedAt: now(),
        paperCount: 0,
      };
      library.categories.push(category);
      store.saveCategory(category);
      return store.listCategoriesWithCounts().find((item) => item.id === category.id);
    },

    async library_update_category({ request }) {
      const library = store.load();
      const category = library.categories.find((item) => item.id === request.id);
      if (!category) throw new Error('Category does not exist');
      if (category.isSystem) throw new Error('System categories cannot be modified');

      if (request.name != null && cleanString(request.name)) category.name = cleanString(request.name);
      if (request.parentId !== undefined) {
        const nextParentId = cleanString(request.parentId) || null;
        if (nextParentId !== (category.parentId ?? null)) {
          assertCategoryParentAllowed(library.categories, category.id, nextParentId);
        }
        category.parentId = nextParentId;
      }
      if (request.sortOrder != null) category.sortOrder = request.sortOrder;
      category.updatedAt = now();

      store.saveCategory(category);
      return store.listCategoriesWithCounts().find((item) => item.id === category.id);
    },

    async library_move_category({ request }) {
      return commands.library_update_category({
        request: {
          id: request.categoryId,
          parentId: request.parentId ?? null,
          sortOrder: request.sortOrder,
        },
      });
    },

    async library_delete_category({ categoryId }) {
      const library = store.load();
      const target = library.categories.find((item) => item.id === categoryId);
      if (!target) throw new Error('Category does not exist');
      if (target.isSystem) throw new Error('System categories cannot be deleted');

      const removeIds = new Set([categoryId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const category of library.categories) {
          if (category.parentId && removeIds.has(category.parentId) && !removeIds.has(category.id)) {
            removeIds.add(category.id);
            changed = true;
          }
        }
      }

      // 分类删除由外键级联清理 paper_categories；只删目标分类，不重写整库。
      store.deleteCategories({ categoryIds: [...removeIds] });
    },

    async library_assign_paper_category({ request }) {
      const paper = store.getPaper(request.paperId);
      if (!paper) throw new Error('Paper does not exist');
      if (!paper.categoryIds.includes(request.categoryId)) paper.categoryIds.push(request.categoryId);
      paper.updatedAt = now();
      store.savePaper(paper);
      return paper;
    },

    async library_set_paper_categories({ request }) {
      const paperId = cleanString(request?.paperId);
      const categoryIds = request?.categoryIds;
      if (!paperId) throw new Error('paperId is required');
      if (!Array.isArray(categoryIds) || categoryIds.some((id) => typeof id !== 'string')) {
        throw new Error('categoryIds must be an array of strings');
      }
      const paper = store.getPaper(paperId);
      if (!paper) throw new Error('Paper does not exist');
      const uniqueIds = [...new Set(categoryIds.map(cleanString).filter(Boolean))];
      const library = store.load();
      const categories = new Map(library.categories.map((category) => [category.id, category]));
      for (const categoryId of uniqueIds) {
        const category = categories.get(categoryId);
        if (!category || category.isSystem) throw new Error(`Invalid user category: ${categoryId}`);
      }
      paper.categoryIds = uniqueIds;
      paper.updatedAt = now();
      store.savePaper(paper);
      return paper;
    },
  };

  return commands;
}

module.exports = { createLibraryCategoryCommands };
