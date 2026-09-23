import { parseMineruPages } from '../../services/mineru.ts';
import type { MineruPage } from '../../types/reader.ts';

interface WorkerResponse {
  id: number;
  ok: boolean;
  done?: boolean;
  pages?: MineruPage[];
  error?: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, {
  pages: MineruPage[];
  resolve: (pages: MineruPage[]) => void;
  reject: (error: Error) => void;
}>();

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

    if (Array.isArray(message.pages) && message.pages.length > 0) {
      entry.pages.push(...message.pages);
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

export function parseMineruPagesOffThread(payload: string | unknown): Promise<MineruPage[]> {
  const jsonText = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  const current = getWorker();
  if (!current) {
    return Promise.resolve(parseMineruPages(payload));
  }

  const id = nextId;
  nextId += 1;

  return new Promise((resolve, reject) => {
    pending.set(id, { pages: [], resolve, reject });
    try {
      current.postMessage({ id, jsonText });
    } catch (error) {
      pending.delete(id);
      resolve(parseMineruPages(jsonText));
      void error;
    }
  });
}
