export const READER_MOUNTED_TAB_LIMIT = 2;

/**
 * 默认阅读器全局内存预算（字节）：
 * - 默认总预算 256 MB，可保证 2 个标签页渲染与必要缓存稳定常驻
 * - PDF 文档缓存预算 96 MB（可支撑 5-8 篇文献常驻而无需重复重新解析 PDF.js 实例）
 * - 裁剪图切片缓存预算 32 MB
 */
export const DEFAULT_READER_TOTAL_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
export const DEFAULT_PDF_DOC_CACHE_BUDGET_BYTES = 96 * 1024 * 1024;
export const DEFAULT_CROP_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;

/**
 * PDF.js 文档对象内存开销保守估算：
 * 基础开销 4 MB（xref 表、catalog、Worker 通信与初始字体表），每页保守按 128 KB 计入已缓存页与流式数据。
 */
export function estimatePdfDocumentBytes(doc?: { numPages?: number } | null): number {
  if (!doc) {
    return 0;
  }
  const pages = typeof doc.numPages === 'number' && Number.isFinite(doc.numPages)
    ? Math.max(1, Math.floor(doc.numPages))
    : 1;
  const baseBytes = 4 * 1024 * 1024; // 4 MB
  const perPageBytes = 128 * 1024; // 128 KB
  return baseBytes + pages * perPageBytes;
}

/**
 * MinerU 解析数据（mineruPages / flatBlocks）内存开销保守估算：
 * 包含块对象结构基础开销（384 字节）+ 文本字符（UTF-16 每个字符 2 字节）+ 每页开销（512 字节）。
 */
export function estimateMineruParseBytes(
  input?:
    | readonly any[]
    | { pages?: readonly any[] | null; flatBlocks?: readonly any[] | null }
    | null,
): number {
  if (!input) {
    return 0;
  }

  let totalBytes = 0;

  if (Array.isArray(input)) {
    // 可能是 MineruPage[] 或 PositionedMineruBlock[]
    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray((item as any).blocks)) {
        // 是 MineruPage
        totalBytes += 512;
        for (const block of (item as any).blocks) {
          totalBytes += estimateBlockBytes(block);
        }
      } else {
        // 是单个块
        totalBytes += estimateBlockBytes(item);
      }
    }
    return totalBytes;
  }

  const container = input as { pages?: readonly any[] | null; flatBlocks?: readonly any[] | null };
  if (Array.isArray(container.pages)) {
    for (const page of container.pages) {
      totalBytes += 512;
      if (Array.isArray(page?.blocks)) {
        for (const block of page.blocks) {
          totalBytes += estimateBlockBytes(block);
        }
      }
    }
  } else if (Array.isArray(container.flatBlocks)) {
    for (const block of container.flatBlocks) {
      totalBytes += estimateBlockBytes(block);
    }
  }

  return totalBytes;
}

function estimateBlockBytes(block: any): number {
  if (!block || typeof block !== 'object') {
    return 0;
  }
  const structBytes = 384;
  let textBytes = 0;
  if (typeof block.text === 'string') {
    textBytes = block.text.length * 2;
  } else if (block.content && typeof block.content === 'object' && typeof block.content.text === 'string') {
    textBytes = block.content.text.length * 2;
  }
  return structBytes + textBytes;
}

/**
 * 裁剪图与缩略图 Data URL 内存估算：
 * 将 Base64 负载换算为实际图像二进制大小（约 75%），并保守计入其 V8 字符串自身开销。
 */
export function estimateDataUrlBytes(dataUrl?: string | null): number {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return 0;
  }

  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    return dataUrl.length * 2;
  }

  const base64Len = Math.max(0, dataUrl.length - commaIndex - 1);
  const binaryBytes = Math.floor(base64Len * 0.75);
  const stringBytes = dataUrl.length * 2;
  return binaryBytes + stringBytes;
}

/**
 * 缩略图字节估算（与 Data URL 图像一致，提供显式命名保持方案语义一致）。
 */
export function estimateThumbnailBytes(dataUrl?: string | null): number {
  return estimateDataUrlBytes(dataUrl);
}

export interface ByteCacheEntryOptions<T> {
  bytes?: number;
  onEvict?: (value: T, key: string) => void;
  pinned?: boolean;
}

interface InternalCacheEntry<T> {
  key: string;
  value: T;
  bytes: number;
  onEvict?: (value: T, key: string) => void;
  refCount: number;
  pinned: boolean;
}

/**
 * 统一的按字节预算 LRU 缓存淘汰器：
 * - 超预算时按最久未使用（LRU）顺序淘汰；
 * - 明确引用所有权：被借用（refCount > 0 或 pinned === true）的对象在淘汰时被安全跳过，绝不销毁；
 * - 淘汰时触发 onEvict 回调（如执行 PDF.js 的 destroy/cleanup 或丢弃外部句柄）。
 */
export class ByteBudgetLruCache<T> {
  private maxBytes: number;
  private currentBytes = 0;
  private readonly entries = new Map<string, InternalCacheEntry<T>>();
  private readonly computeDefaultBytes?: (value: T, key: string) => number;

  constructor(options: {
    maxBytes: number;
    computeBytes?: (value: T, key: string) => number;
  }) {
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes));
    this.computeDefaultBytes = options.computeBytes;
  }

  getMaxBytes(): number {
    return this.maxBytes;
  }

  setMaxBytes(maxBytes: number): void {
    this.maxBytes = Math.max(1, Math.floor(maxBytes));
    this.evictExcess();
  }

  getCurrentBytes(): number {
    return this.currentBytes;
  }

  size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    // 移至末尾表示最近访问
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  peek(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }

  set(key: string, value: T, options?: ByteCacheEntryOptions<T>): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.currentBytes -= existing.bytes;
      this.entries.delete(key);
    }

    const bytes = options?.bytes ??
      (this.computeDefaultBytes ? this.computeDefaultBytes(value, key) : 0);

    const safeBytes = Math.max(0, Math.floor(bytes));

    const entry: InternalCacheEntry<T> = {
      key,
      value,
      bytes: safeBytes,
      onEvict: options?.onEvict ?? existing?.onEvict,
      refCount: existing?.refCount ?? 0,
      pinned: options?.pinned ?? existing?.pinned ?? false,
    };

    this.entries.set(key, entry);
    this.currentBytes += safeBytes;

    this.evictExcess();
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }
    this.entries.delete(key);
    this.currentBytes -= entry.bytes;
    try {
      entry.onEvict?.(entry.value, key);
    } catch (err) {
      console.error('Error during cache entry onEvict:', err);
    }
    return true;
  }

  clear(): void {
    for (const [key, entry] of this.entries) {
      try {
        entry.onEvict?.(entry.value, key);
      } catch (err) {
        console.error('Error during cache clear onEvict:', err);
      }
    }
    this.entries.clear();
    this.currentBytes = 0;
  }

  /**
   * 借用对象：增加引用计数，返回对应 release 函数。
   * 被借用期间（refCount > 0），即使内存超预算也不会被淘汰与销毁。
   */
  acquire(key: string): () => void {
    this.retain(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(key);
    };
  }

  retain(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.refCount += 1;
    }
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (entry && entry.refCount > 0) {
      entry.refCount -= 1;
      if (this.currentBytes > this.maxBytes) {
        this.evictExcess();
      }
    }
  }

  isPinned(key: string): boolean {
    const entry = this.entries.get(key);
    return Boolean(entry && (entry.pinned || entry.refCount > 0));
  }

  setPinned(key: string, pinned: boolean): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.pinned = pinned;
      if (!pinned && this.currentBytes > this.maxBytes) {
        this.evictExcess();
      }
    }
  }

  /**
   * 检查是否超出预算并按 LRU 顺序淘汰未被借用的条目。
   * 返回淘汰的条目数。
   */
  evictExcess(): number {
    if (this.currentBytes <= this.maxBytes) {
      return 0;
    }

    let evictedCount = 0;
    // Map 按插入与更新顺序遍历，最久未访问的在最前面
    for (const [key, entry] of this.entries) {
      if (this.currentBytes <= this.maxBytes) {
        break;
      }
      // 被借用或 pinned 的条目安全保留，跳过淘汰
      if (entry.refCount > 0 || entry.pinned) {
        continue;
      }

      this.entries.delete(key);
      this.currentBytes -= entry.bytes;
      evictedCount += 1;

      try {
        entry.onEvict?.(entry.value, key);
      } catch (err) {
        console.error('Error during cache evict onEvict:', err);
      }
    }

    return evictedCount;
  }
}

export function chooseMountedReaderTabIds(input: {
  readerTabIds: readonly string[];
  activeTabId: string;
  recentTabIds?: readonly string[];
  busyTabIds?: readonly string[];
  tabByteEstimates?: Record<string, number>;
  maxTotalBytes?: number;
}): string[] {
  const readerIds = input.readerTabIds.filter((id) => id.trim());
  const reader = new Set(readerIds);
  const mounted = new Set<string>();

  let accumulatedBytes = 0;
  const maxBytes = input.maxTotalBytes ?? DEFAULT_READER_TOTAL_MEMORY_BUDGET_BYTES;
  const getTabBytes = (id: string) => input.tabByteEstimates?.[id] ?? 0;

  if (reader.has(input.activeTabId)) {
    mounted.add(input.activeTabId);
    accumulatedBytes += getTabBytes(input.activeTabId);
  }

  for (const id of input.busyTabIds ?? []) {
    if (reader.has(id) && !mounted.has(id)) {
      mounted.add(id);
      accumulatedBytes += getTabBytes(id);
    }
  }

  for (const id of [...(input.recentTabIds ?? []), ...readerIds]) {
    if (!reader.has(id) || mounted.has(id)) {
      continue;
    }

    if (mounted.size >= READER_MOUNTED_TAB_LIMIT) {
      break;
    }

    // 若启用了字节预算，检查是否超预算（active/busy 之后）
    if (input.tabByteEstimates) {
      const tabBytes = getTabBytes(id);
      if (mounted.size > 0 && accumulatedBytes + tabBytes > maxBytes) {
        // 超出总字节预算，不再挂载其他后台标签
        break;
      }
      accumulatedBytes += tabBytes;
    }

    mounted.add(id);
  }

  return readerIds.filter((id) => mounted.has(id));
}
