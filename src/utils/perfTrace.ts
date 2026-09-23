// 渲染进程性能基线测量：localStorage 中设置 pq.perf = '1' 开启，
// 输出 [paperquay:perf] 日志；默认仅保留 Map 写入开销。
const marks = new Map<string, number>();

export function perfEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('pq.perf') === '1';
  } catch {
    return false;
  }
}

export function perfMark(name: string): void {
  marks.set(name, performance.now());
}

export function perfMeasure(label: string, startName: string): number | null {
  const start = marks.get(startName);

  if (start === undefined) {
    return null;
  }

  const elapsed = performance.now() - start;

  if (perfEnabled()) {
    console.debug(`[paperquay:perf] ${label}: ${elapsed.toFixed(1)}ms (since ${startName})`);
  }

  return elapsed;
}

// 一次性测量：同一 label 只记录一次（如首个 pagerendered），重复触发直接忽略。
export function perfMeasureOnce(label: string, startName: string): number | null {
  const doneKey = `done:${label}`;

  if (marks.has(doneKey)) {
    return null;
  }

  const elapsed = perfMeasure(label, startName);

  if (elapsed !== null) {
    marks.set(doneKey, performance.now());
  }

  return elapsed;
}
