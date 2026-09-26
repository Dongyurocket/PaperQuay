function retrieveNoteVectors(db, { queryEmbedding, modelKey, documents, limit = 100 }) {
  const dimension = queryEmbedding.length;
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 32768) throw new Error('Invalid embedding dimension');
  if (!documents.length) return [];
  const table = `rag_vec_${dimension}`;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table)) return [];
  const results = [];
  // Partition-scoped KNN keeps deleted/out-of-scope notes from consuming Top-K.
  const search = db.prepare(`
    SELECT c.chunk_id AS chunkId, c.text, v.distance
    FROM ${table} v JOIN rag_chunks c ON c.id = v.rowid
    JOIN rag_indexes i ON i.document_key = c.document_key AND i.source_type = c.source_type
    WHERE v.embedding MATCH ? AND k = ? AND v.document_key = ? AND v.source_type = 'note'
      AND i.status = 'ready' AND i.embedding_model_key = ? AND i.source_signature = ?
    ORDER BY v.distance`);
  const vector = new Float32Array(queryEmbedding);
  for (const document of documents) {
    const rows = search.all(vector, 1, `note:${document.id}`, modelKey, document.signature);
    if (rows.length) results.push({ id: document.id, score: Number(rows[0].distance), chunkId: rows[0].chunkId });
  }
  return results.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id)).slice(0, limit);
}

module.exports = { retrieveNoteVectors };
