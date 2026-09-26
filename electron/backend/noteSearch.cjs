const crypto = require('node:crypto');
const { rrfFuse } = require('./ragStore.cjs');

const PAGE_KINDS = ['paper-card', 'concept', 'synthesis', 'qa', 'excerpt', 'index', 'log', 'overview'];

function noteConditions(db, request) {
  const columns = new Set(db.prepare('PRAGMA table_info(notes)').all().map((row) => row.name));
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  if (request.paperId) {
    conditions.push(request.paperIdOnly ? 'paper_id = ?' : '(paper_id = ? OR linked_paper_id = ?)');
    params.push(request.paperId);
    if (!request.paperIdOnly) params.push(request.paperId);
  }
  if (request.pageKind) {
    if (!PAGE_KINDS.includes(request.pageKind)) throw new Error(`Unsupported note page kind: ${request.pageKind}`);
    conditions.push(columns.has('page_kind') ? 'page_kind = ?' : '0');
    if (columns.has('page_kind')) params.push(request.pageKind);
  }
  if (request.linkedPaperId) {
    conditions.push('linked_paper_id = ?');
    params.push(request.linkedPaperId);
  }
  if (request.type) {
    conditions.push('type = ?');
    params.push(request.type);
  }
  if (request.tag) {
    conditions.push('id IN (SELECT note_id FROM note_tags WHERE lower(tag) = lower(?))');
    params.push(String(request.tag).replace(/^#/, ''));
  }
  return { conditions, params };
}

function eligibleNoteRows(db, request = {}) {
  const { conditions, params } = noteConditions(db, request);
  return db.prepare(`SELECT * FROM notes WHERE ${conditions.join(' AND ')}
    ORDER BY is_pinned DESC, updated_at DESC, created_at DESC, id ASC`).all(...params);
}

function keywordNotes(db, request = {}) {
  const query = String(request.query ?? '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(request.limit) || 10));
  const { conditions, params } = noteConditions(db, request);
  const order = 'ORDER BY is_pinned DESC, updated_at DESC, created_at DESC, id ASC LIMIT ?';
  let rows;
  let channel = 'fts';
  if (query) {
    const tokens = query.split(/\s+/).filter(Boolean);
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes_fts'").get();
    if (exists && tokens.every((token) => token.length >= 3)) {
      try {
        const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
        rows = db.prepare(`SELECT * FROM notes WHERE ${conditions.join(' AND ')}
          AND id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?) ${order}`)
          .all(...params, match, limit);
      } catch { /* Old or unavailable FTS indexes retain the LIKE contract. */ }
    }
    if (!rows) {
      channel = 'like';
      const pattern = `%${query}%`;
      rows = db.prepare(`SELECT * FROM notes WHERE ${conditions.join(' AND ')}
        AND (lower(title) LIKE ? OR lower(content) LIKE ?
          OR lower(COALESCE(content_text, '')) LIKE ? OR lower(COALESCE(excerpt, '')) LIKE ?) ${order}`)
        .all(...params, pattern, pattern, pattern, pattern, limit);
    }
  } else {
    rows = db.prepare(`SELECT * FROM notes WHERE ${conditions.join(' AND ')} ${order}`).all(...params, limit);
  }
  return { rows, channel };
}

function noteProse(note) {
  const blocks = [];
  let snapshotLevel = null;
  const visit = (node) => {
    if (!node || ['noteAnchorBlock', 'noteAnchorLink', 'paperReference'].includes(node.type)) return '';
    if (node.type === 'text') return node.text || '';
    const blockContainer = ['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell'].includes(node.type);
    return (node.content || []).map(visit).join(blockContainer ? '\n\n' : '');
  };
  if (note.contentJson?.content) {
    for (const node of note.contentJson.content) {
      const text = visit(node).trim();
      if (node.type === 'heading') {
        const level = Number(node.attrs?.level) || 2;
        if (/^(原文快照|source snapshot|original snapshot)$/i.test(text)) {
          snapshotLevel = level;
          continue;
        }
        if (snapshotLevel !== null && level <= snapshotLevel) snapshotLevel = null;
      }
      if (snapshotLevel === null && text) {
        blocks.push(node.type === 'heading' ? `${'#'.repeat(Number(node.attrs?.level) || 2)} ${text}` : text);
      }
    }
    return blocks.join('\n\n');
  }
  // Markdown imports without structured JSON: omit evidence sections and anchor links.
  const lines = String(note.contentText ?? note.content ?? '').split(/\r?\n/);
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      if (/^(原文快照|source snapshot|original snapshot)$/i.test(heading[2].trim())) {
        snapshotLevel = heading[1].length;
        continue;
      }
      if (snapshotLevel !== null && heading[1].length <= snapshotLevel) snapshotLevel = null;
    }
    if (snapshotLevel === null) blocks.push(line.replace(/\[[^\]]*\]\(paperquay:\/\/anchor[^)]*\)/g, ''));
  }
  return blocks.join('\n').trim();
}

// Reader RAG's paragraph/punctuation/whitespace soft breaks and 120-character
// overlap, adapted here because its TS module imports renderer-only services.
function splitLongSection(text, maxChars) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const window = text.slice(start, end);
      for (const pattern of [
        /\n{2,}(?![\s\S]*\n{2,})/,
        /[。！？.!?]\s+(?![\s\S]*[。！？.!?]\s+)/,
        /[；;]\s+(?![\s\S]*[；;]\s+)/,
        /\s+(?![\s\S]*\s+)/,
      ]) {
        const match = window.match(pattern);
        if (match && match.index + match[0].length >= maxChars * 0.58) {
          end = start + match.index + match[0].length;
          break;
        }
      }
    }
    const piece = text.slice(start, end).trim();
    if (piece) parts.push(piece);
    if (end === text.length) break;
    const overlap = Math.min(120, Math.floor(maxChars * 0.2));
    start = Math.max(start + 1, end - overlap);
    const whitespace = text.slice(start).search(/\S/);
    if (whitespace >= 0) start += whitespace;
  }
  return parts;
}

function chunkNote(note, maxChars = 900) {
  const prose = noteProse(note);
  const title = String(note.title || '').trim();
  if (!prose && !title) return [];
  const sections = prose.length <= maxChars ? [prose] : prose.split(/(?=^#{1,6}\s)/m).filter(Boolean);
  const parts = sections.flatMap((section) => {
    const heading = section.match(/^#{1,6}\s+[^\n]+/m)?.[0];
    return splitLongSection(section, maxChars).map((piece, index) =>
      index > 0 && heading ? `${heading}\n\n${piece}` : piece);
  });
  if (!parts.length) parts.push('');
  return parts.map((text, index) => ({
    chunkId: `note:${note.id}:${index}`, chunkIndex: index,
    text: [title, text].filter(Boolean).join('\n\n'), pageIndex: null, blockId: null,
  }));
}

function noteSignature(note) {
  return crypto.createHash('sha256').update(JSON.stringify(chunkNote(note).map((chunk) => chunk.text))).digest('hex');
}

function fuseNotes(vectorRows, keywordRows, channel, limit) {
  const wrap = (rows) => rows.map((row) => ({ ...row, chunkId: row.id, sourceType: 'note' }));
  const vectors = new Set(vectorRows.map((row) => row.id));
  const keywords = new Set(keywordRows.map((row) => row.id));
  return rrfFuse(wrap(vectorRows), wrap(keywordRows)).slice(0, limit).map((row) => ({
    ...row,
    channels: [...(vectors.has(row.id) ? ['vector'] : []), ...(keywords.has(row.id) ? [channel] : [])],
  }));
}

module.exports = { keywordNotes, eligibleNoteRows, chunkNote, noteSignature, noteProse, fuseNotes };
