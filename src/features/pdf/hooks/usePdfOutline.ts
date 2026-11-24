import { useCallback, useEffect, useRef, useState } from 'react';
import type { PositionedMineruBlock } from '../../../types/reader';
import type { MineruOutlineIndexItem } from '../../reader/mineruSegments.ts';
import type { PdfJsDocumentInit } from '../pdfDocumentSource';
import {
  buildMineruOutline,
  buildMineruOutlineFromIndex,
  normalizePdfOutline,
  type PdfJsOutlineNode,
  type ReaderOutlineItem,
} from '../pdfOutline.ts';

const PDF_OUTLINE_COLLAPSED_STORAGE_PREFIX = 'paperquay-pdf-outline-collapsed-v1:';

type LocaleText = (zh: string, en: string) => string;
// pdfjs-dist 的运行时句柄与官方 .d.ts 存在差异，只在边界处集中用别名标注。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs 运行时 API 与类型声明不一致
type PdfJsLoose = any;

type MutableRef<T> = { current: T };

export type PdfSidebarTab = 'thumbnails' | 'outline';

interface UsePdfOutlineOptions {
  blocks: PositionedMineruBlock[];
  currentPageRef: MutableRef<number>;
  documentInit: PdfJsDocumentInit | null;
  linkServiceRef: MutableRef<PdfJsLoose>;
  lRef: MutableRef<LocaleText>;
  mineruOutlineIndex?: readonly MineruOutlineIndexItem[] | null;
  onOutlineNavigateBlock?: (block: PositionedMineruBlock) => void;
  outlineCollapsedIds: ReadonlySet<string>;
  pageCount: number;
  pdfDocumentRef: MutableRef<PdfJsLoose>;
  scrollToPage: (pageIndex: number, behavior?: ScrollBehavior) => void;
  setOutlineCollapsedIds: (
    value: Set<string> | ((current: Set<string>) => Set<string>),
  ) => void;
  sidebarTab: PdfSidebarTab;
  sourceSignatureRef: MutableRef<string>;
  thumbnailsCollapsed: boolean;
}

export function loadOutlineCollapsedIds(signature: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${PDF_OUTLINE_COLLAPSED_STORAGE_PREFIX}${signature}`);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

export function persistOutlineCollapsedIds(signature: string, ids: ReadonlySet<string>) {
  if (!signature) {
    return;
  }
  try {
    window.localStorage.setItem(
      `${PDF_OUTLINE_COLLAPSED_STORAGE_PREFIX}${signature}`,
      JSON.stringify([...ids]),
    );
  } catch {
    // 存储失败仅影响展开状态记忆
  }
}

/** 解析 PDF 原生目录 destination 的 0-based 页码；失败返回 null（仅影响当前位置高亮） */
async function resolveOutlineDestinationPageIndex(
  pdfDocument: { getDestination?: (id: string) => Promise<unknown>; getPageIndex?: (ref: unknown) => Promise<number> },
  destination: unknown,
): Promise<number | null> {
  if (destination == null) {
    return null;
  }
  try {
    let explicit: unknown = destination;
    if (typeof destination === 'string') {
      explicit = await pdfDocument.getDestination?.(destination);
    }
    if (!Array.isArray(explicit) || explicit.length === 0) {
      return null;
    }
    const ref: unknown = explicit[0];
    if (typeof ref === 'number' && Number.isFinite(ref)) {
      return ref;
    }
    if (ref && typeof ref === 'object' && pdfDocument.getPageIndex) {
      const pageIndex = await pdfDocument.getPageIndex(ref);
      return Number.isFinite(pageIndex) ? pageIndex : null;
    }
  } catch {
    // 命名目标缺失等情况静默降级
  }
  return null;
}

export function usePdfOutline({
  blocks,
  currentPageRef,
  documentInit,
  linkServiceRef,
  lRef,
  mineruOutlineIndex,
  onOutlineNavigateBlock,
  pageCount,
  pdfDocumentRef,
  scrollToPage,
  setOutlineCollapsedIds,
  sidebarTab,
  sourceSignatureRef,
  thumbnailsCollapsed,
}: UsePdfOutlineOptions) {
  const [outlineItems, setOutlineItems] = useState<ReaderOutlineItem[] | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState('');
  // 仅作 canGoBack 的重渲染信号；真实栈在 outlineBackStackRef
  const [outlineBackCount, setOutlineBackCount] = useState(0);
  const blocksRef = useRef<PositionedMineruBlock[]>(blocks);
  const onOutlineNavigateBlockRef = useRef(onOutlineNavigateBlock);
  const outlineRequestTokenRef = useRef(0);
  const outlineBackStackRef = useRef<number[]>([]);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    onOutlineNavigateBlockRef.current = onOutlineNavigateBlock;
  }, [onOutlineNavigateBlock]);

  // 文档切换：清空目录数据/返回栈，等下次展开目录页签时按新文档重建
  useEffect(() => {
    outlineRequestTokenRef.current += 1;
    outlineBackStackRef.current = [];
    setOutlineBackCount(0);
    setOutlineItems(null);
    setOutlineLoading(false);
    setOutlineError('');
  }, [documentInit]);

  // 目录懒加载：首次展开「目录」页签才读取 outline，失败回退 MinerU 标题块
  useEffect(() => {
    if (sidebarTab !== 'outline' || thumbnailsCollapsed || pageCount <= 0) {
      return;
    }
    if (outlineItems !== null) {
      return;
    }
    const pdfDocument = pdfDocumentRef.current;
    if (!pdfDocument) {
      return;
    }

    const token = ++outlineRequestTokenRef.current;
    setOutlineLoading(true);
    setOutlineError('');

    void (async () => {
      let items: ReaderOutlineItem[] = [];
      let usedMineruFallback = false;

      try {
        const rawOutline = (await pdfDocument.getOutline?.()) ?? null;
        items = normalizePdfOutline((rawOutline ?? []) as PdfJsOutlineNode[]);
      } catch {
        items = [];
      }

      if (items.length === 0) {
        if (mineruOutlineIndex && mineruOutlineIndex.length > 0) {
          items = buildMineruOutlineFromIndex(mineruOutlineIndex);
          if (items.length > 0) {
            usedMineruFallback = true;
          }
        } else {
          const mineruItems = buildMineruOutline(blocksRef.current);
          if (mineruItems.length > 0) {
            items = mineruItems;
            usedMineruFallback = true;
          }
        }
      }

      if (token !== outlineRequestTokenRef.current) {
        return;
      }
      setOutlineItems(items);
      setOutlineLoading(false);

      // 懒解析原生目录页码供「当前位置」高亮；分批让出主线程，失败仅影响高亮
      if (usedMineruFallback || items.length === 0) {
        return;
      }
      const flat: ReaderOutlineItem[] = [];
      const collect = (list: ReaderOutlineItem[]) => {
        for (const item of list) {
          flat.push(item);
          collect(item.children);
        }
      };
      collect(items);
      let processed = 0;
      for (const item of flat) {
        if (token !== outlineRequestTokenRef.current) {
          return;
        }
        if (item.destination != null && typeof item.pageIndex !== 'number') {
          const resolved = await resolveOutlineDestinationPageIndex(pdfDocument, item.destination);
          if (resolved !== null) {
            item.pageIndex = resolved;
          }
        }
        processed += 1;
        if (processed % 25 === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }
      if (token !== outlineRequestTokenRef.current) {
        return;
      }
      setOutlineItems((current) => (current ? [...current] : current));
    })();
  }, [sidebarTab, thumbnailsCollapsed, pageCount, outlineItems]);

  // MinerU 章节索引或结构块异步到达：PDF 无原生目录时，章节索引到达立即构建目录，无需等待正文块全部渲染
  useEffect(() => {
    if (outlineItems === null || outlineItems.length > 0) {
      return;
    }
    if (mineruOutlineIndex && mineruOutlineIndex.length > 0) {
      const items = buildMineruOutlineFromIndex(mineruOutlineIndex);
      if (items.length > 0) {
        setOutlineItems(items);
        return;
      }
    }
    if (blocks.length > 0) {
      const mineruItems = buildMineruOutline(blocks);
      if (mineruItems.length > 0) {
        setOutlineItems(mineruItems);
      }
    }
  }, [blocks, mineruOutlineIndex, outlineItems]);

  const handleOutlineNavigate = useCallback(
    (item: ReaderOutlineItem) => {
      // 记录返回位置（1-based 页），上限 50 条
      const snapshot = Math.max(1, currentPageRef.current);
      const stack = outlineBackStackRef.current;
      if (stack[stack.length - 1] !== snapshot) {
        stack.push(snapshot);
        if (stack.length > 50) {
          stack.shift();
        }
        setOutlineBackCount(stack.length);
      }

      if (item.source === 'mineru-heading') {
        const block = item.blockId
          ? blocksRef.current.find((entry) => entry.blockId === item.blockId)
          : undefined;
        if (block && onOutlineNavigateBlockRef.current) {
          onOutlineNavigateBlockRef.current(block);
          return;
        }
        if (typeof item.pageIndex === 'number' && item.pageIndex >= 0) {
          scrollToPage(item.pageIndex);
        }
        return;
      }

      const linkService = linkServiceRef.current;
      if (linkService && item.destination != null) {
        try {
          void Promise.resolve(linkService.goToDestination(item.destination)).catch(() => {
            setOutlineError(lRef.current('无法跳转到该目录位置', 'Unable to navigate to this outline entry'));
          });
        } catch {
          setOutlineError(lRef.current('无法跳转到该目录位置', 'Unable to navigate to this outline entry'));
        }
        return;
      }
      if (typeof item.pageIndex === 'number' && item.pageIndex >= 0) {
        scrollToPage(item.pageIndex);
      }
    },
    [scrollToPage],
  );

  const handleOutlineGoBack = useCallback(() => {
    const stack = outlineBackStackRef.current;
    const page = stack.pop();
    if (typeof page !== 'number') {
      return;
    }
    setOutlineBackCount(stack.length);
    scrollToPage(Math.max(0, page - 1), 'auto');
  }, [scrollToPage]);

  const handleOutlineToggleCollapsed = useCallback((id: string) => {
    setOutlineCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persistOutlineCollapsedIds(sourceSignatureRef.current, next);
      return next;
    });
  }, []);

  return {
    handleOutlineGoBack,
    handleOutlineNavigate,
    handleOutlineToggleCollapsed,
    outlineBackCount,
    outlineError,
    outlineItems,
    outlineLoading,
  };
}
