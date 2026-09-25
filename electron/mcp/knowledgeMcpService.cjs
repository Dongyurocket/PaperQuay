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
const { execFileSync } = require('node:child_process');
const { attachCategoryCounts, createLibraryStore, normalizeAuthor, normalizeTag } = require('../backend/libraryStore.cjs');
const { createNoteStore } = require('../backend/noteStore.cjs');
const { parseMarkdownToTiptap } = require('../../src/shared/markdownToTiptap.cjs');
const { id, now, safeFileName, fileNameFromPath, hashBytes, isPdf } = require('../backend/utils.cjs');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 笔记对外返回的精简形状：避免 contentJson 等大字段撑爆 MCP 响应。
function slimNote(note) {
  if (!note || typeof note !== 'object') return null;
  return {
    id: note.id,
    paperId: note.paperId,
    linkedPaperId: note.linkedPaperId ?? null,
    type: note.type,
    pageKind: note.pageKind ?? null,
    title: note.title,
    content: note.contentText || note.content || '',
    excerpt: note.excerpt ?? null,
    folderId: note.folderId ?? null,
    tags: Array.isArray(note.tags) ? note.tags : [],
    linkedNoteIds: Array.isArray(note.linkedNoteIds) ? note.linkedNoteIds : [],
    linkedPaperIds: Array.isArray(note.linkedPaperIds) ? note.linkedPaperIds : [],
    isFavorite: Boolean(note.isFavorite),
    isPinned: Boolean(note.isPinned),
    wordCount: note.wordCount ?? 0,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
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

// 命中后补上同一代次、同一章节的前后各一片。没有新列的旧库仍只返回命中文本。
function snippetWithNeighbors(ragDb, row) {
  const text = typeof row?.text === 'string' ? row.text : '';
  const columns = getTableColumns(ragDb, 'rag_chunks');
  if (!columns.has('chunk_index') || !row?.paperId || !row?.sourceType || !row?.chunkId) {
    return text;
  }

  const hasGeneration = columns.has('generation_id');
  const hasSection = columns.has('section_id');
  const current = ragDb.prepare(`
    SELECT chunk_index AS chunkIndex,
           ${hasGeneration ? 'generation_id' : "''"} AS generationId,
           ${hasSection ? 'section_id' : 'NULL'} AS sectionId
    FROM rag_chunks
    WHERE document_key = ? AND source_type = ? AND chunk_id = ?
  `).get(row.paperId, row.sourceType, row.chunkId);

  if (!current) {
    return text;
  }

  const params = [row.paperId, row.sourceType, Number(current.chunkIndex) - 1, Number(current.chunkIndex) + 1];
  let generationClause = '';
  let sectionClause = '';
  if (hasGeneration) {
    generationClause = 'AND generation_id = ?';
    params.push(current.generationId ?? '');
  }
  if (hasSection && current.sectionId) {
    sectionClause = 'AND section_id = ?';
    params.push(current.sectionId);
  }

  const neighbors = ragDb.prepare(`
    SELECT text
    FROM rag_chunks
    WHERE document_key = ? AND source_type = ?
      AND chunk_index BETWEEN ? AND ?
      ${generationClause}
      ${sectionClause}
    ORDER BY chunk_index
  `).all(...params);
  const combined = neighbors.map((item) => item.text).filter((item) => item).join('\n\n');
  return combined || text;
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

// ---- 写工具运行护栏 ----
// 桌面应用将文献库缓存在内存中，且 store.save() 是全量重写：应用运行时的任何保存
// 都会静默覆盖 MCP 写入。写工具默认在检测到应用运行时显式拒绝。

// 返回 true（在运行）/ false（未运行）/ null（无法检测）。
// 注意：仅覆盖已安装的桌面应用（PaperQuay.exe / PaperQuay）；开发模式（electron .）无法可靠识别。
function detectDesktopAppRunning() {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq PaperQuay.exe', '/NH'], { encoding: 'utf8' });
      return /PaperQuay\.exe/i.test(output);
    }
    execFileSync('pgrep', ['-x', 'PaperQuay'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch (error) {
    // pgrep 无匹配时退出码为 1，视为未运行；其它错误（命令缺失等）视为无法检测。
    if (error && typeof error === 'object' && error.status === 1) return false;
    return null;
  }
}

// 与 libraryCommands.cjs 的 library_update_paper 白名单保持一致。
const UPDATABLE_PAPER_FIELDS = [
  'title',
  'titleZh',
  'year',
  'publication',
  'doi',
  'url',
  'abstractText',
  'itemType',
  'publisher',
  'institution',
  'reportNumber',
  'volume',
  'issue',
  'pages',
  'isbn',
  'issn',
  'userNote',
  'aiSummary',
  'citation',
];

class PaperQuayKnowledgeService {
  constructor(options = {}) {
    this.appPaths = resolveAppPaths(options.dataDir);
    // 测试可注入 embedFn(queryText, embeddingConfig) => Promise<number[]>，默认走 OpenAI 兼容接口。
    this.embedFn = typeof options.embedFn === 'function'
      ? options.embedFn
      : async (text, embedding) => (await embedTexts([text], embedding))[0];
    // 测试可注入 isAppRunning() => true/false/null，默认检测已安装的桌面应用进程。
    this.isAppRunning = typeof options.isAppRunning === 'function'
      ? options.isAppRunning
      : detectDesktopAppRunning;
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

  searchPapers({ query = '', tag = '', categoryId = '', limit = 10 } = {}) {
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

      // 按分类过滤，语义与 libraryStore.cjs 的 paperMatches 对齐：
      // 非系统分类包含全部后代分类；recent/uncategorized/favorites 由系统维护。
      const cleanCategoryId = cleanString(categoryId);
      if (cleanCategoryId) {
        const categoryRow = db.prepare(
          `SELECT id, is_system AS isSystem, system_key AS systemKey FROM categories WHERE id = ?`,
        ).get(cleanCategoryId);
        if (!categoryRow) throw new Error(`Category does not exist: ${cleanCategoryId}`);

        if (categoryRow.systemKey === 'favorites') {
          conditions.push(`p.is_favorite = 1`);
        } else if (categoryRow.systemKey === 'uncategorized') {
          conditions.push(`p.id NOT IN (SELECT paper_id FROM paper_categories)`);
        } else if (categoryRow.systemKey === 'recent') {
          conditions.push(`p.id IN (SELECT id FROM papers ORDER BY imported_at DESC, title LIMIT 30)`);
        } else if (!categoryRow.systemKey) {
          const allowed = new Set([cleanCategoryId]);
          const allCategories = db.prepare(`SELECT id, parent_id AS parentId FROM categories`).all();
          let changed = true;
          while (changed) {
            changed = false;
            for (const row of allCategories) {
              if (row.parentId && allowed.has(row.parentId) && !allowed.has(row.id)) {
                allowed.add(row.id);
                changed = true;
              }
            }
          }
          const placeholders = [...allowed].map(() => '?').join(', ');
          conditions.push(`p.id IN (SELECT paper_id FROM paper_categories WHERE category_id IN (${placeholders}))`);
          params.push(...allowed);
        }
        // system-all：不加过滤
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

      const categoryIds = db.prepare(`
        SELECT category_id FROM paper_categories WHERE paper_id = ? ORDER BY sort_order
      `).all(id).map((r) => r.category_id);

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
        categoryIds,
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
        snippet: snippetWithNeighbors(ragDb, row),
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

  searchNotes({ query = '', paperId = '', pageKind = '', limit = 10 } = {}) {
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
      const targetPageKind = cleanString(pageKind);
      const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
      const noteColumns = new Set(db.prepare('PRAGMA table_info(notes)').all().map((row) => row.name));
      const hasPageKind = noteColumns.has('page_kind');

      const conditions = ['deleted_at IS NULL'];
      const params = [];

      if (targetPaperId) {
        conditions.push('(paper_id = ? OR linked_paper_id = ?)');
        params.push(targetPaperId, targetPaperId);
      }
      if (targetPageKind) {
        if (!['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'].includes(targetPageKind)) {
          throw new Error(`Unsupported note page kind: ${targetPageKind}`);
        }
        if (!hasPageKind) {
          return { notes: [], total: 0 };
        }
        conditions.push('page_kind = ?');
        params.push(targetPageKind);
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
          ${hasPageKind ? 'page_kind' : 'NULL'} AS pageKind,
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
        pageKind: row.pageKind,
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

  // ---- 文库写入工具 ----
  // 写入语义与 electron/backend/libraryCommands.cjs 的对应命令保持一致，
  // 统一经 withWritableLibrary 走「护栏检查 → load → 变更 → save → close」。

  // 写操作护栏：显式失败，绝不静默。返回 { warning } 供响应透传。
  assertWritable(allowWhileAppRunning) {
    if (String(process.env.PAPERQUAY_MCP_WRITE || '').trim().toLowerCase() === 'off') {
      throw new Error('MCP write tools are disabled (PAPERQUAY_MCP_WRITE=off)');
    }
    if (allowWhileAppRunning === true) return { warning: null };
    const running = this.isAppRunning();
    if (running === true) {
      throw new Error(
        '检测到 PaperQuay 桌面应用正在运行，已拒绝写入。应用将文献库保存在内存中，'
        + '其下一次保存会覆盖 MCP 写入的数据（store.save 为全量重写）。'
        + '请关闭 PaperQuay 后重试；若确认需要并行写入，显式传入 allowWhileAppRunning: true。',
      );
    }
    return {
      warning: running === null
        ? '未能检测 PaperQuay 桌面应用是否在运行；若应用处于打开状态，本次写入可能被其覆盖。'
        : null,
    };
  }

  withWritableLibrary(mutator, { allowWhileAppRunning = false } = {}) {
    const guard = this.assertWritable(allowWhileAppRunning);
    const store = createLibraryStore(this.appPaths);
    try {
      const library = store.load();
      const result = mutator(library);
      store.save(library);
      if (guard.warning && result && typeof result === 'object' && !Array.isArray(result)) {
        return { ...result, warning: guard.warning };
      }
      return result;
    } finally {
      store.close();
    }
  }

  // 笔记库与文库不同：noteStore 逐条 SQL 写入而非全量重写，桌面应用不会
  // 静默覆盖外部写入。但应用内的笔记列表/编辑器持有内存快照，外部写入后
  // 界面需重新加载才能看到；因此仍走同一道「显式拒绝 + 可覆盖」护栏。
  withWritableNoteStore(mutator, { allowWhileAppRunning = false } = {}) {
    const guard = this.assertWritable(allowWhileAppRunning);
    const store = createNoteStore(this.appPaths);
    try {
      const result = mutator(store);
      if (guard.warning && result && typeof result === 'object' && !Array.isArray(result)) {
        return { ...result, warning: guard.warning };
      }
      return result;
    } finally {
      store.close();
    }
  }

  // ---- 笔记写入工具 ----
  // 复用 noteStore 写路径：FTS 同步、双链解析、标签归一化全部与桌面端一致。

  createNote({ title = '', content = '', tags = [], paperId = '', type = '', pageKind = '', folderId = '', allowWhileAppRunning = false } = {}) {
    const cleanTitle = cleanString(title);
    const cleanContent = typeof content === 'string' ? content : String(content ?? '');
    if (!cleanTitle && !cleanContent.trim()) {
      throw new Error('create_note requires a non-empty title or content');
    }
    const cleanTags = (Array.isArray(tags) ? tags : [])
      .map((tag) => cleanString(tag).replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 30);
    const noteType = cleanString(type);
    if (noteType && !['highlight', 'area', 'standalone', 'ai-chat'].includes(noteType)) {
      throw new Error(`Unsupported note type: ${noteType}`);
    }
    if (pageKind && !['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'].includes(pageKind)) {
      throw new Error(`Unsupported note page kind: ${pageKind}`);
    }
    return this.withWritableNoteStore((store) => {
      const library = createLibraryStore(this.appPaths).load();
      const notes = store.listNotes({ includeDeleted: false });
      const note = store.createNote({
        paperId: cleanString(paperId) || 'global-notes',
        type: noteType || 'standalone',
        pageKind: pageKind || null,
        title: cleanTitle || 'Untitled Note',
        content: cleanContent,
        contentText: cleanContent,
        contentJson: parseMarkdownToTiptap(cleanContent, {
          papers: Array.isArray(library?.papers) ? library.papers : [],
          notes,
        }),
        contentHtml: null,
        tags: cleanTags,
        folderId: cleanString(folderId) || null,
      });
      return { note: slimNote(note), noteId: note.id };
    }, { allowWhileAppRunning });
  }

  updateNote({ noteId = '', title, content, tags, pageKind, folderId, allowWhileAppRunning = false } = {}) {
    const idValue = cleanString(noteId);
    if (!idValue) throw new Error('update_note requires noteId');
    const patch = {};
    if (typeof title === 'string') patch.title = title;
    if (typeof content === 'string') {
      patch.content = content;
      patch.contentText = content;
      // Markdown is parsed at the write boundary so the stored JSON remains authoritative.
      patch.contentHtml = null;
    }
    if (Array.isArray(tags)) {
      patch.tags = tags.map((tag) => cleanString(tag).replace(/^#/, '')).filter(Boolean).slice(0, 30);
    }
    if (typeof pageKind === 'string') {
      if (pageKind && !['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'].includes(pageKind)) {
        throw new Error(`Unsupported note page kind: ${pageKind}`);
      }
      patch.pageKind = pageKind || null;
    }
    // 传空字符串表示移动到「未分类」。
    if (typeof folderId === 'string') {
      patch.folderId = cleanString(folderId) || null;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error('update_note requires at least one of title, content, tags, pageKind, folderId');
    }
    return this.withWritableNoteStore((store) => {
      const library = createLibraryStore(this.appPaths).load();
      if (typeof content === 'string') {
        patch.contentJson = parseMarkdownToTiptap(content, {
          papers: Array.isArray(library?.papers) ? library.papers : [],
          notes: store.listNotes({ includeDeleted: false }),
          anchors: store.getNote({ id: idValue })?.anchors ?? [],
        });
      }
      const note = store.updateNote({ id: idValue, patch });
      return { note: slimNote(note), noteId: note.id };
    }, { allowWhileAppRunning });
  }

  deleteNote({ noteId = '', allowWhileAppRunning = false } = {}) {
    const idValue = cleanString(noteId);
    if (!idValue) throw new Error('delete_note requires noteId');
    return this.withWritableNoteStore((store) => {
      const existing = store.getNote({ id: idValue });
      if (!existing) throw new Error(`Note does not exist: ${idValue}`);
      store.deleteNote({ id: idValue });
      return { deleted: true, noteId: idValue, title: existing.title };
    }, { allowWhileAppRunning });
  }

  listNoteTags({ paperId = '' } = {}) {
    const store = createNoteStore(this.appPaths);
    try {
      const tags = store.listTags({ paperId: cleanString(paperId) });
      return { tags, total: tags.length };
    } finally {
      store.close();
    }
  }

  // ---- 笔记文件夹工具 ----
  // 文件夹树已入库（note_folders 表），外部 agent 可与桌面端维护同一套组织结构。

  listNoteFolders() {
    const store = createNoteStore(this.appPaths);
    try {
      const folders = store.listFolders();
      return { folders, total: folders.length };
    } finally {
      store.close();
    }
  }

  createNoteFolder({ name = '', parentId = '', allowWhileAppRunning = false } = {}) {
    const cleanName = cleanString(name);
    if (!cleanName) throw new Error('create_note_folder requires a non-empty name');
    return this.withWritableNoteStore((store) => {
      const folder = store.createFolder({ name: cleanName, parentId: cleanString(parentId) || null });
      return { folder, folderId: folder.id };
    }, { allowWhileAppRunning });
  }

  renameNoteFolder({ folderId = '', name = '', allowWhileAppRunning = false } = {}) {
    const idValue = cleanString(folderId);
    const cleanName = cleanString(name);
    if (!idValue) throw new Error('rename_note_folder requires folderId');
    if (!cleanName) throw new Error('rename_note_folder requires a non-empty name');
    return this.withWritableNoteStore((store) => {
      const folder = store.renameFolder({ id: idValue, name: cleanName });
      return { folder, folderId: folder.id };
    }, { allowWhileAppRunning });
  }

  deleteNoteFolder({ folderId = '', allowWhileAppRunning = false } = {}) {
    const idValue = cleanString(folderId);
    if (!idValue) throw new Error('delete_note_folder requires folderId');
    return this.withWritableNoteStore((store) => {
      const result = store.deleteFolder({ id: idValue });
      return { deleted: true, deletedFolderIds: result.deletedFolderIds };
    }, { allowWhileAppRunning });
  }

  // 只读：列出全部分类（含系统分类）及文献计数，供写工具发现 categoryId。
  listCategories() {
    if (!fs.existsSync(this.appPaths.libraryDatabasePath)) {
      return {
        categories: [],
        total: 0,
        message: `Library database not found at: ${this.appPaths.libraryDatabasePath}`,
      };
    }
    const store = createLibraryStore(this.appPaths);
    try {
      const library = store.load();
      const categories = attachCategoryCounts(library).map((category) => ({
        id: category.id,
        name: category.name,
        parentId: category.parentId ?? null,
        sortOrder: category.sortOrder ?? 0,
        isSystem: Boolean(category.isSystem),
        systemKey: category.systemKey ?? null,
        paperCount: category.paperCount ?? 0,
      }));
      return { categories, total: categories.length };
    } finally {
      store.close();
    }
  }

  // 与 library_import_pdfs 对齐：查重（contentHash，另加元数据 DOI/标题）→ 复制/移动/引用 → 建记录。
  // 不触发 Crossref 参考文献抓取（桌面端行为），避免 MCP 调用引入隐藏网络副作用。
  importPdfs({
    paths = [],
    metadata = {},
    targetCategoryId = '',
    categoryName = '',
    importMode = '',
    allowWhileAppRunning = false,
  } = {}) {
    const sourcePaths = (Array.isArray(paths) ? paths : []).map(cleanString).filter(Boolean);
    if (sourcePaths.length === 0) {
      throw new Error('paths must be a non-empty array of local PDF file paths');
    }
    const metadataByPath = metadata && typeof metadata === 'object' ? metadata : {};
    const wantedCategoryId = cleanString(targetCategoryId);
    const wantedCategoryName = cleanString(categoryName);
    if (wantedCategoryId && wantedCategoryName) {
      throw new Error('targetCategoryId and categoryName are mutually exclusive');
    }
    const mode = cleanString(importMode).toLowerCase();
    if (mode && !['copy', 'move', 'keep'].includes(mode)) {
      throw new Error(`importMode must be one of: copy, move, keep (got: ${importMode})`);
    }

    return this.withWritableLibrary((library) => {
      const storageDir = library.settings.storageDir || path.join(this.appPaths.dataDir, 'paperquay-data');
      fs.mkdirSync(storageDir, { recursive: true });

      let resolvedCategoryId = null;
      if (wantedCategoryId) {
        const target = library.categories.find((item) => item.id === wantedCategoryId);
        if (!target) throw new Error(`Category does not exist: ${wantedCategoryId}`);
        if (target.isSystem) {
          throw new Error(`系统分类由应用自动维护，不能作为导入目标分类: ${target.name} (${wantedCategoryId})`);
        }
        resolvedCategoryId = target.id;
      } else if (wantedCategoryName) {
        const existing = library.categories.find(
          (item) => !item.isSystem && item.parentId === null
            && item.name.toLowerCase() === wantedCategoryName.toLowerCase(),
        );
        if (existing) {
          resolvedCategoryId = existing.id;
        } else {
          const category = {
            id: id('cat'),
            name: wantedCategoryName,
            parentId: null,
            sortOrder: library.categories.filter((item) => item.parentId === null && !item.isSystem).length,
            isSystem: false,
            systemKey: null,
            createdAt: now(),
            updatedAt: now(),
            paperCount: 0,
          };
          library.categories.push(category);
          resolvedCategoryId = category.id;
        }
      }

      const effectiveMode = mode || library.settings.importMode || 'copy';
      const imported = [];
      const duplicates = [];
      const errors = [];

      for (const sourcePath of sourcePaths) {
        try {
          if (!isPdf(sourcePath)) throw new Error('Only PDF files can be imported');
          if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
            throw new Error(`File not found: ${sourcePath}`);
          }

          const bytes = fs.readFileSync(sourcePath);
          const contentHash = hashBytes(bytes);
          const itemMeta = metadataByPath[sourcePath] && typeof metadataByPath[sourcePath] === 'object'
            ? metadataByPath[sourcePath]
            : {};
          const metaDoi = cleanString(itemMeta.doi);
          const metaTitle = cleanString(itemMeta.title);

          const existing = library.papers.find((paper) =>
            paper.attachments?.some((attachment) => attachment.contentHash === contentHash)
            || (metaDoi && paper.doi && String(paper.doi).toLowerCase() === metaDoi.toLowerCase())
            || (metaTitle && paper.title && paper.title.trim().toLowerCase() === metaTitle.toLowerCase()));

          if (existing) {
            if (resolvedCategoryId && !(existing.categoryIds || []).includes(resolvedCategoryId)) {
              existing.categoryIds = [...(existing.categoryIds || []), resolvedCategoryId];
              existing.updatedAt = now();
            }
            duplicates.push({
              sourcePath,
              existingPaperId: existing.id,
              title: existing.title,
              reason: '文献已在文库中存在（内容哈希/DOI/标题匹配）',
            });
            continue;
          }

          const paperId = id('paper');
          const fileName = safeFileName(fileNameFromPath(sourcePath));
          let storedPath = sourcePath;
          let relativePath = null;
          if (effectiveMode !== 'keep') {
            storedPath = path.join(storageDir, `${paperId}-${fileName}`);
            if (effectiveMode === 'move') fs.renameSync(sourcePath, storedPath);
            else fs.copyFileSync(sourcePath, storedPath);
            relativePath = path.relative(storageDir, storedPath);
          }
          const stat = fs.statSync(storedPath);
          const authors = Array.isArray(itemMeta.authors)
            ? itemMeta.authors.map(cleanString).filter(Boolean).map(normalizeAuthor)
            : [];
          const tags = Array.isArray(itemMeta.tags)
            ? itemMeta.tags.map(cleanString).filter(Boolean).map(normalizeTag)
            : [];

          const paper = {
            id: paperId,
            title: metaTitle || path.basename(fileName, path.extname(fileName)),
            titleZh: cleanString(itemMeta.titleZh) || null,
            year: itemMeta.year ?? null,
            publication: itemMeta.publication ?? null,
            doi: itemMeta.doi ?? null,
            url: itemMeta.url ?? null,
            abstractText: itemMeta.abstractText ?? null,
            itemType: itemMeta.itemType || 'journalArticle',
            publisher: itemMeta.publisher ?? null,
            institution: itemMeta.institution ?? null,
            reportNumber: itemMeta.reportNumber ?? null,
            volume: itemMeta.volume ?? null,
            issue: itemMeta.issue ?? null,
            pages: itemMeta.pages ?? null,
            isbn: itemMeta.isbn ?? null,
            issn: itemMeta.issn ?? null,
            keywords: Array.isArray(itemMeta.keywords) ? itemMeta.keywords.map(cleanString).filter(Boolean) : [],
            importedAt: now(),
            updatedAt: now(),
            lastReadAt: null,
            readingProgress: 0,
            isFavorite: false,
            userNote: null,
            aiSummary: null,
            citation: null,
            source: 'local',
            sortOrder: Math.min(0, ...library.papers.map((item) => item.sortOrder ?? 0)) - 1,
            authors,
            tags,
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
          imported.push({
            id: paperId,
            title: paper.title,
            sourcePath,
            storedPath,
            categoryId: resolvedCategoryId,
          });
        } catch (error) {
          errors.push({
            sourcePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        summary: {
          totalRequested: sourcePaths.length,
          importedCount: imported.length,
          duplicateCount: duplicates.length,
          failedCount: errors.length,
        },
        imported,
        duplicates,
        errors,
        categoryId: resolvedCategoryId,
        importMode: effectiveMode,
      };
    }, { allowWhileAppRunning });
  }

  // 与 library_update_paper 对齐的元数据白名单更新；未知字段显式拒绝。
  updatePaper({ paperId, allowWhileAppRunning = false, ...patch } = {}) {
    const targetId = cleanString(paperId);
    if (!targetId) throw new Error('paperId is required');
    const specialFields = ['keywords', 'authors', 'tags', 'isFavorite'];
    const unknown = Object.keys(patch).filter(
      (key) => !UPDATABLE_PAPER_FIELDS.includes(key) && !specialFields.includes(key),
    );
    if (unknown.length > 0) {
      throw new Error(
        `Unsupported update fields: ${unknown.join(', ')}. `
        + `Updatable fields: ${[...UPDATABLE_PAPER_FIELDS, ...specialFields].join(', ')}`,
      );
    }
    if (Object.keys(patch).length === 0) throw new Error('No fields to update');

    return this.withWritableLibrary((library) => {
      const paper = library.papers.find((item) => item.id === targetId);
      if (!paper) throw new Error(`Paper does not exist: ${targetId}`);

      for (const key of UPDATABLE_PAPER_FIELDS) {
        if (patch[key] !== undefined) paper[key] = patch[key];
      }
      if (patch.keywords !== undefined) {
        if (!Array.isArray(patch.keywords)) throw new Error('keywords must be an array of strings');
        paper.keywords = patch.keywords.map(cleanString).filter(Boolean);
      }
      if (patch.authors !== undefined) {
        if (!Array.isArray(patch.authors)) throw new Error('authors must be an array of author names');
        paper.authors = patch.authors.map(cleanString).filter(Boolean).map(normalizeAuthor);
      }
      if (patch.tags !== undefined) {
        if (!Array.isArray(patch.tags)) throw new Error('tags must be an array of tag names');
        paper.tags = patch.tags.map(cleanString).filter(Boolean).map(normalizeTag);
      }
      if (patch.isFavorite != null) paper.isFavorite = Boolean(patch.isFavorite);
      paper.updatedAt = now();

      return {
        paper: {
          id: paper.id,
          title: paper.title,
          titleZh: paper.titleZh ?? null,
          year: paper.year ?? null,
          doi: paper.doi ?? null,
          categoryIds: paper.categoryIds ?? [],
          updatedAt: paper.updatedAt,
        },
      };
    }, { allowWhileAppRunning });
  }

  // 批量分配/移除/重设非系统分类。系统分类由应用维护，显式拒绝。
  setPaperCategories({
    paperIds = [],
    add = [],
    remove = [],
    replace,
    allowWhileAppRunning = false,
  } = {}) {
    const ids = (Array.isArray(paperIds) ? paperIds : []).map(cleanString).filter(Boolean);
    if (ids.length === 0) throw new Error('paperIds must be a non-empty array');
    const cleanIdList = (value) => (Array.isArray(value) ? value.map(cleanString).filter(Boolean) : []);
    const addIds = cleanIdList(add);
    const removeIds = cleanIdList(remove);
    const replaceIds = replace === undefined ? null : cleanIdList(replace);
    if (replaceIds && (addIds.length > 0 || removeIds.length > 0)) {
      throw new Error('replace cannot be combined with add/remove');
    }
    if (!replaceIds && addIds.length === 0 && removeIds.length === 0) {
      throw new Error('Provide add, remove, or replace with at least one category ID');
    }

    return this.withWritableLibrary((library) => {
      const requestedIds = [...new Set(replaceIds ?? [...addIds, ...removeIds])];
      for (const categoryId of requestedIds) {
        const category = library.categories.find((item) => item.id === categoryId);
        if (!category) throw new Error(`Category does not exist: ${categoryId}`);
        if (category.isSystem) {
          throw new Error(`系统分类不可手动分配: ${category.name} (${categoryId})。收藏请使用 update_paper 的 isFavorite 字段。`);
        }
      }
      const papers = ids.map((targetId) => {
        const paper = library.papers.find((item) => item.id === targetId);
        if (!paper) throw new Error(`Paper does not exist: ${targetId}`);
        return paper;
      });

      const updated = papers.map((paper) => {
        let next = replaceIds ? [...replaceIds] : [...(paper.categoryIds || [])];
        for (const categoryId of addIds) {
          if (!next.includes(categoryId)) next.push(categoryId);
        }
        next = next.filter((categoryId) => !removeIds.includes(categoryId));
        paper.categoryIds = next;
        paper.updatedAt = now();
        return { id: paper.id, title: paper.title, categoryIds: next };
      });

      return { updated, total: updated.length };
    }, { allowWhileAppRunning });
  }

  // 分类管理：create / rename / move / delete。delete 与应用一致级联删除子孙分类，
  // 文献仅解除关联，不删除文献本身。系统分类显式拒绝修改/删除。
  manageCategory({
    action,
    categoryId = '',
    name = '',
    parentId,
    sortOrder,
    allowWhileAppRunning = false,
  } = {}) {
    const op = cleanString(action);
    if (!['create', 'rename', 'move', 'delete'].includes(op)) {
      throw new Error(`action must be one of: create, rename, move, delete (got: ${action})`);
    }

    return this.withWritableLibrary((library) => {
      if (op === 'create') {
        const categoryName = cleanString(name);
        if (!categoryName) throw new Error('name is required for create');
        let parent = null;
        const wantedParentId = cleanString(parentId);
        if (wantedParentId) {
          parent = library.categories.find((item) => item.id === wantedParentId) || null;
          if (!parent) throw new Error(`Parent category does not exist: ${wantedParentId}`);
          if (parent.isSystem) throw new Error('系统分类不能作为父级分类');
        }
        const category = {
          id: id('cat'),
          name: categoryName,
          parentId: parent ? parent.id : null,
          sortOrder: library.categories.filter(
            (item) => (item.parentId ?? null) === (parent ? parent.id : null) && !item.isSystem,
          ).length,
          isSystem: false,
          systemKey: null,
          createdAt: now(),
          updatedAt: now(),
          paperCount: 0,
        };
        library.categories.push(category);
        return { category };
      }

      const target = library.categories.find((item) => item.id === cleanString(categoryId));
      if (!target) throw new Error(`Category does not exist: ${categoryId}`);
      if (target.isSystem) throw new Error('系统分类不能修改或删除');

      if (op === 'rename') {
        const nextName = cleanString(name);
        if (!nextName) throw new Error('name is required for rename');
        target.name = nextName;
        target.updatedAt = now();
        return { category: target };
      }

      if (op === 'move') {
        const nextParentId = cleanString(parentId) || null;
        if (nextParentId) {
          if (nextParentId === target.id) throw new Error('分类不能移动到自身之下');
          const parent = library.categories.find((item) => item.id === nextParentId);
          if (!parent) throw new Error(`Parent category does not exist: ${nextParentId}`);
          if (parent.isSystem) throw new Error('系统分类不能作为父级分类');
          // 环检测：目标父级不能位于 target 的子树内
          const seen = new Set([target.id]);
          let cursor = parent;
          while (cursor) {
            if (seen.has(cursor.id)) throw new Error('分类不能移动到其子分类之下');
            seen.add(cursor.id);
            cursor = library.categories.find((item) => item.id === cursor.parentId) || null;
          }
        }
        target.parentId = nextParentId;
        if (sortOrder != null) target.sortOrder = sortOrder;
        target.updatedAt = now();
        return { category: target };
      }

      // delete：级联收集子孙分类，文献解除关联（与 library_delete_category 一致）
      const removeIds = new Set([target.id]);
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
      library.categories = library.categories.filter((item) => !removeIds.has(item.id));
      for (const paper of library.papers) {
        paper.categoryIds = (paper.categoryIds || []).filter((item) => !removeIds.has(item));
      }
      return { deletedCategoryIds: [...removeIds] };
    }, { allowWhileAppRunning });
  }

  // 删除文献记录；deleteFiles=true 时一并删除库内存储的附件文件。
  // 先提交数据库再删文件：文件删除失败不会留下指向已删文件的记录。
  deletePapers({ paperIds = [], deleteFiles = false, allowWhileAppRunning = false } = {}) {
    const ids = (Array.isArray(paperIds) ? paperIds : []).map(cleanString).filter(Boolean);
    if (ids.length === 0) throw new Error('paperIds must be a non-empty array');
    const idSet = new Set(ids);

    const result = this.withWritableLibrary((library) => {
      const papers = ids.map((targetId) => {
        const paper = library.papers.find((item) => item.id === targetId);
        if (!paper) throw new Error(`Paper does not exist: ${targetId}`);
        return paper;
      });
      const filesToDelete = [];
      const deleted = papers.map((paper) => {
        if (deleteFiles) {
          for (const attachment of paper.attachments || []) {
            if (attachment.storedPath) filesToDelete.push(attachment.storedPath);
          }
        }
        return { id: paper.id, title: paper.title };
      });
      library.papers = library.papers.filter((paper) => !idSet.has(paper.id));
      return { deleted, filesToDelete };
    }, { allowWhileAppRunning });

    const fileErrors = [];
    if (deleteFiles) {
      for (const filePath of result.filesToDelete) {
        try {
          fs.rmSync(filePath, { force: true });
        } catch (error) {
          fileErrors.push({ path: filePath, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    return {
      deleted: result.deleted,
      total: result.deleted.length,
      deletedFileCount: deleteFiles ? result.filesToDelete.length - fileErrors.length : 0,
      fileErrors,
      ...(result.warning ? { warning: result.warning } : {}),
    };
  }
}

module.exports = {
  PaperQuayKnowledgeService,
  resolveAppPaths,
  resolveDefaultDataDir,
};
