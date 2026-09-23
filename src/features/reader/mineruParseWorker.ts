import { parseMineruPages } from '../../services/mineru.ts';
import type { MineruPage } from '../../types/reader.ts';
import {
  MINERU_PARSE_PAGE_BATCH,
  type MineruDocumentMetadata,
  type MineruOutlineIndexItem,
  splitMineruPagesIntoParts,
} from './mineruSegments.ts';

interface WorkerResponse {
  id: number;
  ok: boolean;
  done?: boolean;
  pages?: MineruPage[];
  metadata?: MineruDocumentMetadata;
  outlineIndex?: MineruOutlineIndexItem[];
  segmentIndex?: number;
  totalSegments?: number;
  error?: string;
}

export interface MineruParseProgressEvent {
  metadata?: MineruDocumentMetadata;
  outlineIndex?: MineruOutlineIndexItem[];
  newPages: MineruPage[];
  allPagesSoFar: MineruPage[];
  segmentIndex: number;
  totalSegments: number;
  done: boolean;
}

export interface ParseMineruOffThreadOptions {
  sourcePath?: string;
  onProgress?: (event: MineruParseProgressEvent) => void;
  onOutlineIndex?: (outlineIndex: MineruOutlineIndexItem[], metadata: MineruDocumentMetadata) => void;
  onSegment?: (
    segmentPages: MineruPage[],
    progress: {
      segmentIndex: number;
      totalSegments: number;
      done: boolean;
      allPagesSoFar: MineruPage[];
    },
  ) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  {
    pages: MineruPage[];
    metadata?: MineruDocumentMetadata;
    outlineIndex?: MineruOutlineIndexItem[];
    options?: ParseMineruOffThreadOptions;
    resolve: (pages: MineruPage[]) => void;
    reject: (error: Error) => void;
  }
>();

function failAll(error: Error) {
  for (const entry of pending.values()) {
    entry.reject(error);
  }
  pending.clear();
  worker = null;
}

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null;
  }

  if (worker) {
    return worker;
  }

  try {
    worker = new Worker(new URL('./mineruParse.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return null;
  }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message?.id);
    if (!entry) {
      return;
    }

    if (!message.ok) {
      pending.delete(message.id);
      entry.reject(new Error(message.error || 'MinerU JSON 解析失败'));
      return;
    }

    if (message.metadata || message.outlineIndex) {
      if (message.metadata) entry.metadata = message.metadata;
      if (message.outlineIndex) entry.outlineIndex = message.outlineIndex;
      try {
        entry.options?.onOutlineIndex?.(
          entry.outlineIndex ?? [],
          entry.metadata ?? { pageCount: 0, blockCount: 0 },
        );
      } catch (err) {
        console.error('Error in onOutlineIndex callback:', err);
      }
    }

    const hasNewPages = Array.isArray(message.pages) && message.pages.length > 0;
    if (hasNewPages) {
      entry.pages.push(...message.pages!);
      try {
        entry.options?.onSegment?.(message.pages!, {
          segmentIndex: message.segmentIndex ?? 0,
          totalSegments: message.totalSegments ?? 1,
          done: Boolean(message.done),
          allPagesSoFar: entry.pages,
        });
      } catch (err) {
        console.error('Error in onSegment callback:', err);
      }
    }

    try {
      entry.options?.onProgress?.({
        metadata: entry.metadata,
        outlineIndex: entry.outlineIndex,
        newPages: message.pages ?? [],
        allPagesSoFar: entry.pages,
        segmentIndex: message.segmentIndex ?? 0,
        totalSegments: message.totalSegments ?? 1,
        done: Boolean(message.done),
      });
    } catch (err) {
      console.error('Error in onProgress callback:', err);
    }

    if (message.done) {
      pending.delete(message.id);
      entry.resolve(entry.pages);
    }
  };

  worker.onerror = () => {
    failAll(new Error('MinerU 解析 Worker 失败，已改在当前线程解析。'));
  };

  return worker;
}

export function parseMineruPagesOffThread(
  payload: string | unknown,
  options?: ParseMineruOffThreadOptions,
): Promise<MineruPage[]> {
  const jsonText = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  const current = getWorker();
  if (!current) {
    const pages = parseMineruPages(payload);
    const parts = splitMineruPagesIntoParts(pages, MINERU_PARSE_PAGE_BATCH, options?.sourcePath);
    try {
      options?.onOutlineIndex?.(parts.outlineIndex, parts.metadata);
      for (const seg of parts.segments) {
        const pagesSoFar = pages.slice(0, seg.startPageIndex + seg.pageCount);
        options?.onSegment?.(seg.pages, {
          segmentIndex: seg.segmentIndex,
          totalSegments: seg.totalSegments,
          done: seg.done,
          allPagesSoFar: pagesSoFar,
        });
        options?.onProgress?.({
          metadata: parts.metadata,
          outlineIndex: parts.outlineIndex,
          newPages: seg.pages,
          allPagesSoFar: pagesSoFar,
          segmentIndex: seg.segmentIndex,
          totalSegments: seg.totalSegments,
          done: seg.done,
        });
      }
    } catch (callbackErr) {
      console.error('Error in synchronous mineru fallback callbacks:', callbackErr);
    }
    return Promise.resolve(pages);
  }

  const id = nextId;
  nextId += 1;

  return new Promise((resolve, reject) => {
    pending.set(id, {
      pages: [],
      options,
      resolve,
      reject,
    });
    try {
      current.postMessage({ id, jsonText, sourcePath: options?.sourcePath });
    } catch (error) {
      pending.delete(id);
      resolve(parseMineruPages(jsonText));
      void error;
    }
  });
}

export async function parseMineruDocumentOffThread(
  payload: string | unknown,
  options?: ParseMineruOffThreadOptions,
): Promise<{
  metadata: MineruDocumentMetadata;
  outlineIndex: MineruOutlineIndexItem[];
  pages: MineruPage[];
}> {
  let capturedMetadata: MineruDocumentMetadata | undefined;
  let capturedOutline: MineruOutlineIndexItem[] | undefined;

  const pages = await parseMineruPagesOffThread(payload, {
    ...options,
    onOutlineIndex: (outline, meta) => {
      capturedOutline = outline;
      capturedMetadata = meta;
      options?.onOutlineIndex?.(outline, meta);
    },
  });

  const metadata = capturedMetadata ?? {
    pageCount: pages.length,
    blockCount: pages.reduce((acc, p) => acc + (Array.isArray(p) ? p.length : 0), 0),
    sourcePath: options?.sourcePath,
  };

  const outlineIndex = capturedOutline ?? splitMineruPagesIntoParts(pages, MINERU_PARSE_PAGE_BATCH).outlineIndex;

  return {
    metadata,
    outlineIndex,
    pages,
  };
}
