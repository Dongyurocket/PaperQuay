import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAgentMemoryStore } = require('../electron/backend/agentMemoryStore.cjs');

function createStore() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'paperquay-agent-memory-test-'));
  return {
    dataDir,
    store: createAgentMemoryStore({ dataDir, agentMemoryDir: path.join(dataDir, 'agent-memory') }),
  };
}

test('Agent memory store writes fixed L2/L3 files and appends redacted L1 traces', () => {
  const { dataDir, store } = createStore();

  try {
    const topics = store.writeMemory({ file: 'topics', content: '# Topic\n- paper A' });
    assert.equal(topics.content, '# Topic\n- paper A');
    assert.equal(topics.exists, true);

    const trace = store.appendTrace({
      ts: Date.UTC(2026, 7, 27),
      runId: 'run-a',
      kind: 'tool_call',
      payload: {
        apiKey: 'do-not-store',
        name: 'rag_search',
        dataUrl: 'data:image/png;base64,do-not-store',
      },
    });

    // appendTrace 只回 stat 信息（避免全量读回），内容校验改走 readMemory。
    assert.equal(trace.date, '2026-08-27');
    const traceContent = store.readMemory({ file: 'trace', date: '2026-08-27' }).content;
    assert.match(traceContent, /"apiKey":"\[redacted\]"/);
    assert.match(traceContent, /"dataUrl":"\[redacted\]"/);
    assert.match(traceContent, /rag_search/);
    assert.equal(store.listMemory({ date: '2026-08-27' }).length, 3);

    const cleared = store.clearMemory({ file: 'topics' });
    assert.equal(cleared.content, '');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Agent memory store enforces the 4,000-character working-memory limit on L2/L3 only', () => {
  const { dataDir, store } = createStore();

  try {
    // L2/L3：4_000 字符硬上限
    const withinLimit = store.writeMemory({ file: 'topics', content: 'x'.repeat(4_000) });
    assert.equal(withinLimit.content.length, 4_000);
    assert.throws(
      () => store.writeMemory({ file: 'topics', content: 'x'.repeat(4_001) }),
      /exceeds the 4000 character limit/,
    );
    assert.throws(
      () => store.writeMemory({ file: 'synthesis', content: 'x'.repeat(4_001) }),
      /exceeds the 4000 character limit/,
    );

    // trace 保持 8MB 上限：总量不受 4_000 工作记忆上限约束
    for (let index = 0; index < 3; index += 1) {
      store.appendTrace({
        ts: Date.UTC(2026, 8, 30),
        runId: 'run-limit',
        kind: 'note',
        payload: { blob: 'y'.repeat(10_000) },
      });
    }
    const traceContent = store.readMemory({ file: 'trace', date: '2026-09-30' }).content;
    assert.ok(traceContent.length > 4_000);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Agent memory store rejects arbitrary file names', () => {
  const { dataDir, store } = createStore();

  try {
    assert.throws(() => store.readMemory({ file: '../config' }), /Unsupported agent memory file/);
    const trace = store.writeMemory({ file: 'trace', date: '../escape', content: 'x' });
    assert.match(trace.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.throws(
      () => store.writeMemory({ file: 'trace', date: '2026-08-27', content: '中'.repeat(3_000_000) }),
      /exceeds/,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
