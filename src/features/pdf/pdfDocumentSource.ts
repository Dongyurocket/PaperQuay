import type { PdfSource } from '../../types/reader';
import { PDFJS_COMPATIBILITY_OPTIONS } from '../../utils/pdfJsCompatibility.ts';

export const LOCAL_PDF_PROTOCOL = 'paperquay-pdf';

export interface PdfJsDocumentInit {
  cMapPacked?: boolean;
  cMapUrl?: string;
  data?: Uint8Array;
  disableAutoFetch?: boolean;
  disableFontFace?: boolean;
  disableRange?: boolean;
  disableStream?: boolean;
  enableHWA?: boolean;
  fontExtraProperties?: boolean;
  isEvalSupported?: boolean;
  isOffscreenCanvasSupported?: boolean;
  rangeChunkSize?: number;
  standardFontDataUrl?: string;
  stopAtErrors?: boolean;
  useSystemFonts?: boolean;
  useWorkerFetch?: boolean;
  httpHeaders?: Record<string, string>;
  url?: string;
}

const PDF_LOADING_OPTIONS = {
  ...PDFJS_COMPATIBILITY_OPTIONS,
  disableAutoFetch: true,
  enableHWA: true,
  isEvalSupported: false,
  isOffscreenCanvasSupported: true,
  rangeChunkSize: 1024 * 1024,
} as const;

const URL_PDF_LOADING_OPTIONS = {
  ...PDF_LOADING_OPTIONS,
  disableStream: false,
} as const;

export function buildLocalPdfProtocolUrl(path: string): string {
  return `${LOCAL_PDF_PROTOCOL}://local/?path=${encodeURIComponent(path)}`;
}

export function buildPdfJsDocumentInit(
  source: PdfSource,
  pdfData: Uint8Array | null,
): PdfJsDocumentInit | null {
  if (source?.kind === 'local-path') {
    return {
      ...URL_PDF_LOADING_OPTIONS,
      url: buildLocalPdfProtocolUrl(source.path),
    };
  }

  if (source?.kind === 'remote-url') {
    return source.headers
      ? {
          ...URL_PDF_LOADING_OPTIONS,
          url: source.url,
          httpHeaders: source.headers,
        }
      : {
          ...URL_PDF_LOADING_OPTIONS,
          url: source.url,
        };
  }

  if (pdfData) {
    return {
      ...PDF_LOADING_OPTIONS,
      data: pdfData,
    };
  }

  return null;
}

const PDF_DATA_SAMPLE_WINDOW = 8;
const PDF_DATA_SAMPLE_WINDOWS = 64;

/**
 * 对内存 PDF 取固定成本的采样指纹（FNV-1a）：首、中、尾及等距窗口参与，
 * 覆盖同长度但中间字节变化的场景。字节数不同必然得到不同签名。
 */
export function getPdfDataSignature(data: Uint8Array | null | undefined): string {
  if (!data) {
    return '';
  }

  const { length } = data;
  const windowSize = Math.min(PDF_DATA_SAMPLE_WINDOW, length);
  const windowCount = Math.min(PDF_DATA_SAMPLE_WINDOWS, length);
  const maxStart = length - windowSize;
  let hash = 2166136261;

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const start = windowCount <= 1 ? 0 : Math.floor((maxStart * windowIndex) / (windowCount - 1));
    for (let offset = 0; offset < windowSize; offset += 1) {
      hash = Math.imul(hash ^ data[start + offset], 16777619) >>> 0;
    }
  }

  return `data:${length}:${hash.toString(16).padStart(8, '0')}`;
}

export function getPdfSourceSignature(
  source: PdfSource,
  fallback = '',
  pdfData?: Uint8Array | null,
): string {
  if (source?.kind === 'local-path') {
    return `local:${source.path}`;
  }

  if (source?.kind === 'remote-url') {
    return `remote:${source.url}`;
  }

  // source 为空时由内存数据承载 PDF：签名必须跟随字节内容，而不是显示名/文件名。
  // 否则重命名会触发一次无谓的重新加载，而真正换掉字节反而看不出变化。
  if (pdfData) {
    return getPdfDataSignature(pdfData);
  }

  return fallback;
}
