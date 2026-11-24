const { cleanString, toError } = require('../utils.cjs');
const { buildFtsMatchQuery } = require('../../../src/shared/ragQueryUtils.cjs');
const {
  ragResultKey,
  rrfFuse,
  searchFtsChunks,
  searchExactSignalChunks,
  mergeRankedRows,
  searchVectorChunks,
} = require('../../shared/ragSearch.cjs');
const { hasVectorTable } = require('./schema.cjs');
const {
  decodeEmbeddingValue,
  getStatus,
  normalizeBoundedString,
  normalizeDocumentKey,
  normalizeNonNegativeInteger,
  normalizeRequiredString,
  normalizeSourceType,
  parseStoredSectionPath,
  toFloat32Array,
  validateEmbedding,
} = require('./indexing.cjs');

const MAX_RAG_RETRIEVAL_TOP_K = 100;
const MAX_CONTEXT_NEIGHBORS = 8;
// S5-GRAPH-2：文档相似度是 O(n^2) 热点。候选向量集与输出边数都有上限，
// 超过上限时按 document_key 升序确定性地截断，再做 top-K 保留。
const DEFAULT_MAX_SIMILARITY_CANDIDATES = 2000;
const MAX_SIMILARITY_CANDIDATES = 5000;
const MAX_SIMILARITY_EDGE_LIMIT = 1000;

function vectorNorm(vector) {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = Number(vector[index]) || 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

// 保留“最差边在堆顶”的小顶堆，内存只与 limit 有关。
function isWorseEdge(left, right) {
  if (left.similarity !== right.similarity) return left.similarity < right.similarity;
  return left.order > right.order;
}

function createTopEdgeCollector(limit) {
  const heap = [];
  let order = 0;

  const siftUp = (index) => {
    let current = index;
    while (current > 0) {
      const parent = (current - 1) >> 1;
      if (!isWorseEdge(heap[current], heap[parent])) break;
      [heap[current], heap[parent]] = [heap[parent], heap[current]];
      current = parent;
    }
  };

  const siftDown = (index) => {
    let current = index;
    for (;;) {
      const left = current * 2 + 1;
      const right = left + 1;
      let worst = current;
      if (left < heap.length && isWorseEdge(heap[left], heap[worst])) worst = left;
      if (right < heap.length && isWorseEdge(heap[right], heap[worst])) worst = right;
      if (worst === current) break;
      [heap[current], heap[worst]] = [heap[worst], heap[current]];
      current = worst;
    }
  };

  return {
    push(edge) {
      const entry = { ...edge, order };
      order += 1;
      if (limit <= 0) return;
      if (heap.length < limit) {
        heap.push(entry);
        siftUp(heap.length - 1);
        return;
      }
      // The heap root is the worst kept edge; replace it only with a better one.
      if (isWorseEdge(entry, heap[0]) || entry.similarity === heap[0].similarity) return;
      heap[0] = entry;
      siftDown(0);
    },
    values() {
      return heap
        .slice()
        .sort((left, right) => (
          right.similarity - left.similarity || left.order - right.order
        ))
        .map(({ order: _order, ...edge }) => edge);
    },
    get size() {
      return heap.length;
    },
  };
}

function parseSourceTypesJson(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.map((item) => cleanString(item)).filter(Boolean).sort() : [];
  } catch {
    return [];
  }
}

function retrieveVectorChunks(db, { documentKey, documentKeys, sourceType, queryEmbedding, dimension, limit, modelKey, sourceSignature, excludedDocumentKeys }) {
  if (!hasVectorTable(db, dimension)) {
    return [];
  }

  const scopedKey = documentKey && (!documentKeys || documentKeys.length <= 1) ? documentKey : null;
  return searchVectorChunks(db, {
    queryVector: queryEmbedding,
    dimension,
    limit,
    documentKey: scopedKey,
    documentKeys: scopedKey ? null : documentKeys,
    sourceType,
    modelKey,
    sourceSignature,
    excludedDocumentKeys,
    requireReady: true,
  });
}

function searchFts(db, { documentKey, documentKeys, sourceType, queryText, dimension, limit, modelKey, sourceSignature, excludedDocumentKeys }, ftsAvailable) {
  if (!ftsAvailable) {
    return { rows: [], status: 'unavailable' };
  }

  const matchQuery = buildFtsMatchQuery(queryText);
  const exactRows = searchExactSignalChunks(db, {
    queryText,
    documentKey,
    documentKeys,
    sourceType,
    limit,
    excludedDocumentKeys,
    readyMode: 'index',
    dimension,
    modelKey,
    sourceSignature,
  });

  if (!matchQuery) {
    return exactRows.length > 0
      ? { status: 'searched', rows: exactRows }
      : { rows: [], status: 'not-queried' };
  }

  const result = searchFtsChunks(db, {
    matchQuery,
    documentKey,
    documentKeys,
    sourceType,
    limit,
    excludedDocumentKeys,
    readyMode: 'index',
    dimension,
    modelKey,
    sourceSignature,
  });

  if (result.status === 'failed') {
    console.warn('[paperquay] FTS retrieval failed; local RAG used vector retrieval only.', toError(result.error));
    return { rows: [], status: 'failed' };
  }

  return { status: 'searched', rows: mergeRankedRows(exactRows, result.rows, limit) };
}

function retrieveDocumentChunks(db, request, ftsAvailable) {
  const rawDocKey = cleanString(request?.documentKey);
  const rawDocKeys = Array.isArray(request?.documentKeys)
    ? request.documentKeys.map(cleanString).filter(Boolean)
    : [];
  const documentKey = rawDocKey || null;
  const documentKeys = rawDocKeys.length > 0 ? rawDocKeys : (documentKey ? [documentKey] : null);
  const sourceType = request?.sourceType ? normalizeSourceType(request.sourceType) : null;
  const modelKey = cleanString(request?.embeddingModelKey) || null;
  const sourceSignature = cleanString(request?.sourceSignature) || null;
  const excludedDocumentKeys = new Set(Array.isArray(request?.excludedDocumentKeys) ? request.excludedDocumentKeys.map(cleanString).filter(Boolean) : []);
  const topK = Math.min(
    MAX_RAG_RETRIEVAL_TOP_K,
    Math.max(1, normalizeNonNegativeInteger(request?.topK, 6)),
  );
  const dimension = validateEmbedding(request?.queryEmbedding);
  const candidateLimit = Math.min(MAX_RAG_RETRIEVAL_TOP_K, Math.max(topK, topK * 2));
  const vectorRows = retrieveVectorChunks(db, {
    documentKey,
    documentKeys,
    sourceType,
    queryEmbedding: toFloat32Array(request.queryEmbedding),
    dimension,
    limit: candidateLimit,
    modelKey,
    sourceSignature,
    excludedDocumentKeys,
  });
  const fts = searchFts(db, {
    documentKey,
    documentKeys,
    sourceType,
    queryText: normalizeBoundedString(request?.queryText, 'RAG queryText', { maxLength: 2000 }),
    dimension,
    limit: candidateLimit,
    modelKey,
    sourceSignature,
    excludedDocumentKeys,
  }, ftsAvailable);

  const vectorKeys = new Set(vectorRows.map(ragResultKey));
  const ftsKeys = new Set(fts.rows.map(ragResultKey));
  const rawResults = fts.rows.length === 0
    ? vectorRows.slice(0, topK)
    : rrfFuse(vectorRows, fts.rows).slice(0, topK);
  const results = rawResults.map((row) => {
    const key = ragResultKey(row);
    const channels = [];
    if (vectorKeys.has(key)) channels.push('vector');
    if (ftsKeys.has(key)) channels.push('fts');
    return channels.length > 0 ? { ...row, channels } : row;
  });
  if (request?.includeDiagnostics === true) {
    let indexCoverage;
    if (request?.includeIndexCoverage === true && documentKeys && sourceType !== 'note') {
      const keys = [...new Set(documentKeys)];
      const eligible = keys.filter((key) => !excludedDocumentKeys.has(key));
      const clauses = ["status = 'ready'", 'embedding_dimension = ?', "source_type IN ('mineru-markdown', 'pdf-text')", 'document_key IN (SELECT value FROM json_each(?))'];
      const args = [dimension, JSON.stringify(eligible)];
      if (sourceType) {
        clauses.push('source_type = ?');
        args.push(sourceType);
      }
      if (modelKey) {
        clauses.push('embedding_model_key = ?');
        args.push(modelKey);
      }
      if (sourceSignature) {
        clauses.push('source_signature = ?');
        args.push(sourceSignature);
      }
      const ready = db.prepare(`SELECT COUNT(DISTINCT document_key) AS count FROM rag_indexes WHERE ${clauses.join(' AND ')}`).get(...args).count;
      indexCoverage = { total: keys.length, excluded: keys.length - eligible.length, ready: Number(ready), unavailable: eligible.length - Number(ready) };
    }
    return { results, ftsStatus: fts.status, ftsHitCount: fts.rows.length, ...(indexCoverage ? { indexCoverage } : {}) };
  }
  return results;
}

function getChunkContext(db, request) {
  const documentKey = normalizeDocumentKey(request?.documentKey);
  const sourceType = normalizeSourceType(request?.sourceType);
  const chunkId = normalizeRequiredString(request?.chunkId, 'chunkId');
  const before = Math.min(MAX_CONTEXT_NEIGHBORS, normalizeNonNegativeInteger(request?.before, 1));
  const after = Math.min(MAX_CONTEXT_NEIGHBORS, normalizeNonNegativeInteger(request?.after, 1));
  const emptyResult = (status) => ({
    status,
    sectionPath: null,
    slices: [],
    hasMoreBefore: false,
    hasMoreAfter: false,
    truncated: false,
    truncationReason: null,
  });

  const statusRow = getStatus(db, documentKey, sourceType);
  if (!statusRow || statusRow.status !== 'ready') {
    return emptyResult('not-ready');
  }

  const target = db
    .prepare(
      `SELECT chunk_id, chunk_index, page_index, block_id, text,
              generation_id, section_id, section_path
       FROM rag_chunks
       WHERE document_key = ? AND source_type = ? AND chunk_id = ?`,
    )
    .get(documentKey, sourceType, chunkId);
  if (!target) {
    return emptyResult('not-found');
  }

  const generationId = target.generation_id ?? '';
  const restrictSection = request?.boundary === 'document' || !target.section_id
    ? null
    : target.section_id;
  const neighborSql = `
    SELECT chunk_id, chunk_index, page_index, block_id, text
    FROM rag_chunks
    WHERE document_key = ? AND source_type = ? AND generation_id = ?
      AND (? IS NULL OR section_id = ?)
  `;

  const beforeRows = before > 0
    ? db
        .prepare(`${neighborSql} AND chunk_index < ? ORDER BY chunk_index DESC LIMIT ?`)
        .all(
          documentKey,
          sourceType,
          generationId,
          restrictSection,
          restrictSection,
          target.chunk_index,
          before,
        )
        .reverse()
    : [];
  const afterRows = after > 0
    ? db
        .prepare(`${neighborSql} AND chunk_index > ? ORDER BY chunk_index ASC LIMIT ?`)
        .all(
          documentKey,
          sourceType,
          generationId,
          restrictSection,
          restrictSection,
          target.chunk_index,
          after,
        )
    : [];

  const minFetchedIndex = beforeRows.length > 0 ? beforeRows[0].chunk_index : target.chunk_index;
  const maxFetchedIndex = afterRows.length > 0 ? afterRows[afterRows.length - 1].chunk_index : target.chunk_index;
  const hasMoreBefore = Boolean(
    db
      .prepare(
        `SELECT 1 FROM rag_chunks
         WHERE document_key = ? AND source_type = ? AND generation_id = ?
           AND (? IS NULL OR section_id = ?)
           AND chunk_index < ? LIMIT 1`,
      )
      .get(documentKey, sourceType, generationId, restrictSection, restrictSection, minFetchedIndex),
  );
  const hasMoreAfter = Boolean(
    db
      .prepare(
        `SELECT 1 FROM rag_chunks
         WHERE document_key = ? AND source_type = ? AND generation_id = ?
           AND (? IS NULL OR section_id = ?)
           AND chunk_index > ? LIMIT 1`,
      )
      .get(documentKey, sourceType, generationId, restrictSection, restrictSection, maxFetchedIndex),
  );
  const stoppedAtSectionBoundary = Boolean(
    restrictSection && db.prepare(
      `SELECT 1 FROM rag_chunks
       WHERE document_key = ? AND source_type = ? AND generation_id = ?
         AND (section_id IS NULL OR section_id != ?)
       LIMIT 1`,
    ).get(documentKey, sourceType, generationId, restrictSection),
  );

  const toSlice = (row, position) => ({
    chunkId: row.chunk_id,
    chunkIndex: row.chunk_index,
    pageIndex: row.page_index ?? null,
    blockId: row.block_id ?? null,
    text: row.text,
    position,
  });

  return {
    status: 'ready',
    sectionPath: parseStoredSectionPath(target.section_path),
    generationId,
    slices: [
      ...beforeRows.map((row) => toSlice(row, 'before')),
      toSlice(target, 'hit'),
      ...afterRows.map((row) => toSlice(row, 'after')),
    ],
    hasMoreBefore,
    hasMoreAfter,
    truncated: stoppedAtSectionBoundary,
    truncationReason: stoppedAtSectionBoundary ? 'boundary' : null,
  };
}

/**
 * S5-GRAPH-2：文档级相似度边（知识图谱 embedding 边数据源）。
 *
 * 规模与采样策略：
 * - 候选向量：默认 DEFAULT_MAX_SIMILARITY_CANDIDATES = 2000，硬上限 5000；
 *   候选超过上限时按 document_key 升序截断（SQL 已按 document_key 排序），再两两比较，
 *   因此成对规模始终受候选上限约束，不会退化为无界 O(n^2)。
 * - 输出边：默认 limit 80，硬上限 MAX_SIMILARITY_EDGE_LIMIT = 1000，用小顶堆 top-K 收集。
 * - 复杂度：O(C² × D)。生产 embedding 为 768 维；2000 候选 / 768 维实测约 0.8s
 *   （内联点积优化前约 1.05s），8 维 2500 文档约 33–43ms。基准见
 *   tests/graphSimilarityScale.test.mjs。
 * - 精确性：始终对全部候选做精确 cosine（零向量相似度按 0 处理），不做近似或抽样；
 *   若未来需要近似索引，必须另行设计误差边界并同步更新文档与基准。
 */
function listDocumentSimilarities(db, request = {}) {
  const limit = Math.min(
    MAX_SIMILARITY_EDGE_LIMIT,
    Math.max(0, normalizeNonNegativeInteger(request.limit, 80)),
  );
  const minSimilarity = Number.isFinite(Number(request.minSimilarity))
    ? Math.max(-1, Math.min(1, Number(request.minSimilarity)))
    : 0.82;
  const candidateLimit = Math.min(
    MAX_SIMILARITY_CANDIDATES,
    Math.max(2, normalizeNonNegativeInteger(request.maxCandidates, DEFAULT_MAX_SIMILARITY_CANDIDATES)),
  );
  const allowedDocumentKeys = Array.isArray(request.documentKeys)
    ? new Set(request.documentKeys.map((key) => cleanString(key)).filter(Boolean))
    : null;

  if (limit === 0) {
    return [];
  }

  // 只读文档级平均向量缓存（由 indexDocument/reportFailure 维护、旧库一次性回填），
  // 避免每次全量解码 chunk 向量阻塞主进程。允许列表在 SQL 中先过滤，避免
  // 大库把全部向量解码后才丢弃。
  const selectSql = `
    SELECT
      document_key AS documentKey,
      dimension,
      embedding,
      source_types_json AS sourceTypesJson
    FROM rag_document_vectors
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(rag_document_vectors.source_types_json) WHERE value = 'note'
    )`;
  const rows = allowedDocumentKeys
    ? db.prepare(`${selectSql}
        AND document_key IN (SELECT value FROM json_each(?))
        ORDER BY document_key, dimension
      `).all(JSON.stringify(Array.from(allowedDocumentKeys).sort()))
    : db.prepare(`${selectSql}
        ORDER BY document_key, dimension
      `).all();

  const documents = rows
    .map((row) => {
      const documentKey = cleanString(row.documentKey);
      const dimension = Number(row.dimension);

      if (!documentKey || (allowedDocumentKeys && !allowedDocumentKeys.has(documentKey))) {
        return null;
      }

      const vector = decodeEmbeddingValue(row.embedding, dimension);
      if (!vector) {
        return null;
      }

      return {
        documentKey,
        dimension,
        vector,
        norm: vectorNorm(vector),
        sourceTypes: parseSourceTypesJson(row.sourceTypesJson),
      };
    })
    .filter(Boolean);

  // 候选向量数超过上限时按 document_key 升序截断（SQL 已排序），再进入
  // 成对循环；因此成对比较的规模始终受 candidateLimit 约束，不会退化为
  // 无界 O(n^2)。
  const candidates = documents.length > candidateLimit
    ? documents.slice(0, candidateLimit)
    : documents;

  const collector = createTopEdgeCollector(limit);

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    const leftDimension = left.dimension;
    const leftNorm = left.norm;
    const leftVector = left.vector;
    // 零向量与任何向量的相似度恒为 0：阈值 > 0 时整行都不可能入选，直接跳过。
    const leftIsZero = leftNorm === 0;
    if (leftIsZero && minSimilarity > 0) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];

      if (leftDimension !== right.dimension) {
        continue;
      }

      let similarity = 0;
      if (!leftIsZero && right.norm !== 0) {
        // 内联点积：candidate 向量统一为 Float32Array（decodeEmbeddingValue），
        // 直接下标相乘避免逐元素函数调用与属性查找。累加顺序与旧 vectorDot 一致，
        // 因此相似度数值逐位相同（小规模对照见 tests/graphSimilarityScale.test.mjs）。
        const rightVector = right.vector;
        let dot = 0;
        for (let axis = 0; axis < leftDimension; axis += 1) {
          dot += leftVector[axis] * rightVector[axis];
        }
        similarity = dot / (leftNorm * right.norm);
      }

      if (similarity < minSimilarity) {
        continue;
      }

      collector.push({
        sourceDocumentKey: left.documentKey,
        targetDocumentKey: right.documentKey,
        similarity,
        sourceTypes: Array.from(new Set([...left.sourceTypes, ...right.sourceTypes])).sort(),
      });
    }
  }

  return collector.values();
}

function retrieveNoteVectors(db, request) {
  return require('../noteVectors.cjs').retrieveNoteVectors(db, request);
}

module.exports = {
  DEFAULT_MAX_SIMILARITY_CANDIDATES,
  MAX_SIMILARITY_CANDIDATES,
  MAX_SIMILARITY_EDGE_LIMIT,
  getChunkContext,
  listDocumentSimilarities,
  retrieveDocumentChunks,
  retrieveNoteVectors,
  retrieveVectorChunks,
  searchFts,
};
