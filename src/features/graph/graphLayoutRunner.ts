// S5-GRAPH-1: main-thread client for the fcose layout worker.
//
// The client owns one worker, correlates requests by id, and falls back to the
// injected main-thread layout whenever the worker is unavailable, crashes or
// returns an unusable payload. Neither Worker nor cytoscape is imported at
// module scope, so this file stays testable under Node.

import {
  GRAPH_LAYOUT_WORKER_PROTOCOL,
  buildFcoseLayoutOptions,
  normalizeLayoutPositions,
  parseLayoutWorkerResponse,
  type GraphForceSettings,
  type GraphLayoutEdgeInput,
  type GraphLayoutNodeInput,
  type GraphLayoutPosition,
  type GraphLayoutRequestPayload,
} from './graphLayoutMessages.ts';

export interface LayoutWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type MainThreadLayoutRunner = (
  request: GraphLayoutRequestPayload,
) => GraphLayoutPosition[] | Promise<GraphLayoutPosition[]>;

export interface GraphLayoutClientOptions {
  createWorker?: () => LayoutWorkerLike | null;
  runFallback: MainThreadLayoutRunner;
  onFallback?: (error: unknown) => void;
  timeoutMs?: number;
}

export interface GraphLayoutRequestOptions {
  forces?: GraphForceSettings;
  packComponents?: boolean;
  incremental?: boolean;
}

export interface GraphLayoutClient {
  requestLayout(
    nodes: GraphLayoutNodeInput[],
    edges: GraphLayoutEdgeInput[],
    options?: GraphLayoutRequestOptions,
  ): Promise<GraphLayoutPosition[]>;
  dispose(): void;
}

interface PendingRequest {
  resolve: (positions: GraphLayoutPosition[]) => void;
  reject: (error: Error) => void;
  request: GraphLayoutRequestPayload;
  timer: ReturnType<typeof setTimeout>;
}

function defaultCreateWorker(): LayoutWorkerLike | null {
  if (typeof Worker === 'undefined') {
    return null;
  }

  try {
    return new Worker(new URL('./graphLayout.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as LayoutWorkerLike;
  } catch {
    return null;
  }
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.trim()) return new Error(value);
  return new Error(fallback);
}

export function createGraphLayoutClient(options: GraphLayoutClientOptions): GraphLayoutClient {
  const createWorker = options.createWorker ?? defaultCreateWorker;
  // `undefined` means "not probed yet"; `null` means "worker unavailable".
  let worker: LayoutWorkerLike | null | undefined;
  let disposed = false;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();

  const runFallback = async (request: GraphLayoutRequestPayload): Promise<GraphLayoutPosition[]> => {
    try {
      const positions = normalizeLayoutPositions(await options.runFallback(request));
      if (!positions) {
        throw new Error('Main-thread layout returned invalid positions');
      }
      return positions;
    } catch (error) {
      options.onFallback?.(error);
      throw toError(error, 'Graph layout failed');
    }
  };

  const settleWithFallback = (entry: PendingRequest) => {
    void runFallback(entry.request).then(entry.resolve, entry.reject);
  };

  const handleWorkerFailure = (source: LayoutWorkerLike | null, error: unknown) => {
    // 迟到事件：旧 worker 在重建后才触发 onerror/exit，不能终止新 worker。
    if (worker !== source) return;
    if (worker) {
      try {
        worker.terminate();
      } catch {
        // The worker is already unusable; nothing else to release.
      }
      worker = undefined;
    }

    const entries = Array.from(pending.values());
    pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      options.onFallback?.(error);
      settleWithFallback(entry);
    }
  };

  const ensureWorker = (): LayoutWorkerLike | null => {
    if (disposed) return null;
    if (worker) return worker;
    // `worker === null` 表示上一次创建失败；下一次请求重试，避免一次瞬时
    // 失败把主线程布局永久钉死（也可能是 Worker 构造器暂时不可用）。

    try {
      worker = createWorker();
    } catch {
      worker = null;
    }

    if (!worker) return null;

    const currentWorker = worker;
    currentWorker.onmessage = (event) => {
      if (worker !== currentWorker) return;
      const parsed = parseLayoutWorkerResponse(event?.data);
      if (!parsed) return;

      const entry = pending.get(parsed.id);
      if (!entry) return;
      pending.delete(parsed.id);
      clearTimeout(entry.timer);

      if (parsed.ok) {
        entry.resolve(parsed.positions);
      } else {
        options.onFallback?.(new Error('error' in parsed ? parsed.error : 'Graph layout worker failed'));
        settleWithFallback(entry);
      }
    };
    currentWorker.onerror = (event) => {
      handleWorkerFailure(currentWorker, event);
    };

    return currentWorker;
  };

  return {
    requestLayout(nodes, edges, requestOptions = {}) {
      if (disposed) {
        return Promise.reject(new Error('Graph layout client has been disposed'));
      }

      const request: GraphLayoutRequestPayload = {
        nodes: Array.isArray(nodes) ? nodes : [],
        edges: Array.isArray(edges) ? edges : [],
        options: buildFcoseLayoutOptions(nodes?.length ?? 0, requestOptions.forces, {
          packComponents: requestOptions.packComponents,
          incremental: requestOptions.incremental,
        }),
      };

      const current = ensureWorker();
      if (!current) {
        return runFallback(request);
      }

      const id = nextRequestId;
      nextRequestId += 1;

      return new Promise<GraphLayoutPosition[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          handleWorkerFailure(current, new Error(`Graph layout worker timed out after ${options.timeoutMs ?? 30000}ms`));
        }, Math.max(1, options.timeoutMs ?? 30000));
        pending.set(id, { resolve, reject, request, timer });
        try {
          current.postMessage({
            id,
            protocol: GRAPH_LAYOUT_WORKER_PROTOCOL,
            request,
          });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          options.onFallback?.(error);
          settleWithFallback({ resolve, reject, request, timer });
          // 发送失败通常意味着 worker 已退出：让其他等待中的调用一起失败并在下次调用重建。
          handleWorkerFailure(current, error);
        }
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;

      if (worker) {
        try {
          worker.terminate();
        } catch {
          // Ignore teardown errors from a worker that already failed.
        }
        worker = null;
      }

      const entries = Array.from(pending.values());
      pending.clear();
      for (const entry of entries) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Graph layout client has been disposed'));
      }
    },
  };
}
