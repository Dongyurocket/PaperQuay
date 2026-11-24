const { withTransaction } = require('../nodeSqlite.cjs');
const { cleanString, toError } = require('../utils.cjs');
const {
  VECTOR_BACKFILL_CURSOR_KEY,
  VECTOR_BACKFILL_META_KEY,
  VECTOR_BACKFILL_SYNC_LIMIT,
  ensureVectorTable,
  knownVectorDimensions,
  normalizeVectorDimension,
  readStoreMeta,
  vectorTableName,
  writeStoreMeta,
} = require('./schema.cjs');

const RAG_SOURCE_TYPES = new Set(['mineru-markdown', 'pdf-text', 'note']);
const MAX_AGENT_LOG_STRING_LENGTH = 4096;

function normalizeDocumentKey(value) {
  const documentKey = cleanString(value);
  if (!documentKey) throw new Error('RAG documentKey is required');
  return documentKey;
}

function normalizeSourceType(value) {
  const sourceType = cleanString(value);
  if (!RAG_SOURCE_TYPES.has(sourceType)) {
    throw new Error(`Unsupported RAG sourceType: ${sourceType || '(empty)'}`);
  }
  return sourceType;
}

function normalizeRequiredString(value, label) {
  const text = cleanString(value);
  if (!text) throw new Error(`RAG ${label} is required`);
  return text;
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.trunc(number));
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizeBoundedString(value, label, { required = false, maxLength = MAX_AGENT_LOG_STRING_LENGTH } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';

  if (required && !text) {
    throw new Error(`${label} is required`);
  }

  return text.slice(0, maxLength);
}

function validateEmbedding(embedding, expectedDimension = null) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('RAG chunk embedding must be a non-empty number array');
  }

  const dimension = normalizeVectorDimension(embedding.length);
  if (expectedDimension !== null && dimension !== expectedDimension) {
    throw new Error(`RAG chunk embedding dimension mismatch: expected ${expectedDimension}, got ${dimension}`);
  }

  for (const value of embedding) {
    if (!Number.isFinite(Number(value))) {
      throw new Error('RAG chunk embedding contains a non-finite value');
    }
  }

  return dimension;
}

function toFloat32Array(vector) {
  const output = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    output[index] = Number(vector[index]);
  }
  return output;
}

// sqlite-vec 的 embedding 列在 node:sqlite 下返回 float32 原始字节（Uint8Array/Buffer），
// 必须按字节视图解码；Array.from 会得到字节值数组，长度不等于维度，直接导致相似边静默为空。
function decodeEmbeddingValue(value, dimension) {
  if (!Number.isSafeInteger(dimension) || dimension <= 0) {
    return null;
  }

  if (value instanceof Float32Array) {
    return value.length === dimension ? value : null;
  }

  if (value instanceof Uint8Array) {
    if (value.byteLength !== dimension * 4 || value.byteOffset % 4 !== 0) {
      return null;
    }

    return new Float32Array(value.buffer, value.byteOffset, dimension);
  }

  if (Array.isArray(value)) {
    return value.length === dimension ? toFloat32Array(value) : null;
  }

  return null;
}

function parseStoredSectionPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((part) => typeof part === 'string' && part.trim()).map((part) => part.trim());
  } catch {
    return null;
  }
}

function normalizeOptionalOffset(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return null;
  }

  return offset;
}

function normalizeChunk(chunk, dimension, defaults = {}) {
  const chunkId = cleanString(chunk?.chunkId) || `chunk-${normalizeNonNegativeInteger(chunk?.chunkIndex)}`;
  const chunkIndex = normalizeNonNegativeInteger(chunk?.chunkIndex);
  const pageIndex = chunk?.pageIndex === null || chunk?.pageIndex === undefined
    ? null
    : normalizeNonNegativeInteger(chunk.pageIndex);
  const blockId = cleanString(chunk?.blockId) || null;
  const text = typeof chunk?.text === 'string' ? chunk.text : String(chunk?.text ?? '');
  const sectionPath = Array.isArray(chunk?.sectionPath)
    ? chunk.sectionPath.filter((part) => typeof part === 'string' && part.trim()).map((part) => part.trim())
    : parseStoredSectionPath(chunk?.sectionPath);

  validateEmbedding(chunk?.embedding, dimension);

  return {
    chunkId,
    chunkIndex,
    pageIndex,
    blockId,
    text,
    embedding: chunk.embedding,
    generationId: cleanString(chunk?.generationId) || cleanString(defaults.generationId) || '',
    sectionId: cleanString(chunk?.sectionId) || null,
    sectionPath: sectionPath && sectionPath.length > 0 ? JSON.stringify(sectionPath) : null,
    startOffset: normalizeOptionalOffset(chunk?.startOffset),
    endOffset: normalizeOptionalOffset(chunk?.endOffset),
    textVersion: cleanString(chunk?.textVersion) || null,
  };
}

function rowToStatus(row) {
  if (!row) return null;

  return {
    documentKey: row.document_key,
    sourceType: row.source_type,
    sourceSignature: row.source_signature,
    embeddingModelKey: row.embedding_model_key,
    embeddingDimension: Number(row.embedding_dimension) || 0,
    totalChunkCount: Number(row.total_chunk_count) || 0,
    chunkCount: Number(row.chunk_count) || 0,
    indexedChunkCount: Number(row.indexed_chunk_count) || 0,
    indexedAt: Number(row.indexed_at) || 0,
    status: row.status,
    lastError: row.last_error ?? null,
    failedAt: row.failed_at ?? null,
    retryAfterMs: row.retry_after_ms ?? null,
    cooldownUntil: row.cooldown_until ?? null,
  };
}

// 重算单个文档在所有维度下的平均向量缓存；没有可用向量时删除缓存行。
// 语义与原 listDocumentSimilarities 的按 documentKey 聚合一致：跨 source_type 合并、仅统计 ready 且维度匹配的索引。
function rebuildDocumentVectors(db, documentKey) {
  const normalizedDocumentKey = cleanString(documentKey);
  if (!normalizedDocumentKey) {
    return;
  }

  for (const dimension of knownVectorDimensions(db)) {
    const table = vectorTableName(dimension);
    const rows = db.prepare(`
      SELECT
        c.source_type AS sourceType,
        v.embedding AS embedding
      FROM ${table} v
      JOIN rag_chunks c ON c.id = v.rowid
      JOIN rag_indexes i
        ON i.document_key = c.document_key
       AND i.source_type = c.source_type
       AND i.status = 'ready'
       AND i.embedding_dimension = ?
      WHERE c.document_key = ?
      ORDER BY c.source_type, c.chunk_index
    `).all(dimension, normalizedDocumentKey);

    const sum = new Float64Array(dimension);
    const sourceTypes = new Set();
    let count = 0;

    for (const row of rows) {
      const vector = decodeEmbeddingValue(row.embedding, dimension);
      if (!vector) {
        continue;
      }

      for (let index = 0; index < dimension; index += 1) {
        sum[index] += vector[index];
      }
      count += 1;

      const sourceType = cleanString(row.sourceType);
      if (sourceType) {
        sourceTypes.add(sourceType);
      }
    }

    if (count === 0) {
      db.prepare('DELETE FROM rag_document_vectors WHERE document_key = ? AND dimension = ?')
        .run(normalizedDocumentKey, dimension);
      continue;
    }

    const average = new Float32Array(dimension);
    for (let index = 0; index < dimension; index += 1) {
      average[index] = sum[index] / count;
    }

    db.prepare(`
      INSERT INTO rag_document_vectors (
        document_key,
        dimension,
        embedding,
        chunk_count,
        source_types_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (document_key, dimension) DO UPDATE SET
        embedding = excluded.embedding,
        chunk_count = excluded.chunk_count,
        source_types_json = excluded.source_types_json,
        updated_at = excluded.updated_at
    `).run(
      normalizedDocumentKey,
      dimension,
      Buffer.from(average.buffer, average.byteOffset, average.byteLength),
      count,
      JSON.stringify(Array.from(sourceTypes).sort()),
      Date.now(),
    );
  }
}

// 全量重建所有文档的平均向量缓存：顺序扫描 vec 表（partition key 含 document_key/source_type），
// 避免按文档 JOIN vec0 虚拟表的随机 rowid 查找。
function rebuildAllDocumentVectors(db) {
  db.prepare('DELETE FROM rag_document_vectors').run();

  const upsert = db.prepare(`
    INSERT INTO rag_document_vectors (
      document_key,
      dimension,
      embedding,
      chunk_count,
      source_types_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const dimension of knownVectorDimensions(db)) {
    const readyKeys = new Set(
      db.prepare(`
        SELECT document_key || '::' || source_type AS key
        FROM rag_indexes
        WHERE status = 'ready' AND embedding_dimension = ?
      `).all(dimension).map((row) => row.key),
    );
    const table = vectorTableName(dimension);
    const rows = db.prepare(`
      SELECT document_key AS documentKey, source_type AS sourceType, embedding
      FROM ${table}
    `).all();
    const grouped = new Map();

    for (const row of rows) {
      const documentKey = cleanString(row.documentKey);
      const sourceType = cleanString(row.sourceType);

      if (!documentKey || !readyKeys.has(`${documentKey}::${sourceType}`)) {
        continue;
      }

      const vector = decodeEmbeddingValue(row.embedding, dimension);
      if (!vector) {
        continue;
      }

      let entry = grouped.get(documentKey);
      if (!entry) {
        entry = { sum: new Float64Array(dimension), count: 0, sourceTypes: new Set() };
        grouped.set(documentKey, entry);
      }

      for (let index = 0; index < dimension; index += 1) {
        entry.sum[index] += vector[index];
      }
      entry.count += 1;
      if (sourceType) {
        entry.sourceTypes.add(sourceType);
      }
    }

    for (const [documentKey, entry] of grouped) {
      const average = new Float32Array(dimension);
      for (let index = 0; index < dimension; index += 1) {
        average[index] = entry.sum[index] / entry.count;
      }

      upsert.run(
        documentKey,
        dimension,
        Buffer.from(average.buffer, average.byteOffset, average.byteLength),
        entry.count,
        JSON.stringify(Array.from(entry.sourceTypes).sort()),
        Date.now(),
      );
    }
  }
}

// 启动时只做有界的一批。其余由 createRagStore 在空闲时继续，避免一次扫完全库向量。
function backfillDocumentVectors(db) {
  return runBoundedVectorBackfill(db);
}

// 按 document_key 分批重建平均向量。不先清空缓存，中断后从游标继续。
function stepDocumentVectorBackfill(db, limit = 8) {
  if (readStoreMeta(db, VECTOR_BACKFILL_META_KEY)) {
    return { done: true, processed: 0 };
  }

  const batchSize = Math.max(1, Math.min(100, normalizeNonNegativeInteger(limit, 8) || 8));
  const cursor = readStoreMeta(db, VECTOR_BACKFILL_CURSOR_KEY);
  const keys = db.prepare(`
    SELECT DISTINCT document_key AS documentKey
    FROM rag_chunks
    WHERE document_key > ?
    ORDER BY document_key
    LIMIT ?
  `).all(cursor, batchSize);

  for (const row of keys) {
    rebuildDocumentVectors(db, row.documentKey);
  }

  if (keys.length < batchSize) {
    writeStoreMeta(db, VECTOR_BACKFILL_META_KEY, String(Date.now()));
    db.prepare('DELETE FROM rag_store_meta WHERE key = ?').run(VECTOR_BACKFILL_CURSOR_KEY);
    return { done: true, processed: keys.length };
  }

  writeStoreMeta(db, VECTOR_BACKFILL_CURSOR_KEY, keys[keys.length - 1].documentKey);
  return { done: false, processed: keys.length };
}

function runBoundedVectorBackfill(db, maxDocuments = VECTOR_BACKFILL_SYNC_LIMIT) {
  let processed = 0;

  while (processed < maxDocuments) {
    const step = stepDocumentVectorBackfill(db, 8);
    processed += step.processed;
    if (step.done) {
      return { done: true, processed };
    }
  }

  return { done: false, processed };
}

function getStatus(db, documentKey, sourceType) {
  return rowToStatus(
    db
      .prepare('SELECT * FROM rag_indexes WHERE document_key = ? AND source_type = ?')
      .get(documentKey, sourceType),
  );
}

function countChunks(db, documentKey, sourceType) {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM rag_chunks WHERE document_key = ? AND source_type = ?')
    .get(documentKey, sourceType);
  return Number(row?.count) || 0;
}

function upsertStatus(db, status) {
  db.prepare(`
    INSERT INTO rag_indexes (
      document_key,
      source_type,
      title,
      source_signature,
      embedding_model_key,
      embedding_dimension,
      total_chunk_count,
      chunk_count,
      indexed_chunk_count,
      indexed_at,
      status,
      last_error,
      failed_at,
      retry_after_ms,
      cooldown_until
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (document_key, source_type) DO UPDATE SET
      title = excluded.title,
      source_signature = excluded.source_signature,
      embedding_model_key = excluded.embedding_model_key,
      embedding_dimension = excluded.embedding_dimension,
      total_chunk_count = excluded.total_chunk_count,
      chunk_count = excluded.chunk_count,
      indexed_chunk_count = excluded.indexed_chunk_count,
      indexed_at = excluded.indexed_at,
      status = excluded.status,
      last_error = excluded.last_error,
      failed_at = excluded.failed_at,
      retry_after_ms = excluded.retry_after_ms,
      cooldown_until = excluded.cooldown_until
  `).run(
    status.documentKey,
    status.sourceType,
    status.title,
    status.sourceSignature,
    status.embeddingModelKey,
    status.embeddingDimension,
    status.totalChunkCount,
    status.chunkCount,
    status.indexedChunkCount,
    status.indexedAt,
    status.status,
    status.lastError,
    status.failedAt,
    status.retryAfterMs,
    status.cooldownUntil,
  );
}

function indexedSourceRows(db, documentKey, sourceType, dimension, modelKey, sourceSignature) {
  const sql = `
    SELECT source_type
    FROM rag_indexes
    WHERE document_key = ?
      AND status = 'ready'
      AND embedding_dimension = ?
      ${sourceType ? 'AND source_type = ?' : ''}
      ${modelKey ? 'AND embedding_model_key = ?' : ''}
      ${sourceSignature ? 'AND source_signature = ?' : ''}
    ORDER BY source_type
  `;
  const args = [documentKey, dimension, ...(sourceType ? [sourceType] : []),
    ...(modelKey ? [modelKey] : []), ...(sourceSignature ? [sourceSignature] : [])];
  return db.prepare(sql).all(...args);
}

function deleteVectorRowsByIds(db, ids) {
  if (ids.length === 0) return;

  for (const dimension of knownVectorDimensions(db)) {
    const table = vectorTableName(dimension);
    const statement = db.prepare(`DELETE FROM ${table} WHERE rowid = ?`);

    for (const id of ids) {
      statement.run(BigInt(id));
    }
  }
}

function chunkIdsForSource(db, documentKey, sourceType) {
  return db
    .prepare('SELECT id FROM rag_chunks WHERE document_key = ? AND source_type = ?')
    .all(documentKey, sourceType)
    .map((row) => Number(row.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

function deleteDocumentSourceData(db, documentKey, sourceType) {
  deleteVectorRowsByIds(db, chunkIdsForSource(db, documentKey, sourceType));
  db.prepare('DELETE FROM rag_chunks WHERE document_key = ? AND source_type = ?').run(documentKey, sourceType);
  db.prepare('DELETE FROM rag_indexes WHERE document_key = ? AND source_type = ?').run(documentKey, sourceType);
}

function indexDocument(db, request) {
  const documentKey = normalizeDocumentKey(request?.documentKey);
  const sourceType = normalizeSourceType(request?.sourceType);
  const title = cleanString(request?.title);
  const sourceSignature = normalizeRequiredString(request?.sourceSignature, 'sourceSignature');
  const embeddingModelKey = normalizeRequiredString(request?.embeddingModelKey, 'embeddingModelKey');
  const chunks = Array.isArray(request?.chunks) ? request.chunks : [];
  const totalChunkCount = normalizeNonNegativeInteger(request?.totalChunkCount, chunks.length);
  const dimension = chunks.length > 0 ? validateEmbedding(chunks[0]?.embedding) : 0;

  if (dimension > 0) {
    for (const chunk of chunks) {
      validateEmbedding(chunk?.embedding, dimension);
    }
  }

  return withTransaction(db, () => {
    const existing = getStatus(db, documentKey, sourceType);
    const shouldReset =
      !existing ||
      existing.status === 'failed' ||
      existing.sourceSignature !== sourceSignature ||
      existing.embeddingModelKey !== embeddingModelKey ||
      existing.embeddingDimension !== dimension;

    if (shouldReset) {
      deleteDocumentSourceData(db, documentKey, sourceType);
    }

    if (dimension === 0) {
      upsertStatus(db, {
        documentKey,
        sourceType,
        title,
        sourceSignature,
        embeddingModelKey,
        embeddingDimension: 0,
        totalChunkCount,
        chunkCount: 0,
        indexedChunkCount: 0,
        indexedAt: Date.now(),
        status: totalChunkCount === 0 ? 'ready' : 'pending',
        lastError: null,
        failedAt: null,
        retryAfterMs: null,
        cooldownUntil: null,
      });
      rebuildDocumentVectors(db, documentKey);
      return;
    }

    const vectorTable = ensureVectorTable(db, dimension);
    const selectChunk = db.prepare(
      'SELECT id FROM rag_chunks WHERE document_key = ? AND source_type = ? AND chunk_id = ?',
    );
    const insertChunk = db.prepare(`
      INSERT INTO rag_chunks (
        document_key,
        source_type,
        chunk_id,
        chunk_index,
        page_index,
        block_id,
        text,
        generation_id,
        section_id,
        section_path,
        start_offset,
        end_offset,
        text_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateChunk = db.prepare(`
      UPDATE rag_chunks
      SET chunk_index = ?, page_index = ?, block_id = ?, text = ?,
          generation_id = ?, section_id = ?, section_path = ?,
          start_offset = ?, end_offset = ?, text_version = ?
      WHERE id = ?
    `);
    const lastInsertedId = db.prepare('SELECT last_insert_rowid() AS id');
    const insertVector = db.prepare(`
      INSERT INTO ${vectorTable} (rowid, document_key, source_type, embedding)
      VALUES (?, ?, ?, ?)
    `);

    for (const rawChunk of chunks) {
      const chunk = normalizeChunk(rawChunk, dimension, {
        generationId: request?.generationId,
      });
      const existingChunk = selectChunk.get(documentKey, sourceType, chunk.chunkId);
      let chunkRowId;

      if (existingChunk) {
        chunkRowId = Number(existingChunk.id);
        deleteVectorRowsByIds(db, [chunkRowId]);
        updateChunk.run(
          chunk.chunkIndex,
          chunk.pageIndex,
          chunk.blockId,
          chunk.text,
          chunk.generationId,
          chunk.sectionId,
          chunk.sectionPath,
          chunk.startOffset,
          chunk.endOffset,
          chunk.textVersion,
          chunkRowId,
        );
      } else {
        insertChunk.run(
          documentKey,
          sourceType,
          chunk.chunkId,
          chunk.chunkIndex,
          chunk.pageIndex,
          chunk.blockId,
          chunk.text,
          chunk.generationId,
          chunk.sectionId,
          chunk.sectionPath,
          chunk.startOffset,
          chunk.endOffset,
          chunk.textVersion,
        );
        chunkRowId = Number(lastInsertedId.get().id);
      }

      insertVector.run(
        BigInt(chunkRowId),
        documentKey,
        sourceType,
        toFloat32Array(chunk.embedding),
      );
    }

    const indexedChunkCount = countChunks(db, documentKey, sourceType);
    const nextStatus = indexedChunkCount >= totalChunkCount ? 'ready' : 'pending';
    upsertStatus(db, {
      documentKey,
      sourceType,
      title,
      sourceSignature,
      embeddingModelKey,
      embeddingDimension: dimension,
      totalChunkCount,
      chunkCount: indexedChunkCount,
      indexedChunkCount,
      indexedAt: Date.now(),
      status: nextStatus,
      lastError: null,
      failedAt: null,
      retryAfterMs: null,
      cooldownUntil: null,
    });

    if (nextStatus === 'ready' && sourceType === 'mineru-markdown') {
      db.prepare(`
        DELETE FROM rag_indexes
        WHERE document_key = ?
          AND source_type != ?
          AND status = 'failed'
          AND chunk_count = 0
      `).run(documentKey, sourceType);
    }

    rebuildDocumentVectors(db, documentKey);
  });
}

function reportFailure(db, request) {
  const documentKey = normalizeDocumentKey(request?.documentKey);
  const sourceType = normalizeSourceType(request?.sourceType);
  const title = cleanString(request?.title);
  const sourceSignature = normalizeRequiredString(request?.sourceSignature, 'sourceSignature');
  const embeddingModelKey = normalizeRequiredString(request?.embeddingModelKey, 'embeddingModelKey');
  const retryAfterMs = normalizeNullableInteger(request?.retryAfterMs);
  const failedAt = Date.now();

  return withTransaction(db, () => {
    deleteDocumentSourceData(db, documentKey, sourceType);
    rebuildDocumentVectors(db, documentKey);
    upsertStatus(db, {
      documentKey,
      sourceType,
      title,
      sourceSignature,
      embeddingModelKey,
      embeddingDimension: 0,
      totalChunkCount: normalizeNonNegativeInteger(request?.totalChunkCount),
      chunkCount: 0,
      indexedChunkCount: 0,
      indexedAt: 0,
      status: 'failed',
      lastError: cleanString(request?.errorMessage) || 'RAG index failed',
      failedAt,
      retryAfterMs,
      cooldownUntil: retryAfterMs ? failedAt + retryAfterMs : null,
    });
  });
}

function getDocumentIndexStatus(db, request) {
  const documentKey = normalizeDocumentKey(request?.documentKey);
  const sourceType = normalizeSourceType(request?.sourceType);
  return getStatus(db, documentKey, sourceType);
}

// 续跑索引时用于按 chunkId 差集计算真实缺口：位置计数（indexed_chunk_count）
// 在历史上的中断/缺陷状态下可能与实际入库的 chunk 行错位，只按位置切片
// 会反复重发已存在的 chunk，缺失的低位 chunk 永远补不上，状态停在 pending。
function listIndexedChunkIds(db, request) {
  const documentKey = normalizeDocumentKey(request?.documentKey);
  const sourceType = normalizeSourceType(request?.sourceType);
  return db
    .prepare('SELECT chunk_id FROM rag_chunks WHERE document_key = ? AND source_type = ?')
    .all(documentKey, sourceType)
    .map((row) => row.chunk_id)
    .filter((chunkId) => typeof chunkId === 'string' && chunkId.length > 0);
}

// 索引循环结束后按期望 chunkId 集收敛状态：清理同一 signature/模型下遗留的
// 陈旧 chunk 行，重算计数，并把状态写为 ready/pending，使断续/缺陷状态自愈。
function finalizeDocumentIndex(db, request) {
  const documentKey = normalizeDocumentKey(request?.documentKey);
  const sourceType = normalizeSourceType(request?.sourceType);
  const title = cleanString(request?.title);
  const sourceSignature = normalizeRequiredString(request?.sourceSignature, 'sourceSignature');
  const embeddingModelKey = normalizeRequiredString(request?.embeddingModelKey, 'embeddingModelKey');
  const totalChunkCount = normalizeNonNegativeInteger(request?.totalChunkCount);
  const expectedChunkIds = Array.isArray(request?.expectedChunkIds)
    ? new Set(request.expectedChunkIds.map((id) => cleanString(id)).filter(Boolean))
    : null;

  return withTransaction(db, () => {
    const existing = getStatus(db, documentKey, sourceType);

    // signature 或模型不匹配说明内容已变化，后续索引流程会走重建路径，
    // finalize 不干预，避免误删新内容。
    if (
      existing &&
      (existing.sourceSignature !== sourceSignature ||
        existing.embeddingModelKey !== embeddingModelKey)
    ) {
      return existing;
    }

    if (expectedChunkIds) {
      const staleRowIds = db
        .prepare('SELECT id, chunk_id FROM rag_chunks WHERE document_key = ? AND source_type = ?')
        .all(documentKey, sourceType)
        .filter((row) => !expectedChunkIds.has(row.chunk_id))
        .map((row) => Number(row.id))
        .filter((id) => Number.isSafeInteger(id) && id > 0);

      if (staleRowIds.length > 0) {
        deleteVectorRowsByIds(db, staleRowIds);
        const deleteChunk = db.prepare('DELETE FROM rag_chunks WHERE id = ?');

        for (const rowId of staleRowIds) {
          deleteChunk.run(BigInt(rowId));
        }
      }
    }

    const indexedChunkCount = countChunks(db, documentKey, sourceType);
    const nextStatus = indexedChunkCount >= totalChunkCount ? 'ready' : 'pending';
    upsertStatus(db, {
      documentKey,
      sourceType,
      title: title || existing?.title || '',
      sourceSignature,
      embeddingModelKey,
      embeddingDimension: existing?.embeddingDimension ?? 0,
      totalChunkCount,
      chunkCount: indexedChunkCount,
      indexedChunkCount,
      indexedAt: Date.now(),
      status: nextStatus,
      lastError: null,
      failedAt: null,
      retryAfterMs: null,
      cooldownUntil: null,
    });

    if (nextStatus === 'ready' && sourceType === 'mineru-markdown') {
      db.prepare(`
        DELETE FROM rag_indexes
        WHERE document_key = ?
          AND source_type != ?
          AND status = 'failed'
          AND chunk_count = 0
      `).run(documentKey, sourceType);
    }

    rebuildDocumentVectors(db, documentKey);
    return getStatus(db, documentKey, sourceType);
  });
}

function migrateFromLibraryRagIndexes(db, ragIndexes) {
  const entries = Object.entries(ragIndexes && typeof ragIndexes === 'object' ? ragIndexes : {});
  const summary = {
    migratedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
  };

  for (const [key, value] of entries) {
    try {
      const status = value?.status ?? {};
      const keyParts = key.split('::');
      const fallbackSourceType = keyParts.pop();
      const fallbackDocumentKey = keyParts.join('::');
      const documentKey = status.documentKey || fallbackDocumentKey;
      const sourceType = status.sourceType || fallbackSourceType;

      if (status.status === 'failed') {
        reportFailure(db, {
          documentKey,
          title: value?.title || '',
          sourceType,
          sourceSignature: status.sourceSignature,
          embeddingModelKey: status.embeddingModelKey,
          totalChunkCount: status.totalChunkCount,
          errorMessage: status.lastError || 'Legacy RAG index failed',
          retryAfterMs: status.retryAfterMs,
        });
        summary.migratedCount += 1;
        continue;
      }

      const chunks = (Array.isArray(value?.chunks) ? value.chunks : []).filter((chunk) =>
        Array.isArray(chunk?.embedding) && chunk.embedding.length > 0,
      );

      indexDocument(db, {
        documentKey,
        title: value?.title || '',
        sourceType,
        sourceSignature: status.sourceSignature,
        embeddingModelKey: status.embeddingModelKey,
        totalChunkCount: status.totalChunkCount ?? chunks.length,
        chunks,
      });
      summary.migratedCount += 1;
    } catch (error) {
      summary.failedCount += 1;
      summary.errors.push({ key, message: toError(error) });
    }
  }

  summary.skippedCount = entries.length - summary.migratedCount - summary.failedCount;
  return summary;
}

function listIndexStatuses(db) {
  return db
    .prepare('SELECT * FROM rag_indexes ORDER BY indexed_at DESC')
    .all()
    .map(rowToStatus);
}

function documentVectorBackfillStatus(db) {
  return {
    done: Boolean(readStoreMeta(db, VECTOR_BACKFILL_META_KEY)),
    cursor: readStoreMeta(db, VECTOR_BACKFILL_CURSOR_KEY),
  };
}

function removeNoteIndex(db, { id }) {
  return withTransaction(db, () => {
    deleteDocumentSourceData(db, `note:${id}`, 'note');
    rebuildDocumentVectors(db, `note:${id}`);
  });
}

function removeDocumentIndex(db, { documentKey }) {
  const key = cleanString(documentKey);
  if (!key) return { removed: false };

  return withTransaction(db, () => {
    const indexCount = Number(
      db.prepare(
        `SELECT COUNT(*) AS count FROM rag_indexes
         WHERE document_key = ? AND source_type != 'note'`,
      ).get(key)?.count,
    ) || 0;
    const chunkCount = Number(
      db.prepare(
        `SELECT COUNT(*) AS count FROM rag_chunks
         WHERE document_key = ? AND source_type != 'note'`,
      ).get(key)?.count,
    ) || 0;

    deleteDocumentSourceData(db, key, 'mineru-markdown');
    deleteDocumentSourceData(db, key, 'pdf-text');
    rebuildDocumentVectors(db, key);
    return { removed: indexCount > 0 || chunkCount > 0 };
  });
}

module.exports = {
  MAX_AGENT_LOG_STRING_LENGTH,
  backfillDocumentVectors,
  countChunks,
  decodeEmbeddingValue,
  deleteDocumentSourceData,
  deleteVectorRowsByIds,
  documentVectorBackfillStatus,
  finalizeDocumentIndex,
  getDocumentIndexStatus,
  getStatus,
  indexDocument,
  indexedSourceRows,
  listIndexStatuses,
  listIndexedChunkIds,
  migrateFromLibraryRagIndexes,
  normalizeBoundedString,
  normalizeChunk,
  normalizeDocumentKey,
  normalizeNonNegativeInteger,
  normalizeNullableInteger,
  normalizeRequiredString,
  normalizeSourceType,
  parseStoredSectionPath,
  rebuildAllDocumentVectors,
  rebuildDocumentVectors,
  removeDocumentIndex,
  removeNoteIndex,
  reportFailure,
  rowToStatus,
  runBoundedVectorBackfill,
  stepDocumentVectorBackfill,
  toFloat32Array,
  upsertStatus,
  validateEmbedding,
};
