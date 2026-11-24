'use strict';

/**
 * Shared hybrid retrieval primitives for the desktop RAG store and the MCP
 * service. Every function accepts an open `DatabaseSync` handle so both callers
 * use the same FTS5, KNN, RRF, LIKE fallback, and neighbor-snippet semantics.
 */

const {
  extractFormulaNumbers,
  extractReferenceNumbers,
  extractShortSymbolTokens,
  scoreChunkByExactQuerySignals,
  stripRagQueryTemplateNoise,
} = require('../../src/shared/ragQueryUtils.cjs');

const DEFAULT_RRF_K = 60;
const NEIGHBOR_RADIUS = 3;
const NEIGHBOR_MAX_CHARS = 1600;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toExcludedSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value.map(cleanString).filter(Boolean) : []);
}

function toDocumentKeys(value) {
  return Array.isArray(value) ? value.map(cleanString).filter(Boolean) : [];
}

/** Global identity for a retrieval row; accepts both canonical and MCP aliases. */
function ragResultKey(row) {
  const documentKey = cleanString(row?.documentKey || row?.paperId);
  return JSON.stringify([documentKey, row?.sourceType ?? '', row?.chunkId ?? '']);
}

function rrfFuse(vectorRows, ftsRows, { k = DEFAULT_RRF_K } = {}) {
  const normalizedK = Math.max(1, Math.round(Number(k)) || DEFAULT_RRF_K);
  const fused = new Map();

  const addRanks = (rows, source) => {
    for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
      const key = ragResultKey(row);
      const existing = fused.get(key) ?? { ...row, rrfScore: 0, sourceRanks: {} };
      existing.rrfScore += 1 / (normalizedK + index + 1);
      existing.sourceRanks[source] = index + 1;
      fused.set(key, existing);
    }
  };

  addRanks(vectorRows, 'vector');
  addRanks(ftsRows, 'fts');

  return [...fused.values()]
    .sort((left, right) => right.rrfScore - left.rrfScore)
    .map(({ rrfScore, sourceRanks, ...row }) => ({
      ...row,
      // Existing renderers expect lower scores to be more relevant.
      score: 1 - rrfScore,
    }));
}

function canonicalRow(row) {
  return {
    documentKey: cleanString(row.documentKey || row.paperId),
    chunkId: row.chunkId,
    sourceType: row.sourceType,
    pageIndex: row.pageIndex ?? null,
    blockId: row.blockId ?? null,
    text: row.text,
    score: Number(row.score) || 0,
  };
}

function getTableColumns(db, tableName) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
  } catch {
    return new Set();
  }
}

function hasVectorTable(db, dimension) {
  try {
    const row = db.prepare('SELECT dimension FROM rag_vec_dimensions WHERE dimension = ?').get(dimension);
    if (row) return true;
  } catch {}
  try {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(`rag_vec_${dimension}`));
  } catch {
    return false;
  }
}

function toFloat32Array(vector) {
  if (vector instanceof Float32Array) return vector;
  const values = Array.isArray(vector)
    ? vector
    : (vector && typeof vector.length === 'number' ? Array.from(vector) : []);
  const output = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    output[index] = Number(values[index]);
  }
  return output;
}

function appendReadyFilter(conditions, params, readyMode, { dimension, modelKey, sourceSignature }) {
  let join = '';
  if (readyMode === 'index') {
    join = 'JOIN rag_indexes i ON i.document_key = c.document_key AND i.source_type = c.source_type';
    conditions.push("i.status = 'ready'");
    if (dimension !== null && dimension !== undefined) {
      conditions.push('i.embedding_dimension = ?');
      params.push(Number(dimension));
    }
    if (modelKey) {
      conditions.push('i.embedding_model_key = ?');
      params.push(modelKey);
    }
    if (sourceSignature) {
      conditions.push('i.source_signature = ?');
      params.push(sourceSignature);
    }
  } else if (readyMode === 'exists') {
    conditions.push("EXISTS (SELECT 1 FROM rag_indexes i WHERE i.document_key = c.document_key AND i.source_type = c.source_type AND i.status = 'ready')");
  }
  return join;
}

function appendScopeFilter(conditions, params, {
  documentKey,
  documentKeys,
  sourceType,
  excludedDocumentKeys,
  excludeNotes = true,
}) {
  const scopedKey = cleanString(documentKey);
  const targetKeys = toDocumentKeys(documentKeys);
  const excluded = toExcludedSet(excludedDocumentKeys);

  if (scopedKey) {
    conditions.push('c.document_key = ?');
    params.push(scopedKey);
    if (sourceType) {
      conditions.push('c.source_type = ?');
      params.push(sourceType);
    } else if (excluded.has(scopedKey) && excludeNotes) {
      conditions.push("c.source_type = 'note'");
    }
    return;
  }

  if (sourceType) {
    conditions.push('c.source_type = ?');
    params.push(sourceType);
  } else if (excludeNotes) {
    conditions.push("c.source_type != 'note'");
  }
  if (targetKeys.length > 0) {
    conditions.push('c.document_key IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(targetKeys));
  }
  if (excluded.size > 0) {
    conditions.push("(c.source_type = 'note' OR c.document_key NOT IN (SELECT value FROM json_each(?)))");
    params.push(JSON.stringify([...excluded]));
  }
}

function searchFtsChunks(db, {
  matchQuery,
  documentKey = null,
  documentKeys = null,
  sourceType = null,
  limit = 10,
  excludedDocumentKeys = new Set(),
  excludeNotes = true,
  readyMode = 'none',
  dimension = null,
  modelKey = null,
  sourceSignature = null,
} = {}) {
  const query = cleanString(matchQuery);
  if (!query) {
    return { rows: [], status: 'not-queried' };
  }

  const safeLimit = Math.max(1, Math.round(Number(limit)) || 10);
  const conditions = ['rag_chunks_fts MATCH ?'];
  const params = [query];
  const join = appendReadyFilter(conditions, params, readyMode, { dimension, modelKey, sourceSignature });
  appendScopeFilter(conditions, params, {
    documentKey,
    documentKeys,
    sourceType,
    excludedDocumentKeys,
    excludeNotes,
  });
  params.push(safeLimit);

  try {
    const rows = db.prepare(`
      SELECT
        c.document_key AS documentKey,
        c.chunk_id AS chunkId,
        c.source_type AS sourceType,
        c.page_index AS pageIndex,
        c.block_id AS blockId,
        c.text,
        bm25(rag_chunks_fts) AS rank
      FROM rag_chunks_fts
      JOIN rag_chunks c ON c.id = rag_chunks_fts.rowid
      ${join}
      WHERE ${conditions.join(' AND ')}
      ORDER BY rank
      LIMIT ?
    `).all(...params);

    return {
      status: 'searched',
      rows: rows.map((row) => ({
        documentKey: row.documentKey,
        chunkId: row.chunkId,
        sourceType: row.sourceType,
        pageIndex: row.pageIndex ?? null,
        blockId: row.blockId ?? null,
        text: row.text,
        score: Number(row.rank) || 0,
      })),
    };
  } catch (error) {
    return { rows: [], status: 'failed', error };
  }
}

function hasExactQuerySignals(queryText) {
  const { question, combined } = stripRagQueryTemplateNoise(queryText);
  return (
    extractFormulaNumbers(combined).length > 0 ||
    extractReferenceNumbers(combined).length > 0 ||
    extractShortSymbolTokens(question || combined).length > 0
  );
}

/** Scoped exact-signal boost (formula/reference/symbol matches). */
function searchExactSignalChunks(db, {
  queryText,
  documentKey = null,
  documentKeys = null,
  sourceType = null,
  limit = 10,
  excludedDocumentKeys = new Set(),
  excludeNotes = true,
  readyMode = 'none',
  dimension = null,
  modelKey = null,
  sourceSignature = null,
} = {}) {
  if (!hasExactQuerySignals(queryText)) {
    return [];
  }

  const scopedKey = cleanString(documentKey);
  const suppliedKeys = toDocumentKeys(documentKeys);
  const targetKeys = scopedKey && suppliedKeys.length <= 1
    ? [scopedKey]
    : (suppliedKeys.length > 0 && suppliedKeys.length <= 20 ? suppliedKeys : []);
  if (targetKeys.length === 0) {
    return [];
  }

  const safeLimit = Math.max(1, Math.round(Number(limit)) || 10);
  const conditions = ['c.document_key IN (SELECT value FROM json_each(?))'];
  const params = [JSON.stringify(targetKeys)];
  const join = appendReadyFilter(conditions, params, readyMode, { dimension, modelKey, sourceSignature });

  if (sourceType) {
    conditions.push('c.source_type = ?');
    params.push(sourceType);
  } else if (excludeNotes) {
    conditions.push("c.source_type != 'note'");
  }
  const excluded = toExcludedSet(excludedDocumentKeys);
  if (excluded.size > 0) {
    conditions.push("(c.source_type = 'note' OR c.document_key NOT IN (SELECT value FROM json_each(?)))");
    params.push(JSON.stringify([...excluded]));
  }

  try {
    const rows = db.prepare(`
      SELECT
        c.document_key AS documentKey,
        c.chunk_id AS chunkId,
        c.source_type AS sourceType,
        c.page_index AS pageIndex,
        c.block_id AS blockId,
        c.text
      FROM rag_chunks c
      ${join}
      WHERE ${conditions.join(' AND ')}
    `).all(...params);

    return rows
      .map((row) => ({
        documentKey: row.documentKey,
        chunkId: row.chunkId,
        sourceType: row.sourceType,
        pageIndex: row.pageIndex ?? null,
        blockId: row.blockId ?? null,
        text: row.text,
        exactScore: scoreChunkByExactQuerySignals(row.text, queryText),
      }))
      .filter((row) => row.exactScore > 0)
      .sort((left, right) => right.exactScore - left.exactScore)
      .slice(0, safeLimit)
      .map(({ exactScore, ...row }) => ({ ...row, score: -100 - exactScore }));
  } catch {
    return [];
  }
}

/** Merge exact-signal rows in front of FTS rows, de-duplicated by result key. */
function mergeRankedRows(primaryRows, secondaryRows, limit) {
  const primary = Array.isArray(primaryRows) ? primaryRows : [];
  const secondary = Array.isArray(secondaryRows) ? secondaryRows : [];
  if (primary.length === 0) return secondary;
  if (secondary.length === 0) return primary;

  const merged = new Map();
  for (const row of primary) merged.set(ragResultKey(row), row);
  for (const row of secondary) {
    const key = ragResultKey(row);
    if (!merged.has(key)) merged.set(key, row);
  }
  return [...merged.values()].slice(0, Math.max(1, Math.round(Number(limit)) || merged.size));
}

/**
 * Single KNN query over the sqlite-vec table. `documentKey` constrains the
 * query to one source document; otherwise `documentKeys`/`sourceType` narrow
 * the joined chunk rows.
 */
function searchVectorChunks(db, {
  queryVector,
  dimension,
  limit = 10,
  documentKey = null,
  documentKeys = null,
  sourceType = null,
  modelKey = null,
  sourceSignature = null,
  excludedDocumentKeys = new Set(),
  requireReady = true,
} = {}) {
  const dim = Number(dimension);
  if (!Number.isSafeInteger(dim) || dim <= 0) return [];
  if (!hasVectorTable(db, dim)) return [];

  const safeLimit = Math.max(1, Math.round(Number(limit)) || 10);
  const scopedKey = cleanString(documentKey);
  const targetKeys = scopedKey ? [] : toDocumentKeys(documentKeys);
  const excluded = toExcludedSet(excludedDocumentKeys);

  // A single global KNN needs a budget large enough to avoid one document
  // consuming every slot. Count eligible index sources once, then issue one
  // KNN with `k = limit * sourceCount` (bounded), instead of a query per source.
  // Eligible partitions are also pushed into the KNN so closer vectors from
  // another embedding model cannot starve valid results.
  let knnLimit = safeLimit;
  let eligibleDocumentKeys = [];
  let eligibleSourceTypes = [];
  if (requireReady) {
    const countConditions = ["i.status = 'ready'", 'i.embedding_dimension = ?'];
    const countParams = [dim];
    if (modelKey) {
      countConditions.push('i.embedding_model_key = ?');
      countParams.push(modelKey);
    }
    if (sourceSignature) {
      countConditions.push('i.source_signature = ?');
      countParams.push(sourceSignature);
    }
    if (sourceType) {
      countConditions.push('i.source_type = ?');
      countParams.push(sourceType);
    } else if (!scopedKey) {
      countConditions.push("i.source_type IN ('mineru-markdown', 'pdf-text')");
    }
    if (scopedKey) {
      countConditions.push('i.document_key = ?');
      countParams.push(scopedKey);
    } else if (targetKeys.length > 0) {
      countConditions.push('i.document_key IN (SELECT value FROM json_each(?))');
      countParams.push(JSON.stringify(targetKeys));
    }
    try {
      const sources = db.prepare(`
        SELECT DISTINCT i.document_key AS documentKey, i.source_type AS sourceType
        FROM rag_indexes i
        WHERE ${countConditions.join(' AND ')}
      `).all(...countParams);
      eligibleDocumentKeys = [...new Set(sources.map((row) => row.documentKey))];
      eligibleSourceTypes = [...new Set(sources.map((row) => row.sourceType))];
      // Cover every vector in the eligible scope (bounded) so no source can be
      // starved by closer vectors from the same eligible partition set.
      const partitionWhere = [];
      const partitionParams = [];
      if (eligibleDocumentKeys.length > 0) {
        partitionWhere.push('v.document_key IN (SELECT value FROM json_each(?))');
        partitionParams.push(JSON.stringify(eligibleDocumentKeys));
      }
      if (eligibleSourceTypes.length > 0) {
        partitionWhere.push('v.source_type IN (SELECT value FROM json_each(?))');
        partitionParams.push(JSON.stringify(eligibleSourceTypes));
      }
      const countRow = db.prepare(`
        SELECT COUNT(*) AS count
        FROM rag_vec_${dim} v
        ${partitionWhere.length > 0 ? `WHERE ${partitionWhere.join(' AND ')}` : ''}
      `).get(...partitionParams);
      knnLimit = Math.min(4096, Math.max(safeLimit, Number(countRow?.count) || 0));
    } catch {
      knnLimit = safeLimit;
    }
  }

  const conditions = ['v.embedding MATCH ?', 'k = ?'];
  const params = [toFloat32Array(queryVector), knnLimit];
  let join = '';

  if (requireReady) {
    if (eligibleDocumentKeys.length === 0) return [];
    conditions.push('v.document_key IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(eligibleDocumentKeys));
    if (eligibleSourceTypes.length > 0) {
      conditions.push('v.source_type IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(eligibleSourceTypes));
    }
    join = 'JOIN rag_indexes i ON i.document_key = c.document_key AND i.source_type = c.source_type';
    conditions.push("i.status = 'ready'");
    conditions.push('i.embedding_dimension = ?');
    params.push(dim);
    if (modelKey) {
      conditions.push('i.embedding_model_key = ?');
      params.push(modelKey);
    }
    if (sourceSignature) {
      conditions.push('i.source_signature = ?');
      params.push(sourceSignature);
    }
  }

  if (scopedKey) {
    conditions.push('c.document_key = ?');
    params.push(scopedKey);
  } else if (targetKeys.length > 0) {
    conditions.push('c.document_key IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(targetKeys));
  }

  if (sourceType) {
    conditions.push('c.source_type = ?');
    params.push(sourceType);
  } else if (!scopedKey) {
    conditions.push("c.source_type IN ('mineru-markdown', 'pdf-text')");
  }

  if (excluded.size > 0) {
    conditions.push("(c.source_type = 'note' OR c.document_key NOT IN (SELECT value FROM json_each(?)))");
    params.push(JSON.stringify([...excluded]));
  }

  try {
    const rows = db.prepare(`
      SELECT
        c.document_key AS documentKey,
        c.chunk_id AS chunkId,
        c.source_type AS sourceType,
        c.page_index AS pageIndex,
        c.block_id AS blockId,
        c.text,
        v.distance
      FROM rag_vec_${dim} v
      JOIN rag_chunks c ON c.id = v.rowid
      ${join}
      WHERE ${conditions.join(' AND ')}
      ORDER BY v.distance
    `).all(...params);

    return rows
      .map((row) => ({
        documentKey: row.documentKey,
        chunkId: row.chunkId,
        sourceType: row.sourceType,
        pageIndex: row.pageIndex ?? null,
        blockId: row.blockId ?? null,
        text: row.text,
        score: Number(row.distance) || 0,
      }))
      .sort((left, right) => left.score - right.score)
      .slice(0, safeLimit);
  } catch {
    return [];
  }
}

/** LIKE fallback used when FTS and vector channels both return nothing. */
function searchLikeChunks(db, {
  query,
  documentKey = null,
  documentKeys = null,
  sourceType = null,
  limit = 10,
  excludedDocumentKeys = new Set(),
  excludeNotes = true,
  readyMode = 'none',
  dimension = null,
  modelKey = null,
  sourceSignature = null,
} = {}) {
  const text = cleanString(query);
  if (!text) return [];

  const safeLimit = Math.max(1, Math.round(Number(limit)) || 10);
  const conditions = ['lower(c.text) LIKE ?'];
  const params = [`%${text.toLowerCase()}%`];
  const join = appendReadyFilter(conditions, params, readyMode, { dimension, modelKey, sourceSignature });
  appendScopeFilter(conditions, params, {
    documentKey,
    documentKeys,
    sourceType,
    excludedDocumentKeys,
    excludeNotes,
  });
  params.push(safeLimit);

  try {
    const rows = db.prepare(`
      SELECT
        c.document_key AS documentKey,
        c.chunk_id AS chunkId,
        c.source_type AS sourceType,
        c.page_index AS pageIndex,
        c.block_id AS blockId,
        c.text
      FROM rag_chunks c
      ${join}
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.chunk_index
      LIMIT ?
    `).all(...params);

    return rows.map((row) => ({
      documentKey: row.documentKey,
      chunkId: row.chunkId,
      sourceType: row.sourceType,
      pageIndex: row.pageIndex ?? null,
      blockId: row.blockId ?? null,
      text: row.text,
      score: 1,
    }));
  } catch {
    return [];
  }
}

function isBridgeableNeighborText(text) {
  const trimmed = cleanString(text);
  if (!trimmed) return false;
  return trimmed.length < 120 || /\\tag\{|\$\$/.test(trimmed);
}

function pickNeighborText(neighbors, hitChunkIndex, fallbackText, maxChars = NEIGHBOR_MAX_CHARS) {
  const hitPos = neighbors.findIndex((item) => Number(item.chunkIndex) === hitChunkIndex);
  if (hitPos < 0) {
    const combined = neighbors.map((item) => item.text).filter((item) => item).join('\n\n');
    return combined || fallbackText;
  }

  const picked = [neighbors[hitPos]];
  let totalChars = (neighbors[hitPos].text || '').length;

  for (let index = hitPos - 1; index >= 0; index -= 1) {
    const candidate = neighbors[index];
    const distance = hitPos - index;
    const previous = picked[0];
    if (distance > 1 && !isBridgeableNeighborText(previous?.text) && !isBridgeableNeighborText(candidate.text)) {
      break;
    }
    const nextLength = (candidate.text || '').length;
    if (distance > 1 && totalChars + nextLength > maxChars) {
      break;
    }
    picked.unshift(candidate);
    totalChars += nextLength;
    if (distance === 1 && !isBridgeableNeighborText(candidate.text) && !isBridgeableNeighborText(neighbors[hitPos].text)) {
      break;
    }
  }

  for (let index = hitPos + 1; index < neighbors.length; index += 1) {
    const candidate = neighbors[index];
    const distance = index - hitPos;
    const previous = picked[picked.length - 1];
    if (distance > 1 && !isBridgeableNeighborText(previous?.text) && !isBridgeableNeighborText(candidate.text)) {
      break;
    }
    const nextLength = (candidate.text || '').length;
    if (distance > 1 && totalChars + nextLength > maxChars) {
      break;
    }
    picked.push(candidate);
    totalChars += nextLength;
    if (distance === 1 && !isBridgeableNeighborText(candidate.text) && !isBridgeableNeighborText(neighbors[hitPos].text)) {
      break;
    }
  }

  const combined = picked.map((item) => item.text).filter((item) => item).join('\n\n');
  return combined || fallbackText;
}

/**
 * Assemble neighbor-expanded snippets for all result rows with one hit lookup
 * and one neighbor query instead of two queries per result.
 *
 * @returns {Map<string, string>} keyed by `ragResultKey(row)`
 */
function assembleNeighborSnippets(db, rows, { radius = NEIGHBOR_RADIUS, maxChars = NEIGHBOR_MAX_CHARS } = {}) {
  const output = new Map();
  const input = Array.isArray(rows) ? rows : [];
  const columns = getTableColumns(db, 'rag_chunks');
  if (!columns.has('chunk_index')) {
    for (const row of input) {
      output.set(ragResultKey(row), typeof row.text === 'string' ? row.text : '');
    }
    return output;
  }

  const hits = [];
  for (const row of input) {
    const documentKey = cleanString(row.documentKey || row.paperId);
    const sourceType = cleanString(row.sourceType);
    const chunkId = row.chunkId;
    if (!documentKey || !sourceType || chunkId === undefined || chunkId === null) {
      output.set(ragResultKey(row), typeof row.text === 'string' ? row.text : '');
      continue;
    }
    hits.push({ row, documentKey, sourceType, chunkId, key: ragResultKey({ documentKey, sourceType, chunkId }) });
  }

  if (hits.length === 0) return output;

  const hasGeneration = columns.has('generation_id');
  const hasSection = columns.has('section_id');

  const hitConditions = [];
  const hitParams = [];
  for (const hit of hits) {
    hitConditions.push('(document_key = ? AND source_type = ? AND chunk_id = ?)');
    hitParams.push(hit.documentKey, hit.sourceType, hit.chunkId);
  }

  const currentRows = db.prepare(`
    SELECT
      document_key AS documentKey,
      source_type AS sourceType,
      chunk_id AS chunkId,
      chunk_index AS chunkIndex,
      ${hasGeneration ? 'generation_id' : "''"} AS generationId,
      ${hasSection ? 'section_id' : 'NULL'} AS sectionId
    FROM rag_chunks
    WHERE ${hitConditions.join(' OR ')}
  `).all(...hitParams);

  const currentByKey = new Map(currentRows.map((row) => [
    ragResultKey({ documentKey: row.documentKey, sourceType: row.sourceType, chunkId: row.chunkId }),
    row,
  ]));

  const rangeConditions = [];
  const rangeParams = [];
  const ranges = new Map();

  for (const hit of hits) {
    const fallback = typeof hit.row.text === 'string' ? hit.row.text : '';
    const current = currentByKey.get(hit.key);
    const hitChunkIndex = Number(current?.chunkIndex);
    if (!current || !Number.isFinite(hitChunkIndex)) {
      output.set(hit.key, fallback);
      continue;
    }

    let condition = '(document_key = ? AND source_type = ? AND chunk_index BETWEEN ? AND ?';
    const params = [hit.documentKey, hit.sourceType, hitChunkIndex - radius, hitChunkIndex + radius];
    if (hasGeneration) {
      condition += ' AND generation_id = ?';
      params.push(current.generationId ?? '');
    }
    if (hasSection && current.sectionId) {
      condition += ' AND section_id = ?';
      params.push(current.sectionId);
    }
    condition += ')';
    rangeConditions.push(condition);
    rangeParams.push(...params);
    ranges.set(hit.key, { hitChunkIndex, fallback, documentKey: hit.documentKey, sourceType: hit.sourceType });
  }

  if (rangeConditions.length === 0) return output;

  const neighborRows = db.prepare(`
    SELECT
      document_key AS documentKey,
      source_type AS sourceType,
      chunk_index AS chunkIndex,
      text
    FROM rag_chunks
    WHERE ${rangeConditions.join(' OR ')}
    ORDER BY document_key, source_type, chunk_index
  `).all(...rangeParams);

  const neighborsBySource = new Map();
  for (const row of neighborRows) {
    const key = JSON.stringify([row.documentKey, row.sourceType]);
    const bucket = neighborsBySource.get(key) ?? [];
    bucket.push({ chunkIndex: row.chunkIndex, text: row.text });
    neighborsBySource.set(key, bucket);
  }

  for (const [key, range] of ranges) {
    const neighbors = neighborsBySource.get(JSON.stringify([range.documentKey, range.sourceType])) ?? [];
    output.set(key, pickNeighborText(neighbors, range.hitChunkIndex, range.fallback, maxChars));
  }

  return output;
}

module.exports = {
  DEFAULT_RRF_K,
  ragResultKey,
  rrfFuse,
  canonicalRow,
  getTableColumns,
  hasVectorTable,
  toFloat32Array,
  hasExactQuerySignals,
  searchFtsChunks,
  searchExactSignalChunks,
  mergeRankedRows,
  searchVectorChunks,
  searchLikeChunks,
  assembleNeighborSnippets,
};
