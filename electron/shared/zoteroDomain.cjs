'use strict';

/**
 * Shared Zotero import planning used by the MCP `paperquay_sync_from_zotero`
 * flow (the desktop import UI is the behavioral reference).
 *
 * - Collection categories are nested by Zotero parent collection.
 * - Existing categories are matched case-insensitively by full path.
 * - Items outside every collection go to a top-level "Zotero Unfiled" category.
 */

const {
  buildZoteroItemMetadata,
  zoteroItemIdentity,
} = require('../../src/shared/zoteroItemMetadata.cjs');

const UNFILED_CATEGORY_NAME = 'Zotero Unfiled';
const UNTITLED_COLLECTION_NAME = 'Untitled Zotero Collection';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Case-insensitive identity of a category path (ancestors -> leaf). */
function zoteroCategoryPathKey(names) {
  return (Array.isArray(names) ? names : [])
    .map((name) => cleanString(name).toLocaleLowerCase())
    .join('::');
}

/** Ancestor -> leaf names for a Zotero collection, cycle-safe. */
function collectionCategoryPath(collection, collections) {
  const byKey = new Map(
    (Array.isArray(collections) ? collections : []).map((entry) => [entry.collectionKey, entry]),
  );
  const path = [];
  const seen = new Set();
  let current = collection;

  while (current) {
    if (seen.has(current.collectionKey)) {
      throw new Error('Zotero collection tree contains a cycle');
    }
    seen.add(current.collectionKey);
    path.unshift(cleanString(current.name) || UNTITLED_COLLECTION_NAME);
    current = current.parentCollectionKey ? byKey.get(current.parentCollectionKey) : null;
  }

  return path;
}

/** Map every existing user category path to its id (first match wins). */
function buildExistingCategoryPathIndex(existingCategories) {
  const categories = Array.isArray(existingCategories) ? existingCategories : [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const index = new Map();

  for (const category of categories) {
    if (category.isSystem) continue;
    const names = [];
    const seen = new Set();
    let current = category;
    while (current && !current.isSystem) {
      if (seen.has(current.id)) break;
      seen.add(current.id);
      names.unshift(cleanString(current.name));
      current = current.parentId ? byId.get(current.parentId) : null;
    }
    const key = zoteroCategoryPathKey(names);
    if (!index.has(key)) index.set(key, category.id);
  }

  return index;
}

/**
 * Build the category/import plan for a Zotero sync.
 *
 * `items` entries may carry `collectionKeys: string[]`; items with an empty
 * array are reported as unfiled. `categoriesToCreate` is ordered so parents
 * come before children and entries carry the collection key they belong to.
 */
function buildZoteroImportPlan({
  collections = [],
  items = [],
  existingCategories = [],
  unfiledCategoryName = UNFILED_CATEGORY_NAME,
} = {}) {
  const collectionList = Array.isArray(collections) ? collections : [];
  const itemList = Array.isArray(items) ? items : [];
  const existingIdByPath = buildExistingCategoryPathIndex(existingCategories);
  const pathByCollectionKey = new Map();

  for (const collection of collectionList) {
    pathByCollectionKey.set(collection.collectionKey, collectionCategoryPath(collection, collectionList));
  }

  const orderedCollections = [...collectionList].sort((left, right) => {
    const leftPath = pathByCollectionKey.get(left.collectionKey) ?? [];
    const rightPath = pathByCollectionKey.get(right.collectionKey) ?? [];
    if (leftPath.length !== rightPath.length) return leftPath.length - rightPath.length;
    return zoteroCategoryPathKey(leftPath).localeCompare(zoteroCategoryPathKey(rightPath));
  });

  const categoriesToCreate = [];
  const categoryIdByCollectionKey = {};
  const plannedPaths = new Set(existingIdByPath.keys());

  for (const collection of orderedCollections) {
    const path = pathByCollectionKey.get(collection.collectionKey) ?? [];
    const key = zoteroCategoryPathKey(path);
    const existingId = existingIdByPath.get(key);
    if (existingId) {
      categoryIdByCollectionKey[collection.collectionKey] = existingId;
      continue;
    }
    if (!plannedPaths.has(key)) {
      categoriesToCreate.push({
        kind: 'collection',
        name: path[path.length - 1] ?? UNTITLED_COLLECTION_NAME,
        parentPath: path.slice(0, -1),
        collectionKey: collection.collectionKey,
      });
      plannedPaths.add(key);
    }
  }

  const hasMembership = itemList.some((item) => Array.isArray(item?.collectionKeys));
  const unfiledItems = hasMembership
    ? itemList.filter((item) => !Array.isArray(item?.collectionKeys) || item.collectionKeys.length === 0)
    : [];

  let unfiledCategory = null;
  if (unfiledItems.length > 0) {
    const key = zoteroCategoryPathKey([unfiledCategoryName]);
    const existingId = existingIdByPath.get(key) ?? null;
    unfiledCategory = {
      name: unfiledCategoryName,
      parentPath: [],
      existingCategoryId: existingId,
    };
    if (!existingId) {
      categoriesToCreate.push({
        kind: 'unfiled',
        name: unfiledCategoryName,
        parentPath: [],
        collectionKey: null,
      });
    }
  }

  return {
    categoriesToCreate,
    categoryIdByCollectionKey,
    categoryPathByCollectionKey: Object.fromEntries(pathByCollectionKey),
    existingCategoryIdByPath: Object.fromEntries(existingIdByPath),
    unfiledItems,
    unfiledCategory,
  };
}

module.exports = {
  UNFILED_CATEGORY_NAME,
  UNTITLED_COLLECTION_NAME,
  buildZoteroItemMetadata,
  zoteroItemIdentity,
  zoteroCategoryPathKey,
  collectionCategoryPath,
  buildZoteroImportPlan,
};
