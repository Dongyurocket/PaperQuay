'use strict';

const { cleanString } = require('./utils.cjs');

/**
 * 文库 SQL 下推查询（方案 P2-1）：筛选/搜索/排序/分页在 SQLite 内完成，
 * 不再把全库加载进 JS。语义对齐 libraryStore.cjs 的 paperMatches/sortPapers，
 * 已知的可控差异：
 * - 排序使用 SQLite 序列（BINARY/lower()），与 JS localeCompare 在非 ASCII
 *   并列时可能不同；分页稳定性的唯一兜底是 p.id ASC。
 * - recent 系统分类同毫秒导入的并列顺序可能不同。
 */

const RECENT_CATEGORY_SIZE = 30;
const MAX_QUERY_LIMIT = 5000;
const DEFAULT_QUERY_LIMIT = 300;

const SEARCH_COLUMNS = ['title', 'title_zh', 'year', 'publication', 'doi', 'abstract_text'];

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function normalizePage(request = {}) {
  const rawLimit = Number(request.limit);
  const rawOffset = Number(request.offset);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.trunc(rawLimit)))
    : DEFAULT_QUERY_LIMIT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  return { limit, offset };
}

/**
 * 构建筛选 WHERE 片段。返回 { cteSql, whereSql, params }，params 顺序与
 * SQL 文本中的占位符顺序一致（递归 CTE 的参数在最前）。
 */
function buildLibraryFilter(db, request = {}) {
  const where = [];
  const params = [];
  let cteSql = '';

  const categoryId = cleanString(request.categoryId);
  if (categoryId) {
    const category = db
      .prepare(
        'SELECT id, system_key AS systemKey FROM categories WHERE id = ? OR (is_system = 1 AND system_key = ?)',
      )
      .get(categoryId, categoryId);

    if (category?.systemKey === 'recent') {
      where.push(
        `p.id IN (SELECT id FROM papers ORDER BY imported_at DESC, title ASC LIMIT ${RECENT_CATEGORY_SIZE})`,
      );
    } else if (category?.systemKey === 'uncategorized') {
      where.push('NOT EXISTS (SELECT 1 FROM paper_categories pc WHERE pc.paper_id = p.id)');
    } else if (category?.systemKey === 'favorites') {
      where.push('p.is_favorite = 1');
    } else if (category?.systemKey === 'all') {
      // "所有文献"系统分类：不限制分类，与 JS paperMatches 语义保持一致。
    } else if (category && !category.systemKey) {
      cteSql = `WITH RECURSIVE filter_cat_ids(id) AS (
        SELECT ?
        UNION ALL
        SELECT c.id FROM categories c JOIN filter_cat_ids f ON c.parent_id = f.id
      )`;
      params.push(category.id);
      where.push(
        'EXISTS (SELECT 1 FROM paper_categories pc WHERE pc.paper_id = p.id AND pc.category_id IN (SELECT id FROM filter_cat_ids))',
      );
    } else {
      // 未知分类：与 JS paperMatches 一致，匹配为空。
      where.push('1 = 0');
    }
  }

  const tagId = cleanString(request.tagId);
  if (tagId) {
    where.push('EXISTS (SELECT 1 FROM tags t WHERE t.paper_id = p.id AND t.id = ?)');
    params.push(tagId);
  }

  const search = cleanString(request.search).toLowerCase();
  if (search) {
    const like = `%${escapeLike(search)}%`;
    const clauses = SEARCH_COLUMNS.map(
      (column) => `lower(COALESCE(p.${column}, '')) LIKE ? ESCAPE '\\'`,
    );
    clauses.push(
      `EXISTS (SELECT 1 FROM paper_keywords k WHERE k.paper_id = p.id AND lower(k.keyword) LIKE ? ESCAPE '\\')`,
    );
    clauses.push(
      `EXISTS (SELECT 1 FROM authors a WHERE a.paper_id = p.id AND lower(a.name) LIKE ? ESCAPE '\\')`,
    );
    clauses.push(
      `EXISTS (SELECT 1 FROM tags t WHERE t.paper_id = p.id AND lower(t.name) LIKE ? ESCAPE '\\')`,
    );
    where.push(`(${clauses.join(' OR ')})`);
    for (let index = 0; index < clauses.length; index += 1) params.push(like);
  }

  return {
    cteSql,
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

/**
 * 排序子句。所有排序都以 p.id ASC 兜底，保证分页边界稳定（方案 §3.2）。
 * manual 固定升序，与 JS sortPapers 一致。
 */
function libraryOrderClause(request = {}) {
  const sortBy = cleanString(request.sortBy) || 'manual';
  const direction = request.sortDirection === 'asc' ? 'ASC' : 'DESC';

  switch (sortBy) {
    case 'title':
      return `ORDER BY lower(COALESCE(p.title, '')) ${direction}, p.id ASC`;
    case 'year':
      return `ORDER BY COALESCE(p.year, '') ${direction}, p.id ASC`;
    case 'author':
      return `ORDER BY lower(COALESCE((SELECT a.name FROM authors a WHERE a.paper_id = p.id ORDER BY a.sort_order LIMIT 1), '')) ${direction}, p.id ASC`;
    case 'updatedAt':
      return `ORDER BY p.updated_at ${direction}, p.id ASC`;
    case 'lastReadAt':
      return `ORDER BY COALESCE(p.last_read_at, 0) ${direction}, p.id ASC`;
    case 'importedAt':
      return `ORDER BY p.imported_at ${direction}, p.id ASC`;
    default:
      return 'ORDER BY p.sort_order ASC, p.id ASC';
  }
}

module.exports = {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  RECENT_CATEGORY_SIZE,
  buildLibraryFilter,
  escapeLike,
  libraryOrderClause,
  normalizePage,
};
