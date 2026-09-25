/**
 * 与 PaperQuay 的连接：同源 `/api/v1/*`（由加载项页面源站在进程内转发给 Office 桥）。
 *
 * 不再需要「复制连接信息」：页面和 API 同源，只要 PaperQuay 在运行就能访问；
 * 服务端靠 `X-PaperQuay-Client` 自定义头 + Host/Origin 校验挡住跨站页面（见 officeAddinHost.cjs）。
 *
 * 连接状态机：connecting → online / offline；offline 时按 1s→2s→4s→…→10s 退避重试，
 * 页面重新可见或窗口获得焦点时立即重试。
 */
import type { CitationPaperLike } from '../../../src/shared/citation/index.ts';

export const API_BASE = '/api/v1';
export const CLIENT_HEADER = 'X-PaperQuay-Client';
export const CLIENT_ID = 'word-addin/0.4.0';

export type ConnectionState = 'connecting' | 'online' | 'offline';

export interface HealthInfo {
  ok: boolean;
  apiVersion: number;
  appVersion: string;
  capabilities?: { styles?: string[]; defaultStyle?: string; writeBack?: boolean };
}

export interface WirePaper extends CitationPaperLike {
  id: string;
  title: string;
  tags?: string[];
}

export class BridgeError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface FetchLike {
  (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface BridgeClient {
  state(): ConnectionState;
  health(): HealthInfo | null;
  onChange(listener: (state: ConnectionState, health: HealthInfo | null) => void): void;
  /** 立即探测一次（UI「重试」按钮、visibilitychange）。 */
  probe(): Promise<boolean>;
  start(): void;
  stop(): void;
  searchPapers(query: string, limit?: number): Promise<{ papers: WirePaper[]; total: number }>;
  fetchPapers(ids: string[]): Promise<{ papers: WirePaper[]; missing: string[] }>;
  recordCited(payload: { documentId: string; documentTitle: string; paperIds: string[] }): Promise<void>;
}

export interface ClientOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 10000];

export function createBridgeClient(options: ClientOptions = {}): BridgeClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init as RequestInit));
  const base = (options.baseUrl ?? '') + API_BASE;
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as number));

  let current: ConnectionState = 'connecting';
  let info: HealthInfo | null = null;
  let attempt = 0;
  let timer: unknown = null;
  let running = false;
  const listeners: Array<(state: ConnectionState, health: HealthInfo | null) => void> = [];

  function setState(next: ConnectionState, health: HealthInfo | null): void {
    const changed = next !== current || health !== info;
    current = next;
    info = health;
    if (changed) for (const listener of listeners) listener(current, info);
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { [CLIENT_HEADER]: CLIENT_ID, Accept: 'application/json' };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    let response;
    try {
      response = await doFetch(base + path, { method: init.method ?? 'GET', headers, body });
    } catch (error) {
      if (running) scheduleRetry(true);
      throw new BridgeError('OFFLINE', 'PaperQuay 未运行或无法访问。', 0);
    }
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
      // 源站在但桥未就绪（文献库未打开）：视作离线，继续重试。
      if (response.status === 503 && running) scheduleRetry(true);
      throw new BridgeError(error?.code ?? 'HTTP_' + response.status, error?.message ?? `请求失败（${response.status}）`, response.status);
    }
    return payload as T;
  }

  function scheduleRetry(markOffline: boolean): void {
    if (markOffline) setState('offline', null);
    if (!running || timer !== null) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    timer = setTimer(() => {
      timer = null;
      void probe();
    }, delay);
  }

  async function probe(): Promise<boolean> {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (current !== 'online') setState('connecting', info);
    try {
      const health = await request<HealthInfo>('/health');
      attempt = 0;
      setState('online', health);
      return true;
    } catch {
      scheduleRetry(true);
      return false;
    }
  }

  return {
    state: () => current,
    health: () => info,
    onChange(listener) {
      listeners.push(listener);
    },
    probe,
    start() {
      if (running) return;
      running = true;
      void probe();
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    async searchPapers(query, limit = 30) {
      const params = `?limit=${limit}${query ? `&search=${encodeURIComponent(query)}` : ''}`;
      const result = await request<{ papers: WirePaper[]; total: number }>(`/papers${params}`);
      return { papers: Array.isArray(result?.papers) ? result.papers : [], total: result?.total ?? 0 };
    },
    async fetchPapers(ids) {
      if (ids.length === 0) return { papers: [], missing: [] };
      const papers: WirePaper[] = [];
      const missing: string[] = [];
      for (let index = 0; index < ids.length; index += 400) {
        const chunk = ids.slice(index, index + 400);
        const result = await request<{ papers: WirePaper[]; missing: string[] }>('/papers/batch', {
          method: 'POST',
          body: { ids: chunk },
        });
        papers.push(...(result?.papers ?? []));
        missing.push(...(result?.missing ?? []));
      }
      return { papers, missing };
    },
    async recordCited(payload) {
      try {
        await request('/documents/cited', { method: 'POST', body: { ...payload, source: 'office-addin' } });
      } catch (error) {
        if (error instanceof BridgeError && error.code === 'WRITE_DISABLED') return;
        throw error;
      }
    },
  };
}
