import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAPER_HISTORY_STORAGE_WARNING_EVENT,
  invalidatePaperHistoryCache,
  loadPaperHistoryMap,
  removePaperHistory,
  savePaperHistory,
} from '../src/utils/paperHistory.ts';
import type { PaperHistoryRecord } from '../src/types/reader.ts';

const LEGACY_KEY = 'paper-reader-paper-history-v1';
const INDEX_KEY = 'paper-reader-paper-history-index-v2';
const RECORD_PREFIX = 'paper-reader-paper-history-v2:';

class FakeStorage {
  map = new Map<string, string>();
  setCalls: string[] = [];
  failNextSet = 0;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setCalls.push(key);
    if (this.failNextSet > 0) {
      this.failNextSet -= 1;
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  get length(): number {
    return this.map.size;
  }
}

function installStorage(storage: FakeStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

function restoreStorage(original: unknown) {
  if (original) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

function makeRecord(workspaceId: string, overrides: Partial<PaperHistoryRecord> = {}): PaperHistoryRecord {
  return {
    workspaceId,
    document: { workspaceId, itemKey: workspaceId, title: workspaceId } as never,
    lastOpenedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    lastPdfPath: '',
    pdfScrollPositions: {},
    pdfReadingHeatmaps: {},
    lastMineruPath: '',
    lastActiveBlockId: null,
    workspaceStage: 'saved' as never,
    readingViewMode: 'dual-pane' as never,
    selectedQaPresetId: null,
    selectedQaSessionId: null,
    paperSummary: null,
    workspaceNoteMarkdown: '',
    annotations: [],
    qaSessions: [],
    ...overrides,
  } as PaperHistoryRecord;
}

function seedIndex(storage: FakeStorage, workspaceIds: string[]) {
  storage.map.set(
    INDEX_KEY,
    JSON.stringify({
      version: 6,
      entries: workspaceIds.map((workspaceId, index) => ({
        workspaceId,
        lastOpenedAt: index + 1,
        lastUpdatedAt: index + 1,
      })),
    }),
  );
}

test('paper history keeps one shard per paper and writes only the changed paper', () => {
  const original = globalThis.localStorage;
  const storage = new FakeStorage();
  installStorage(storage);
  invalidatePaperHistoryCache();

  try {
    const legacy: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) {
      legacy[`paper-${index}`] = {
        workspaceId: `paper-${index}`,
        lastOpenedAt: index,
        qaSessions: [],
        annotations: [],
        pdfScrollPositions: {},
        pdfReadingHeatmaps: {},
      };
    }
    storage.map.set(LEGACY_KEY, JSON.stringify(legacy));

    const loaded = loadPaperHistoryMap();
    assert.equal(Object.keys(loaded).length, 5000);
    assert.equal(storage.map.has(LEGACY_KEY), false, 'legacy table is removed after migration');
    assert.ok(storage.map.has(`${RECORD_PREFIX}paper-0`));

    storage.setCalls.length = 0;
    savePaperHistory(makeRecord('paper-123'));
    assert.deepEqual(
      storage.setCalls.sort(),
      [`${RECORD_PREFIX}paper-123`, INDEX_KEY].sort(),
      'a scroll save must not rewrite the other 4,999 records',
    );

    const index = JSON.parse(storage.map.get(INDEX_KEY) ?? '{}');
    assert.equal(index.entries[0].workspaceId, 'paper-123');
  } finally {
    invalidatePaperHistoryCache();
    restoreStorage(original);
  }
});

test('per-paper sessions are capped and the selected session stays valid', () => {
  const original = globalThis.localStorage;
  const storage = new FakeStorage();
  installStorage(storage);
  invalidatePaperHistoryCache();

  try {
    const sessions = Array.from({ length: 120 }, (_, index) => ({
      id: `session-${index}`,
      title: `Session ${index}`,
      createdAt: index,
      updatedAt: index,
      messages: [],
    }));
    const saved = savePaperHistory(
      makeRecord('paper-sessions', {
        qaSessions: sessions as never,
        selectedQaSessionId: 'session-119',
      }),
    );

    assert.equal(saved.qaSessions.length, 40);
    assert.equal(saved.selectedQaSessionId, 'session-119');
    const shard = JSON.parse(storage.map.get(`${RECORD_PREFIX}paper-sessions`) ?? '{}');
    assert.equal(shard.qaSessions.length, 40);
  } finally {
    invalidatePaperHistoryCache();
    restoreStorage(original);
  }
});

test('the global record index is bounded and evicted shards are removed', () => {
  const original = globalThis.localStorage;
  const storage = new FakeStorage();
  installStorage(storage);
  invalidatePaperHistoryCache();

  try {
    for (let index = 0; index < 305; index += 1) {
      savePaperHistory(makeRecord(`paper-${index}`, { lastOpenedAt: index + 1 }));
    }

    const index = JSON.parse(storage.map.get(INDEX_KEY) ?? '{}');
    assert.equal(index.entries.length, 300);
    assert.equal(storage.map.has(`${RECORD_PREFIX}paper-0`), false);
    assert.equal(storage.map.has(`${RECORD_PREFIX}paper-4`), false);
    assert.equal(storage.map.has(`${RECORD_PREFIX}paper-304`), true);
  } finally {
    invalidatePaperHistoryCache();
    restoreStorage(original);
  }
});

test('quota exhaustion evicts the oldest records and surfaces a warning instead of throwing', () => {
  const original = globalThis.localStorage;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const storage = new FakeStorage();
  installStorage(storage);
  const events: Array<{ type: string; detail?: unknown }> = [];
  (globalThis as { window?: unknown }).window = {
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      events.push(event);
      return true;
    },
  };
  invalidatePaperHistoryCache();

  try {
    const workspaces = Array.from({ length: 10 }, (_, index) => `old-${index}`);
    seedIndex(storage, workspaces);
    for (const workspaceId of workspaces) {
      storage.map.set(`${RECORD_PREFIX}${workspaceId}`, JSON.stringify({ workspaceId }));
    }

    storage.failNextSet = 1;
    assert.doesNotThrow(() => savePaperHistory(makeRecord('fresh')));
    assert.equal(storage.map.has(`${RECORD_PREFIX}fresh`), true);
    assert.equal(storage.map.has(`${RECORD_PREFIX}old-0`), false, 'oldest records are evicted first');
    assert.ok(
      events.some((event) => event.type === PAPER_HISTORY_STORAGE_WARNING_EVENT),
      'a storage warning is dispatched to the UI',
    );
  } finally {
    invalidatePaperHistoryCache();
    restoreStorage(original);
    if (originalWindow) {
      (globalThis as { window?: unknown }).window = originalWindow;
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});

test('removePaperHistory deletes the shard and the index entry', () => {
  const original = globalThis.localStorage;
  const storage = new FakeStorage();
  installStorage(storage);
  invalidatePaperHistoryCache();

  try {
    savePaperHistory(makeRecord('paper-remove'));
    assert.ok(storage.map.has(`${RECORD_PREFIX}paper-remove`));

    removePaperHistory('paper-remove');
    assert.equal(storage.map.has(`${RECORD_PREFIX}paper-remove`), false);
    const index = JSON.parse(storage.map.get(INDEX_KEY) ?? '{}');
    assert.deepEqual(index.entries, []);
    assert.equal(loadPaperHistoryMap()['paper-remove'] ?? null, null);
  } finally {
    invalidatePaperHistoryCache();
    restoreStorage(original);
  }
});

test('a scroll save stays fast with a large migrated history', () => {
  const original = globalThis.localStorage;
  const storage = new FakeStorage();
  installStorage(storage);
  invalidatePaperHistoryCache();

  try {
    const legacy: Record<string, unknown> = {};
    for (let index = 0; index < 5000; index += 1) {
      legacy[`paper-${index}`] = {
        workspaceId: `paper-${index}`,
        lastOpenedAt: index,
        qaSessions: [],
        annotations: [],
        pdfScrollPositions: {},
        pdfReadingHeatmaps: {},
      };
    }
    storage.map.set(LEGACY_KEY, JSON.stringify(legacy));
    loadPaperHistoryMap();

    const startedAt = performance.now();
    savePaperHistory(makeRecord('paper-timed'));
    const elapsed = performance.now() - startedAt;

    // 计划验收目标是 <5ms；这里给 CI/机械盘留出余量，同时确保不是旧版
    // 「重新序列化整张 5000 条 map」的 O(N) 写入。
    assert.ok(elapsed < 25, `scroll save took ${elapsed.toFixed(2)}ms`);
  } finally {
    invalidatePaperHistoryCache();
    restoreStorage(original);
  }
});
