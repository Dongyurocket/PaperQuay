const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync, sqlStringLiteral, withTransaction } = require('./nodeSqlite.cjs');
const { cleanString, readJson, writeJsonSync } = require('./utils.cjs');
const {
  buildLibraryFilter,
  libraryOrderClause,
  normalizePage,
} = require('./libraryQuery.cjs');

function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  createSchema(db);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webdav_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER NOT NULL,
      is_system INTEGER NOT NULL,
      system_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      title_zh TEXT,
      year TEXT,
      publication TEXT,
      doi TEXT,
      url TEXT,
      abstract_text TEXT,
      item_type TEXT,
      publisher TEXT,
      institution TEXT,
      report_number TEXT,
      volume TEXT,
      issue TEXT,
      pages TEXT,
      isbn TEXT,
      issn TEXT,
      imported_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_read_at INTEGER,
      reading_progress REAL NOT NULL,
      is_favorite INTEGER NOT NULL,
      user_note TEXT,
      ai_summary TEXT,
      citation TEXT,
      source TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_keywords (
      paper_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (paper_id, sort_order),
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS authors (
      id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      name TEXT NOT NULL,
      given_name TEXT,
      family_name TEXT,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS paper_categories (
      paper_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (paper_id, category_id),
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      original_path TEXT,
      stored_path TEXT NOT NULL,
      relative_path TEXT,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      content_hash TEXT,
      created_at INTEGER NOT NULL,
      missing INTEGER NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS paper_references (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      doi TEXT,
      title TEXT,
      authors TEXT,
      year TEXT,
      journal TEXT,
      volume TEXT,
      issue TEXT,
      pages TEXT,
      unstructured TEXT,
      fetched_at INTEGER NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_papers_sort_order ON papers(sort_order);
    CREATE INDEX IF NOT EXISTS idx_papers_imported_at ON papers(imported_at);
    CREATE INDEX IF NOT EXISTS idx_papers_is_favorite ON papers(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_attachments_paper_id ON attachments(paper_id);
    CREATE INDEX IF NOT EXISTS idx_authors_paper_id ON authors(paper_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_tags_paper_id ON tags(paper_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_paper_categories_category_id ON paper_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_paper_references_paper_id ON paper_references(paper_id);
    CREATE INDEX IF NOT EXISTS idx_paper_references_doi ON paper_references(doi);
  `);

  migrateRepeatedIdListTable(db, 'authors', `
    CREATE TABLE authors (
      id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      name TEXT NOT NULL,
      given_name TEXT,
      family_name TEXT,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    )
  `, 'id, paper_id, name, given_name, family_name, sort_order');

  migrateRepeatedIdListTable(db, 'tags', `
    CREATE TABLE tags (
      id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
    )
  `, 'id, paper_id, name, color, sort_order');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_authors_paper_id ON authors(paper_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_tags_paper_id ON tags(paper_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_paper_references_paper_id ON paper_references(paper_id);
    CREATE INDEX IF NOT EXISTS idx_paper_references_doi ON paper_references(doi);
  `);

  ensureColumn(db, 'papers', 'title_zh', 'TEXT');
  ensureColumn(db, 'papers', 'item_type', 'TEXT');
  ensureColumn(db, 'papers', 'publisher', 'TEXT');
  ensureColumn(db, 'papers', 'institution', 'TEXT');
  ensureColumn(db, 'papers', 'report_number', 'TEXT');
  ensureColumn(db, 'papers', 'volume', 'TEXT');
  ensureColumn(db, 'papers', 'issue', 'TEXT');
  ensureColumn(db, 'papers', 'pages', 'TEXT');
  ensureColumn(db, 'papers', 'isbn', 'TEXT');
  ensureColumn(db, 'papers', 'issn', 'TEXT');
}

function ensureColumn(db, tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();

  if (columns.some((column) => column.name === columnName)) return;

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function tableHasPrimaryKey(db, tableName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => Number(column.pk) > 0);
}

function migrateRepeatedIdListTable(db, tableName, createSql, columns) {
  if (!tableHasPrimaryKey(db, tableName)) return;

  const tempTableName = `${tableName}_legacy_${Date.now()}`;

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    withTransaction(db, () => {
      db.exec(`ALTER TABLE ${tableName} RENAME TO ${tempTableName}`);
      db.exec(createSql);
      db.exec(`
        INSERT INTO ${tableName} (${columns})
        SELECT ${columns}
        FROM ${tempTableName}
      `);
      db.exec(`DROP TABLE ${tempTableName}`);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function boolToInteger(value) {
  return value ? 1 : 0;
}

function parseJsonValue(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadKeyValueTable(db, tableName) {
  return Object.fromEntries(
    db
      .prepare(`SELECT key, value_json FROM ${tableName} ORDER BY key`)
      .all()
      .map((row) => [row.key, parseJsonValue(row.value_json)]),
  );
}

function saveKeyValueTable(db, tableName, values) {
  db.prepare(`DELETE FROM ${tableName}`).run();
  const insert = db.prepare(`INSERT INTO ${tableName} (key, value_json) VALUES (?, ?)`);

  for (const [key, value] of Object.entries(values ?? {})) {
    insert.run(key, JSON.stringify(value ?? null));
  }
}

function rowsByPaperId(rows) {
  const grouped = new Map();

  for (const row of rows) {
    if (!grouped.has(row.paper_id)) grouped.set(row.paper_id, []);
    grouped.get(row.paper_id).push(row);
  }

  return grouped;
}

const PAPER_SELECT_COLUMNS = `
  id,
  title,
  title_zh AS titleZh,
  year,
  publication,
  doi,
  url,
  abstract_text AS abstractText,
  item_type AS itemType,
  publisher,
  institution,
  report_number AS reportNumber,
  volume,
  issue,
  pages,
  isbn,
  issn,
  imported_at AS importedAt,
  updated_at AS updatedAt,
  last_read_at AS lastReadAt,
  reading_progress AS readingProgress,
  is_favorite AS isFavorite,
  user_note AS userNote,
  ai_summary AS aiSummary,
  citation,
  source,
  sort_order AS sortOrder
`;

function mapPaperRows(paperRows, { keywordRows, authorRows, tagRows, categoryRows, attachmentRows }) {
  return paperRows.map((paper) => ({
    ...paper,
    isFavorite: Boolean(paper.isFavorite),
    keywords: (keywordRows.get(paper.id) ?? []).map((row) => row.keyword),
    authors: (authorRows.get(paper.id) ?? []).map(({ paper_id: _paperId, ...author }) => author),
    tags: (tagRows.get(paper.id) ?? []).map(({ paper_id: _paperId, ...tag }) => tag),
    categoryIds: (categoryRows.get(paper.id) ?? []).map((row) => row.category_id),
    attachments: (attachmentRows.get(paper.id) ?? []).map(({ paper_id: _paperId, missing, ...attachment }) => ({
      ...attachment,
      paperId: paper.id,
      missing: Boolean(missing),
    })),
  }));
}

/**
 * 只为给定 papers 行加载关联表（keywords/authors/tags/categories/attachments），
 * 供 SQL 分页按页水合，避免全库关联扫描。
 */
function hydratePaperRows(db, paperRows) {
  if (paperRows.length === 0) return [];

  const ids = paperRows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  const keywordRows = rowsByPaperId(db.prepare(`
    SELECT paper_id, keyword
    FROM paper_keywords
    WHERE paper_id IN (${placeholders})
    ORDER BY paper_id, sort_order
  `).all(...ids));
  const authorRows = rowsByPaperId(db.prepare(`
    SELECT
      paper_id,
      id,
      name,
      given_name AS givenName,
      family_name AS familyName,
      sort_order AS sortOrder
    FROM authors
    WHERE paper_id IN (${placeholders})
    ORDER BY paper_id, sort_order
  `).all(...ids));
  const tagRows = rowsByPaperId(db.prepare(`
    SELECT
      paper_id,
      id,
      name,
      color,
      sort_order AS sortOrder
    FROM tags
    WHERE paper_id IN (${placeholders})
    ORDER BY paper_id, sort_order
  `).all(...ids));
  const categoryRows = rowsByPaperId(db.prepare(`
    SELECT paper_id, category_id
    FROM paper_categories
    WHERE paper_id IN (${placeholders})
    ORDER BY paper_id, sort_order
  `).all(...ids));
  const attachmentRows = rowsByPaperId(db.prepare(`
    SELECT
      paper_id,
      id,
      kind,
      original_path AS originalPath,
      stored_path AS storedPath,
      relative_path AS relativePath,
      file_name AS fileName,
      mime_type AS mimeType,
      file_size AS fileSize,
      content_hash AS contentHash,
      created_at AS createdAt,
      missing
    FROM attachments
    WHERE paper_id IN (${placeholders})
    ORDER BY paper_id, created_at, id
  `).all(...ids));

  return mapPaperRows(paperRows, { keywordRows, authorRows, tagRows, categoryRows, attachmentRows });
}

/** SQL 分页查询（P2-1）：筛选/搜索/排序/分页全部下推，返回 { papers, total, offset, limit }。 */
function queryPapersFromDb(db, request = {}) {
  const { limit, offset } = normalizePage(request);
  const filter = buildLibraryFilter(db, request);
  const total = db
    .prepare(`${filter.cteSql} SELECT COUNT(*) AS n FROM papers p ${filter.whereSql}`)
    .get(...filter.params).n;
  const rows = db
    .prepare(
      `${filter.cteSql} SELECT ${PAPER_SELECT_COLUMNS} FROM papers p ${filter.whereSql} ${libraryOrderClause(request)} LIMIT ? OFFSET ?`,
    )
    .all(...filter.params, limit, offset);

  return { papers: hydratePaperRows(db, rows), total, offset, limit };
}

/** 与 queryPapersFromDb 同筛选的完整匹配计数（独立 COUNT 查询，不取行）。 */
function countPapersFromDb(db, request = {}) {
  const filter = buildLibraryFilter(db, request);
  return db
    .prepare(`${filter.cteSql} SELECT COUNT(*) AS n FROM papers p ${filter.whereSql}`)
    .get(...filter.params).n;
}

/** 与 queryPapersFromDb 同筛选同排序，仅枚举 id（供全选/批量目标分批枚举，P2-2）。 */
function listPaperIdsFromDb(db, request = {}) {
  const { limit, offset } = normalizePage({ ...request, limit: request?.limit ?? 1000 });
  const filter = buildLibraryFilter(db, request);
  const rows = db
    .prepare(
      `${filter.cteSql} SELECT p.id FROM papers p ${filter.whereSql} ${libraryOrderClause(request)} LIMIT ? OFFSET ?`,
    )
    .all(...filter.params, limit, offset);

  return rows.map((row) => row.id);
}

/** 分类计数独立查询（P2-1）：与 libraryStore.categoryCounts 语义一致，但不加载全库。 */
function categoryCountsFromDb(db) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM papers').get().n;
  const counts = new Map();
  counts.set('all', total);
  counts.set('recent', Math.min(30, total));
  counts.set(
    'uncategorized',
    db.prepare('SELECT COUNT(*) AS n FROM papers p WHERE NOT EXISTS (SELECT 1 FROM paper_categories pc WHERE pc.paper_id = p.id)').get().n,
  );
  counts.set('favorites', db.prepare('SELECT COUNT(*) AS n FROM papers WHERE is_favorite = 1').get().n);

  const categories = db.prepare('SELECT id, is_system AS isSystem FROM categories').all();
  const countDescendants = db.prepare(`
    WITH RECURSIVE d(id) AS (
      SELECT ?
      UNION ALL
      SELECT c.id FROM categories c JOIN d ON c.parent_id = d.id
    )
    SELECT COUNT(DISTINCT pc.paper_id) AS n FROM paper_categories pc WHERE pc.category_id IN (SELECT id FROM d)
  `);

  for (const category of categories) {
    if (category.isSystem) continue;
    counts.set(category.id, countDescendants.get(category.id).n);
  }

  return counts;
}

/** 分类列表 + 计数（替代 attachCategoryCounts(store.load())，不加载 papers）。 */
function listCategoriesWithCountsFromDb(db) {
  const counts = categoryCountsFromDb(db);
  const categories = db.prepare(`
    SELECT
      id,
      name,
      parent_id AS parentId,
      sort_order AS sortOrder,
      is_system AS isSystem,
      system_key AS systemKey,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM categories
    ORDER BY is_system DESC, (parent_id IS NOT NULL), sort_order, name
  `).all();

  return categories.map((category) => ({
    ...category,
    isSystem: Boolean(category.isSystem),
    paperCount: category.isSystem ? counts.get(category.systemKey) ?? 0 : counts.get(category.id) ?? 0,
  }));
}

function getPaperFromDb(db, paperId) {
  const id = cleanString(paperId);
  if (!id) return null;
  const row = db.prepare(`SELECT ${PAPER_SELECT_COLUMNS} FROM papers WHERE id = ?`).get(id);
  if (!row) return null;
  return hydratePaperRows(db, [row])[0];
}

function getPaperIdByAttachmentId(db, attachmentId) {
  const row = db
    .prepare('SELECT paper_id AS paperId FROM attachments WHERE id = ?')
    .get(cleanString(attachmentId));
  return row?.paperId ?? null;
}

function loadLibraryFromDb(db, appPaths, normalizeLibrary) {
  const settings = loadKeyValueTable(db, 'library_settings');
  const webdav = loadKeyValueTable(db, 'webdav_settings');
  const categories = db.prepare(`
    SELECT
      id,
      name,
      parent_id AS parentId,
      sort_order AS sortOrder,
      is_system AS isSystem,
      system_key AS systemKey,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM categories
    ORDER BY is_system DESC, sort_order, name
  `).all().map((category) => ({
    ...category,
    isSystem: Boolean(category.isSystem),
    paperCount: 0,
  }));
  const authorRows = rowsByPaperId(db.prepare(`
    SELECT
      paper_id,
      id,
      name,
      given_name AS givenName,
      family_name AS familyName,
      sort_order AS sortOrder
    FROM authors
    ORDER BY paper_id, sort_order
  `).all());
  const tagRows = rowsByPaperId(db.prepare(`
    SELECT
      paper_id,
      id,
      name,
      color,
      sort_order AS sortOrder
    FROM tags
    ORDER BY paper_id, sort_order
  `).all());
  const keywordRows = rowsByPaperId(db.prepare(`
    SELECT paper_id, keyword
    FROM paper_keywords
    ORDER BY paper_id, sort_order
  `).all());
  const categoryRows = rowsByPaperId(db.prepare(`
    SELECT paper_id, category_id
    FROM paper_categories
    ORDER BY paper_id, sort_order
  `).all());
  const attachmentRows = rowsByPaperId(db.prepare(`
    SELECT
      paper_id,
      id,
      kind,
      original_path AS originalPath,
      stored_path AS storedPath,
      relative_path AS relativePath,
      file_name AS fileName,
      mime_type AS mimeType,
      file_size AS fileSize,
      content_hash AS contentHash,
      created_at AS createdAt,
      missing
    FROM attachments
    ORDER BY paper_id, created_at, id
  `).all());
  const papers = mapPaperRows(
    db.prepare(`SELECT ${PAPER_SELECT_COLUMNS} FROM papers ORDER BY sort_order, title`).all(),
    { keywordRows, authorRows, tagRows, categoryRows, attachmentRows },
  );

  return normalizeLibrary({
    version: 1,
    settings,
    webdav,
    categories,
    papers,
  }, appPaths);
}

function clearData(db) {
  for (const table of [
    'attachments',
    'paper_categories',
    'tags',
    'authors',
    'paper_keywords',
    'papers',
    'categories',
    'library_settings',
    'webdav_settings',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

function normalizeReferenceRow(row) {
  return {
    id: cleanString(row?.id),
    paperId: cleanString(row?.paperId || row?.paper_id),
    seq: Number(row?.seq) || 0,
    doi: cleanString(row?.doi),
    title: cleanString(row?.title),
    authors: cleanString(row?.authors),
    year: cleanString(row?.year),
    journal: cleanString(row?.journal),
    volume: cleanString(row?.volume),
    issue: cleanString(row?.issue),
    pages: cleanString(row?.pages),
    unstructured: cleanString(row?.unstructured),
    fetchedAt: Number(row?.fetchedAt || row?.fetched_at) || 0,
  };
}

function loadReferenceRows(db, paperId = '') {
  const sql = `
    SELECT
      id,
      paper_id AS paperId,
      seq,
      doi,
      title,
      authors,
      year,
      journal,
      volume,
      issue,
      pages,
      unstructured,
      fetched_at AS fetchedAt
    FROM paper_references
    ${paperId ? 'WHERE paper_id = ?' : ''}
    ORDER BY paper_id, seq
  `;
  const statement = db.prepare(sql);
  const rows = paperId ? statement.all(paperId) : statement.all();
  return rows.map(normalizeReferenceRow);
}

function saveReferenceRows(db, paperId, refs) {
  const normalizedPaperId = cleanString(paperId);
  if (!normalizedPaperId) {
    return [];
  }

  const fetchedAt = Date.now();
  const normalizedRefs = (Array.isArray(refs) ? refs : [])
    .map((ref, index) => ({
      id: cleanString(ref?.id) || `ref:${normalizedPaperId}:${index + 1}`,
      paperId: normalizedPaperId,
      seq: Number.isFinite(Number(ref?.seq)) ? Number(ref.seq) : index + 1,
      doi: cleanString(ref?.doi).toLowerCase(),
      title: cleanString(ref?.title),
      authors: cleanString(ref?.authors),
      year: cleanString(ref?.year),
      journal: cleanString(ref?.journal),
      volume: cleanString(ref?.volume),
      issue: cleanString(ref?.issue),
      pages: cleanString(ref?.pages),
      unstructured: cleanString(ref?.unstructured),
      fetchedAt: Number(ref?.fetchedAt || ref?.fetched_at) || fetchedAt,
    }))
    .filter((ref) => ref.doi || ref.title || ref.unstructured);

  const deleteStatement = db.prepare('DELETE FROM paper_references WHERE paper_id = ?');
  const insertStatement = db.prepare(`
    INSERT INTO paper_references (
      id,
      paper_id,
      seq,
      doi,
      title,
      authors,
      year,
      journal,
      volume,
      issue,
      pages,
      unstructured,
      fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  deleteStatement.run(normalizedPaperId);
  for (const ref of normalizedRefs) {
    insertStatement.run(
      ref.id,
      ref.paperId,
      ref.seq,
      ref.doi || null,
      ref.title || null,
      ref.authors || null,
      ref.year || null,
      ref.journal || null,
      ref.volume || null,
      ref.issue || null,
      ref.pages || null,
      ref.unstructured || null,
      ref.fetchedAt,
    );
  }

  return normalizedRefs;
}

function restoreReferenceRows(db, refs, paperIds) {
  if (!Array.isArray(refs) || refs.length === 0) {
    return;
  }

  const grouped = new Map();
  for (const ref of refs) {
    const paperId = cleanString(ref.paperId);
    if (!paperId || !paperIds.has(paperId)) continue;
    if (!grouped.has(paperId)) grouped.set(paperId, []);
    grouped.get(paperId).push(ref);
  }

  for (const [paperId, paperRefs] of grouped) {
    saveReferenceRows(db, paperId, paperRefs);
  }
}

const PAPER_TABLE_COLUMNS = [
  'id',
  'title',
  'title_zh',
  'year',
  'publication',
  'doi',
  'url',
  'abstract_text',
  'item_type',
  'publisher',
  'institution',
  'report_number',
  'volume',
  'issue',
  'pages',
  'isbn',
  'issn',
  'imported_at',
  'updated_at',
  'last_read_at',
  'reading_progress',
  'is_favorite',
  'user_note',
  'ai_summary',
  'citation',
  'source',
  'sort_order',
];

const PAPER_UPSERT_ASSIGNMENTS = PAPER_TABLE_COLUMNS.filter((column) => column !== 'id')
  .map((column) => `${column} = excluded.${column}`)
  .join(', ');

function paperRowValues(paper) {
  return [
    paper.id,
    paper.title,
    paper.titleZh ?? null,
    paper.year ?? null,
    paper.publication ?? null,
    paper.doi ?? null,
    paper.url ?? null,
    paper.abstractText ?? null,
    paper.itemType ?? 'journalArticle',
    paper.publisher ?? null,
    paper.institution ?? null,
    paper.reportNumber ?? null,
    paper.volume ?? null,
    paper.issue ?? null,
    paper.pages ?? null,
    paper.isbn ?? null,
    paper.issn ?? null,
    Number(paper.importedAt) || 0,
    Number(paper.updatedAt) || 0,
    paper.lastReadAt ?? null,
    Number(paper.readingProgress) || 0,
    boolToInteger(paper.isFavorite),
    paper.userNote ?? null,
    paper.aiSummary ?? null,
    paper.citation ?? null,
    paper.source || 'local',
    Number(paper.sortOrder) || 0,
  ];
}

/**
 * 单篇/批量共用的 papers 写入器（P2-1 增量事务）：行写入 + 关联表重建。
 * 关联表（keywords/authors/tags/paper_categories/attachments）按 paper_id
 * 删除后重插；paper_references 不在此触碰，由引用命令单独维护。
 */
function createPaperWriters(db) {
  const placeholders = PAPER_TABLE_COLUMNS.map(() => '?').join(', ');
  const insertPaper = db.prepare(
    `INSERT INTO papers (${PAPER_TABLE_COLUMNS.join(', ')}) VALUES (${placeholders})`,
  );
  const upsertPaper = db.prepare(
    `INSERT INTO papers (${PAPER_TABLE_COLUMNS.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${PAPER_UPSERT_ASSIGNMENTS}`,
  );
  const deleteRelations = ['paper_keywords', 'authors', 'tags', 'paper_categories', 'attachments'].map(
    (table) => db.prepare(`DELETE FROM ${table} WHERE paper_id = ?`),
  );
  const insertKeyword = db.prepare(`
    INSERT INTO paper_keywords (paper_id, keyword, sort_order)
    VALUES (?, ?, ?)
  `);
  const insertAuthor = db.prepare(`
    INSERT INTO authors (id, paper_id, name, given_name, family_name, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertTag = db.prepare(`
    INSERT INTO tags (id, paper_id, name, color, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertPaperCategory = db.prepare(`
    INSERT INTO paper_categories (paper_id, category_id, sort_order)
    VALUES (?, ?, ?)
  `);
  const insertAttachment = db.prepare(`
    INSERT INTO attachments (
      id,
      paper_id,
      kind,
      original_path,
      stored_path,
      relative_path,
      file_name,
      mime_type,
      file_size,
      content_hash,
      created_at,
      missing
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const writers = {
    insertRow(paper) {
      insertPaper.run(...paperRowValues(paper));
    },
    upsertRow(paper) {
      upsertPaper.run(...paperRowValues(paper));
    },
    insertRelations(paper) {
      (paper.keywords ?? []).forEach((keyword, index) => {
        insertKeyword.run(paper.id, String(keyword), index);
      });
      (paper.authors ?? []).forEach((author, index) => {
        insertAuthor.run(
          author.id,
          paper.id,
          author.name,
          author.givenName ?? null,
          author.familyName ?? null,
          Number(author.sortOrder ?? index) || 0,
        );
      });
      (paper.tags ?? []).forEach((tag, index) => {
        insertTag.run(tag.id, paper.id, tag.name, tag.color ?? null, index);
      });
      (paper.categoryIds ?? []).forEach((categoryId, index) => {
        insertPaperCategory.run(paper.id, categoryId, index);
      });
      (paper.attachments ?? []).forEach((attachment) => {
        insertAttachment.run(
          attachment.id,
          paper.id,
          attachment.kind || 'pdf',
          attachment.originalPath ?? null,
          attachment.storedPath,
          attachment.relativePath ?? null,
          attachment.fileName,
          attachment.mimeType,
          Number(attachment.fileSize) || 0,
          attachment.contentHash ?? null,
          Number(attachment.createdAt) || 0,
          boolToInteger(attachment.missing),
        );
      });
    },
    replaceRelations(paper) {
      for (const statement of deleteRelations) statement.run(paper.id);
      writers.insertRelations(paper);
    },
  };

  return writers;
}

/** 单项增量事务（P2-1）：UPSERT 一篇文献并重建其关联表，不重写全库。 */
function savePaperToDb(db, paper) {
  withTransaction(db, () => {
    const writers = createPaperWriters(db);
    writers.upsertRow(paper);
    writers.replaceRelations(paper);
  });
  return paper;
}

/** 单篇删除：papers 行删除后关联表（含 paper_references）经外键级联清理。 */
function deletePaperFromDb(db, paperId) {
  const id = cleanString(paperId);
  if (!id) return;

  withTransaction(db, () => {
    db.prepare('DELETE FROM papers WHERE id = ?').run(id);
  });
}

function saveLibraryToDb(db, appPaths, normalizeLibrary, library) {
  const normalized = normalizeLibrary(library, appPaths);

  withTransaction(db, () => {
    const referenceCache = loadReferenceRows(db);
    clearData(db);
    saveKeyValueTable(db, 'library_settings', normalized.settings);
    saveKeyValueTable(db, 'webdav_settings', normalized.webdav);
    db.prepare(`
      INSERT INTO library_meta (key, value)
      VALUES ('initialized', '1'), ('version', '1')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `).run();

    const insertCategory = db.prepare(`
      INSERT INTO categories (
        id,
        name,
        parent_id,
        sort_order,
        is_system,
        system_key,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const writers = createPaperWriters(db);

    for (const category of normalized.categories) {
      insertCategory.run(
        category.id,
        category.name,
        category.parentId ?? null,
        Number(category.sortOrder) || 0,
        boolToInteger(category.isSystem),
        category.systemKey ?? null,
        Number(category.createdAt) || 0,
        Number(category.updatedAt) || 0,
      );
    }

    for (const paper of normalized.papers) {
      writers.insertRow(paper);
      writers.insertRelations(paper);
    }

    restoreReferenceRows(
      db,
      referenceCache,
      new Set(normalized.papers.map((paper) => paper.id)),
    );
  });

  return normalized;
}

function databaseInitialized(db) {
  const row = db
    .prepare("SELECT value FROM library_meta WHERE key = 'initialized'")
    .get();
  return row?.value === '1';
}

function legacyRagIndexes(raw) {
  return raw?.ragIndexes && typeof raw.ragIndexes === 'object' ? raw.ragIndexes : {};
}

function createLibraryDatabaseStore(appPaths, helpers) {
  let db = openDatabase(appPaths.libraryDatabasePath);
  const { normalizeLibrary } = helpers;

  if (!databaseInitialized(db)) {
    const rawLibrary = readJson(appPaths.libraryPath, null);

    if (rawLibrary && typeof rawLibrary === 'object') {
      saveLibraryToDb(db, appPaths, normalizeLibrary, rawLibrary);
    }
  }

  return {
    close() {
      if (db.isOpen) db.close();
    },

    load() {
      return loadLibraryFromDb(db, appPaths, normalizeLibrary);
    },

    save(library) {
      saveLibraryToDb(db, appPaths, normalizeLibrary, library);
    },

    saveSync(library) {
      saveLibraryToDb(db, appPaths, normalizeLibrary, library);
    },

    queryPapers(request) {
      return queryPapersFromDb(db, request);
    },

    listPaperIds(request) {
      return listPaperIdsFromDb(db, request);
    },

    countPapers(request) {
      return countPapersFromDb(db, request);
    },

    listCategoriesWithCounts() {
      return listCategoriesWithCountsFromDb(db);
    },

    getPaper(paperId) {
      return getPaperFromDb(db, paperId);
    },

    getPaperIdByAttachment(attachmentId) {
      return getPaperIdByAttachmentId(db, attachmentId);
    },

    findAttachmentsByStoredPath(storedPath) {
      return db
        .prepare(
          'SELECT id, paper_id AS paperId, stored_path AS storedPath FROM attachments WHERE lower(stored_path) = lower(?)',
        )
        .all(cleanString(storedPath));
    },

    savePaper(paper) {
      return savePaperToDb(db, paper);
    },

    deletePaper(paperId) {
      deletePaperFromDb(db, paperId);
    },

    loadSettings() {
      return loadKeyValueTable(db, 'library_settings');
    },

    saveReferences(paperId, refs) {
      return withTransaction(db, () => saveReferenceRows(db, paperId, refs));
    },

    loadReferences(paperId) {
      return loadReferenceRows(db, cleanString(paperId));
    },

    loadAllReferences() {
      return loadReferenceRows(db);
    },

    loadFromSnapshot(snapshotPath) {
      const snapshotDb = openDatabase(snapshotPath);
      try {
        return loadLibraryFromDb(snapshotDb, appPaths, normalizeLibrary);
      } finally {
        if (snapshotDb.isOpen) snapshotDb.close();
      }
    },

    snapshotTo(targetPath) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.rmSync(targetPath, { force: true });
      db.exec(`VACUUM main INTO ${sqlStringLiteral(targetPath)}`);
      return targetPath;
    },

    loadLegacyRagIndexes() {
      return legacyRagIndexes(readJson(appPaths.libraryPath, null));
    },

    clearLegacyRagIndexesSync() {
      const rawLibrary = readJson(appPaths.libraryPath, null);
      if (!rawLibrary || typeof rawLibrary !== 'object' || !rawLibrary.ragIndexes) return;

      delete rawLibrary.ragIndexes;
      writeJsonSync(appPaths.libraryPath, rawLibrary);
    },

    async replaceWithSnapshot(snapshotPath) {
      const replacementPath = `${appPaths.libraryDatabasePath}.restore-${Date.now()}.tmp`;
      await fsp.mkdir(path.dirname(appPaths.libraryDatabasePath), { recursive: true });
      await fsp.copyFile(snapshotPath, replacementPath);

      if (db.isOpen) db.close();

      try {
        await fsp.rm(appPaths.libraryDatabasePath, { force: true });
        await fsp.rm(`${appPaths.libraryDatabasePath}-wal`, { force: true });
        await fsp.rm(`${appPaths.libraryDatabasePath}-shm`, { force: true });
        await fsp.rename(replacementPath, appPaths.libraryDatabasePath);
      } finally {
        await fsp.rm(replacementPath, { force: true }).catch(() => {});
        db = openDatabase(appPaths.libraryDatabasePath);
      }
    },
  };
}

module.exports = { createLibraryDatabaseStore };
