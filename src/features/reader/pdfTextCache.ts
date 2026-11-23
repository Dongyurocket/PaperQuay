/**
 * PDF 文本提取的按身份缓存。
 *
 * 同一 workspaceId 内切换原始版/批注版/项目 PDF 时，旧 PDF 的在途提取
 * promise 不能被新 PDF 复用；旧结果返回后也不能回写共享缓存。把「缓存键 +
 * 在途请求身份」封装在这里，组件只按当前 cacheKey 取值。
 */

export interface PdfTextCacheEntry {
  key: string;
  text: string;
}

export interface PdfTextPendingEntry {
  key: string;
  promise: Promise<string>;
}

export interface PdfTextCache {
  getCached(key: string): string | null;
  getPending(key: string): Promise<string> | null;
  start(key: string, load: () => Promise<string>): Promise<string>;
  /** PDF 身份变化时调用：旧的在途结果之后一律丢弃。 */
  invalidate(): void;
  peekPendingKey(): string | null;
  peekCachedKey(): string | null;
}

export function createPdfTextCache(): PdfTextCache {
  let cached: PdfTextCacheEntry | null = null;
  let pending: PdfTextPendingEntry | null = null;

  return {
    getCached(key: string): string | null {
      return cached?.key === key ? cached.text : null;
    },

    getPending(key: string): Promise<string> | null {
      return pending?.key === key ? pending.promise : null;
    },

    start(key: string, load: () => Promise<string>): Promise<string> {
      const entry: PdfTextPendingEntry = {
        key,
        promise: Promise.resolve(''),
      };
      pending = entry;
      entry.promise = load()
        .then((text) => {
          // 只有仍是当前请求时才写缓存；被新 PDF 取代的结果直接丢弃。
          if (pending === entry) {
            cached = { key, text };
          }
          return text;
        })
        .finally(() => {
          if (pending === entry) {
            pending = null;
          }
        });
      return entry.promise;
    },

    invalidate(): void {
      pending = null;
    },

    peekPendingKey(): string | null {
      return pending?.key ?? null;
    },

    peekCachedKey(): string | null {
      return cached?.key ?? null;
    },
  };
}
