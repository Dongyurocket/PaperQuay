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
const FILTERABLE_ITEM_TYPES = new Set([
  'journalArticle', 'book', 'bookSection', 'conferencePaper', 'thesis', 'report', 'preprint', 'misc',
]);
const METADATA_FIELD_APPLICABILITY = {
  title: null, authors: null, year: null, abstractText: null, keywords: null, url: null,
  doi: ['journalArticle', 'conferencePaper', 'preprint'],
  publication: ['journalArticle', 'conferencePaper', 'bookSection', 'preprint'],
  publisher: ['journalArticle', 'conferencePaper', 'book', 'bookSection', 'report'],
  institution: ['thesis', 'report'], reportNumber: ['report'],
  volume: ['journalArticle'], issue: ['journalArticle'], pages: ['journalArticle', 'conferencePaper', 'bookSection'],
  isbn: ['book', 'bookSection', 'conferencePaper'], issn: ['journalArticle'],
};
const METADATA_FIELD_SQL = {
  title: "pq_trim(COALESCE(p.title, '')) = ''",
  authors: "NOT EXISTS (SELECT 1 FROM authors ma WHERE ma.paper_id = p.id AND pq_trim(ma.name) != '')",
  year: "pq_trim(COALESCE(p.year, '')) = ''",
  abstractText: "pq_trim(COALESCE(p.abstract_text, '')) = ''",
  keywords: "NOT EXISTS (SELECT 1 FROM paper_keywords mk WHERE mk.paper_id = p.id AND pq_trim(mk.keyword) != '')",
  url: "pq_trim(COALESCE(p.url, '')) = ''", doi: "pq_trim(COALESCE(p.doi, '')) = ''",
  publication: "pq_trim(COALESCE(p.publication, '')) = ''", publisher: "pq_trim(COALESCE(p.publisher, '')) = ''",
  institution: "pq_trim(COALESCE(p.institution, '')) = ''", reportNumber: "pq_trim(COALESCE(p.report_number, '')) = ''",
  volume: "pq_trim(COALESCE(p.volume, '')) = ''", issue: "pq_trim(COALESCE(p.issue, '')) = ''",
  pages: "pq_trim(COALESCE(p.pages, '')) = ''", isbn: "pq_trim(COALESCE(p.isbn, '')) = ''",
  issn: "pq_trim(COALESCE(p.issn, '')) = ''",
};

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

function normalizeYearBound(value, fieldName) {
  if (value == null || value === '') return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error(`Invalid ${fieldName} year filter`);
  }
  return year;
}

function normalizeProgressBound(value, fieldName) {
  if (value == null || value === '') return null;
  const progress = Number(value);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    throw new Error(`Invalid ${fieldName} reading progress filter`);
  }
  return progress;
}

function normalizeTimestampBound(value, fieldName) {
  if (value == null || value === '') return null;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`Invalid ${fieldName} timestamp filter`);
  }
  return timestamp;
}

function isUnknownYearSql() {
  return "(p.year IS NULL OR p.year NOT GLOB '[0-9][0-9][0-9][0-9]*')";
}

/**
 * 构建筛选 WHERE 片段。返回 { cteSql, whereSql, params }，params 顺序与
 * SQL 文本中的占位符顺序一致（递归 CTE 的参数在最前）。
 */
function buildLibraryFilter(db, request = {}) {
  const where = [];
  const params = [];
  let cteSql = '';

  const mineruParseStatus = cleanString(request.mineruParseStatus);
  if (mineruParseStatus) {
    if (!['unknown', 'available', 'missing', 'error'].includes(mineruParseStatus)) {
      throw new Error(`Unsupported mineruParseStatus filter: ${mineruParseStatus}`);
    }
    const freshAfter = Date.now() - 24 * 60 * 60 * 1000;
    if (mineruParseStatus === 'unknown') {
      where.push(`NOT EXISTS (
        SELECT 1 FROM paper_processing_status ps
        WHERE ps.paper_id = p.id
          AND (ps.mineru_status = 'error' OR (
            ps.mineru_status IN ('available', 'missing') AND ps.mineru_checked_at >= ?
          ))
          AND ps.mineru_source_version != ''
      )`);
      params.push(freshAfter);
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM paper_processing_status ps
        WHERE ps.paper_id = p.id
          AND ps.mineru_source_version != ''
          AND ps.mineru_status = ?
          AND (? = 0 OR ps.mineru_checked_at >= ?)
      )`);
      params.push(mineruParseStatus);
      params.push(mineruParseStatus === 'error' ? 0 : 1, freshAfter);
    }
  }

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

  if (request.ragEnabled === true) {
    where.push('COALESCE(p.rag_enabled, 1) != 0');
  } else if (request.ragEnabled === false) {
    where.push('p.rag_enabled = 0');
  }

  if (request.isFavorite === true) {
    where.push('p.is_favorite = 1');
  } else if (request.isFavorite === false) {
    where.push('p.is_favorite = 0');
  }

  if (request.isRead === true) where.push('p.last_read_at IS NOT NULL');
  else if (request.isRead === false) where.push('p.last_read_at IS NULL');

  const progressFrom = normalizeProgressBound(request.progressFrom, 'progressFrom');
  const progressTo = normalizeProgressBound(request.progressTo, 'progressTo');
  if (progressFrom !== null && progressTo !== null && progressFrom > progressTo) {
    throw new Error('Invalid reading progress range: progressFrom exceeds progressTo');
  }
  if (progressFrom !== null) {
    where.push('p.reading_progress * 100 >= ?');
    params.push(progressFrom);
  }
  if (progressTo !== null) {
    where.push('p.reading_progress * 100 <= ?');
    params.push(progressTo);
  }

  for (const [requestPrefix, column] of [['importedAt', 'p.imported_at'], ['lastReadAt', 'p.last_read_at']]) {
    const from = normalizeTimestampBound(request[`${requestPrefix}From`], `${requestPrefix}From`);
    const to = normalizeTimestampBound(request[`${requestPrefix}To`], `${requestPrefix}To`);
    if (from !== null && to !== null && from > to) {
      throw new Error(`Invalid ${requestPrefix} range: from exceeds to`);
    }
    if (from !== null) {
      where.push(`${column} >= ?`);
      params.push(from);
    }
    if (to !== null) {
      where.push(`${column} <= ?`);
      params.push(to);
    }
  }

  const attachmentRole = cleanString(request.attachmentRole);
  if (attachmentRole === 'original-pdf') {
    where.push("EXISTS (SELECT 1 FROM attachments a WHERE a.paper_id = p.id AND a.kind IN ('pdf', 'original-pdf') AND a.missing = 0)");
  } else if (attachmentRole === 'translated-pdf') {
    where.push("EXISTS (SELECT 1 FROM attachments a WHERE a.paper_id = p.id AND a.kind = 'translated-pdf' AND a.missing = 0)");
  } else if (attachmentRole === 'missing') {
    where.push('EXISTS (SELECT 1 FROM attachments a WHERE a.paper_id = p.id AND a.missing = 1)');
  } else if (attachmentRole === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM attachments a WHERE a.paper_id = p.id)');
  } else if (attachmentRole && attachmentRole !== 'any') {
    throw new Error(`Unsupported attachmentRole filter: ${attachmentRole}`);
  }

  const missingMetadataFields = Array.isArray(request.missingMetadataFields)
    ? [...new Set(request.missingMetadataFields.map(cleanString).filter(Boolean))]
    : [];
  if (missingMetadataFields.length) {
    const clauses = missingMetadataFields.map((field) => {
      const missingSql = METADATA_FIELD_SQL[field];
      if (!missingSql) throw new Error(`Unsupported missing metadata field: ${field}`);
      const applicableTypes = METADATA_FIELD_APPLICABILITY[field];
      const applicabilitySql = applicableTypes
        ? `COALESCE(NULLIF(p.item_type, ''), 'journalArticle') IN (${applicableTypes.map(() => '?').join(', ')})`
        : '1 = 1';
      if (applicableTypes) params.push(...applicableTypes);
      return `(${applicabilitySql} AND ${missingSql})`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  }

  const itemType = cleanString(request.itemType);
  if (itemType) {
    if (!FILTERABLE_ITEM_TYPES.has(itemType)) {
      throw new Error(`Unsupported itemType filter: ${itemType}`);
    }
    where.push("COALESCE(NULLIF(p.item_type, ''), 'journalArticle') = ?");
    params.push(itemType);
  }

  const yearFrom = normalizeYearBound(request.yearFrom, 'yearFrom');
  const yearTo = normalizeYearBound(request.yearTo, 'yearTo');
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    throw new Error('Invalid year range: yearFrom exceeds yearTo');
  }
  if (request.unknownYearOnly === true) {
    where.push(isUnknownYearSql());
  } else if (yearFrom !== null || yearTo !== null) {
    const yearExpression = "CASE WHEN p.year GLOB '[0-9][0-9][0-9][0-9]*' THEN CAST(substr(p.year, 1, 4) AS INTEGER) END";
    if (yearFrom !== null) {
      where.push(`${yearExpression} >= ?`);
      params.push(yearFrom);
    }
    if (yearTo !== null) {
      where.push(`${yearExpression} <= ?`);
      params.push(yearTo);
    }
  }

  const authorQuery = cleanString(request.authorQuery).toLowerCase();
  if (authorQuery) {
    where.push("EXISTS (SELECT 1 FROM authors a WHERE a.paper_id = p.id AND pq_casefold(a.name) LIKE ? ESCAPE '\\')");
    params.push(`%${escapeLike(authorQuery)}%`);
  }

  const publicationQuery = cleanString(request.publicationQuery).toLowerCase();
  if (publicationQuery) {
    where.push("pq_casefold(COALESCE(p.publication, '')) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(publicationQuery)}%`);
  }

  const keywordQuery = cleanString(request.keywordQuery).toLowerCase();
  if (keywordQuery) {
    where.push("EXISTS (SELECT 1 FROM paper_keywords k WHERE k.paper_id = p.id AND pq_casefold(k.keyword) LIKE ? ESCAPE '\\')");
    params.push(`%${escapeLike(keywordQuery)}%`);
  }

  const tagNames = Array.isArray(request.tagNames)
    ? [...new Set(request.tagNames.map((value) => cleanString(value).toLowerCase()).filter(Boolean))]
    : [];
  if (tagNames.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM tags t WHERE t.paper_id = p.id AND pq_casefold(pq_trim(t.name)) IN (${tagNames.map(() => '?').join(', ')}))`);
    params.push(...tagNames);
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
      (column) => `pq_casefold(COALESCE(p.${column}, '')) LIKE ? ESCAPE '\\'`,
    );
    clauses.push(
      `EXISTS (SELECT 1 FROM paper_keywords k WHERE k.paper_id = p.id AND pq_casefold(k.keyword) LIKE ? ESCAPE '\\')`,
    );
    clauses.push(
      `EXISTS (SELECT 1 FROM authors a WHERE a.paper_id = p.id AND pq_casefold(a.name) LIKE ? ESCAPE '\\')`,
    );
    clauses.push(
      `EXISTS (SELECT 1 FROM tags t WHERE t.paper_id = p.id AND pq_casefold(t.name) LIKE ? ESCAPE '\\')`,
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
  normalizeYearBound,
};
