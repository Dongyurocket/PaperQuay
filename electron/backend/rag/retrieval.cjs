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
const DEFAULT_MUTUAL_NEIGHBORS = 10;
const MAX_MUTUAL_NEIGHBORS = 20;
const MAX_MUTUAL_EDGE_LIMIT = 20000;
const DEFAULT_GEOMETRY_COMPONENTS = 2;
const MAX_GEOMETRY_COMPONENTS = 3;
const MAX_GEOMETRY_DOCUMENTS = 1200;
const DOCUMENT_GEOMETRY_VERSION = 'abtt-d2-mutual-knn-v1';
const documentGeometryCache = new Map();
const MAX_DOCUMENT_GEOMETRY_CACHE = 6;

function vectorNorm(vector) {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = Number(vector[index]) || 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function normalizeVector(vector) {
  const norm = vectorNorm(vector);
  if (norm <= 0) return null;
  const normalized = new Float64Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / norm;
  }
  return normalized;
}

function dotProduct(left, right) {
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

/**
 * 读取同一 embedding 模型、同一维度的文档向量。
 *
 * 旧缓存可能同时存在多个模型；选“文档数最多”的一组，避免把不同模型的
 * 平均向量混在一起做几何。没有模型键的旧数据按 unknown 处理。
 */
function readDocumentVectors(db, request = {}) {
  const allowedDocumentKeys = Array.isArray(request.documentKeys)
    ? new Set(request.documentKeys.map((key) => cleanString(key)).filter(Boolean))
    : null;
  const requestedModelKey = cleanString(request.embeddingModelKey);
  const where = [
    `NOT EXISTS (
      SELECT 1 FROM json_each(rag_document_vectors.source_types_json) WHERE value = 'note'
    )`,
  ];
  const params = [];

  if (allowedDocumentKeys) {
    where.push('document_key IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(Array.from(allowedDocumentKeys).sort()));
  }
  if (requestedModelKey) {
    where.push('embedding_model_key = ?');
    params.push(requestedModelKey);
  }

  const rows = db.prepare(`
    SELECT
      document_key AS documentKey,
      dimension,
      embedding_model_key AS embeddingModelKey,
      embedding,
      source_types_json AS sourceTypesJson,
      updated_at AS updatedAt
    FROM rag_document_vectors
    WHERE ${where.join(' AND ')}
    ORDER BY document_key, dimension
  `).all(...params);

  const groups = new Map();
  for (const row of rows) {
    const documentKey = cleanString(row.documentKey);
    const dimension = Number(row.dimension);
    const modelKey = cleanString(row.embeddingModelKey) || 'unknown';

    if (!documentKey || !Number.isFinite(dimension) || dimension <= 0) continue;
    if (allowedDocumentKeys && !allowedDocumentKeys.has(documentKey)) continue;

    const vector = decodeEmbeddingValue(row.embedding, dimension);
    if (!vector) continue;

    const groupKey = `${modelKey}\u0000${dimension}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { modelKey, dimension, documents: [], maxUpdatedAt: 0 };
      groups.set(groupKey, group);
    }
    group.documents.push({
      documentKey,
      vector,
      sourceTypes: parseSourceTypesJson(row.sourceTypesJson),
    });
    group.maxUpdatedAt = Math.max(group.maxUpdatedAt, Number(row.updatedAt) || 0);
  }

  let selected = null;
  for (const group of groups.values()) {
    if (!selected
      || group.documents.length > selected.documents.length
      || (group.documents.length === selected.documents.length && group.maxUpdatedAt > selected.maxUpdatedAt)
      || (group.documents.length === selected.documents.length
        && group.maxUpdatedAt === selected.maxUpdatedAt
        && `${group.modelKey}\u0000${group.dimension}` < `${selected.modelKey}\u0000${selected.dimension}`)) {
      selected = group;
    }
  }

  if (!selected) {
    return { documents: [], modelKey: requestedModelKey || null, dimension: 0, maxUpdatedAt: 0 };
  }

  selected.documents.sort((left, right) => left.documentKey.localeCompare(right.documentKey));
  return selected;
}

/**
 * 用 Gram 矩阵上的幂迭代求前 D 个主成分。
 * n≈200 << d=4096 时，构造 n×n 矩阵比 d×d 协方差便宜得多。
 */
function topPrincipalComponents(gram, count) {
  const size = Math.sqrt(gram.length) | 0;
  const matrix = Float64Array.from(gram);
  const components = [];

  for (let componentIndex = 0; componentIndex < count; componentIndex += 1) {
    let vector = new Float64Array(size);
    for (let index = 0; index < size; index += 1) {
      vector[index] = Math.sin((index + 1) * (componentIndex + 1) * 1.6180339887498949);
    }
    if (size > componentIndex) vector[componentIndex] += 1;

    const orthogonalize = (candidate) => {
      for (const previous of components) {
        const projection = dotProduct(candidate, previous);
        for (let index = 0; index < size; index += 1) {
          candidate[index] -= projection * previous[index];
        }
      }
    };

    orthogonalize(vector);
    let norm = vectorNorm(vector);
    if (norm <= 1e-12) break;
    for (let index = 0; index < size; index += 1) vector[index] /= norm;

    for (let iteration = 0; iteration < 96; iteration += 1) {
      const next = new Float64Array(size);
      for (let row = 0; row < size; row += 1) {
        let sum = 0;
        const offset = row * size;
        for (let column = 0; column < size; column += 1) {
          sum += matrix[offset + column] * vector[column];
        }
        next[row] = sum;
      }

      orthogonalize(next);
      norm = vectorNorm(next);
      if (norm <= 1e-12) {
        vector = null;
        break;
      }
      for (let index = 0; index < size; index += 1) next[index] /= norm;
      vector = next;
    }

    if (!vector) break;

    let eigenvalue = 0;
    for (let row = 0; row < size; row += 1) {
      eigenvalue += vector[row] * dotProduct(matrix.subarray(row * size, (row + 1) * size), vector);
    }
    if (!(eigenvalue > 1e-9)) break;

    components.push(vector);
    // 对称矩阵的降幂：A <- A - λ v vᵀ
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        matrix[row * size + column] -= eigenvalue * vector[row] * vector[column];
      }
    }
  }

  return components;
}

/**
 * 文档几何：单位化 → 去均值 → 去前 D 个主成分 → 再单位化。
 * 这是 all-but-the-top 的轻量实现，专门解决平均池化向量的公共方向。
 */
function buildDocumentGeometry(db, request = {}) {
  const source = readDocumentVectors(db, request);
  if (source.documents.length === 0) {
    return {
      ...source,
      geometryVersion: DOCUMENT_GEOMETRY_VERSION,
      documents: [],
    };
  }

  // 几何是 O(n²·d)；这里只约束互近邻路径，global-top 仍按旧候选上限处理。
  if (source.documents.length > MAX_GEOMETRY_DOCUMENTS) {
    source.documents = source.documents.slice(0, MAX_GEOMETRY_DOCUMENTS);
  }

  const components = Math.min(
    MAX_GEOMETRY_COMPONENTS,
    Math.max(0, normalizeNonNegativeInteger(request.components, DEFAULT_GEOMETRY_COMPONENTS)),
  );
  const cacheKey = [
    source.modelKey,
    source.dimension,
    source.documents.length,
    source.maxUpdatedAt,
    components,
  ].join('\u0000');

  const cached = documentGeometryCache.get(cacheKey);
  if (cached) return cached;

  const normalized = source.documents.map((document) => normalizeVector(document.vector));
  const mean = new Float64Array(source.dimension);
  let meanCount = 0;
  for (const vector of normalized) {
    if (!vector) continue;
    for (let index = 0; index < source.dimension; index += 1) mean[index] += vector[index];
    meanCount += 1;
  }
  if (meanCount > 0) {
    for (let index = 0; index < source.dimension; index += 1) mean[index] /= meanCount;
  }

  const centered = normalized.map((vector) => {
    if (!vector) return null;
    const next = new Float64Array(source.dimension);
    for (let index = 0; index < source.dimension; index += 1) {
      next[index] = vector[index] - mean[index];
    }
    return next;
  });

  let principalComponents = [];
  if (components > 0) {
    const size = centered.length;
    const gram = new Float64Array(size * size);
    for (let row = 0; row < size; row += 1) {
      if (!centered[row]) continue;
      for (let column = row; column < size; column += 1) {
        if (!centered[column]) continue;
        const value = dotProduct(centered[row], centered[column]);
        gram[row * size + column] = value;
        gram[column * size + row] = value;
      }
    }
    // Gram 的特征向量是「文档权重」；真正的特征空间方向是中心化文档的线性组合。
    principalComponents = topPrincipalComponents(gram, components)
      .map((weights) => {
        const direction = new Float64Array(source.dimension);
        for (let row = 0; row < weights.length; row += 1) {
          const weight = weights[row];
          if (!weight || !centered[row]) continue;
          for (let axis = 0; axis < source.dimension; axis += 1) {
            direction[axis] += weight * centered[row][axis];
          }
        }
        return normalizeVector(direction);
      })
      .filter(Boolean);
  }

  const documents = source.documents.map((document, index) => {
    let vector = centered[index];
    if (!vector) {
      return { ...document, vector: new Float64Array(source.dimension) };
    }

    const projected = new Float64Array(vector);
    for (const component of principalComponents) {
      const projection = dotProduct(projected, component);
      for (let axis = 0; axis < source.dimension; axis += 1) {
        projected[axis] -= projection * component[axis];
      }
    }

    vector = normalizeVector(projected) ?? projected;
    return { ...document, vector };
  });

  const result = {
    ...source,
    documents,
    geometryVersion: DOCUMENT_GEOMETRY_VERSION,
  };
  documentGeometryCache.set(cacheKey, result);
  if (documentGeometryCache.size > MAX_DOCUMENT_GEOMETRY_CACHE) {
    documentGeometryCache.delete(documentGeometryCache.keys().next().value);
  }
  return result;
}

function unionFind(size) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (value) => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  return { find, union };
}

/**
 * 互近邻语义边：每篇最多 k 个双向邻居；断开的连通分量用跨分量最高相似度桥接。
 * 边权重用排名（1 表示最近邻），原始中心化余弦只作为证据。
 */
function listMutualKnnEdges(geometry, request = {}) {
  const documents = geometry.documents;
  const size = documents.length;
  if (size < 2) return [];

  const k = Math.min(
    MAX_MUTUAL_NEIGHBORS,
    Math.max(1, normalizeNonNegativeInteger(request.k, DEFAULT_MUTUAL_NEIGHBORS)),
  );
  const neighbors = Array.from({ length: size }, (_, index) => {
    const scored = [];
    for (let other = 0; other < size; other += 1) {
      if (other === index) continue;
      scored.push({
        index: other,
        similarity: dotProduct(documents[index].vector, documents[other].vector),
      });
    }
    scored.sort((left, right) => right.similarity - left.similarity || left.index - right.index);
    return scored.slice(0, k);
  });

  const neighborSets = neighbors.map((entries) => new Set(entries.map((entry) => entry.index)));
  const edges = new Map();
  const union = unionFind(size);

  const addEdge = (leftIndex, rightIndex, similarity, rankWeight) => {
    const left = Math.min(leftIndex, rightIndex);
    const right = Math.max(leftIndex, rightIndex);
    const key = `${left}:${right}`;
    const existing = edges.get(key);
    if (existing) {
      existing.rankWeight = Math.max(existing.rankWeight, rankWeight);
      existing.similarity = Math.max(existing.similarity, similarity);
      return existing;
    }
    const edge = {
      sourceDocumentKey: documents[left].documentKey,
      targetDocumentKey: documents[right].documentKey,
      similarity,
      rankWeight,
      sourceTypes: Array.from(new Set([
        ...documents[left].sourceTypes,
        ...documents[right].sourceTypes,
      ])).sort(),
    };
    edges.set(key, edge);
    union.union(left, right);
    return edge;
  };

  for (let index = 0; index < size; index += 1) {
    for (let rank = 0; rank < neighbors[index].length; rank += 1) {
      const neighbor = neighbors[index][rank];
      if (!neighborSets[neighbor.index].has(index)) continue;
      addEdge(index, neighbor.index, neighbor.similarity, 1 - rank / k);
    }
  }

  // 互近邻可能产生多个分量；把每个分量接到文档 0 所在分量上，避免 O(c·n²) 的反复全扫。
  // embeddingBridge=false 时保留分量（用于观察真实主题隔离），但默认开启。
  if (request.bridge !== false) {
    let anchorRoot = union.find(0);
    for (let index = 0; index < size; index += 1) {
      if (union.find(index) === anchorRoot) continue;

      let best = null;
      for (let other = 0; other < size; other += 1) {
        if (union.find(other) !== anchorRoot) continue;
        const similarity = dotProduct(documents[index].vector, documents[other].vector);
        if (!best || similarity > best.similarity) {
          best = { index: other, similarity };
        }
      }

      if (best) {
        addEdge(index, best.index, best.similarity, 0);
        anchorRoot = union.find(anchorRoot);
      }
    }
  }

  const values = Array.from(edges.values())
    .sort((left, right) => right.similarity - left.similarity
      || left.sourceDocumentKey.localeCompare(right.sourceDocumentKey)
      || left.targetDocumentKey.localeCompare(right.targetDocumentKey));
  const explicitLimit = Number.isFinite(Number(request.limit))
    ? Math.max(0, Math.min(MAX_MUTUAL_EDGE_LIMIT, Math.trunc(Number(request.limit))))
    : MAX_MUTUAL_EDGE_LIMIT;
  return values.slice(0, explicitLimit);
}

function listGlobalTopEdges(geometry, request = {}) {
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

  if (limit === 0) return [];

  const candidates = (geometry.documents.length > candidateLimit
    ? geometry.documents.slice(0, candidateLimit)
    : geometry.documents)
    .map((document) => ({ ...document, norm: vectorNorm(document.vector) }));
  const collector = createTopEdgeCollector(limit);

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    const leftNorm = left.norm;
    if (leftNorm === 0 && minSimilarity > 0) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      const rightNorm = right.norm;
      let similarity = 0;
      if (leftNorm !== 0 && rightNorm !== 0) {
        similarity = dotProduct(left.vector, right.vector) / (leftNorm * rightNorm);
      }
      if (similarity < minSimilarity) continue;

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
  const strategy = request.strategy === 'global-top' ? 'global-top' : 'mutual-knn';

  // global-top 保留原始空间与旧的预算语义，便于回退和旧测试对照。
  if (strategy === 'global-top') {
    const source = readDocumentVectors(db, request);
    return source.documents.length < 2 ? [] : listGlobalTopEdges(source, request);
  }

  const geometry = buildDocumentGeometry(db, request);
  if (geometry.documents.length < 2) {
    return [];
  }

  return listMutualKnnEdges(geometry, request);
}

function retrieveNoteVectors(db, request) {
  return require('../noteVectors.cjs').retrieveNoteVectors(db, request);
}

module.exports = {
  DEFAULT_MAX_SIMILARITY_CANDIDATES,
  DEFAULT_MUTUAL_NEIGHBORS,
  DOCUMENT_GEOMETRY_VERSION,
  MAX_SIMILARITY_CANDIDATES,
  MAX_SIMILARITY_EDGE_LIMIT,
  buildDocumentGeometry,
  getChunkContext,
  listDocumentSimilarities,
  retrieveDocumentChunks,
  retrieveNoteVectors,
  retrieveVectorChunks,
  searchFts,
};
