const { withTransaction } = require('../nodeSqlite.cjs');
const {
  MAX_AGENT_LOG_STRING_LENGTH,
  normalizeBoundedString,
  normalizeNonNegativeInteger,
} = require('./indexing.cjs');

const MAX_AGENT_LOG_DEPTH = 6;
const MAX_AGENT_LOG_ITEMS = 64;
const AGENT_RUN_STATUSES = new Set(['running', 'done', 'error', 'aborted']);
const AGENT_RUN_EVENT_KINDS = new Set([
  'turn_start',
  'tool_call',
  'tool_result',
  'answer_delta',
  'turn_end',
  'error',
  'stage_start',
  'stage_progress',
  'stage_end',
  'capability',
  'memory',
  'context_compacted',
  'checkpoint',
  'capability_route',
  'capability_route_failed',
  'citation_verification',
]);
const AGENT_LOG_SENSITIVE_KEY = /(?:api[_-]?key|authorization|token|password|secret|dataurl|attachment)/i;

function normalizeAgentRunId(value, label = 'agent runId') {
  return normalizeBoundedString(value, label, { required: true, maxLength: 180 });
}

function normalizeAgentRunStatus(value, fallback = 'running') {
  const status = normalizeBoundedString(value, 'agent run status', { maxLength: 24 }) || fallback;

  if (!AGENT_RUN_STATUSES.has(status)) {
    throw new Error(`Unsupported agent run status: ${status}`);
  }

  return status;
}

function normalizeAgentEventKind(value) {
  const kind = normalizeBoundedString(value, 'agent run event kind', { required: true, maxLength: 64 });

  if (!AGENT_RUN_EVENT_KINDS.has(kind)) {
    throw new Error(`Unsupported agent run event kind: ${kind}`);
  }

  return kind;
}

function redactAgentLogValue(value, key = '', depth = 0) {
  if (AGENT_LOG_SENSITIVE_KEY.test(key)) {
    return '[redacted]';
  }

  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      return '[redacted]';
    }

    return value.slice(0, MAX_AGENT_LOG_STRING_LENGTH);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (depth >= MAX_AGENT_LOG_DEPTH) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AGENT_LOG_ITEMS)
      .map((item) => redactAgentLogValue(item, '', depth + 1));
  }

  if (typeof value === 'object') {
    const output = {};

    for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_AGENT_LOG_ITEMS)) {
      output[entryKey] = redactAgentLogValue(entryValue, entryKey, depth + 1);
    }

    return output;
  }

  return String(value).slice(0, MAX_AGENT_LOG_STRING_LENGTH);
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(String(value ?? 'null'));
  } catch {
    return null;
  }
}

function rowToAgentRun(row) {
  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    sessionId: row.session_id,
    startedAt: Number(row.started_at) || 0,
    finishedAt: row.finished_at === null || row.finished_at === undefined ? null : Number(row.finished_at),
    status: row.status,
    model: row.model ?? '',
    presetId: row.preset_id ?? '',
    instruction: row.instruction ?? '',
    promptTokens: Number(row.prompt_tokens) || 0,
    completionTokens: Number(row.completion_tokens) || 0,
    turns: Number(row.turns) || 0,
  };
}

function rowToAgentRunEvent(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id) || 0,
    runId: row.run_id,
    ts: Number(row.ts) || 0,
    kind: row.kind,
    payload: parseJsonOrNull(row.payload) ?? {},
  };
}

/** 一次性清理已退役的独立 Agent 历史；表结构保留。 */
function clearAgentHistory(db) {
  return withTransaction(db, () => {
    const runs = Number(db.prepare('SELECT COUNT(*) AS count FROM agent_runs').get()?.count) || 0;
    const events = Number(db.prepare('SELECT COUNT(*) AS count FROM agent_run_events').get()?.count) || 0;
    db.prepare('DELETE FROM agent_run_events').run();
    db.prepare('DELETE FROM agent_runs').run();
    return { runs, events };
  });
}

function createAgentRun(db, request) {
  const runId = normalizeAgentRunId(request?.runId);
  const sessionId = normalizeAgentRunId(request?.sessionId, 'agent sessionId');
  const startedAt = normalizeNonNegativeInteger(request?.startedAt, Date.now());
  const status = normalizeAgentRunStatus(request?.status, 'running');

  db.prepare(`
    INSERT INTO agent_runs (
      run_id, session_id, started_at, finished_at, status, model, preset_id, instruction,
      prompt_tokens, completion_tokens, turns
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    sessionId,
    startedAt,
    status === 'running' ? null : startedAt,
    status,
    normalizeBoundedString(request?.model, 'agent model', { maxLength: 256 }),
    normalizeBoundedString(request?.presetId, 'agent presetId', { maxLength: 180 }),
    normalizeBoundedString(request?.instruction, 'agent instruction', { maxLength: MAX_AGENT_LOG_STRING_LENGTH }),
    normalizeNonNegativeInteger(request?.promptTokens),
    normalizeNonNegativeInteger(request?.completionTokens),
    normalizeNonNegativeInteger(request?.turns),
  );

  return rowToAgentRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
}

function appendAgentRunEvent(db, request) {
  const runId = normalizeAgentRunId(request?.runId);
  const kind = normalizeAgentEventKind(request?.kind);
  const ts = normalizeNonNegativeInteger(request?.ts, Date.now());
  const promptTokens = normalizeNonNegativeInteger(request?.promptTokens);
  const completionTokens = normalizeNonNegativeInteger(request?.completionTokens);
  const turns = normalizeNonNegativeInteger(request?.turn);
  const payload = redactAgentLogValue(request?.payload ?? {});
  const serializedPayload = JSON.stringify(payload);

  if (!db.prepare('SELECT 1 FROM agent_runs WHERE run_id = ?').get(runId)) {
    throw new Error(`Unknown agent run: ${runId}`);
  }

  return withTransaction(db, () => {
    db.prepare(`
      INSERT INTO agent_run_events (run_id, ts, kind, payload)
      VALUES (?, ?, ?, ?)
    `).run(runId, ts, kind, serializedPayload);
    const id = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);

    db.prepare(`
      UPDATE agent_runs
      SET prompt_tokens = prompt_tokens + ?,
          completion_tokens = completion_tokens + ?,
          turns = MAX(turns, ?)
      WHERE run_id = ?
    `).run(promptTokens, completionTokens, turns, runId);

    return rowToAgentRunEvent(db.prepare('SELECT * FROM agent_run_events WHERE id = ?').get(id));
  });
}

function finishAgentRun(db, request) {
  const runId = normalizeAgentRunId(request?.runId);
  const status = normalizeAgentRunStatus(request?.status, 'done');

  if (status === 'running') {
    throw new Error('A finished agent run cannot retain running status');
  }

  const result = db.prepare(`
    UPDATE agent_runs
    SET finished_at = ?,
        status = ?,
        prompt_tokens = prompt_tokens + ?,
        completion_tokens = completion_tokens + ?,
        turns = MAX(turns, ?)
    WHERE run_id = ?
  `).run(
    normalizeNonNegativeInteger(request?.finishedAt, Date.now()),
    status,
    normalizeNonNegativeInteger(request?.promptTokens),
    normalizeNonNegativeInteger(request?.completionTokens),
    normalizeNonNegativeInteger(request?.turns),
    runId,
  );

  if (Number(result.changes) === 0) {
    throw new Error(`Unknown agent run: ${runId}`);
  }

  return rowToAgentRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
}

function getAgentRun(db, request) {
  const runId = normalizeAgentRunId(request?.runId);
  return rowToAgentRun(db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId));
}

function getAgentRunEvents(db, request) {
  const runId = normalizeAgentRunId(request?.runId);
  const afterId = normalizeNonNegativeInteger(request?.afterId);
  const limit = Math.min(500, Math.max(1, normalizeNonNegativeInteger(request?.limit, 200)));

  // order=desc 时取最新 N 条（再反转为时间升序返回），供中断恢复读取最近的 checkpoint，
  // 避免流式事件把 checkpoint 挤出最旧 200 条的读取窗口。
  if (request?.order === 'desc') {
    return db.prepare(`
      SELECT *
      FROM agent_run_events
      WHERE run_id = ? AND id > ?
      ORDER BY id DESC
      LIMIT ?
    `).all(runId, afterId, limit).reverse().map(rowToAgentRunEvent);
  }

  return db.prepare(`
    SELECT *
    FROM agent_run_events
    WHERE run_id = ? AND id > ?
    ORDER BY id
    LIMIT ?
  `).all(runId, afterId, limit).map(rowToAgentRunEvent);
}

function listInterruptedAgentRuns(db, request = {}) {
  const sessionId = normalizeBoundedString(request?.sessionId, 'agent sessionId', { maxLength: 180 });
  const limit = Math.min(50, Math.max(1, normalizeNonNegativeInteger(request?.limit, 10)));
  const rows = sessionId
    ? db.prepare(`
      SELECT * FROM agent_runs
      WHERE status = 'running' AND session_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(sessionId, limit)
    : db.prepare(`
      SELECT * FROM agent_runs
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit);

  return rows.map(rowToAgentRun);
}

function listAgentRunUsageBySession(db, request = {}) {
  const sessionIds = Array.isArray(request?.sessionIds)
    ? request.sessionIds
      .map((sessionId) => normalizeBoundedString(sessionId, 'agent sessionId', { maxLength: 180 }))
      .filter(Boolean)
      .slice(0, 100)
    : [];

  const where = sessionIds.length > 0
    ? `WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`
    : '';

  return db.prepare(`
    SELECT
      session_id,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
      COUNT(*) AS run_count
    FROM agent_runs
    ${where}
    GROUP BY session_id
  `).all(...sessionIds).map((row) => ({
    sessionId: row.session_id,
    promptTokens: Number(row.prompt_tokens) || 0,
    completionTokens: Number(row.completion_tokens) || 0,
    runCount: Number(row.run_count) || 0,
  }));
}

module.exports = {
  appendAgentRunEvent,
  clearAgentHistory,
  createAgentRun,
  finishAgentRun,
  getAgentRun,
  getAgentRunEvents,
  listAgentRunUsageBySession,
  listInterruptedAgentRuns,
};
