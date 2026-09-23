import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useState } from 'react';

import type { PdfSource, PositionedMineruBlock } from '../../types/reader';
import { bboxToRect, isValidBBox } from '../../utils/bbox';
import {
  ByteBudgetLruCache,
  DEFAULT_CROP_CACHE_BUDGET_BYTES,
  DEFAULT_PDF_DOC_CACHE_BUDGET_BYTES,
  estimateDataUrlBytes,
  estimatePdfDocumentBytes,
} from '../reader/readerResourceBudget';
import { buildPdfJsDocumentInit, getPdfSourceSignature } from './pdfDocumentSource';
import { releasePdfDocument, releasePdfLoadingTask, resolveBBoxBaseSize } from './pdfViewerUtils';

if (typeof window !== 'undefined' && GlobalWorkerOptions && workerUrl) {
  GlobalWorkerOptions.workerSrc = workerUrl;
}

interface CachedPdfDocEntry {
  promise: Promise<any>;
  doc?: any;
  loadingTask?: any;
  sourceKey: string;
}

const cropDataUrlCache = new ByteBudgetLruCache<string>({
  maxBytes: DEFAULT_CROP_CACHE_BUDGET_BYTES,
  computeBytes: (url) => estimateDataUrlBytes(url),
});

const pdfDocCache = new ByteBudgetLruCache<CachedPdfDocEntry>({
  maxBytes: DEFAULT_PDF_DOC_CACHE_BUDGET_BYTES,
  computeBytes: (entry) => estimatePdfDocumentBytes(entry.doc),
});

export function clearPdfBlockCropCache(): void {
  cropDataUrlCache.clear();
  pdfDocCache.clear();
}

export function getPdfBlockCropCacheStats() {
  return {
    cropCacheBytes: cropDataUrlCache.getCurrentBytes(),
    cropCacheSize: cropDataUrlCache.size(),
    cropCacheMaxBytes: cropDataUrlCache.getMaxBytes(),
    pdfDocCacheBytes: pdfDocCache.getCurrentBytes(),
    pdfDocCacheSize: pdfDocCache.size(),
    pdfDocCacheMaxBytes: pdfDocCache.getMaxBytes(),
  };
}

export async function getPdfBlockCropDataUrl(
  source: PdfSource,
  block: PositionedMineruBlock,
  scale = 2.0,
): Promise<string | null> {
  if (!source || !block || !isValidBBox(block.bbox) || typeof document === 'undefined') {
    return null;
  }

  const sourceKey = getPdfSourceSignature(source) || 'default-pdf';
  // A reparse can reuse block IDs while moving or resizing their PDF regions.
  const cacheKey = JSON.stringify([sourceKey, block.blockId, block.pageIndex, block.bbox, block.bboxCoordinateSystem, block.bboxPageSize, scale]);

  if (cropDataUrlCache.has(cacheKey)) {
    return cropDataUrlCache.get(cacheKey)!;
  }

  try {
    let cachedEntry = pdfDocCache.get(sourceKey);
    if (!cachedEntry) {
      const documentInit = buildPdfJsDocumentInit(source, null);
      if (!documentInit) {
        return null;
      }

      const loadingTask = getDocument(documentInit as any);
      const promise = loadingTask.promise;
      cachedEntry = {
        promise,
        loadingTask,
        sourceKey,
      };
      pdfDocCache.set(sourceKey, cachedEntry, {
        bytes: estimatePdfDocumentBytes(null),
        onEvict: (entry) => {
          if (entry.loadingTask) {
            releasePdfLoadingTask(entry.loadingTask);
          }
          if (entry.doc) {
            releasePdfDocument(entry.doc);
          }
        },
      });
    }

    const releaseBorrow = pdfDocCache.acquire(sourceKey);
    let pdfDoc: any = null;

    try {
      pdfDoc = await cachedEntry.promise;
      cachedEntry.doc = pdfDoc;
      pdfDocCache.set(sourceKey, cachedEntry, {
        bytes: estimatePdfDocumentBytes(pdfDoc),
      });

      const pageNumber = block.pageIndex + 1;
      if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
        return null;
      }

      const page = await pdfDoc.getPage(pageNumber);
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      const baseSize = resolveBBoxBaseSize(block, {
        width: unscaledViewport.width,
        height: unscaledViewport.height,
      });

      const rect = bboxToRect(
        block.bbox,
        baseSize,
        { width: unscaledViewport.width, height: unscaledViewport.height },
      );

      // 预留微小边距，防止字形或笔画被贴边截断
      const padding = 6;
      const cropLeft = Math.max(0, rect.left - padding);
      const cropTop = Math.max(0, rect.top - padding);
      const cropWidth = Math.min(unscaledViewport.width - cropLeft, rect.width + padding * 2);
      const cropHeight = Math.min(unscaledViewport.height - cropTop, rect.height + padding * 2);

      if (cropWidth <= 0 || cropHeight <= 0) {
        return null;
      }

      const viewport = page.getViewport({ scale });
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = Math.ceil(viewport.width);
      tempCanvas.height = Math.ceil(viewport.height);

      const tempCtx = tempCanvas.getContext('2d', { alpha: false });
      if (!tempCtx) {
        return null;
      }

      tempCtx.fillStyle = '#ffffff';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      await page.render({
        canvasContext: tempCtx,
        viewport,
        background: '#ffffff',
      }).promise;

      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = Math.round(cropWidth * scale);
      finalCanvas.height = Math.round(cropHeight * scale);

      const finalCtx = finalCanvas.getContext('2d');
      if (!finalCtx) {
        return null;
      }

      finalCtx.drawImage(
        tempCanvas,
        Math.round(cropLeft * scale),
        Math.round(cropTop * scale),
        finalCanvas.width,
        finalCanvas.height,
        0,
        0,
        finalCanvas.width,
        finalCanvas.height,
      );

      const dataUrl = finalCanvas.toDataURL('image/png');
      cropDataUrlCache.set(cacheKey, dataUrl);

      return dataUrl;
    } catch (innerError) {
      // 若文档加载失败，清理错误的缓存条目
      if (!cachedEntry.doc) {
        pdfDocCache.delete(sourceKey);
      }
      throw innerError;
    } finally {
      releaseBorrow();
    }
  } catch (error) {
    console.error('Failed to render PDF block crop:', error);
    return null;
  }
}

export function usePdfBlockCrop(
  source?: PdfSource,
  block?: PositionedMineruBlock,
  enabled = true,
) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !source || !block || !isValidBBox(block.bbox)) {
      setDataUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPdfBlockCropDataUrl(source, block)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setDataUrl(url);
        } else {
          setError('未生成切片');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '切片生成失败');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source, block, enabled]);

  return { dataUrl, loading, error };
}
