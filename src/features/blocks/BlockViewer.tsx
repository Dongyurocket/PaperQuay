import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  FilePlus2,
  Info,
  Pencil,
  RefreshCw,
  Scan,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import EmptyState from '../../components/EmptyState';
import { ContextMenu, type ContextMenuEntry } from '../../components/ContextMenu';
import { useLocaleText } from '../../i18n/uiLanguage';
import { confirmAction } from '../../ui/confirmHost';
import { toast } from '../../ui/toast';
import { IconButton } from '../../ui/button';
import { buildRenderableBlocks, extractCaptionFromMineruBlock, extractTextFromMineruBlock, extractTableHtmlFromMineruBlock, renderListMarkdownContent } from '../../services/mineru';
import { htmlTableToMarkdown } from '../../utils/markdown';
import type { BlockReparseOverrideApi } from '../../services/blockReparseOverrides';
import type {
  PdfSource,
  PositionedMineruBlock,
  TextSelectionPayload,
  TranslationDisplayMode,
  TranslationMap,
} from '../../types/reader';
import { isValidBBox } from '../../utils/bbox';
import { cn } from '../../utils/cn';
import { normalizeSelectionText } from '../../utils/text';
import {
  areVirtualWindowsEqual,
  getVirtualOffset,
  resolveVirtualWindow,
  type VirtualWindow,
} from '../../utils/virtualWindow';
import { BlockItem } from './blockViewerContent';
import { BlockReparseModal } from './BlockReparseModal';
import { ParseEditsDialog } from './ParseEditsDialog';
import {
  BLOCK_ITEM_GAP_PX,
  BLOCK_WINDOW_OVERSCAN,
  BLOCK_WINDOW_VIEWPORT_FALLBACK_PX,
  estimateBlockHeight,
} from './blockViewerWindow';

interface BlockViewerProps {
  blocks: PositionedMineruBlock[];
  mineruPath: string;
  pdfSource?: PdfSource;
  translations: TranslationMap;
  translationDisplayMode: TranslationDisplayMode;
  translationLanguageLabel: string;
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  scrollSignal: number;
  compactMode: boolean;
  showBlockMeta: boolean;
  hidePageDecorations?: boolean;
  hideToolbar?: boolean;
  smoothScroll: boolean;
  active?: boolean;
  translationBusy?: boolean;
  onBlockClick: (block: PositionedMineruBlock) => void;
  onAddBlockToNote?: (block: PositionedMineruBlock, selection: TextSelectionPayload) => void;
  onRetranslateBlock?: (block: PositionedMineruBlock) => void;
  /** AI 重解析覆盖：与翻译流程共享同一份状态。 */
  blockReparse: BlockReparseOverrideApi;
  /** 修复文本保存或恢复后触发（用于按新源文本重译该块）。 */
  onBlockReparseApplied?: (block: PositionedMineruBlock) => void;
  onTranslationDisplayModeChange?: (mode: TranslationDisplayMode) => void;
  onTextSelect?: (selection: TextSelectionPayload) => void;
}

const CONTENT_MIN_SCALE = 0.85;
const CONTENT_MAX_SCALE = 1.45;
const CONTENT_SCALE_STEP = 0.05;

function hasActiveTextSelection() {
  const selection = window.getSelection();

  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function clampContentScale(nextScale: number) {
  return Math.min(CONTENT_MAX_SCALE, Math.max(CONTENT_MIN_SCALE, Number(nextScale.toFixed(2))));
}

function getScopedSelectionPayload(container: HTMLElement | null): TextSelectionPayload | null {
  const selection = window.getSelection();

  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const text = normalizeSelectionText(selection.toString());

  if (!text) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  const targetNode =
    commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentElement : commonAncestor;

  if (!targetNode || !container.contains(targetNode)) {
    return null;
  }

  const rangeRect = range.getBoundingClientRect();
  const blockElement = targetNode instanceof Element
    ? targetNode.closest<HTMLElement>('[data-block-id]')
    : null;
  const blockId = blockElement?.dataset.blockId;
  const anchorClientX =
    rangeRect.width > 0 ? rangeRect.left + rangeRect.width / 2 : rangeRect.left;
  const anchorClientY = rangeRect.bottom;
  const anchorClientRect =
    rangeRect.width > 0 && rangeRect.height > 0
      ? {
          left: rangeRect.left,
          top: rangeRect.top,
          width: rangeRect.width,
          height: rangeRect.height,
        }
      : undefined;

  return {
    text,
    anchorClientX,
    anchorClientY,
    anchorClientRect,
    placement: 'bottom',
    blockId: blockId || undefined,
  };
}

function createBlockSelectionPayload(
  block: PositionedMineruBlock,
  text: string,
  point: { clientX: number; clientY: number },
): TextSelectionPayload {
  return {
    text,
    anchorClientX: point.clientX,
    anchorClientY: point.clientY,
    placement: 'bottom',
    blockId: block.blockId,
    pdfLocation: block.bbox
      ? {
          pageNumber: block.pageIndex + 1,
          bbox: block.bbox,
          bboxCoordinateSystem: block.bboxCoordinateSystem,
          bboxPageSize: block.bboxPageSize,
        }
      : undefined,
  };
}

function selectionBelongsToContainer(container: HTMLElement | null) {
  const selection = window.getSelection();

  if (!container || !selection) {
    return false;
  }

  if (
    (selection.anchorNode && container.contains(selection.anchorNode)) ||
    (selection.focusNode && container.contains(selection.focusNode))
  ) {
    return true;
  }

  if (selection.rangeCount === 0) {
    return false;
  }

  return container.contains(selection.getRangeAt(0).commonAncestorContainer);
}

function BlockViewer({
  blocks,
  mineruPath,
  pdfSource,
  translations,
  translationDisplayMode,
  translationLanguageLabel,
  activeBlockId,
  hoveredBlockId,
  scrollSignal,
  compactMode,
  showBlockMeta,
  hidePageDecorations = false,
  hideToolbar = false,
  smoothScroll,
  active = true,
  translationBusy = false,
  onBlockClick,
  onAddBlockToNote,
  onRetranslateBlock,
  blockReparse,
  onBlockReparseApplied,
  onTranslationDisplayModeChange,
  onTextSelect,
}: BlockViewerProps) {
  const l = useLocaleText();
  const {
    edits,
    editCount,
    staleCount,
    hiddenBlockIds,
    overrides: blockOverrides,
    storageReady,
    storageError,
  } = blockReparse;
  const visibleBlocks = useMemo(
    () => {
      const pageContentBlocks = blocks.filter(
        (block) => !block.contentSourceBlockId && !hiddenBlockIds.has(block.blockId),
      );

      return hidePageDecorations
        ? pageContentBlocks.filter(
            (block) =>
              !['page_header', 'page_footer', 'page_number', 'page_footnote'].includes(
                block.type,
              ),
          )
        : pageContentBlocks;
    },
    [blocks, hiddenBlockIds, hidePageDecorations],
  );
  const [blockWindow, setBlockWindow] = useState<VirtualWindow>(() =>
    resolveVirtualWindow({
      itemCount: visibleBlocks.length,
      getItemSize: (index) => {
        const block = visibleBlocks[index];

        if (!block) {
          return 0;
        }

        return (
          estimateBlockHeight(block, {
            scale: 1,
            compactMode,
            bilingual: translationDisplayMode === 'bilingual',
          }) + BLOCK_ITEM_GAP_PX
        );
      },
      scrollOffset: 0,
      viewportSize: BLOCK_WINDOW_VIEWPORT_FALLBACK_PX,
      overscan: BLOCK_WINDOW_OVERSCAN,
    }),
  );
  const windowedVisibleBlocks = useMemo(
    () => visibleBlocks.slice(blockWindow.startIndex, blockWindow.endIndex),
    [blockWindow.endIndex, blockWindow.startIndex, visibleBlocks],
  );
  const renderableBlocks = useMemo(
    () => buildRenderableBlocks(windowedVisibleBlocks, mineruPath),
    [mineruPath, windowedVisibleBlocks],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const heightMapRef = useRef<Record<string, number>>({});
  const itemResizeObserverRef = useRef<ResizeObserver | null>(null);
  const windowRafRef = useRef(0);
  const visibleBlocksIdentityRef = useRef(visibleBlocks);
  const lastSelectionRef = useRef<{ text: string; emittedAt: number } | null>(null);
  const selectionStartedInsideRef = useRef(false);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    block: PositionedMineruBlock;
    x: number;
    y: number;
  } | null>(null);
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);
  const [cropBlockIds, setCropBlockIds] = useState<Set<string>>(() => new Set());
  const [reparseTarget, setReparseTarget] = useState<{
    block: PositionedMineruBlock;
    initialText: string;
    currentText: string;
    mode: 'manual' | 'ai';
  } | null>(null);
  const [editsDialogOpen, setEditsDialogOpen] = useState(false);

  const resolveOriginalText = useCallback((block: PositionedMineruBlock) => {
    if (block.type === 'table') {
      // 表格以 GFM Markdown 作为编辑格式：原始 HTML 既不可直接编辑，
      // Markdown 渲染器也不会把它当表格显示。
      const caption = extractCaptionFromMineruBlock(block).trim();
      const table = htmlTableToMarkdown(extractTableHtmlFromMineruBlock(block) ?? '').trim();

      if (!table) {
        return extractTextFromMineruBlock(block);
      }

      return [caption, table].filter(Boolean).join('\n\n');
    }

    if (block.type === 'list') {
      return renderListMarkdownContent(block.content).trim() || extractTextFromMineruBlock(block);
    }

    if (block.type === 'title') {
      const title = extractTextFromMineruBlock(block).trim();

      return title ? `## ${title}` : '';
    }

    if (block.type === 'equation') {
      const math = extractTextFromMineruBlock(block).trim();

      return math && !math.startsWith('$$') ? `$$\n${math}\n$$` : math;
    }

    return extractTextFromMineruBlock(block);
  }, []);

  const handleOpenReparse = useCallback((
    block: PositionedMineruBlock,
    mode: 'manual' | 'ai' = 'manual',
  ) => {
    // AI 重析始终引用原始 OCR（含表格标记）；手动编辑则从当前生效文本开始。
    const originalText = resolveOriginalText(block);
    const currentText = blockOverrides[block.blockId] || originalText;

    setReparseTarget({
      block,
      initialText: originalText || currentText,
      currentText: currentText || originalText,
      mode,
    });
  }, [blockOverrides, resolveOriginalText]);

  const persistReparse = useCallback(async (markdown: string) => {
    if (!reparseTarget) {
      return;
    }

    await blockReparse.saveOverride(reparseTarget.block.blockId, markdown);
    onBlockReparseApplied?.(reparseTarget.block);
  }, [blockReparse, onBlockReparseApplied, reparseTarget]);
  const handleApplyReparse = useCallback(
    (markdown: string) => persistReparse(markdown),
    [persistReparse],
  );
  const handleResetReparse = useCallback(async () => {
    if (!reparseTarget) {
      return;
    }

    await blockReparse.restoreBlock(reparseTarget.block.blockId);
    onBlockReparseApplied?.(reparseTarget.block);
  }, [blockReparse, onBlockReparseApplied, reparseTarget]);
  const handleDeleteReparse = useCallback(async () => {
    if (!reparseTarget) {
      return;
    }

    await blockReparse.deleteBlock(reparseTarget.block.blockId);
  }, [blockReparse, reparseTarget]);

  const handleDeleteBlock = useCallback(async (block: PositionedMineruBlock) => {
    const confirmed = await confirmAction({
      title: l('删除这个识别块？', 'Delete this recognized block?'),
      description: l(
        '该块会从阅读、翻译和重新索引中排除，原始解析文件不会被修改，可以在工具栏的「识别结果」列表里恢复。',
        'The block will be excluded from reading, translation and re-indexing. The original parse file is not modified, and it can be restored from the "Recognition results" list in the toolbar.',
      ),
      confirmLabel: l('删除此块', 'Delete Block'),
      danger: true,
    });

    if (!confirmed) return;

    try {
      await blockReparse.deleteBlock(block.blockId);
      toast({
        tone: 'success',
        message: l('已从正文隐藏该识别块，可在「识别结果」中恢复。', 'Block hidden from the reading view; restore it from "Recognition results".'),
      });
    } catch (reason) {
      toast({
        tone: 'error',
        message: l('删除识别块失败：', 'Could not delete the block: ') + (reason instanceof Error ? reason.message : String(reason)),
      });
    }
  }, [blockReparse, l]);

  const handleToggleBlockCrop = useCallback((blockId: string) => {
    setCropBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);
  const [contentScale, setContentScale] = useState(1);
  const bilingualReading = translationDisplayMode === 'bilingual';
  const windowParamsRef = useRef({
    visibleBlocks,
    contentScale,
    compactMode,
    bilingual: bilingualReading,
  });
  windowParamsRef.current = {
    visibleBlocks,
    contentScale,
    compactMode,
    bilingual: bilingualReading,
  };

  const getItemSize = useCallback((index: number) => {
    const params = windowParamsRef.current;
    const block = params.visibleBlocks[index];

    if (!block) {
      return 0;
    }

    const measured = heightMapRef.current[block.blockId];
    const content =
      measured ??
      estimateBlockHeight(block, {
        scale: params.contentScale,
        compactMode: params.compactMode,
        bilingual: params.bilingual,
      });

    return content + (index < params.visibleBlocks.length - 1 ? BLOCK_ITEM_GAP_PX : 0);
  }, []);

  const updateListWindow = useCallback(() => {
    const scroller = listRef.current;
    const next = resolveVirtualWindow({
      itemCount: windowParamsRef.current.visibleBlocks.length,
      getItemSize,
      scrollOffset: scroller?.scrollTop ?? 0,
      viewportSize: scroller?.clientHeight || BLOCK_WINDOW_VIEWPORT_FALLBACK_PX,
      overscan: BLOCK_WINDOW_OVERSCAN,
    });

    setBlockWindow((current) => (areVirtualWindowsEqual(current, next) ? current : next));
  }, [getItemSize]);

  const scheduleListWindowUpdate = useCallback(() => {
    if (windowRafRef.current) {
      return;
    }

    windowRafRef.current = window.requestAnimationFrame(() => {
      windowRafRef.current = 0;
      updateListWindow();
    });
  }, [updateListWindow]);

  useLayoutEffect(() => {
    if (visibleBlocksIdentityRef.current !== visibleBlocks) {
      heightMapRef.current = {};
      blockRefs.current = {};
      visibleBlocksIdentityRef.current = visibleBlocks;

      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
    }

    updateListWindow();
  }, [compactMode, contentScale, translationDisplayMode, updateListWindow, visibleBlocks]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      let scrollAdjust = 0;
      const scroller = listRef.current;
      const items = windowParamsRef.current.visibleBlocks;
      const scrollTop = scroller?.scrollTop ?? 0;

      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const blockId = element.dataset.blockId;

        if (!blockId) {
          continue;
        }

        const nextHeight = element.getBoundingClientRect().height;

        if (nextHeight <= 0) {
          continue;
        }

        const index = items.findIndex((block) => block.blockId === blockId);

        if (index < 0) {
          continue;
        }

        const measuredBlock = items[index];

        if (!measuredBlock) {
          continue;
        }

        const previous = heightMapRef.current[blockId];
        const oldContent =
          previous ??
          estimateBlockHeight(measuredBlock, {
            scale: windowParamsRef.current.contentScale,
            compactMode: windowParamsRef.current.compactMode,
            bilingual: windowParamsRef.current.bilingual,
          });

        if (previous != null && Math.abs(previous - nextHeight) < 0.5) {
          continue;
        }

        const offsetBefore = getVirtualOffset(index, getItemSize);
        heightMapRef.current[blockId] = nextHeight;

        if (offsetBefore < scrollTop) {
          scrollAdjust += nextHeight - oldContent;
        }

        changed = true;
      }

      if (scrollAdjust && scroller) {
        scroller.scrollTop += scrollAdjust;
      }

      if (changed) {
        scheduleListWindowUpdate();
      }
    });

    itemResizeObserverRef.current = observer;

    for (const element of Object.values(blockRefs.current)) {
      if (element) {
        observer.observe(element);
      }
    }

    return () => {
      observer.disconnect();
      itemResizeObserverRef.current = null;
    };
  }, [getItemSize, scheduleListWindowUpdate]);

  useEffect(() => {
    const scroller = listRef.current;

    if (!scroller) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      scheduleListWindowUpdate();
    });

    observer.observe(scroller);

    return () => observer.disconnect();
  }, [scheduleListWindowUpdate, visibleBlocks.length]);

  useEffect(() => {
    return () => {
      if (windowRafRef.current) {
        window.cancelAnimationFrame(windowRafRef.current);
        windowRafRef.current = 0;
      }
    };
  }, []);

  const translatedCount = useMemo(
    () => Object.values(translations).filter((value) => value.trim()).length,
    [translations],
  );
  const hasAnyTranslations = translatedCount > 0;
  const activeDisplayMode = hasAnyTranslations ? translationDisplayMode : 'original';
  const displayModeOptions: Array<{
    mode: TranslationDisplayMode;
    label: string;
    disabled?: boolean;
  }> = [
    {
      mode: 'original',
      label: l('原文 MinerU', 'Original MinerU'),
    },
    {
      mode: 'translated',
      label: l(
        `译文 · ${translationLanguageLabel}`,
        `Translation · ${translationLanguageLabel}`,
      ),
      disabled: !hasAnyTranslations,
    },
    {
      mode: 'bilingual',
      label: l('原文 + 译文', 'Original + Translation'),
      disabled: !hasAnyTranslations,
    },
  ];

  const updateContentScale = useCallback((delta: number) => {
    setContentScale((current) => clampContentScale(current + delta));
  }, []);

  const registerBlockRef = useCallback((blockId: string, element: HTMLDivElement | null) => {
    const observer = itemResizeObserverRef.current;
    const previous = blockRefs.current[blockId];

    if (previous && previous !== element) {
      observer?.unobserve(previous);
    }

    if (element) {
      blockRefs.current[blockId] = element;
      observer?.observe(element);
      return;
    }

    delete blockRefs.current[blockId];
  }, []);

  const handleBlockContextMenu = useCallback(
    (block: PositionedMineruBlock, event: ReactMouseEvent<HTMLDivElement>) => {
      if (hasActiveTextSelection()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        block,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [onAddBlockToNote, onRetranslateBlock],
  );

  const contextMenuEntries = useMemo<ContextMenuEntry[]>(() => {
    if (!contextMenu) {
      return [];
    }

    const entries: ContextMenuEntry[] = [];

    const resolveContextMarkdown = (block: PositionedMineruBlock) => {
      const fromWindow = renderableBlocks
        .find((item) => item.block.blockId === block.blockId)
        ?.markdown.trim();

      if (fromWindow) {
        return fromWindow;
      }

      return buildRenderableBlocks([block], mineruPath)[0]?.markdown.trim() ?? '';
    };

    if (onAddBlockToNote) {
      const blockText = resolveContextMarkdown(contextMenu.block);

      entries.push({
        id: 'add-block-to-note',
        label: l('整块加入笔记', 'Add Whole Block to Note'),
        icon: <FilePlus2 className="h-4 w-4" strokeWidth={1.9} />,
        tone: 'accent',
        disabled: !blockText,
        onSelect: () => {
          if (!blockText) {
            return;
          }

          onAddBlockToNote(
            contextMenu.block,
            createBlockSelectionPayload(contextMenu.block, blockText, {
              clientX: contextMenu.x,
              clientY: contextMenu.y,
            }),
          );
        },
      });
    }

    if (onRetranslateBlock) {
      entries.push({
        id: 'retranslate-block',
        label: translationBusy
          ? l('翻译进行中', 'Translation in progress')
          : l('重新翻译此块', 'Retranslate This Block'),
        icon: <RefreshCw className="h-4 w-4" strokeWidth={1.9} />,
        disabled: translationBusy,
        tone: entries.length > 0 ? 'default' : 'accent',
        onSelect: () => onRetranslateBlock(contextMenu.block),
      });
    }

    if (pdfSource && isValidBBox(contextMenu.block.bbox)) {
      const isCropActive = cropBlockIds.has(contextMenu.block.blockId);
      entries.push({
        id: 'toggle-pdf-crop',
        label: isCropActive
          ? l('切换回排版文本', 'Show Parsed Text')
          : l('切换为原 PDF 切片', 'View Original PDF Crop'),
        icon: <Scan className="h-4 w-4" strokeWidth={1.9} />,
        tone: 'default',
        onSelect: () => handleToggleBlockCrop(contextMenu.block.blockId),
      });
    }

    const blockTextForReparse =
      blockOverrides[contextMenu.block.blockId] || resolveContextMarkdown(contextMenu.block);

    entries.push({
      id: 'edit-block',
      label: l('编辑识别结果', 'Edit Recognized Content'),
      icon: <Pencil className="h-4 w-4" strokeWidth={1.9} />,
      tone: 'accent',
      onSelect: () => {
        handleOpenReparse(contextMenu.block, 'manual');
      },
    });

    entries.push({
      id: 'reparse-block-ai',
      label: l('✨ AI 重新识别此块', '✨ AI Re-parse This Block'),
      icon: <Sparkles className="h-4 w-4 text-[var(--pq-accent)]" strokeWidth={1.9} />,
      tone: 'default',
      disabled: !blockTextForReparse && !(pdfSource && isValidBBox(contextMenu.block.bbox)),
      onSelect: () => {
        handleOpenReparse(contextMenu.block, 'ai');
      },
    });

    entries.push({
      id: 'delete-block',
      label: l('删除此块（隐藏）', 'Delete This Block'),
      icon: <Trash2 className="h-4 w-4" strokeWidth={1.9} />,
      tone: 'danger',
      onSelect: () => handleDeleteBlock(contextMenu.block),
    });

    return entries;
  }, [
    blockOverrides,
    contextMenu,
    cropBlockIds,
    handleDeleteBlock,
    handleOpenReparse,
    handleToggleBlockCrop,
    l,
    mineruPath,
    pdfSource,
    renderableBlocks,
    translationBusy,
  ]);

  const emitSelectedText = () => {
    if (!onTextSelect) {
      return;
    }

    window.requestAnimationFrame(() => {
      const selection = getScopedSelectionPayload(containerRef.current);

      if (!selection) {
        lastSelectionRef.current = null;
        return;
      }

      const now = Date.now();

      if (
        lastSelectionRef.current &&
        lastSelectionRef.current.text === selection.text &&
        now - lastSelectionRef.current.emittedAt < 250
      ) {
        return;
      }

      lastSelectionRef.current = {
        text: selection.text,
        emittedAt: now,
      };
      onTextSelect(selection);
    });
  };

  const clearSelectionCommitTimer = () => {
    if (selectionCommitTimerRef.current !== null) {
      window.clearTimeout(selectionCommitTimerRef.current);
      selectionCommitTimerRef.current = null;
    }
  };

  const scheduleSelectionCommit = (delay = 48) => {
    if (!active || !onTextSelect) {
      return;
    }

    clearSelectionCommitTimer();
    selectionCommitTimerRef.current = window.setTimeout(() => {
      selectionCommitTimerRef.current = null;
      emitSelectedText();
    }, delay);
  };

  useLayoutEffect(() => {
    if (!active || !activeBlockId) {
      return undefined;
    }

    const items = windowParamsRef.current.visibleBlocks;
    const index = items.findIndex((block) => block.blockId === activeBlockId);

    if (index < 0) {
      return undefined;
    }

    const scroller = listRef.current;

    if (scroller) {
      const offset = getVirtualOffset(index, getItemSize);
      const target = Math.max(0, offset - scroller.clientHeight / 3);

      if (Math.abs(scroller.scrollTop - target) > 2) {
        scroller.scrollTop = target;
      }
    }

    updateListWindow();

    const scrollToActiveBlock = (behavior: ScrollBehavior) => {
      const element = blockRefs.current[activeBlockId];

      if (!element) {
        return false;
      }

      element.scrollIntoView({
        behavior,
        block: 'center',
      });
      return true;
    };

    const mounted = Boolean(blockRefs.current[activeBlockId]);
    const didScroll = scrollToActiveBlock(mounted && smoothScroll ? 'smooth' : 'auto');
    const retryFrame = window.requestAnimationFrame(() => {
      updateListWindow();
      window.requestAnimationFrame(() => {
        scrollToActiveBlock('auto');
      });
    });
    const retryTimer = didScroll
      ? 0
      : window.setTimeout(() => {
          updateListWindow();
          scrollToActiveBlock('auto');
        }, 80);

    setFlashBlockId(activeBlockId);

    const timer = window.setTimeout(() => {
      setFlashBlockId((current) => (current === activeBlockId ? null : current));
    }, 1200);

    return () => {
      window.cancelAnimationFrame(retryFrame);
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      window.clearTimeout(timer);
    };
  }, [active, activeBlockId, getItemSize, scrollSignal, smoothScroll, updateListWindow, visibleBlocks.length]);

  useEffect(() => {
    const container = containerRef.current;

    if (!active || !container) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      updateContentScale(event.deltaY < 0 ? CONTENT_SCALE_STEP : -CONTENT_SCALE_STEP);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [active, updateContentScale]);

  useEffect(() => {
    if (!active || !onTextSelect) {
      return undefined;
    }

    const isEventInsideContainer = (event: Event) => {
      const container = containerRef.current;
      const target = event.target;

      return Boolean(container && target instanceof Node && container.contains(target));
    };

    const handleSelectionStart = (event: MouseEvent | PointerEvent) => {
      selectionStartedInsideRef.current = isEventInsideContainer(event);
    };

    const handleMouseSelectionCommit = (event: MouseEvent) => {
      const shouldReadSelection =
        selectionStartedInsideRef.current || isEventInsideContainer(event);

      selectionStartedInsideRef.current = false;

      if (!shouldReadSelection) {
        return;
      }

      scheduleSelectionCommit();
    };

    const handleKeyboardSelectionCommit = (event: KeyboardEvent) => {
      if (!isEventInsideContainer(event)) {
        return;
      }

      scheduleSelectionCommit();
    };

    const handleSelectionChange = () => {
      const selectionInside = selectionBelongsToContainer(containerRef.current);

      if (!selectionStartedInsideRef.current && !selectionInside) {
        return;
      }
    };

    document.addEventListener('pointerdown', handleSelectionStart);
    document.addEventListener('mousedown', handleSelectionStart);
    document.addEventListener('mouseup', handleMouseSelectionCommit);
    document.addEventListener('keyup', handleKeyboardSelectionCommit);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      clearSelectionCommitTimer();
      document.removeEventListener('pointerdown', handleSelectionStart);
      document.removeEventListener('mousedown', handleSelectionStart);
      document.removeEventListener('mouseup', handleMouseSelectionCommit);
      document.removeEventListener('keyup', handleKeyboardSelectionCommit);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [active, onTextSelect]);

  if (visibleBlocks.length === 0) {
    return (
      <EmptyState
        title={l('等待结构化内容', 'Waiting for structured content')}
        description={l('打开或加载 MinerU JSON 文件后，这里会按块显示论文内容，并与左侧 PDF 保持几何联动。', 'After opening or loading a MinerU JSON file, this panel will show the paper block by block and stay geometrically linked to the PDF on the left.',
        )}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col bg-[var(--pq-bg-primary)] text-[var(--pq-text)]"
      onMouseUp={active ? () => scheduleSelectionCommit() : undefined}
      onKeyUp={active ? () => scheduleSelectionCommit() : undefined}
    >
      {!hideToolbar ? (
        <div className="sticky top-0 z-40 px-3 pt-1">
          <div className="pq-toolbar mx-auto flex h-9 w-fit max-w-full items-center gap-2 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] px-2">
            <IconButton
              className="shrink-0"
              title={l(
                `${visibleBlocks.length} 个块，${translatedCount} 个译文块。点击块可反向定位到 PDF 几何区域。`,
                `${visibleBlocks.length} blocks, ${translatedCount} translated blocks. Click a block to jump back to the PDF geometry region.`,
              )}
              aria-label={l('结构化阅读信息', 'Structured reading information')}
            >
              <Info className="h-4 w-4" strokeWidth={1.8} />
            </IconButton>

            {editCount > 0 ? (
              <button
                type="button"
                onClick={() => setEditsDialogOpen(true)}
                title={l(
                  '查看并恢复手动调整过的识别结果',
                  'Review and restore manually adjusted recognized content',
                )}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--pq-radius-sm)] border border-[color-mix(in_srgb,var(--pq-accent)_28%,transparent)] bg-[var(--pq-accent-bg)] px-2 py-1 text-[11px] font-medium text-[var(--pq-accent)]"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                {l(`识别结果 ${editCount}`, `Edits ${editCount}`)}
                {staleCount > 0 ? <span className="text-[var(--pq-text-faint)]">· {staleCount} 失效</span> : null}
              </button>
            ) : null}

            <div className="flex min-w-0 items-center gap-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] p-0.5 text-[11px] text-[var(--pq-text-muted)]">
              {displayModeOptions.map((option) => {
                const selected = option.mode === activeDisplayMode;

                return (
                  <button
                    key={option.mode}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => onTranslationDisplayModeChange?.(option.mode)}
                    className={cn(
                      'pq-nav-item !h-7 px-2 text-[11px] font-medium',
                      selected && 'active !text-[var(--pq-accent)]',
                      option.disabled && 'cursor-not-allowed opacity-45',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-1 rounded-[var(--pq-radius-sm)] border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-1 text-[11px] text-[var(--pq-text-muted)]">
              <IconButton
                size="sm"
                onClick={() => updateContentScale(-CONTENT_SCALE_STEP)}
                aria-label={l('缩小正文', 'Zoom out content')}
              >
                <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.9} />
              </IconButton>
              <span className="min-w-10 text-center font-medium text-[var(--pq-text-muted)]">
                {Math.round(contentScale * 100)}%
              </span>
              <IconButton
                size="sm"
                onClick={() => updateContentScale(CONTENT_SCALE_STEP)}
                aria-label={l('放大正文', 'Zoom in content')}
              >
                <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.9} />
              </IconButton>
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={listRef}
        data-block-viewer-scroll
        className={cn('min-h-0 flex-1 overflow-y-auto', compactMode ? 'px-6 py-6' : 'px-8 py-8')}
        onScroll={scheduleListWindowUpdate}
      >
        <article className={cn('mx-auto max-w-[960px]', compactMode ? 'pb-12' : 'pb-16')}>
          <div
            style={{
              paddingTop: blockWindow.paddingStart,
              paddingBottom: blockWindow.paddingEnd,
            }}
          >
            <div className="space-y-1">
              {renderableBlocks.map((renderable) => (
                <BlockItem
                  key={renderable.block.blockId}
                  renderable={renderable}
                  pdfSource={pdfSource}
                  showPdfCrop={cropBlockIds.has(renderable.block.blockId)}
                  onTogglePdfCrop={() => handleToggleBlockCrop(renderable.block.blockId)}
                  active={renderable.block.blockId === activeBlockId}
                  hovered={renderable.block.blockId === hoveredBlockId}
                  flashing={renderable.block.blockId === flashBlockId}
                  scale={contentScale}
                  showBlockMeta={showBlockMeta}
                  compactMode={compactMode}
                  translatedText={translations[renderable.block.blockId]}
                  translationDisplayMode={translationDisplayMode}
                  customOverrideMarkdown={blockOverrides[renderable.block.blockId]}
                  onOpenReparse={handleOpenReparse}
                  onClick={onBlockClick}
                  onContextMenu={handleBlockContextMenu}
                  registerRef={registerBlockRef}
                />
              ))}
            </div>
          </div>

          <div className="mt-8 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--pq-border)] bg-[var(--pq-surface-1)] px-3 py-1.5 text-xs text-[var(--pq-text-faint)] shadow-[var(--pq-shadow-soft)]">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
              {l(
                '左侧 PDF 与右侧结构块保持几何联动',
                'The PDF on the left stays geometrically linked with the structured blocks on the right',
              )}
            </div>
          </div>
        </article>
      </div>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={l(
            `第 ${contextMenu.block.pageIndex + 1} 页 · 块 ${contextMenu.block.blockIndex + 1}`,
            `Page ${contextMenu.block.pageIndex + 1} · Block ${contextMenu.block.blockIndex + 1}`,
          )}
          entries={contextMenuEntries}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {reparseTarget ? (
        <BlockReparseModal
          key={`${reparseTarget.block.blockId}:${reparseTarget.mode}`}
          block={reparseTarget.block}
          pdfSource={pdfSource}
          storageReady={storageReady}
          storageError={storageError}
          initialText={reparseTarget.initialText}
          currentText={reparseTarget.currentText}
          initialTab={reparseTarget.mode}
          hasCustomOverride={Boolean(blockOverrides[reparseTarget.block.blockId])}
          onApply={handleApplyReparse}
          onReset={handleResetReparse}
          onDelete={handleDeleteReparse}
          onClose={() => setReparseTarget(null)}
        />
      ) : null}

      {editsDialogOpen ? (
        <ParseEditsDialog
          blocks={blocks}
          edits={edits}
          staleCount={staleCount}
          onRestoreBlock={blockReparse.restoreBlock}
          onRestoreAll={blockReparse.restoreAll}
          onClose={() => setEditsDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default memo(BlockViewer);

