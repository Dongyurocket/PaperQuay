const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sqliteVec = require('sqlite-vec');
const { DatabaseSync } = require('../backend/nodeSqlite.cjs');
const { embedTexts } = require('../backend/utils.cjs');
const { rrfFuse } = require('../backend/ragStore.cjs');
const {
  detectLocalZoteroDataDir,
  listLocalCollections,
  listLocalCollectionItems,
  listLocalLibraryItems,
  getLocalItemsByKeys,
  searchLocalLibraryItems,
} = require('../backend/zoteroLocal.cjs');
const { createLibraryStore } = require('../backend/libraryStore.cjs');
const { id, now, safeFileName, fileNameFromPath, hashBytes, isPdf } = require('../backend/utils.cjs');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPaperAuthors(item) {
  if (Array.isArray(item.authors) && item.authors.length > 0) {
    return item.authors.map((author, index) => ({
      id: id('auth'),
      name: cleanString(author.name) || 'Unknown Author',
      givenName: cleanString(author.givenName) || null,
      familyName: cleanString(author.familyName) || null,
      sortOrder: index,
    }));
  }
  const creators = cleanString(item.creators);
  if (!creators) return [];
  return creators.split(/,\s*|;\s*|\s+and\s+/).map((name, index) => ({
    id: id('auth'),
    name: cleanString(name),
    givenName: null,
    familyName: null,
    sortOrder: index,
  })).filter((a) => a.name);
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
    configPath: path.join(dataDir, '.settings', 'paperquay.config.json'),
    libraryDatabasePath: path.join(dataDir, 'paperquay-library.sqlite'),
    notesDatabasePath: path.join(dataDir, 'paperquay-notes.sqlite'),
    ragDatabasePath: path.join(dataDir, 'paperquay-rag.sqlite'),
  };
}

function openReadOnlyDb(databasePath, { allowExtension = false } = {}) {
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  try {
    const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000, allowExtension });

    if (allowExtension) {
      // sqlite-vec 扩展加载是连接级操作，只读连接上同样可以执行 vec0 查询。
      db.enableLoadExtension(true);
      try {
        const loadablePath = typeof sqliteVec.getLoadablePath === 'function'
          ? sqliteVec.getLoadablePath()
          : null;
        if (loadablePath) {
          db.loadExtension(loadablePath);
        } else {
          sqliteVec.load(db);
        }
      } catch (extensionError) {
        // 扩展不可用时退化为普通只读连接，保证关键词检索仍可用。
        console.warn('[PaperQuay MCP] sqlite-vec extension unavailable; vector retrieval disabled.', extensionError.message);
        try {
          db.close();
        } catch {}
        return new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
      } finally {
        db.enableLoadExtension(false);
      }
    }

    return db;
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

// ---- 向量混合检索（与桌面端 ragStore.cjs 的混合检索逻辑对齐） ----

const MAX_VECTOR_FANOUT_SOURCES = 500;

// 与 src/services/rag.ts 的 normalizeBaseUrl 保持一致，用于比对 embedding_model_key。
function normalizeEmbeddingBaseUrl(baseUrl) {
  const trimmed = cleanString(baseUrl);
  if (!trimmed) return '';

  const normalized = trimmed
    .replace(/\/embeddings\/?$/i, '')
    .replace(/\/+$/, '');

  if (/\/v\d+$/i.test(normalized)) {
    return normalized;
  }

  return `${normalized}/v1`;
}

// 与 src/services/rag.ts 的 buildRagEmbeddingModelKey 保持一致。
function buildEmbeddingModelKey(config) {
  return `${normalizeEmbeddingBaseUrl(config.baseUrl)}::${cleanString(config.model)}::${config.dimensions ?? 'default'}`;
}

// 与 ragStore.cjs 的 vectorTableName 保持一致。
function vectorTableName(dimension) {
  return `rag_vec_${dimension}`;
}

function toFloat32Array(vector) {
  const output = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    output[index] = Number(vector[index]);
  }
  return output;
}

function normalizeRetrievalMode(mode) {
  const value = cleanString(mode).toLowerCase();
  if (value === 'hybrid' || value === 'keyword') return value;
  return 'auto';
}

function ragResultKey(row) {
  return `${row.sourceType}::${row.chunkId}`;
}

class PaperQuayKnowledgeService {
  constructor(options = {}) {
    this.appPaths = resolveAppPaths(options.dataDir);
    // 测试可注入 embedFn(queryText, embeddingConfig) => Promise<number[]>，默认走 OpenAI 兼容接口。
    this.embedFn = typeof options.embedFn === 'function'
      ? options.embedFn
      : async (text, embedding) => (await embedTexts([text], embedding))[0];
  }

  getLibraryDb() {
    return openReadOnlyDb(this.appPaths.libraryDatabasePath);
  }

  getRagDb({ withVec = false } = {}) {
    return openReadOnlyDb(this.appPaths.ragDatabasePath, { allowExtension: withVec });
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

  // 从渲染层持久化的阅读器配置中读取 embedding 设置（settings + secrets）。
  // 与桌面端共用同一份配置，用户在应用内修改后 MCP 下次调用即生效。
  resolveEmbeddingConfig() {
    try {
      if (!fs.existsSync(this.appPaths.configPath)) {
        return null;
      }

      const raw = JSON.parse(fs.readFileSync(this.appPaths.configPath, 'utf8'));
      const settings = raw?.settings ?? {};
      const secrets = raw?.secrets ?? {};
      const baseUrl = normalizeEmbeddingBaseUrl(settings.embeddingBaseUrl);
      const model = cleanString(settings.embeddingModel);
      const apiKey = cleanString(secrets.embeddingApiKey);

      if (!baseUrl || !model) {
        return null;
      }

      const dimensions = Number.isInteger(settings.embeddingDimensions) && settings.embeddingDimensions > 0
        ? settings.embeddingDimensions
        : null;

      return { baseUrl, model, dimensions, apiKey, timeoutSeconds: 60 };
    } catch {
      return null;
    }
  }

  // 选择与当前 embedding 配置最匹配的已索引向量维度：优先 model_key 完全匹配，
  // 否则退到 ready 文档数最多的维度（调用方需自行校验查询向量维度一致）。
  pickVectorDimension(ragDb, modelKey) {
    let registered;
    try {
      registered = new Set(
        ragDb.prepare('SELECT dimension FROM rag_vec_dimensions').all()
          .map((row) => Number(row.dimension))
          .filter((d) => Number.isSafeInteger(d) && d > 0),
      );
    } catch {
      return null;
    }

    if (registered.size === 0) {
      return null;
    }

    const rows = ragDb.prepare(`
      SELECT embedding_dimension AS dimension, embedding_model_key AS modelKey,
             COUNT(DISTINCT document_key) AS documentCount
      FROM rag_indexes
      WHERE status = 'ready'
      GROUP BY embedding_dimension, embedding_model_key
    `).all().filter((row) => registered.has(Number(row.dimension)));

    if (rows.length === 0) {
      return null;
    }

    const exact = rows.find((row) => row.modelKey === modelKey);
    if (exact) {
      return { dimension: Number(exact.dimension), modelKeyMatched: true };
    }

    rows.sort((left, right) => Number(right.documentCount) - Number(left.documentCount));
    return { dimension: Number(rows[0].dimension), modelKeyMatched: false };
  }

  // 原生单次全局 KNN 检索：vec0 的 partition key 支持全局缺省查询，
  // 通过单条 SQL 跨全库直接召回 Top-K 向量，免除逐文档循环与来源截断限制。
  retrieveVectorChunks(ragDb, { queryVector, dimension, paperId, candidateLimit }) {
    const table = vectorTableName(dimension);
    const queryVec = toFloat32Array(queryVector);

    if (paperId) {
      const search = ragDb.prepare(`
        SELECT
          c.document_key AS paperId,
          c.chunk_id AS chunkId,
          c.source_type AS sourceType,
          c.page_index AS pageIndex,
          c.block_id AS blockId,
          c.text,
          v.distance
        FROM ${table} v
        JOIN rag_chunks c ON c.id = v.rowid
        JOIN rag_indexes i
          ON i.document_key = c.document_key
         AND i.source_type = c.source_type
         AND i.status = 'ready'
         AND i.embedding_dimension = ?
        WHERE v.embedding MATCH ?
          AND k = ?
          AND v.document_key = ?
        ORDER BY v.distance
      `);

      const rows = search.all(dimension, queryVec, candidateLimit, paperId);
      return {
        rows: rows.map((row) => ({
          paperId: row.paperId,
          chunkId: row.chunkId,
          sourceType: row.sourceType,
          pageIndex: row.pageIndex ?? null,
          blockId: row.blockId ?? null,
          text: row.text,
          score: Number(row.distance) || 0,
        })),
        truncated: false,
      };
    }

    const search = ragDb.prepare(`
      SELECT
        c.document_key AS paperId,
        c.chunk_id AS chunkId,
        c.source_type AS sourceType,
        c.page_index AS pageIndex,
        c.block_id AS blockId,
        c.text,
        v.distance
      FROM ${table} v
      JOIN rag_chunks c ON c.id = v.rowid
      JOIN rag_indexes i
        ON i.document_key = c.document_key
       AND i.source_type = c.source_type
       AND i.status = 'ready'
       AND i.embedding_dimension = ?
      WHERE v.embedding MATCH ?
        AND k = ?
      ORDER BY v.distance
    `);

    const rows = search.all(dimension, queryVec, candidateLimit);
    return {
      rows: rows.map((row) => ({
        paperId: row.paperId,
        chunkId: row.chunkId,
        sourceType: row.sourceType,
        pageIndex: row.pageIndex ?? null,
        blockId: row.blockId ?? null,
        text: row.text,
        score: Number(row.distance) || 0,
      })),
      truncated: false,
    };
  }

  async embedQuery(queryText, config) {
    const vector = await this.embedFn(queryText, config);
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Embedding service returned an empty query vector');
    }
    return vector;
  }

  async searchKnowledgeBase({ query, paperId = '', limit = 8, mode = 'auto' } = {}) {
    const cleanQuery = cleanString(query);
    if (!cleanQuery) throw new Error('query is required');

    const retrievalMode = normalizeRetrievalMode(mode);
    const embeddingDisabled = cleanString(process.env.PAPERQUAY_MCP_EMBEDDING).toLowerCase() === 'off';
    const wantsHybrid = retrievalMode !== 'keyword' && !embeddingDisabled;

    const ragDb = this.getRagDb({ withVec: wantsHybrid });
    if (!ragDb) {
      return {
        query: cleanQuery,
        retrievalMode: 'keyword',
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
      const candidateLimit = Math.min(100, Math.max(safeLimit, safeLimit * 2));
      const targetPaperId = cleanString(paperId);
      const ftsQuery = escapeFtsQuery(cleanQuery);
      let warning;
      let embeddingModel;
      let vectorExecuted = false;

      const toResult = (row, channels) => ({
        paperId: row.paperId,
        paperTitle: paperTitles.get(row.paperId) || row.paperId,
        pageIndex: row.pageIndex !== null && row.pageIndex !== undefined ? Number(row.pageIndex) : null,
        pageNumber: row.pageIndex !== null && row.pageIndex !== undefined ? Number(row.pageIndex) + 1 : null,
        blockId: row.blockId || null,
        sourceType: row.sourceType,
        snippet: row.text,
        score: row.score,
        channels,
      });

      // 1. FTS5 全文搜索（关键词通道）
      let ftsRows = [];
      if (ftsQuery) {
        try {
          const conditions = ['rag_chunks_fts MATCH ?'];
          const params = [ftsQuery];

          if (targetPaperId) {
            conditions.push('c.document_key = ?');
            params.push(targetPaperId);
          }

          params.push(wantsHybrid ? candidateLimit : safeLimit);

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

          ftsRows = ragDb.prepare(ftsSql).all(...params).map((row) => ({
            paperId: row.paperId,
            chunkId: row.chunkId,
            sourceType: row.sourceType,
            pageIndex: row.pageIndex,
            blockId: row.blockId,
            text: row.text,
            score: Number(row.rank) || 0,
          }));
        } catch (ftsError) {
          // FTS5 失败时后续降级到 LIKE
        }
      }

      // 2. 向量通道：查询向量化 + 逐文档 KNN，与桌面端混合检索对齐
      let vectorRows = [];
      if (wantsHybrid) {
        const config = this.resolveEmbeddingConfig();

        if (!config) {
          if (retrievalMode === 'hybrid') {
            warning = 'Embedding 未在 PaperQuay 中配置，已降级为关键词检索。';
          }
        } else {
          try {
            embeddingModel = config.model;
            const pick = this.pickVectorDimension(ragDb, buildEmbeddingModelKey(config));

            if (!pick) {
              warning = 'RAG 知识库中没有已完成的向量索引，已降级为关键词检索。';
            } else {
              const queryVector = await this.embedQuery(cleanQuery, config);

              if (queryVector.length !== pick.dimension) {
                warning = `查询向量维度 (${queryVector.length}) 与索引维度 (${pick.dimension}) 不一致，已降级为关键词检索。`;
              } else {
                const vectorResult = this.retrieveVectorChunks(ragDb, {
                  queryVector,
                  dimension: pick.dimension,
                  paperId: targetPaperId,
                  candidateLimit,
                });
                vectorRows = vectorResult.rows;
                vectorExecuted = true;

                if (vectorResult.truncated) {
                  warning = `向量检索仅覆盖最近索引的 ${MAX_VECTOR_FANOUT_SOURCES} 个来源（文档, source）组合。`;
                }
              }
            }
          } catch (error) {
            warning = `向量检索失败，已降级为关键词检索：${error.message}`;
          }
        }
      }

      // 3. 融合排序：向量 + FTS 双通道走 RRF（与桌面端 rrfFuse 相同）；
      //    chunk_id 仅在 (document_key, source_type) 内唯一，跨库融合前用 paperId 前缀合成全局键。
      let results = [];
      if (vectorExecuted) {
        if (vectorRows.length > 0 && ftsRows.length > 0) {
          const wrap = (rows) => rows.map((row) => ({
            ...row,
            chunkId: `${row.paperId}::${row.chunkId}`,
          }));
          const fused = rrfFuse(wrap(vectorRows), wrap(ftsRows)).slice(0, safeLimit);
          const vectorKeys = new Set(vectorRows.map(ragResultKey));
          const ftsKeys = new Set(ftsRows.map(ragResultKey));

          results = fused.map((row) => {
            const chunkId = row.chunkId.slice(row.paperId.length + 2);
            const key = ragResultKey({ sourceType: row.sourceType, chunkId });
            const channels = [];
            if (vectorKeys.has(key)) channels.push('vector');
            if (ftsKeys.has(key)) channels.push('fts');
            return toResult({ ...row, chunkId }, channels);
          });
        } else if (vectorRows.length > 0) {
          results = vectorRows.slice(0, safeLimit).map((row) => toResult(row, ['vector']));
        } else {
          results = ftsRows.slice(0, safeLimit).map((row) => toResult(row, ['fts']));
        }
      } else {
        results = ftsRows.slice(0, safeLimit).map((row) => toResult(row, ['fts']));
      }

      // 4. 如果 FTS/向量均未命中，使用 LIKE 降级
      let likeFallbackUsed = false;
      if (results.length === 0) {
        likeFallbackUsed = true;
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
        results = rows.map((row) => toResult({ ...row, score: 1.0 }, ['like']));
      }

      return {
        query: cleanQuery,
        retrievalMode: vectorExecuted && !likeFallbackUsed ? 'hybrid' : 'keyword',
        ...(embeddingModel && vectorExecuted && !likeFallbackUsed ? { embeddingModel } : {}),
        ...(warning ? { warning } : {}),
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

  async zoteroListCollections({ dataDir = '' } = {}) {
    const collections = await listLocalCollections({ dataDir });
    return {
      collections,
      total: collections.length,
      dataDir: dataDir || (await detectLocalZoteroDataDir()),
    };
  }

  async zoteroSearchItems({ dataDir = '', query = '', collectionKey = '', limit = 50 } = {}) {
    const items = await searchLocalLibraryItems({
      dataDir,
      query,
      collectionKey,
      limit,
    });
    return {
      items: items.map((item) => ({
        itemKey: item.itemKey,
        title: item.title,
        creators: item.creators,
        authors: item.authors,
        year: item.year,
        doi: item.doi || null,
        publication: item.publication || null,
        abstractNote: item.abstractNote || null,
        itemType: item.itemType,
        hasLocalPdf: Boolean(item.localPdfPath && fs.existsSync(item.localPdfPath)),
        localPdfPath: item.localPdfPath || null,
        attachmentFilename: item.attachmentFilename || null,
      })),
      total: items.length,
      query: cleanString(query),
      collectionKey: cleanString(collectionKey) || null,
    };
  }

  async zoteroPreviewSync({ dataDir = '', itemKeys = [], collectionKey = '' } = {}) {
    const targetKeys = Array.isArray(itemKeys) ? itemKeys.map(cleanString).filter(Boolean) : [];
    const targetCollection = cleanString(collectionKey);

    let candidates = [];
    if (targetKeys.length > 0) {
      candidates = await getLocalItemsByKeys({ dataDir, itemKeys: targetKeys });
    } else if (targetCollection) {
      candidates = await listLocalCollectionItems({ dataDir, collectionKey: targetCollection });
    } else {
      candidates = await listLocalLibraryItems({ dataDir, limit: 100 });
    }

    const db = this.getLibraryDb();
    const existingDois = new Set();
    const existingTitles = new Set();
    const existingHashes = new Set();

    if (db) {
      try {
        const rows = db.prepare(`
          SELECT p.id, p.title, p.doi, a.content_hash AS contentHash
          FROM papers p
          LEFT JOIN attachments a ON a.paper_id = p.id
        `).all();

        for (const row of rows) {
          if (row.doi) existingDois.add(cleanString(row.doi).toLowerCase());
          if (row.title) existingTitles.add(cleanString(row.title).toLowerCase());
          if (row.contentHash) existingHashes.add(row.contentHash);
        }
      } finally {
        db.close();
      }
    }

    const ready = [];
    const alreadyExists = [];
    const missingPdf = [];

    for (const item of candidates) {
      if (!item.localPdfPath || !fs.existsSync(item.localPdfPath)) {
        missingPdf.push({
          itemKey: item.itemKey,
          title: item.title,
          year: item.year,
          creators: item.creators,
          reason: 'Zotero 中无本地 PDF 附件或文件已丢失',
        });
        continue;
      }

      let isDuplicate = false;
      let duplicateReason = '';

      if (item.doi && existingDois.has(cleanString(item.doi).toLowerCase())) {
        isDuplicate = true;
        duplicateReason = `DOI 重复 (${item.doi})`;
      } else if (item.title && existingTitles.has(cleanString(item.title).toLowerCase())) {
        isDuplicate = true;
        duplicateReason = `标题重复 (${item.title})`;
      } else {
        try {
          const bytes = fs.readFileSync(item.localPdfPath);
          const hash = hashBytes(bytes);
          if (existingHashes.has(hash)) {
            isDuplicate = true;
            duplicateReason = 'PDF 文件内容 Hash 重复';
          }
        } catch {
          // ignore read error
        }
      }

      if (isDuplicate) {
        alreadyExists.push({
          itemKey: item.itemKey,
          title: item.title,
          year: item.year,
          creators: item.creators,
          doi: item.doi || null,
          reason: duplicateReason,
        });
      } else {
        ready.push({
          itemKey: item.itemKey,
          title: item.title,
          year: item.year,
          creators: item.creators,
          doi: item.doi || null,
          publication: item.publication || null,
          hasLocalPdf: true,
          localPdfPath: item.localPdfPath,
          attachmentFilename: item.attachmentFilename || null,
        });
      }
    }

    return {
      summary: {
        total: candidates.length,
        readyCount: ready.length,
        alreadyExistsCount: alreadyExists.length,
        missingPdfCount: missingPdf.length,
      },
      ready,
      alreadyExists,
      missingPdf,
    };
  }

  async paperquaySyncFromZotero({
    dataDir = '',
    itemKeys = [],
    collectionKey = '',
    targetCategoryId = '',
    createCollectionCategory = true,
  } = {}) {
    const targetKeys = Array.isArray(itemKeys) ? itemKeys.map(cleanString).filter(Boolean) : [];
    const targetCollection = cleanString(collectionKey);

    let candidates = [];
    if (targetKeys.length > 0) {
      candidates = await getLocalItemsByKeys({ dataDir, itemKeys: targetKeys });
    } else if (targetCollection) {
      candidates = await listLocalCollectionItems({ dataDir, collectionKey: targetCollection });
    } else {
      throw new Error('Must provide either itemKeys or collectionKey to sync');
    }

    if (candidates.length === 0) {
      return {
        summary: {
          totalRequested: 0,
          importedCount: 0,
          duplicateCount: 0,
          missingPdfCount: 0,
          failedCount: 0,
        },
        importedPapers: [],
        duplicates: [],
        missingPdfs: [],
        errors: [],
      };
    }

    const store = createLibraryStore(this.appPaths);
    const library = store.load();
    const storageDir = library.settings.storageDir || path.join(this.appPaths.dataDir, 'paperquay-data');
    fs.mkdirSync(storageDir, { recursive: true });

    let resolvedCategoryId = cleanString(targetCategoryId) || null;

    if (!resolvedCategoryId && targetCollection && createCollectionCategory !== false) {
      const collections = await listLocalCollections({ dataDir });
      const matched = collections.find((c) => c.collectionKey === targetCollection);
      const collectionName = cleanString(matched?.name) || 'Zotero Collection';

      const existingCat = library.categories.find(
        (c) => !c.isSystem && c.parentId === null && c.name.toLowerCase() === collectionName.toLowerCase(),
      );

      if (existingCat) {
        resolvedCategoryId = existingCat.id;
      } else {
        const newCat = {
          id: id('cat'),
          name: collectionName,
          parentId: null,
          sortOrder: library.categories.length,
          isSystem: false,
          systemKey: null,
          createdAt: now(),
          updatedAt: now(),
          paperCount: 0,
        };
        library.categories.push(newCat);
        resolvedCategoryId = newCat.id;
      }
    }

    const importedPapers = [];
    const duplicates = [];
    const missingPdfs = [];
    const errors = [];

    for (const item of candidates) {
      if (!item.localPdfPath || !fs.existsSync(item.localPdfPath)) {
        missingPdfs.push({
          itemKey: item.itemKey,
          title: item.title,
          reason: '本地无 PDF 附件',
        });
        continue;
      }

      try {
        const sourcePath = item.localPdfPath;
        if (!isPdf(sourcePath)) {
          missingPdfs.push({ itemKey: item.itemKey, title: item.title, reason: '附件非 PDF 文件' });
          continue;
        }

        const bytes = fs.readFileSync(sourcePath);
        const contentHash = hashBytes(bytes);

        const existingPaper = library.papers.find((p) =>
          p.attachments?.some((att) => att.contentHash === contentHash) ||
          (item.doi && p.doi && p.doi.toLowerCase() === item.doi.toLowerCase()) ||
          (item.title && p.title && p.title.trim().toLowerCase() === item.title.trim().toLowerCase()),
        );

        if (existingPaper) {
          if (resolvedCategoryId && !existingPaper.categoryIds.includes(resolvedCategoryId)) {
            existingPaper.categoryIds.push(resolvedCategoryId);
            existingPaper.updatedAt = now();
          }
          duplicates.push({
            itemKey: item.itemKey,
            title: item.title,
            existingPaperId: existingPaper.id,
            reason: '文献已在文库中存在',
          });
          continue;
        }

        const paperId = id('paper');
        const fileName = safeFileName(item.attachmentFilename || fileNameFromPath(sourcePath));
        const storedPath = path.join(storageDir, `${paperId}-${fileName}`);
        fs.copyFileSync(sourcePath, storedPath);

        const relativePath = path.relative(storageDir, storedPath);
        const stat = fs.statSync(storedPath);

        const authors = buildPaperAuthors(item);

        const paper = {
          id: paperId,
          title: cleanString(item.title) || path.basename(fileName, path.extname(fileName)),
          titleZh: null,
          year: item.year || null,
          publication: item.publication || null,
          doi: item.doi || null,
          url: item.url || null,
          abstractText: item.abstractNote || null,
          itemType: item.itemType || 'journalArticle',
          publisher: null,
          institution: null,
          reportNumber: null,
          volume: null,
          issue: null,
          pages: null,
          isbn: null,
          issn: null,
          keywords: [],
          importedAt: now(),
          updatedAt: now(),
          lastReadAt: null,
          readingProgress: 0,
          isFavorite: false,
          userNote: null,
          aiSummary: null,
          citation: null,
          source: 'zotero',
          sortOrder: Math.min(0, ...library.papers.map((p) => p.sortOrder ?? 0)) - 1,
          authors,
          tags: [],
          categoryIds: resolvedCategoryId ? [resolvedCategoryId] : [],
          attachments: [{
            id: id('att'),
            paperId,
            kind: 'pdf',
            originalPath: sourcePath,
            storedPath,
            relativePath,
            fileName,
            mimeType: 'application/pdf',
            fileSize: stat.size,
            contentHash,
            createdAt: now(),
            missing: false,
          }],
        };

        library.papers.push(paper);
        importedPapers.push({
          id: paper.id,
          title: paper.title,
          year: paper.year,
          doi: paper.doi,
          zoteroItemKey: item.itemKey,
          categoryId: resolvedCategoryId,
        });
      } catch (err) {
        errors.push({
          itemKey: item.itemKey,
          title: item.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      store.save(library);
    } finally {
      store.close();
    }

    return {
      summary: {
        totalRequested: candidates.length,
        importedCount: importedPapers.length,
        duplicateCount: duplicates.length,
        missingPdfCount: missingPdfs.length,
        failedCount: errors.length,
      },
      importedPapers,
      duplicates,
      missingPdfs,
      errors,
      categoryId: resolvedCategoryId,
    };
  }
}

module.exports = {
  PaperQuayKnowledgeService,
  resolveAppPaths,
  resolveDefaultDataDir,
};
