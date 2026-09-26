const { fuseNotes, noteSignature } = require('./noteSearch.cjs');
const { noteModelKey } = require('./noteEmbedding.cjs');

function rowNote(row) {
  let contentJson = null;
  try { contentJson = row.content_json ? JSON.parse(row.content_json) : null; }
  catch { /* Historical malformed JSON retains the plain-text fallback. */ }
  return {
    id: row.id, title: row.title, content: row.content, contentText: row.content_text,
    contentJson,
  };
}

async function hybridNotes({ query, limit, keyword, eligible, embedding, embed, retrieve }) {
  const currentKeywords = () => {
    const current = new Map(eligible().map((row) => [row.id, row]));
    return keyword.rows.filter((row) => current.has(row.id)
      && noteSignature(rowNote(row)) === noteSignature(rowNote(current.get(row.id))))
      .map((row) => current.get(row.id));
  };
  const fallback = (warning) => ({
    notes: currentKeywords().slice(0, limit).map((row) => ({ ...row, channels: [keyword.channel] })),
    retrievalMode: 'keyword', warning,
  });
  if (!embedding) return {
    notes: keyword.rows.slice(0, limit).map((row) => ({ ...row, channels: [keyword.channel] })),
    retrievalMode: 'keyword', warning: 'Embedding 未在 PaperQuay 中配置，已降级为关键词检索。',
  };
  try {
    const queryEmbedding = await embed(query, embedding);
    if (!Array.isArray(queryEmbedding) || !queryEmbedding.length || queryEmbedding.some((value) => !Number.isFinite(value))) {
      throw new Error('Embedding service returned an invalid query vector');
    }
    const rows = eligible();
    const documents = rows.map((row) => ({ id: row.id, signature: noteSignature(rowNote(row)) }));
    const vectors = await retrieve({ queryEmbedding, modelKey: noteModelKey(embedding), documents, limit: 100 });
    if (!vectors.length) return fallback('笔记库没有与当前模型及正文版本匹配的向量结果，已降级为关键词检索。');
    const signatures = new Map(documents.map((doc) => [doc.id, doc.signature]));
    const byId = new Map(eligible().filter((row) => signatures.get(row.id) === noteSignature(rowNote(row)))
      .map((row) => [row.id, row]));
    const seen = new Set();
    const vectorNotes = vectors.filter((row) => byId.has(row.id) && !seen.has(row.id) && seen.add(row.id))
      .map((row) => ({ ...byId.get(row.id), score: row.score }));
    return {
      notes: fuseNotes(vectorNotes, currentKeywords(), keyword.channel, limit),
      retrievalMode: 'hybrid', embeddingModel: embedding.model,
    };
  } catch (error) {
    return fallback(`向量检索失败，已降级为关键词检索：${error.message}`);
  }
}

module.exports = { hybridNotes, rowNote };
