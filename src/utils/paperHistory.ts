import type {
  DocumentChatAttachment,
  DocumentChatMessage,
  DocumentChatSession,
  PaperAnnotation,
  PaperHistoryRecord,
  PdfReadingHeatmap,
  PdfScrollPosition,
} from '../types/reader';
import { emitToast } from '../ui/toastBridge.ts';

const PAPER_HISTORY_LEGACY_KEY = 'paper-reader-paper-history-v1';
const PAPER_HISTORY_INDEX_KEY = 'paper-reader-paper-history-index-v2';
const PAPER_HISTORY_RECORD_PREFIX = 'paper-reader-paper-history-v2:';
const PAPER_HISTORY_VERSION = 6;
const PDF_READING_HEATMAP_BIN_COUNT = 120;
const PAPER_HISTORY_MAX_RECORDS = 300;
const PAPER_HISTORY_MAX_SESSIONS = 40;
const PAPER_HISTORY_QUOTA_WARNING_INTERVAL_MS = 30_000;

export const PAPER_READING_HEATMAP_UPDATED_EVENT = 'paperquay:reading-heatmap-updated';
export const PAPER_HISTORY_STORAGE_WARNING_EVENT = 'paperquay:paper-history-storage-warning';

function stripAttachmentForHistory(
  attachment: DocumentChatAttachment,
): DocumentChatAttachment {
  return {
    ...attachment,
    dataUrl: undefined,
    textContent: undefined,
  };
}

function stripMessageForHistory(message: DocumentChatMessage): DocumentChatMessage {
  return {
    ...message,
    attachments: message.attachments?.map(stripAttachmentForHistory),
  };
}

function buildSessionTitle(messages: DocumentChatMessage[]): string {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && message.content.trim(),
  );

  if (!firstUserMessage) {
    return 'New chat';
  }

  const normalizedContent = firstUserMessage.content.replace(/\s+/g, ' ').trim();

  return normalizedContent.length > 36
    ? `${normalizedContent.slice(0, 36)}...`
    : normalizedContent;
}

function stripSessionForHistory(session: DocumentChatSession): DocumentChatSession {
  const firstMessage = session.messages[0];
  const lastMessage = session.messages[session.messages.length - 1];

  return {
    ...session,
    title: session.title.trim() || buildSessionTitle(session.messages),
    createdAt: session.createdAt || firstMessage?.createdAt || Date.now(),
    updatedAt: lastMessage?.createdAt || session.createdAt || Date.now(),
    messages: session.messages.map(stripMessageForHistory),
  };
}

function buildLegacySession(
  record: Pick<PaperHistoryRecord, 'qaMessages' | 'selectedQaPresetId'>,
): DocumentChatSession | null {
  const messages = Array.isArray(record.qaMessages)
    ? record.qaMessages.map(stripMessageForHistory)
    : [];

  if (messages.length === 0) {
    return null;
  }

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];

  return {
    id: `legacy-${firstMessage?.id || crypto.randomUUID()}`,
    title: buildSessionTitle(messages),
    createdAt: firstMessage?.createdAt || Date.now(),
    updatedAt: lastMessage?.createdAt || firstMessage?.createdAt || Date.now(),
    messages,
  };
}

function stripAnnotationForHistory(annotation: PaperAnnotation): PaperAnnotation {
  return {
    ...annotation,
    note: annotation.note.trim(),
    quote: annotation.quote?.trim(),
    updatedAt: annotation.updatedAt || annotation.createdAt || Date.now(),
  };
}

function normalizePdfScrollPositions(value: unknown): Record<string, PdfScrollPosition> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const positions: Record<string, PdfScrollPosition> = {};

  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const position = candidate as Partial<PdfScrollPosition>;
    const sourceKey =
      typeof position.sourceKey === 'string' && position.sourceKey.trim()
        ? position.sourceKey
        : key;

    if (
      !sourceKey ||
      typeof position.top !== 'number' ||
      !Number.isFinite(position.top) ||
      typeof position.left !== 'number' ||
      !Number.isFinite(position.left) ||
      typeof position.page !== 'number' ||
      !Number.isFinite(position.page) ||
      typeof position.pageOffsetTop !== 'number' ||
      !Number.isFinite(position.pageOffsetTop) ||
      typeof position.updatedAt !== 'number' ||
      !Number.isFinite(position.updatedAt)
    ) {
      continue;
    }

    const nextPosition: PdfScrollPosition = {
      sourceKey,
      top: Math.max(0, position.top),
      left: Math.max(0, position.left),
      page: Math.max(1, Math.round(position.page)),
      pageOffsetTop: Math.max(0, position.pageOffsetTop),
      updatedAt: position.updatedAt,
    };

    if (typeof position.pageOffsetRatio === 'number' && Number.isFinite(position.pageOffsetRatio)) {
      nextPosition.pageOffsetRatio = Math.min(1, Math.max(0, position.pageOffsetRatio));
    }

    if (typeof position.pageHeight === 'number' && Number.isFinite(position.pageHeight) && position.pageHeight > 0) {
      nextPosition.pageHeight = position.pageHeight;
    }

    positions[sourceKey] = nextPosition;
  }

  return Object.fromEntries(
    Object.entries(positions)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, 12),
  );
}

function normalizePdfReadingHeatmaps(value: unknown): Record<string, PdfReadingHeatmap> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const heatmaps: Record<string, PdfReadingHeatmap> = {};

  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const heatmap = candidate as Partial<PdfReadingHeatmap>;
    const sourceKey =
      typeof heatmap.sourceKey === 'string' && heatmap.sourceKey.trim()
        ? heatmap.sourceKey
        : key;
    const rawBins = Array.isArray(heatmap.bins) ? heatmap.bins : [];

    if (
      !sourceKey ||
      rawBins.length === 0 ||
      typeof heatmap.updatedAt !== 'number' ||
      !Number.isFinite(heatmap.updatedAt)
    ) {
      continue;
    }

    const bins = Array.from({ length: PDF_READING_HEATMAP_BIN_COUNT }, (_, index) => {
      const value = rawBins[index];

      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.round(value)
        : 0;
    });
    const totalMs =
      typeof heatmap.totalMs === 'number' && Number.isFinite(heatmap.totalMs)
        ? Math.max(0, Math.round(heatmap.totalMs))
        : bins.reduce((sum, value) => sum + value, 0);

    heatmaps[sourceKey] = {
      sourceKey,
      bins,
      totalMs,
      updatedAt: heatmap.updatedAt,
    };
  }

  return Object.fromEntries(
    Object.entries(heatmaps)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, 12),
  );
}

function isRecordShape(value: unknown): value is PaperHistoryRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PaperHistoryRecord).workspaceId === 'string' &&
      typeof (value as PaperHistoryRecord).lastOpenedAt === 'number',
  );
}

interface PaperHistoryIndexEntry {
  workspaceId: string;
  lastOpenedAt: number;
  lastUpdatedAt: number;
}

let cachedHistoryMap: Record<string, PaperHistoryRecord> | null = null;
let lastQuotaWarningAt = 0;

/** 备份恢复或测试替换 localStorage 后，丢弃内存视图。 */
export function invalidatePaperHistoryCache(): void {
  cachedHistoryMap = null;
}

function recordStorageKey(workspaceId: string): string {
  return `${PAPER_HISTORY_RECORD_PREFIX}${workspaceId}`;
}

function readJsonStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  const candidate = error as { name?: string; code?: number } | null;

  return Boolean(
    candidate &&
      (candidate.name === 'QuotaExceededError' ||
        candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        candidate.code === 22 ||
        candidate.code === 1014),
  );
}

function warnStorageQuota(message: string) {
  const now = Date.now();

  if (now - lastQuotaWarningAt < PAPER_HISTORY_QUOTA_WARNING_INTERVAL_MS) {
    return;
  }

  lastQuotaWarningAt = now;
  emitToast({
    tone: 'error',
    key: 'paper-history-storage-warning',
    duration: 12_000,
    message:
      '阅读历史存储空间已满，已清理最旧的记录；最新阅读位置可能未保存。',
    description:
      'Paper history storage is full. The oldest records were evicted; the latest reading position may not be saved.',
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PAPER_HISTORY_STORAGE_WARNING_EVENT, { detail: { message } }),
    );
  }
}

function readIndex(): PaperHistoryIndexEntry[] {
  const parsed = readJsonStorage<{ entries?: unknown }>(PAPER_HISTORY_INDEX_KEY);
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];

  return entries
    .filter(
      (entry): entry is PaperHistoryIndexEntry =>
        Boolean(
          entry &&
            typeof entry === 'object' &&
            typeof (entry as PaperHistoryIndexEntry).workspaceId === 'string' &&
            (entry as PaperHistoryIndexEntry).workspaceId,
        ),
    )
    .map((entry) => ({
      workspaceId: entry.workspaceId,
      lastOpenedAt: Number(entry.lastOpenedAt) || 0,
      lastUpdatedAt: Number(entry.lastUpdatedAt) || 0,
    }))
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
}

/**
 * 配额不足时按最久未打开的顺序淘汰，给当前写入腾出空间。
 * 被淘汰论文的正文仍在文献库，只丢失阅读位置与会话历史。
 */
function evictOldestHistoryEntries(
  protectedWorkspaceId: string,
): { entries: PaperHistoryIndexEntry[]; evictedCount: number } {
  const entries = readIndex();
  const protectedEntry = entries.find((entry) => entry.workspaceId === protectedWorkspaceId);
  const evictable = entries.filter((entry) => entry.workspaceId !== protectedWorkspaceId);
  const keepCount = Math.max(0, Math.floor(evictable.length / 2));
  const kept = evictable.slice(0, keepCount);
  const evicted = evictable.slice(keepCount);

  for (const entry of evicted) {
    if (cachedHistoryMap) delete cachedHistoryMap[entry.workspaceId];
    try {
      localStorage.removeItem(recordStorageKey(entry.workspaceId));
    } catch {}
  }

  const nextEntries = [...(protectedEntry ? [protectedEntry] : []), ...kept].sort(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt,
  );

  try {
    localStorage.setItem(
      PAPER_HISTORY_INDEX_KEY,
      JSON.stringify({ version: PAPER_HISTORY_VERSION, entries: nextEntries }),
    );
  } catch {}

  return { entries: nextEntries, evictedCount: evicted.length };
}

/** 写入单个键；配额不足时先淘汰最旧记录再重试一次。 */
function writeStorageValue(key: string, value: string, protectedWorkspaceId: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) {
      console.warn('Failed to persist paper history.', error);
      return false;
    }
  }

  const eviction = evictOldestHistoryEntries(protectedWorkspaceId);

  try {
    localStorage.setItem(key, value);
    if (eviction.evictedCount > 0) {
      warnStorageQuota(
        'Paper history storage was full and the oldest records were evicted.',
      );
    }
    return true;
  } catch (error) {
    warnStorageQuota(
      'Paper history storage is full. Older reading history was evicted; the latest position may not be saved.',
    );
    console.warn('Failed to persist paper history after eviction.', error);
    return false;
  }
}

function writeIndex(entries: PaperHistoryIndexEntry[]) {
  try {
    localStorage.setItem(
      PAPER_HISTORY_INDEX_KEY,
      JSON.stringify({
        version: PAPER_HISTORY_VERSION,
        entries: entries.slice(0, PAPER_HISTORY_MAX_RECORDS),
      }),
    );
  } catch (error) {
    console.warn('Failed to persist the paper history index.', error);
  }
}

/** 单篇记录内部的上限：会话数封顶，避免单篇论文无限增长。 */
function trimRecordForStorage(record: PaperHistoryRecord): PaperHistoryRecord {
  const normalizedSessions = record.qaSessions.map(stripSessionForHistory);
  const sessions = [...normalizedSessions]
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
    .slice(0, PAPER_HISTORY_MAX_SESSIONS)
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
  const selectedQaSessionId =
    record.selectedQaSessionId && sessions.some((session) => session.id === record.selectedQaSessionId)
      ? record.selectedQaSessionId
      : sessions[0]?.id ?? null;

  return {
    ...record,
    version: PAPER_HISTORY_VERSION,
    selectedQaSessionId,
    pdfScrollPositions: normalizePdfScrollPositions(record.pdfScrollPositions),
    pdfReadingHeatmaps: normalizePdfReadingHeatmaps(record.pdfReadingHeatmaps),
    workspaceNoteMarkdown: record.workspaceNoteMarkdown,
    annotations: record.annotations.map(stripAnnotationForHistory),
    qaSessions: sessions,
    qaMessages: undefined,
  };
}

function normalizeStoredRecord(
  workspaceId: string,
  value: unknown,
): PaperHistoryRecord | null {
  if (!isRecordShape(value)) {
    return null;
  }

  const record = value as PaperHistoryRecord;
  const legacyReadingViewMode = (record as { readingViewMode?: unknown }).readingViewMode;
  const normalizedSessions = Array.isArray(record.qaSessions)
    ? record.qaSessions
        .filter(
          (session): session is DocumentChatSession =>
            Boolean(session && typeof session === 'object' && typeof session.id === 'string'),
        )
        .map(stripSessionForHistory)
    : [];
  const legacySession = buildLegacySession(record);
  const qaSessions =
    normalizedSessions.length > 0
      ? normalizedSessions
      : legacySession
        ? [legacySession]
        : [];
  const selectedQaSessionId =
    typeof record.selectedQaSessionId === 'string' &&
    qaSessions.some((session) => session.id === record.selectedQaSessionId)
      ? record.selectedQaSessionId
      : qaSessions[0]?.id ?? null;

  return {
    ...record,
    workspaceId,
    version: PAPER_HISTORY_VERSION,
    readingViewMode:
      legacyReadingViewMode === 'pdf-only' || legacyReadingViewMode === 'pdf-annotate'
        ? 'pdf-only'
        : legacyReadingViewMode === 'pdf-compare'
          ? 'pdf-compare'
          : 'dual-pane',
    selectedQaSessionId,
    pdfScrollPositions: normalizePdfScrollPositions(
      (record as { pdfScrollPositions?: unknown }).pdfScrollPositions,
    ),
    pdfReadingHeatmaps: normalizePdfReadingHeatmaps(
      (record as { pdfReadingHeatmaps?: unknown }).pdfReadingHeatmaps,
    ),
    workspaceNoteMarkdown:
      typeof record.workspaceNoteMarkdown === 'string' ? record.workspaceNoteMarkdown : '',
    annotations: Array.isArray(record.annotations)
      ? record.annotations
          .filter(
            (annotation): annotation is PaperAnnotation =>
              Boolean(
                annotation &&
                  typeof annotation === 'object' &&
                  typeof (annotation as PaperAnnotation).id === 'string' &&
                  typeof (annotation as PaperAnnotation).blockId === 'string',
              ),
          )
          .map(stripAnnotationForHistory)
      : [],
    qaSessions,
    qaMessages: undefined,
  };
}

/** 把 v1 的单文档整表迁移为按论文分片；全部写成功后才删除旧键。 */
function migrateLegacyHistoryMap(): Record<string, PaperHistoryRecord> {
  const legacy = readJsonStorage<Record<string, unknown>>(PAPER_HISTORY_LEGACY_KEY);

  if (!legacy) {
    return {};
  }

  const migrated: Record<string, PaperHistoryRecord> = {};
  const indexEntries: PaperHistoryIndexEntry[] = [];
  let allWritten = true;

  for (const [workspaceId, value] of Object.entries(legacy)) {
    const normalizedRecord = normalizeStoredRecord(workspaceId, value);

    if (!normalizedRecord) {
      continue;
    }

    const normalized = trimRecordForStorage(normalizedRecord);

    migrated[workspaceId] = normalized;
    indexEntries.push({
      workspaceId,
      lastOpenedAt: Number(normalized.lastOpenedAt) || 0,
      lastUpdatedAt: Number(normalized.lastUpdatedAt) || 0,
    });

    if (!writeStorageValue(
      recordStorageKey(workspaceId),
      JSON.stringify(trimRecordForStorage(normalized)),
      workspaceId,
    )) {
      allWritten = false;
      break;
    }
  }

  indexEntries.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  writeIndex(indexEntries);

  if (allWritten) {
    try {
      localStorage.removeItem(PAPER_HISTORY_LEGACY_KEY);
    } catch {}
  }

  return migrated;
}

export function loadPaperHistoryMap(): Record<string, PaperHistoryRecord> {
  if (cachedHistoryMap) {
    return cachedHistoryMap;
  }

  const migrated = migrateLegacyHistoryMap();
  const nextRecords: Record<string, PaperHistoryRecord> = { ...migrated };

  for (const entry of readIndex()) {
    if (nextRecords[entry.workspaceId]) {
      continue;
    }

    const stored = readJsonStorage<unknown>(recordStorageKey(entry.workspaceId));
    const normalized = normalizeStoredRecord(entry.workspaceId, stored);

    if (normalized) {
      nextRecords[entry.workspaceId] = normalized;
    }
  }

  cachedHistoryMap = nextRecords;
  return nextRecords;
}

export function loadPaperHistory(workspaceId: string): PaperHistoryRecord | null {
  const cached = cachedHistoryMap?.[workspaceId];

  if (cached) {
    return cached;
  }

  const normalized = normalizeStoredRecord(
    workspaceId,
    readJsonStorage<unknown>(recordStorageKey(workspaceId)),
  );

  if (normalized) {
    if (cachedHistoryMap) cachedHistoryMap[workspaceId] = normalized;
    return normalized;
  }

  // 尚未迁移的旧版整表：走一次全量迁移。
  return loadPaperHistoryMap()[workspaceId] ?? null;
}

export function savePaperHistory(record: PaperHistoryRecord): PaperHistoryRecord {
  const sanitizedRecord = trimRecordForStorage(record);
  const writeSucceeded = writeStorageValue(
    recordStorageKey(record.workspaceId),
    JSON.stringify(sanitizedRecord),
    record.workspaceId,
  );

  if (writeSucceeded) {
    const entries = readIndex().filter((entry) => entry.workspaceId !== record.workspaceId);
    entries.unshift({
      workspaceId: record.workspaceId,
      lastOpenedAt: Number(record.lastOpenedAt) || Date.now(),
      lastUpdatedAt: Number(record.lastUpdatedAt) || 0,
    });
    entries.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
    writeIndex(entries);

    for (const evicted of entries.slice(PAPER_HISTORY_MAX_RECORDS)) {
      try {
        localStorage.removeItem(recordStorageKey(evicted.workspaceId));
      } catch {}
      if (cachedHistoryMap) delete cachedHistoryMap[evicted.workspaceId];
    }
  }

  if (cachedHistoryMap) {
    cachedHistoryMap[record.workspaceId] = sanitizedRecord;
  }

  return sanitizedRecord;
}

export function removePaperHistory(workspaceId: string): void {
  try {
    localStorage.removeItem(recordStorageKey(workspaceId));
  } catch {}

  writeIndex(readIndex().filter((entry) => entry.workspaceId !== workspaceId));

  if (cachedHistoryMap) {
    delete cachedHistoryMap[workspaceId];
  }
}
