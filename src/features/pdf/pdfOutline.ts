import type { PositionedMineruBlock } from '../../types/reader.ts';
import { extractTextFromMineruBlock } from '../../services/mineru.ts';

export type ReaderOutlineSource = 'pdf-outline' | 'mineru-heading';

export interface ReaderOutlineItem {
  id: string;
  title: string;
  /** 1-based 层级；未知层级平铺为 depth=1 */
  depth: number;
  source: ReaderOutlineSource;
  children: ReaderOutlineItem[];
  /** PDF 原生 destination（字符串命名目标或显式数组），原样保留给 goToDestination */
  destination?: unknown;
  /** 0-based 页码；原生目录的命名目标按需解析后填充 */
  pageIndex?: number;
  /** MinerU 回退来源的结构块 ID */
  blockId?: string;
}

export interface PdfJsOutlineNode {
  title?: unknown;
  dest?: unknown;
  items?: unknown;
}

const MAX_OUTLINE_ITEMS = 2000;
const MAX_OUTLINE_DEPTH = 9;

function normalizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * 规范化 PDF.js getOutline() 输出。destination 原样保留，
 * 页码解析按需进行（见 PdfViewer 内的懒解析），避免打开文献时遍历所有目标。
 */
export function normalizePdfOutline(nodes: PdfJsOutlineNode[] | null | undefined): ReaderOutlineItem[] {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const roots: ReaderOutlineItem[] = [];
  let counter = 0;

  const walk = (list: PdfJsOutlineNode[], depth: number, parent: ReaderOutlineItem[] | null): boolean => {
    for (const node of list) {
      if (counter >= MAX_OUTLINE_ITEMS) {
        return false;
      }

      if (!node || typeof node !== 'object') {
        continue;
      }

      const title = normalizeTitle(node.title);
      const rawItems = Array.isArray(node.items) ? (node.items as PdfJsOutlineNode[]) : [];
      if (!title && rawItems.length === 0) {
        continue;
      }

      counter += 1;
      const item: ReaderOutlineItem = {
        id: `pdf-outline-${counter}`,
        title: title || 'Untitled',
        depth: Math.min(depth, MAX_OUTLINE_DEPTH),
        source: 'pdf-outline',
        children: [],
        destination: node.dest ?? undefined,
      };

      (parent ?? roots).push(item);

      if (rawItems.length > 0) {
        if (!walk(rawItems, depth + 1, item.children)) {
          return false;
        }
      }
    }

    return true;
  };

  walk(nodes, 1, null);
  return roots;
}

function readMineruHeadingLevel(block: PositionedMineruBlock): number | null {
  const content = block.content;
  if (!content || typeof content !== 'object') {
    return null;
  }

  const raw = (content as Record<string, unknown>).text_level;
  const level = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(level) || level <= 0) {
    return null;
  }

  return Math.min(Math.round(level), MAX_OUTLINE_DEPTH);
}

/**
 * 从 MinerU 标题块构建目录。text_level 已知时按层级嵌套，未知层级平铺；
 * 空标题块跳过。blockId 按页/块序号生成，仅对当前解析版本有效。
 */
export function buildMineruOutline(blocks: PositionedMineruBlock[]): ReaderOutlineItem[] {
  const roots: ReaderOutlineItem[] = [];
  // stack[i] 存放 depth=i+1 的最近节点
  const stack: ReaderOutlineItem[] = [];
  let counter = 0;

  for (const block of blocks) {
    if (block.type !== 'title') {
      continue;
    }

    const title = normalizeTitle(extractTextFromMineruBlock(block));
    if (!title) {
      continue;
    }

    if (counter >= MAX_OUTLINE_ITEMS) {
      break;
    }

    counter += 1;
    const level = readMineruHeadingLevel(block);
    const item: ReaderOutlineItem = {
      id: `mineru-heading-${block.blockId}`,
      title,
      depth: level ?? 1,
      source: 'mineru-heading',
      children: [],
      pageIndex: block.pageIndex,
      blockId: block.blockId,
    };

    if (level === null) {
      // 未知层级平铺到根
      roots.push(item);
      stack.length = 0;
      continue;
    }

    while (stack.length >= level) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    (parent ? parent.children : roots).push(item);
    stack.push(item);
  }

  return roots;
}

export function countOutlineItems(items: ReaderOutlineItem[]): number {
  let total = 0;
  const walk = (list: ReaderOutlineItem[]) => {
    for (const item of list) {
      total += 1;
      walk(item.children);
    }
  };
  walk(items);
  return total;
}

export interface FlatOutlineEntry {
  item: ReaderOutlineItem;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

/** 展开状态拍平为可见行，供窗口化/列表渲染 */
export function flattenOutline(
  items: ReaderOutlineItem[],
  collapsedIds: ReadonlySet<string>,
): FlatOutlineEntry[] {
  const rows: FlatOutlineEntry[] = [];
  const walk = (list: ReaderOutlineItem[], depth: number) => {
    for (const item of list) {
      const hasChildren = item.children.length > 0;
      const collapsed = collapsedIds.has(item.id);
      rows.push({ item, depth, hasChildren, collapsed });
      if (hasChildren && !collapsed) {
        walk(item.children, depth + 1);
      }
    }
  };
  walk(items, 1);
  return rows;
}

/** 标题搜索：保留命中项及其祖先，搜索时忽略折叠状态 */
export function filterOutline(
  items: ReaderOutlineItem[],
  query: string,
): ReaderOutlineItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items;
  }

  const walk = (list: ReaderOutlineItem[]): ReaderOutlineItem[] => {
    const kept: ReaderOutlineItem[] = [];
    for (const item of list) {
      const children = walk(item.children);
      if (item.title.toLowerCase().includes(normalized) || children.length > 0) {
        kept.push(children === item.children ? item : { ...item, children });
      }
    }
    return kept;
  };

  return walk(items);
}

/**
 * 当前位置：pageIndex <= currentPageIndex 的最后一项（先序遍历， deepest 优先）。
 * pageIndex 未解析的原生目录项不参与。
 */
export function findActiveOutlineId(
  items: ReaderOutlineItem[],
  currentPageIndex: number,
): string | null {
  let activeId: string | null = null;

  const walk = (list: ReaderOutlineItem[]) => {
    for (const item of list) {
      if (typeof item.pageIndex === 'number' && item.pageIndex <= currentPageIndex) {
        activeId = item.id;
      }
      walk(item.children);
    }
  };

  walk(items);
  return activeId;
}

/** 收集所有节点 ID（用于「全部展开」等场景） */
export function collectOutlineIds(items: ReaderOutlineItem[]): string[] {
  const ids: string[] = [];
  const walk = (list: ReaderOutlineItem[]) => {
    for (const item of list) {
      ids.push(item.id);
      walk(item.children);
    }
  };
  walk(items);
  return ids;
}
