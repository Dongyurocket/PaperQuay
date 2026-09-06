const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('../backend/nodeSqlite.cjs');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveDefaultDataDir() {
  if (process.env.PAPERQUAY_DATA_DIR && cleanString(process.env.PAPERQUAY_DATA_DIR)) {
    return path.resolve(cleanString(process.env.PAPERQUAY_DATA_DIR));
  }

  const platform = process.platform;
  let candidates = [];

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    candidates = [
      path.join(appData, 'PaperQuay', 'PaperQuay'),
      path.join(appData, 'paperquay', 'PaperQuay'),
      path.join(appData, 'PaperQuay'),
      path.join(appData, 'paperquay'),
    ];
  } else if (platform === 'darwin') {
    const home = os.homedir();
    candidates = [
      path.join(home, 'Library', 'Application Support', 'PaperQuay', 'PaperQuay'),
      path.join(home, 'Library', 'Application Support', 'PaperQuay'),
    ];
  } else {
    const home = os.homedir();
    candidates = [
      path.join(home, '.config', 'PaperQuay', 'PaperQuay'),
      path.join(home, '.config', 'PaperQuay'),
    ];
  }

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'paperquay-library.sqlite')) ||
      fs.existsSync(path.join(candidate, 'paperquay-rag.sqlite'))
    ) {
      return candidate;
    }
  }

  return candidates[0] || path.join(os.homedir(), 'PaperQuay');
}

function resolveAppPaths(customDataDir = '') {
  const dataDir = customDataDir ? path.resolve(customDataDir) : resolveDefaultDataDir();

  return {
    dataDir,
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
  };
}

function openReadOnlyDb(databasePath) {
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  try {
    return new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
  } catch (error) {
    console.error(`[PaperQuay MCP] Failed to open database at ${databasePath}:`, error.message);
    return null;
  }
}

function escapeFtsQuery(query) {
  const cleaned = cleanString(query);
  if (!cleaned) return '';
  const tokens = cleaned
    .replace(/[^\p{L}\p{N}\s_]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return '';
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

function getTableColumns(db, tableName) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((c) => c.name));
  } catch {
    return new Set();
  }
}

class PaperQuayKnowledgeService {
  constructor(options = {}) {
    this.appPaths = resolveAppPaths(options.dataDir);
  }

  getLibraryDb() {
    return openReadOnlyDb(this.appPaths.libraryDatabasePath);
  }

  getRagDb() {
    return openReadOnlyDb(this.appPaths.ragDatabasePath);
  }

  getNotesDb() {
    return openReadOnlyDb(this.appPaths.notesDatabasePath);
  }

  searchPapers({ query = '', tag = '', limit = 10 } = {}) {
    const db = this.getLibraryDb();
    if (!db) {
      return {
        papers: [],
        total: 0,
        message: `Library database not found at: ${this.appPaths.libraryDatabasePath}`,
      };
    }

    try {
      const cleanQuery = cleanString(query).toLowerCase();
      const cleanTag = cleanString(tag).toLowerCase();
      const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
      const paperCols = getTableColumns(db, 'papers');

      const conditions = [];
      const params = [];

      if (cleanTag) {
        conditions.push(`p.id IN (SELECT paper_id FROM tags WHERE lower(name) = ?)`);
        params.push(cleanTag);
      }

      const titleZhMatch = paperCols.has('title_zh') ? "OR lower(COALESCE(p.title_zh, '')) LIKE ?" : '';

      if (cleanQuery) {
        conditions.push(`(
          lower(p.title) LIKE ?
          ${titleZhMatch}
          OR lower(COALESCE(p.publication, '')) LIKE ?
          OR lower(COALESCE(p.doi, '')) LIKE ?
          OR lower(COALESCE(p.abstract_text, '')) LIKE ?
          OR p.id IN (SELECT paper_id FROM authors WHERE lower(name) LIKE ?)
          OR p.id IN (SELECT paper_id FROM paper_keywords WHERE lower(keyword) LIKE ?)
        )`);
        const pattern = `%${cleanQuery}%`;
        params.push(pattern);
        if (paperCols.has('title_zh')) params.push(pattern);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const titleZhSelect = paperCols.has('title_zh') ? 'p.title_zh AS titleZh,' : 'NULL AS titleZh,';
      const itemTypeSelect = paperCols.has('item_type') ? 'p.item_type AS itemType,' : "'journalArticle' AS itemType,";

      const sql = `
        SELECT
          p.id,
          p.title,
          ${titleZhSelect}
          p.year,
          p.publication,
          p.doi,
          p.url,
          ${itemTypeSelect}
          p.is_favorite AS isFavorite,
          p.updated_at AS updatedAt
        FROM papers p
        ${whereClause}
        ORDER BY p.sort_order, p.updated_at DESC
        LIMIT ?
      `;

      params.push(safeLimit);
      const rows = db.prepare(sql).all(...params);

      const paperIds = rows.map((r) => r.id);
      let authorsByPaper = new Map();
      let tagsByPaper = new Map();

      if (paperIds.length > 0) {
        const placeholders = paperIds.map(() => '?').join(', ');
        const authorRows = db.prepare(`
          SELECT paper_id, name FROM authors WHERE paper_id IN (${placeholders}) ORDER BY paper_id, sort_order
        `).all(...paperIds);
        for (const row of authorRows) {
          if (!authorsByPaper.has(row.paper_id)) authorsByPaper.set(row.paper_id, []);
          authorsByPaper.get(row.paper_id).push(row.name);
        }

        const tagRows = db.prepare(`
          SELECT paper_id, name FROM tags WHERE paper_id IN (${placeholders}) ORDER BY paper_id, sort_order
        `).all(...paperIds);
        for (const row of tagRows) {
          if (!tagsByPaper.has(row.paper_id)) tagsByPaper.set(row.paper_id, []);
          tagsByPaper.get(row.paper_id).push(row.name);
        }
      }

      const papers = rows.map((row) => ({
        id: row.id,
        title: row.title,
        titleZh: row.titleZh || null,
        authors: authorsByPaper.get(row.id) || [],
        year: row.year || null,
        publication: row.publication || null,
        doi: row.doi || null,
        url: row.url || null,
        itemType: row.itemType || 'journalArticle',
        tags: tagsByPaper.get(row.id) || [],
        isFavorite: Boolean(row.isFavorite),
      }));

      return { papers, total: papers.length };
    } finally {
      db.close();
    }
  }

  getPaperDetails({ paperId } = {}) {
    const id = cleanString(paperId);
    if (!id) throw new Error('paperId is required');

    const db = this.getLibraryDb();
    if (!db) {
      throw new Error(`Library database not found at: ${this.appPaths.libraryDatabasePath}`);
    }

    try {
      const paper = db.prepare(`
        SELECT * FROM papers WHERE id = ?
      `).get(id);

      if (!paper) {
        return null;
      }

      const authors = db.prepare(`
        SELECT id, name, given_name AS givenName, family_name AS familyName, sort_order AS sortOrder
        FROM authors WHERE paper_id = ? ORDER BY sort_order
      `).all(id);

      const tags = db.prepare(`
        SELECT id, name, color FROM tags WHERE paper_id = ? ORDER BY sort_order
      `).all(id);

      const keywords = db.prepare(`
        SELECT keyword FROM paper_keywords WHERE paper_id = ? ORDER BY sort_order
      `).all(id).map((r) => r.keyword);

      const attachments = db.prepare(`
        SELECT id, kind, stored_path AS storedPath, file_name AS fileName, file_size AS fileSize, missing
        FROM attachments WHERE paper_id = ? ORDER BY created_at
      `).all(id).map((att) => ({
        ...att,
        missing: Boolean(att.missing),
      }));

      return {
        id: paper.id,
        title: paper.title,
        titleZh: paper.title_zh || null,
        authors: authors.map((a) => a.name),
        year: paper.year || null,
        publication: paper.publication || null,
        doi: paper.doi || null,
        url: paper.url || null,
        itemType: paper.item_type || 'journalArticle',
        publisher: paper.publisher || null,
        institution: paper.institution || null,
        reportNumber: paper.report_number || null,
        volume: paper.volume || null,
        issue: paper.issue || null,
        pages: paper.pages || null,
        isbn: paper.isbn || null,
        issn: paper.issn || null,
        abstractText: paper.abstract_text || null,
        keywords,
        tags: tags.map((t) => t.name),
        userNote: paper.user_note || null,
        aiSummary: paper.ai_summary || null,
        citation: paper.citation || null,
        isFavorite: Boolean(paper.is_favorite),
        attachments,
      };
    } finally {
      db.close();
    }
  }

  searchKnowledgeBase({ query, paperId = '', limit = 8 } = {}) {
    const cleanQuery = cleanString(query);
    if (!cleanQuery) throw new Error('query is required');

    const ragDb = this.getRagDb();
    if (!ragDb) {
      return {
        results: [],
        total: 0,
        message: `RAG database not found at: ${this.appPaths.ragDatabasePath}`,
      };
    }

    const libraryDb = this.getLibraryDb();
    const paperTitles = new Map();
    if (libraryDb) {
      try {
        const rows = libraryDb.prepare('SELECT id, title FROM papers').all();
        for (const r of rows) paperTitles.set(r.id, r.title);
      } finally {
        libraryDb.close();
      }
    }

    try {
      const safeLimit = Math.max(1, Math.min(30, Number(limit) || 8));
      const targetPaperId = cleanString(paperId);
      const ftsQuery = escapeFtsQuery(cleanQuery);
      let results = [];

      // 1. 尝试 FTS5 全文搜索
      if (ftsQuery) {
        try {
          const conditions = ['rag_chunks_fts MATCH ?'];
          const params = [ftsQuery];

          if (targetPaperId) {
            conditions.push('c.document_key = ?');
            params.push(targetPaperId);
          }

          params.push(safeLimit);

          const ftsSql = `
            SELECT
              c.document_key AS paperId,
              c.chunk_id AS chunkId,
              c.source_type AS sourceType,
              c.page_index AS pageIndex,
              c.block_id AS blockId,
              c.text,
              bm25(rag_chunks_fts) AS rank
            FROM rag_chunks_fts
            JOIN rag_chunks c ON c.id = rag_chunks_fts.rowid
            WHERE ${conditions.join(' AND ')}
            ORDER BY rank
            LIMIT ?
          `;

          const rows = ragDb.prepare(ftsSql).all(...params);
          results = rows.map((row) => ({
            paperId: row.paperId,
            paperTitle: paperTitles.get(row.paperId) || row.paperId,
            pageIndex: row.pageIndex !== null && row.pageIndex !== undefined ? Number(row.pageIndex) : null,
            pageNumber: row.pageIndex !== null && row.pageIndex !== undefined ? Number(row.pageIndex) + 1 : null,
            blockId: row.blockId || null,
            sourceType: row.sourceType,
            snippet: row.text,
            score: Number(row.rank) || 0,
          }));
        } catch (ftsError) {
          // FTS5 失败时降级到 LIKE
        }
      }

      // 2. 如果 FTS 未匹配到或不可用，使用 LIKE 降级
      if (results.length === 0) {
        const likeConditions = ['lower(c.text) LIKE ?'];
        const likeParams = [`%${cleanQuery.toLowerCase()}%`];

        if (targetPaperId) {
          likeConditions.push('c.document_key = ?');
          likeParams.push(targetPaperId);
        }

        likeParams.push(safeLimit);

        const likeSql = `
          SELECT
            c.document_key AS paperId,
            c.chunk_id AS chunkId,
            c.source_type AS sourceType,
            c.page_index AS pageIndex,
            c.block_id AS blockId,
            c.text
          FROM rag_chunks c
          WHERE ${likeConditions.join(' AND ')}
          ORDER BY c.chunk_index
          LIMIT ?
        `;

        const rows = ragDb.prepare(likeSql).all(...likeParams);
        results = rows.map((row) => ({
          paperId: row.paperId,
          paperTitle: paperTitles.get(row.paperId) || row.paperId,
          pageIndex: row.pageIndex !== null && row.pageIndex !== undefined ? Number(row.pageIndex) : null,
          pageNumber: row.pageIndex !== null && row.pageIndex !== undefined ? Number(row.pageIndex) + 1 : null,
          blockId: row.blockId || null,
          sourceType: row.sourceType,
          snippet: row.text,
          score: 1.0,
        }));
      }

      return {
        query: cleanQuery,
        results,
        total: results.length,
      };
    } finally {
      ragDb.close();
    }
  }

  readPaperContent({ paperId, pageIndex = null, limit = 20 } = {}) {
    const id = cleanString(paperId);
    if (!id) throw new Error('paperId is required');

    const ragDb = this.getRagDb();
    if (!ragDb) {
      return {
        chunks: [],
        total: 0,
        message: `RAG database not found at: ${this.appPaths.ragDatabasePath}`,
      };
    }

    try {
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const conditions = ['document_key = ?'];
      const params = [id];

      if (pageIndex !== null && pageIndex !== undefined && pageIndex !== '') {
        conditions.push('page_index = ?');
        params.push(Number(pageIndex));
      }

      params.push(safeLimit);

      const sql = `
        SELECT
          chunk_id AS chunkId,
          source_type AS sourceType,
          chunk_index AS chunkIndex,
          page_index AS pageIndex,
          block_id AS blockId,
          text
        FROM rag_chunks
        WHERE ${conditions.join(' AND ')}
        ORDER BY chunk_index
        LIMIT ?
      `;

      const rows = ragDb.prepare(sql).all(...params);
      const chunks = rows.map((row) => ({
        chunkId: row.chunkId,
        sourceType: row.sourceType,
        chunkIndex: row.chunkIndex,
        pageIndex: row.pageIndex !== null ? Number(row.pageIndex) : null,
        pageNumber: row.pageIndex !== null ? Number(row.pageIndex) + 1 : null,
        blockId: row.blockId,
        text: row.text,
      }));

      return { paperId: id, chunks, total: chunks.length };
    } finally {
      ragDb.close();
    }
  }

  searchNotes({ query = '', paperId = '', limit = 10 } = {}) {
    const db = this.getNotesDb();
    if (!db) {
      return {
        notes: [],
        total: 0,
        message: `Notes database not found at: ${this.appPaths.notesDatabasePath}`,
      };
    }

    try {
      const cleanQuery = cleanString(query).toLowerCase();
      const targetPaperId = cleanString(paperId);
      const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));

      const conditions = ['deleted_at IS NULL'];
      const params = [];

      if (targetPaperId) {
        conditions.push('(paper_id = ? OR linked_paper_id = ?)');
        params.push(targetPaperId, targetPaperId);
      }

      if (cleanQuery) {
        conditions.push(`(
          lower(title) LIKE ?
          OR lower(content) LIKE ?
          OR lower(COALESCE(content_text, '')) LIKE ?
          OR lower(COALESCE(excerpt, '')) LIKE ?
        )`);
        const pattern = `%${cleanQuery}%`;
        params.push(pattern, pattern, pattern, pattern);
      }

      params.push(safeLimit);

      const sql = `
        SELECT
          id,
          paper_id AS paperId,
          type,
          title,
          content_text AS contentText,
          content,
          excerpt,
          pdf_page_number AS pageNumber,
          highlight_color AS highlightColor,
          is_favorite AS isFavorite,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM notes
        WHERE ${conditions.join(' AND ')}
        ORDER BY is_pinned DESC, updated_at DESC
        LIMIT ?
      `;

      const rows = db.prepare(sql).all(...params);
      const notes = rows.map((row) => ({
        id: row.id,
        paperId: row.paperId,
        type: row.type,
        title: row.title,
        content: row.contentText || row.content,
        excerpt: row.excerpt || null,
        pageNumber: row.pageNumber || null,
        highlightColor: row.highlightColor || null,
        isFavorite: Boolean(row.isFavorite),
        updatedAt: row.updatedAt,
      }));

      return { notes, total: notes.length };
    } finally {
      db.close();
    }
  }
}

module.exports = {
  PaperQuayKnowledgeService,
  resolveAppPaths,
  resolveDefaultDataDir,
};
